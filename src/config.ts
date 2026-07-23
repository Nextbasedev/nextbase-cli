import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type Provider = 'groq' | 'elevenlabs' | 'sarvam' | 'nextbase-codex';

export type ModelOption = {
  id: string;
  label: string;
  provider: Provider;
  model: string;
};

export type Config = {
  provider?: Provider;
  model?: string;
  language?: string;
  shortcut?: string;
  polishShortcut?: string;
  spellShortcut?: string;
  keys?: Partial<Record<Provider, string>>;
  autostart?: boolean;
  audioDevice?: string;
  autoPolish?: boolean;
  polishModel?: string;
  audioDucking?: boolean;
  audioDuckingVolume?: number;
  autoUpdate?: boolean;
  autoUpdateIntervalMinutes?: number;
};

const dataDir = join(homedir(), '.wisper-cli');
const configFile = join(dataDir, 'config.json');

export const modelOptions: ModelOption[] = [
  { id: 'groq-whisper', label: 'Groq Whisper Large v3 Turbo', provider: 'groq', model: 'whisper-large-v3-turbo' },
  { id: 'elevenlabs-scribe', label: 'ElevenLabs Scribe v2', provider: 'elevenlabs', model: 'scribe_v2' },
  { id: 'sarvam-saaras', label: 'Sarvam Saaras v3', provider: 'sarvam', model: 'saaras:v3' },
  { id: 'nextbase-codex-transcribe', label: 'Nextbase Codex Transcribe', provider: 'nextbase-codex', model: 'codex-transcribe' }
];

export const providers: Provider[] = ['groq', 'elevenlabs', 'sarvam', 'nextbase-codex'];
export const defaultShortcut = 'Ctrl+Alt+Space';
export const defaultPolishShortcut = 'CommandOrControl+Shift+P';
export const defaultSpellShortcut = 'CommandOrControl+Alt+S';

export async function loadConfig(): Promise<Config> {
  await mkdir(dataDir, { recursive: true });
  try {
    return JSON.parse(await readFile(configFile, 'utf8')) as Config;
  } catch {
    return {};
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(configFile, JSON.stringify(config, null, 2));
}

export async function updateConfig(patch: Config): Promise<Config> {
  const current = await loadConfig();
  const next: Config = {
    ...current,
    ...patch,
    keys: { ...current.keys, ...patch.keys }
  };
  await saveConfig(next);
  return next;
}
