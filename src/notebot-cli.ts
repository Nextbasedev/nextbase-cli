#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { loadConfig, updateConfig, type Provider } from './config.js';
import { createPrompt } from './prompt.js';
import { startRecording, stopRecording } from './audio.js';
import { transcribeFile } from './transcribe.js';
import { verifyProviderKey } from './verify.js';
import { analyzeMeeting } from './notebot-ai.js';
import { clearActiveMeeting, loadActiveMeeting, loadMeetings, saveActiveMeeting, saveMeeting, type ActiveMeeting } from './notebot-storage.js';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [command, ...args] = process.argv.slice(2);

async function main() {
  if (command === 'setup') return setup();
  if (command === 'meeting') return meeting(args);
  if (command === 'history') return history();
  if (command === 'tasks') return tasks();
  if (command === '_record') return recordWorker(args[0]);
  return help();
}

function help() {
  console.log(`Nextbase NoteBot

Commands:
  notebot setup                  Configure transcription and meeting-summary keys
  notebot meeting start          Start background meeting recording
  notebot meeting stop           Stop, transcribe, and create meeting notes
  notebot meeting status         Show active meeting state
  notebot history                Show saved meetings
  notebot tasks                  Show open extracted tasks
`);
}

async function setup() {
  const prompt = createPrompt();
  try {
    const config = await loadConfig();
    const provider = await prompt.choose('Meeting transcription provider:', ['Sarvam (best for Hindi/Gujarati/English mix)', 'Groq (fast general fallback)']);
    const selected: Provider = provider.startsWith('Sarvam') ? 'sarvam' : 'groq';
    const existingSttKey = config.keys?.[selected];
    if (!existingSttKey) {
      const key = await prompt.ask(`Paste ${selected} API key: `);
      const result = await verifyProviderKey(selected, key);
      console.log(result.message);
      if (!result.ok) throw new Error(`Could not verify ${selected} key. Setup stopped.`);
      await updateConfig({ provider: selected, model: selected === 'sarvam' ? 'saarika:v2' : 'whisper-large-v3-turbo', keys: { [selected]: key } });
    } else {
      await updateConfig({ provider: selected, model: selected === 'sarvam' ? 'saarika:v2' : 'whisper-large-v3-turbo' });
      console.log(`${selected} key already saved.`);
    }

    const refreshed = await loadConfig();
    if (!refreshed.keys?.groq) {
      const groqKey = await prompt.ask('Paste Groq API key for summaries/tasks: ');
      const result = await verifyProviderKey('groq', groqKey);
      console.log(result.message);
      if (!result.ok) throw new Error('Could not verify Groq key. Setup stopped.');
      await updateConfig({ keys: { groq: groqKey }, polishModel: 'llama-3.3-70b-versatile' });
    } else {
      console.log('Groq summary key already saved.');
    }

    console.log('NoteBot setup complete. Start with: notebot meeting start');
  } finally {
    prompt.close();
  }
}

async function meeting(args: string[]) {
  const action = args[0]?.toLowerCase();
  if (action === 'start') return startMeeting();
  if (action === 'stop') return stopMeeting();
  if (action === 'status') return meetingStatus();
  throw new Error('Usage: notebot meeting start/stop/status');
}

async function ensureConfigured() {
  let config = await loadConfig();
  if (!config.provider || !config.keys?.[config.provider] || !config.keys?.groq) {
    if (!process.stdin.isTTY) throw new Error('NoteBot keys are not configured. Run: notebot setup');
    console.log('NoteBot needs transcription and Groq summary keys. Starting setup...');
    await setup();
    config = await loadConfig();
  }
  if (!config.provider || !config.keys?.[config.provider] || !config.keys?.groq) {
    throw new Error('NoteBot keys are not configured. Run: notebot setup');
  }
  return config;
}

async function startMeeting() {
  await ensureConfigured();
  const active = await loadActiveMeeting();
  if (active?.status === 'starting' || active?.status === 'recording') {
    throw new Error('A meeting is already recording. Run: notebot meeting stop');
  }

  const id = `meeting-${Date.now()}`;
  await saveActiveMeeting({ id, startedAt: Date.now(), status: 'starting' });
  const cliPath = fileURLToPath(new URL('./notebot-cli.js', import.meta.url));
  const child = spawn(process.execPath, [cliPath, '_record', id], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  await saveActiveMeeting({ id, startedAt: Date.now(), status: 'starting', pid: child.pid });
  console.log(`Meeting recording started in background. ID: ${id}`);
  console.log('When the meeting ends, run: notebot meeting stop');
}

async function recordWorker(id?: string) {
  const active = await loadActiveMeeting();
  if (!id || !active || active.id !== id) process.exit(1);
  const config = await loadConfig();
  const file = await startRecording(config.audioDevice);
  await saveActiveMeeting({ ...active, status: 'recording', audioPath: file, pid: process.pid });

  const stop = async () => {
    try {
      const finished = await stopRecording();
      const current = await loadActiveMeeting();
      if (current?.id === id) await saveActiveMeeting({ ...current, status: 'recorded', audioPath: finished.file });
      process.exit(0);
    } catch {
      process.exit(1);
    }
  };
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
  await new Promise(() => undefined);
}

async function stopMeeting() {
  const active = await loadActiveMeeting();
  if (!active || active.status === null) throw new Error('No active meeting. Run: notebot meeting start');
  if (active.status !== 'recorded' && active.pid) {
    try { process.kill(active.pid, 'SIGTERM'); } catch { /* recorder may already have stopped */ }
  }

  let recorded = active;
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const latest = await loadActiveMeeting();
    if (latest?.status === 'recorded' && latest.audioPath && existsSync(latest.audioPath)) {
      recorded = latest;
      break;
    }
  }

  if (recorded.status !== 'recorded' || !recorded.audioPath || !existsSync(recorded.audioPath)) {
    throw new Error('Meeting recorder did not finalize audio. Try: notebot meeting status');
  }

  const info = await stat(recorded.audioPath);
  if (info.size < 1024) throw new Error('Meeting audio is empty. Check microphone/system-audio setup.');

  console.log('Transcribing meeting...');
  const config = await ensureConfigured();
  const transcript = await transcribeFile(recorded.audioPath, config);
  if (!transcript) throw new Error('Meeting transcription returned no text.');

  console.log('Extracting summary, decisions, and action items...');
  const analysis = await analyzeMeeting(transcript, config);
  const note = {
    id: recorded.id,
    createdAt: new Date(recorded.startedAt).toISOString(),
    durationMs: Date.now() - recorded.startedAt,
    audioPath: recorded.audioPath,
    transcript,
    ...analysis
  };
  await saveMeeting(note);
  await clearActiveMeeting();

  console.log(`Saved: ${note.title}`);
  console.log(`Decisions: ${note.decisions.length} | Tasks: ${note.actionItems.length}`);
  for (const task of note.actionItems) console.log(`- [${task.confidence}] ${task.task}${task.owner ? ` — ${task.owner}` : ''}`);
}

async function meetingStatus() {
  const active = await loadActiveMeeting();
  if (!active) return console.log('No active meeting.');
  const seconds = Math.round((Date.now() - active.startedAt) / 1000);
  console.log(`Meeting: ${active.id}`);
  console.log(`Status: ${active.status}`);
  console.log(`Duration: ${seconds}s`);
  console.log(`Audio: ${active.audioPath || 'initializing'}`);
}

async function history() {
  const meetings = await loadMeetings();
  if (!meetings.length) return console.log('No saved meetings.');
  for (const note of meetings.slice(0, 20)) console.log(`${note.createdAt}  ${note.title}  (${note.actionItems.length} tasks)`);
}

async function tasks() {
  const meetings = await loadMeetings();
  const items = meetings.flatMap((note) => note.actionItems.map((task) => ({ ...task, title: note.title })));
  if (!items.length) return console.log('No extracted tasks.');
  for (const task of items) console.log(`- [${task.confidence}] ${task.task}${task.owner ? ` — ${task.owner}` : ''} (${task.title})`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
