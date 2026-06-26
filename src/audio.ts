import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { preferredInputDevice } from './devices.js';

const activeSignals = ['SIGINT', 'SIGTERM'] as const;

type ActiveRecording = {
  process: ChildProcess;
  file: string;
  startedAt: number;
  done: Promise<void>;
};

let active: ActiveRecording | undefined;

export function isRecording() {
  return Boolean(active);
}

function soxCommand() {
  return process.platform === 'win32' ? 'sox.exe' : 'sox';
}

function soxRecordArgs(file: string, audioDevice?: string) {
  if (process.platform === 'win32') {
    return ['-t', 'waveaudio', preferredInputDevice(audioDevice), '-r', '16000', '-c', '1', '-b', '16', file];
  }

  return ['-d', '-r', '16000', '-c', '1', '-b', '16', file];
}

export async function startRecording(audioDevice?: string): Promise<string> {
  if (active) throw new Error('Recording already active');

  const dir = join(homedir(), '.wisper-cli', 'tmp');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `recording-${Date.now()}.wav`);

  const child = spawn(soxCommand(), soxRecordArgs(file, audioDevice), {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const done = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0 || code === null || activeSignals.includes((child.signalCode || '') as typeof activeSignals[number])) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `SoX exited with code ${code}`));
    });
  });

  active = { process: child, file, startedAt: Date.now(), done };
  return file;
}

export async function stopRecording(): Promise<{ file: string; durationMs: number }> {
  if (!active) throw new Error('Recording is not active');

  const current = active;
  active = undefined;

  current.process.stdin?.write('q');
  current.process.stdin?.end();

  await Promise.race([
    current.done.catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 250))
  ]);

  if (!current.process.killed && current.process.exitCode === null) {
    if (process.platform === 'win32') {
      spawn('taskkill.exe', ['/PID', String(current.process.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      current.process.kill('SIGINT');
    }
    await current.done.catch(() => undefined);
  }
  return { file: current.file, durationMs: Date.now() - current.startedAt };
}


export async function cleanupOldRecordings(options = { maxFiles: 30, maxAgeMs: 24 * 60 * 60 * 1000 }) {
  const dir = join(homedir(), '.wisper-cli', 'tmp');
  let files: { path: string; mtimeMs: number }[] = [];
  try {
    const names = await readdir(dir);
    files = await Promise.all(names
      .filter((name) => name.toLowerCase().endsWith('.wav'))
      .map(async (name) => {
        const path = join(dir, name);
        const info = await stat(path);
        return { path, mtimeMs: info.mtimeMs };
      }));
  } catch {
    return;
  }

  const now = Date.now();
  const sorted = files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const removable = sorted.filter((file, index) => index >= options.maxFiles || now - file.mtimeMs > options.maxAgeMs);
  await Promise.all(removable.map((file) => rm(file.path, { force: true }).catch(() => undefined)));
}
