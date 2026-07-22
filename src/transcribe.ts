import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Config } from './config.js';

export async function transcribeFile(file: string, config: Config): Promise<string> {
  if (!config.provider) throw new Error('No provider configured. Run wisper setup.');
  const key = config.keys?.[config.provider];
  if (!key) throw new Error(`No API key saved for ${config.provider}. Run wisper setup.`);

  if (config.provider === 'groq') return transcribeGroq(file, key, config.model || 'whisper-large-v3-turbo');
  if (config.provider === 'elevenlabs') return transcribeElevenLabs(file, key, config.model || 'scribe_v2');
  if (config.provider === 'sarvam') return transcribeSarvam(file, key, config.model || 'saaras:v3');
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
