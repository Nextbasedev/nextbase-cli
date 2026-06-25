import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const stateDir = join(homedir(), '.wisper-cli');
export const pidFile = join(stateDir, 'listener.pid');

export async function writeListenerPid(pid = process.pid) {
  await mkdir(stateDir, { recursive: true });
  await writeFile(pidFile, String(pid));
}

export async function readListenerPid(): Promise<number | undefined> {
  try {
    const raw = await readFile(pidFile, 'utf8');
    const pid = Number(raw.trim());
    return Number.isFinite(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

export async function clearListenerPid() {
  await rm(pidFile, { force: true }).catch(() => undefined);
}

export async function stopListener() {
  const pid = await readListenerPid();
  if (!pid) return false;
  if (pid === process.pid) return false;

  try {
    process.kill(pid);
    await clearListenerPid();
    return true;
  } catch {
    await clearListenerPid();
    return false;
  }
}
