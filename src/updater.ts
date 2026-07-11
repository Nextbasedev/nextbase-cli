import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import type { Config } from './config.js';
import { log } from './log.js';

const repoApiUrl = 'https://api.github.com/repos/dix105/wisper-cli/commits/master';
const stateDir = join(homedir(), '.wisper-cli');
const installedShaFile = join(stateDir, 'installed-sha');

type GitHubCommit = { sha?: string };

export async function getInstalledSha() {
  try {
    return (await readFile(installedShaFile, 'utf8')).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function setInstalledSha(sha: string) {
  await mkdir(stateDir, { recursive: true });
  await writeFile(installedShaFile, sha);
}

export async function getLatestSha() {
  const response = await fetch(`${repoApiUrl}?x=${Date.now()}`, {
    headers: {
      'accept': 'application/vnd.github+json',
      'user-agent': 'wisper-cli-auto-updater'
    }
  });
  if (!response.ok) throw new Error(`GitHub update check failed: HTTP ${response.status}`);
  const body = await response.json() as GitHubCommit;
  if (!body.sha) throw new Error('GitHub update check did not return a commit SHA.');
  return body.sha;
}

function cliPath() {
  return fileURLToPath(new URL('./cli.js', import.meta.url));
}

function runInstaller() {
  if (process.platform === 'win32') {
    const script = `iwr -useb "https://raw.githubusercontent.com/dix105/wisper-cli/master/install.ps1?x=$(Get-Random)" | iex`;
    return spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true
    });
  }

  const script = `curl -fsSL "https://raw.githubusercontent.com/dix105/wisper-cli/master/install.sh?x=$(date +%s)" | bash`;
  return spawnSync('bash', ['-lc', script], { encoding: 'utf8' });
}

function spawnUpdatedListener() {
  const child = spawn(process.execPath, [cliPath(), 'listen'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: dirname(cliPath())
  });
  child.unref();
}

export async function checkForUpdate(options: { apply?: boolean; restart?: boolean } = {}) {
  const latest = await getLatestSha();
  const installed = await getInstalledSha();

  if (!installed) {
    await setInstalledSha(latest);
    return { updated: false, latest, installed: latest, message: 'Recorded current installed version.' };
  }

  if (installed === latest) {
    return { updated: false, latest, installed, message: 'Wisper CLI is already up to date.' };
  }

  if (!options.apply) {
    return { updated: false, latest, installed, message: `Update available: ${installed.slice(0, 7)} → ${latest.slice(0, 7)}` };
  }

  const result = runInstaller();
  if (result.status !== 0) {
    const output = `${result.stderr || ''}\n${result.stdout || ''}`.trim();
    throw new Error(`Auto-update install failed.${output ? ` ${output}` : ''}`);
  }

  await setInstalledSha(latest);
  if (options.restart) spawnUpdatedListener();
  return { updated: true, latest, installed, message: `Updated Wisper CLI: ${installed.slice(0, 7)} → ${latest.slice(0, 7)}` };
}

export function startAutoUpdater(config: Config) {
  if (process.env.WISPER_DISABLE_AUTO_UPDATE === '1') return undefined;
  if (config.autoUpdate === false) return undefined;

  const intervalMs = Math.max(15, config.autoUpdateIntervalMinutes ?? 180) * 60 * 1000;
  let checking = false;

  const check = async () => {
    if (checking) return;
    checking = true;
    try {
      const result = await checkForUpdate({ apply: true, restart: true });
      if (result.updated) {
        await log(`${result.message}. Restarting listener on updated version...`);
        process.exit(0);
      }
    } catch (error) {
      await log(`Auto-update check failed: ${(error as Error).message}`);
    } finally {
      checking = false;
    }
  };

  const startupTimer = setTimeout(() => { void check(); }, 30_000);
  const interval = setInterval(() => { void check(); }, intervalMs);

  return () => {
    clearTimeout(startupTimer);
    clearInterval(interval);
  };
}
