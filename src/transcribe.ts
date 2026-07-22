import { mkdir, readFile, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import type { Config } from './config.js';

export async function transcribeFile(file: string, config: Config): Promise<string> {
  if (!config.provider) throw new Error('No provider configured. Run wisper setup.');
  const key = config.keys?.[config.provider];
  if (!key) throw new Error(`No API key saved for ${config.provider}. Run wisper setup.`);

  if (config.provider === 'groq') return transcribeGroq(file, key, config.model || 'whisper-large-v3-turbo');
  if (config.provider === 'elevenlabs') return transcribeElevenLabs(file, key, config.model || 'scribe_v2');
  if (config.provider === 'sarvam') {
    try {
      return await transcribeSarvamWithChunks(file, key, config.model || 'saaras:v3');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const groqKey = config.keys?.groq;
      if (groqKey && /duration exceeds|maximum limit|30 seconds|batch api|sox|chunk/i.test(message)) {
        console.warn('Sarvam chunking failed. Emergency fallback to Groq Whisper for this file...');
        return transcribeGroq(file, groqKey, 'whisper-large-v3-turbo');
      }
      throw error;
    }
  }
  throw new Error('Unsupported provider');
}

async function audioForm(file: string) {
  const bytes = await readFile(file);
  const name = basename(file).match(/\.(wav|mp3|flac|m4a|ogg|opus|webm|mp4|mpeg|mpga)$/i)
    ? basename(file)
    : `${basename(file)}.wav`;
  const audioFile = new File([bytes], name, { type: 'audio/wav' });
  return { audioFile, name };
}

async function transcribeGroq(file: string, key: string, model: string) {
  const { audioFile } = await audioForm(file);
  const form = new FormData();
  form.set('file', audioFile);
  form.set('model', model);
  form.set('response_format', 'json');

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: form
  });
  const body = await response.json().catch(() => ({})) as { text?: string; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || `Groq transcription failed: HTTP ${response.status}`);
  return (body.text || '').trim();
}

async function transcribeElevenLabs(file: string, key: string, model: string) {
  const { audioFile } = await audioForm(file);
  const form = new FormData();
  form.set('file', audioFile);
  form.set('model_id', model);

  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': key },
    body: form
  });
  const body = await response.json().catch(() => ({})) as { text?: string; detail?: string };
  if (!response.ok) throw new Error(body.detail || `ElevenLabs transcription failed: HTTP ${response.status}`);
  return (body.text || '').trim();
}

function soxCommand() {
  return process.platform === 'win32' ? 'sox.exe' : 'sox';
}

function audioDurationSeconds(file: string): number | undefined {
  const result = spawnSync(soxCommand(), ['--i', '-D', file], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) return undefined;
  const duration = Number((result.stdout || '').trim());
  return Number.isFinite(duration) && duration > 0 ? duration : undefined;
}

function runSox(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(soxCommand(), args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `SoX failed with code ${code}`)));
  });
}

async function splitAudio(file: string, duration: number, chunkSeconds = 28) {
  const dir = join(homedir(), '.wisper-cli', 'tmp', `sarvam-chunks-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  const chunks: string[] = [];
  for (let start = 0, index = 0; start < duration; start += chunkSeconds, index += 1) {
    const chunk = join(dir, `chunk-${String(index + 1).padStart(4, '0')}.wav`);
    const length = Math.min(chunkSeconds, Math.max(0.1, duration - start));
    await runSox([file, '-r', '16000', '-c', '1', '-b', '16', chunk, 'trim', String(start), String(length)]);
    chunks.push(chunk);
  }
  return { dir, chunks };
}

async function transcribeSarvamWithChunks(file: string, key: string, model: string) {
  const duration = audioDurationSeconds(file);
  if (!duration || duration <= 29) return transcribeSarvam(file, key, model);

  console.warn(`Sarvam REST supports audio under 30s. Splitting ${Math.round(duration)}s audio into 28s chunks...`);
  const { dir, chunks } = await splitAudio(file, duration);
  try {
    const transcripts: string[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      console.warn(`Sarvam chunk ${index + 1}/${chunks.length}...`);
      const text = await transcribeSarvam(chunks[index], key, model);
      if (text) transcripts.push(text);
    }
    return transcripts.join('\n').trim();
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function transcribeSarvam(file: string, key: string, model: string) {
  const { audioFile } = await audioForm(file);
  const form = new FormData();
  form.set('file', audioFile);
  const sarvamModel = model === 'saarika:v2' ? 'saarika:v2.5' : model;
  form.set('model', sarvamModel);
  if (sarvamModel === 'saaras:v3') form.set('mode', 'transcribe');
  form.set('language_code', 'unknown');

  const response = await fetch('https://api.sarvam.ai/speech-to-text', {
    method: 'POST',
    headers: { 'api-subscription-key': key },
    body: form
  });
  const body = await response.json().catch(() => ({})) as { transcript?: string; text?: string; error?: { message?: string }; message?: string; detail?: string };
  if (!response.ok) throw new Error(body.error?.message || body.message || body.detail || `Sarvam transcription failed: HTTP ${response.status}`);
  return (body.transcript || body.text || '').trim();
}
