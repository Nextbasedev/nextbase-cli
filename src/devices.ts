import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export type InputDeviceProbe = {
  device: string;
  score: number;
  ok: boolean;
  hasSignal?: boolean;
  error?: string;
};

export function listInputDevices(): string[] {
  if (process.platform !== 'win32') return ['default'];

  const script = `Get-PnpDevice -Class AudioEndpoint | Where-Object { $_.Status -eq 'OK' -and $_.FriendlyName -match 'Microphone|Mic' } | Select-Object -ExpandProperty FriendlyName`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true });
  return Array.from(new Set(result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)));
}

function isLikelyVirtual(device: string) {
  return /virtual|relay|cable|vb-audio|voicemeeter/i.test(device);
}

function parseSoxStat(output: string) {
  const maximum = Number(output.match(/Maximum amplitude:\s+([0-9.]+)/)?.[1] || 0);
  const rms = Number(output.match(/RMS\s+amplitude:\s+([0-9.]+)/)?.[1] || 0);
  return Math.max(maximum, rms * 10);
}

export function probeInputDevice(device: string): InputDeviceProbe {
  if (process.platform !== 'win32') return { device, score: 1, ok: true };

  const dir = mkdtempSync(join(tmpdir(), 'wisper-mic-test-'));
  const file = join(dir, 'probe.wav');
  try {
    const record = spawnSync('sox.exe', ['-q', '-t', 'waveaudio', device, '-r', '16000', '-c', '1', '-b', '16', file, 'trim', '0', '0.6'], {
      encoding: 'utf8',
      windowsHide: true
    });
    if (record.status !== 0) {
      return { device, score: 0, ok: false, error: (record.stderr || record.stdout || '').trim() };
    }

    const stat = spawnSync('sox.exe', [file, '-n', 'stat'], {
      encoding: 'utf8',
      windowsHide: true
    });
    const output = `${stat.stdout || ''}\n${stat.stderr || ''}`;
    const score = parseSoxStat(output);
    // `ok` means SoX successfully opened the input device. A user can be
    // silent during this short probe, so a zero level must not make a real
    // microphone look unusable. Signal is only used as a ranking preference.
    return { device, score, ok: true, hasSignal: score > 0.0001 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function autoDetectInputDevice(configured?: string): { device: string; probes: InputDeviceProbe[] } {
  if (process.platform !== 'win32') return { device: 'default', probes: [{ device: 'default', score: 1, ok: true }] };

  const devices = listInputDevices();
  const ordered = Array.from(new Set([
    ...(configured ? [configured] : []),
    ...devices.filter((device) => !isLikelyVirtual(device)),
    ...devices.filter(isLikelyVirtual),
    'default'
  ]));

  const probes = ordered.map(probeInputDevice);
  const usable = probes.filter((probe) => probe.ok);
  const realMic = usable.filter((probe) => !isLikelyVirtual(probe.device));
  const preferred = [...realMic, ...usable]
    .sort((a, b) => Number(Boolean(b.hasSignal)) - Number(Boolean(a.hasSignal)) || b.score - a.score)[0];

  return { device: preferred?.device || devices.find((device) => !isLikelyVirtual(device)) || preferredInputDevice(), probes };
}

export function preferredInputDevice(configured?: string) {
  if (configured) return configured;
  if (process.platform !== 'win32') return 'default';

  const devices = listInputDevices();
  return devices.find((device) => !isLikelyVirtual(device)) || devices[0] || 'default';
}
