import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './log.js';


type KeyEvent = {
  name?: string;
  rawKey?: { name?: string };
  state?: 'DOWN' | 'UP';
};

function normalizeKey(key: string) {
  const platformControl = process.platform === 'darwin' ? 'META' : 'CTRL';
  return key
    .trim()
    .toUpperCase()
    .replace(/^LEFT /, '')
    .replace(/^RIGHT /, '')
    .replace('COMMANDORCONTROL', platformControl)
    .replace('COMMAND_OR_CONTROL', platformControl)
    .replace('CONTROL', 'CTRL')
    .replace('COMMAND', 'META')
    .replace('CMD', 'META')
    .replace('WINDOWS', 'META')
    .replace('WINDOW', 'META')
    .replace('WIN', 'META')
    .replace('OPTION', 'ALT')
    .replace(/\s+/g, 'SPACE');
}

export function normalizeShortcut(shortcut: string) {
  return shortcut
    .split('+')
    .map(normalizeKey)
    .filter(Boolean)
    .sort()
    .join('+');
}

function parseShortcut(shortcut: string) {
  const parts = normalizeShortcut(shortcut).split('+').filter(Boolean);
  const key = parts.find((part) => !['CTRL', 'ALT', 'SHIFT', 'META'].includes(part));
  if (!key && parts.length < 2) throw new Error(`Shortcut needs a final key: ${shortcut}`);
  return {
    ctrl: parts.includes('CTRL'),
    alt: parts.includes('ALT'),
    shift: parts.includes('SHIFT'),
    meta: parts.includes('META'),
    key
  };
}

export function validateShortcut(shortcut: string) {
  const parsed = parseShortcut(shortcut);
  if (!parsed.key) {
    if (process.platform === 'darwin' || process.platform === 'win32') return;
    throw new Error(`Modifier-only shortcuts like ${shortcut} are only supported on Windows and macOS. Add a final key, e.g. Ctrl+Alt+Space.`);
  }
  if (process.platform === 'win32') windowsVirtualKey(parsed.key);
  if (process.platform === 'darwin') macKeyCode(parsed.key);
}

function windowsVirtualKey(key: string) {
  if (/^[A-Z]$/.test(key)) return key.charCodeAt(0);
  if (/^[0-9]$/.test(key)) return key.charCodeAt(0);
  if (key === 'SPACE') return 0x20;
  if (key === 'TAB') return 0x09;
  if (key === 'ENTER' || key === 'RETURN') return 0x0d;
  if (key === 'ESC' || key === 'ESCAPE') return 0x1b;
  const f = key.match(/^F(\d{1,2})$/);
  if (f) {
    const n = Number(f[1]);
    if (n >= 1 && n <= 24) return 0x70 + n - 1;
  }
  throw new Error(`Unsupported Windows shortcut key: ${key}. Use A-Z, 0-9, Space, Tab, Enter, Esc, or F1-F24.`);
}

function listenForWindowsHotkey(shortcut: string, onPress: (event?: 'down' | 'up') => void) {
  const parsed = parseShortcut(shortcut);
  if (!parsed.key) return listenForWindowsModifierHotkey(shortcut, parsed, onPress);
  let modifiers = 0;
  if (parsed.alt) modifiers += 0x0001;
  if (parsed.ctrl) modifiers += 0x0002;
  if (parsed.shift) modifiers += 0x0004;
  if (parsed.meta) modifiers += 0x0008;
  const vk = windowsVirtualKey(parsed.key);

  const watchedKeys = [
    parsed.ctrl ? 0x11 : undefined,
    parsed.alt ? 0x12 : undefined,
    parsed.shift ? 0x10 : undefined,
    parsed.meta ? 0x5B : undefined,
    vk
  ].filter((value): value is number => typeof value === 'number');

  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class HotKeyNative {
  [DllImport("user32.dll", SetLastError=true)] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
  [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
  [DllImport("user32.dll")] public static extern sbyte GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
  [DllImport("kernel32.dll")] public static extern uint GetLastError();
  [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public int pt_x; public int pt_y; }
}
"@
$id = 9123
$watched = @(${watchedKeys.join(',')})
$ok = [HotKeyNative]::RegisterHotKey([IntPtr]::Zero, $id, ${modifiers}, ${vk})
if (-not $ok) { [Console]::Error.WriteLine("REGISTER_FAILED:" + [HotKeyNative]::GetLastError()); exit 2 }
[Console]::Out.WriteLine("REGISTERED")
function AllKeysDown {
  foreach ($key in $watched) {
    if (([HotKeyNative]::GetAsyncKeyState($key) -band 0x8000) -eq 0) { return $false }
  }
  return $true
}
try {
  while ($true) {
    $msg = New-Object HotKeyNative+MSG
    $result = [HotKeyNative]::GetMessage([ref]$msg, [IntPtr]::Zero, 0, 0)
    if ($result -eq 0) { break }
    if ($msg.message -eq 0x0312 -and $msg.wParam.ToUInt32() -eq $id) {
      [Console]::Out.WriteLine("HOTKEY_DOWN")
      while (AllKeysDown) { Start-Sleep -Milliseconds 35 }
      [Console]::Out.WriteLine("HOTKEY_UP")
    }
  }
} finally {
  [HotKeyNative]::UnregisterHotKey([IntPtr]::Zero, $id) | Out-Null
}
`;

  const child: ChildProcessWithoutNullStreams = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    windowsHide: true
  });

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (line.trim() === 'REGISTERED') void log(`Shortcut registered: ${shortcut}`);
      if (line.trim() === 'HOTKEY_DOWN') onPress('down');
      if (line.trim() === 'HOTKEY_UP') onPress('up');
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    if (chunk.includes('REGISTER_FAILED')) void log(`Could not register shortcut ${shortcut}. It may be used by another app. Try F12 or Ctrl+Alt+Space.`);
  });

  return () => child.kill();
}

function listenForWindowsModifierHotkey(shortcut: string, parsed: ReturnType<typeof parseShortcut>, onPress: (event?: 'down' | 'up') => void) {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class HotKeyPollNative {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
}
"@
$needCtrl = ${parsed.ctrl ? '$true' : '$false'}
$needAlt = ${parsed.alt ? '$true' : '$false'}
$needShift = ${parsed.shift ? '$true' : '$false'}
$needMeta = ${parsed.meta ? '$true' : '$false'}
function Down($key) { return (([HotKeyPollNative]::GetAsyncKeyState($key) -band 0x8000) -ne 0) }
function RequiredDown {
  if ($needCtrl -and -not ((Down 0x11) -or (Down 0xA2) -or (Down 0xA3))) { return $false }
  if ($needAlt -and -not ((Down 0x12) -or (Down 0xA4) -or (Down 0xA5))) { return $false }
  if ($needShift -and -not ((Down 0x10) -or (Down 0xA0) -or (Down 0xA1))) { return $false }
  if ($needMeta -and -not ((Down 0x5B) -or (Down 0x5C))) { return $false }
  return $true
}
[Console]::Out.WriteLine("REGISTERED")
$held = $false
while ($true) {
  $down = RequiredDown
  if ($down -and -not $held) { $held = $true; [Console]::Out.WriteLine("HOTKEY_DOWN") }
  if (-not $down -and $held) { $held = $false; [Console]::Out.WriteLine("HOTKEY_UP") }
  Start-Sleep -Milliseconds 25
}
`;

  const child: ChildProcessWithoutNullStreams = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    windowsHide: true
  });

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (line.trim() === 'REGISTERED') void log(`Shortcut registered: ${shortcut}`);
      if (line.trim() === 'HOTKEY_DOWN') onPress('down');
      if (line.trim() === 'HOTKEY_UP') onPress('up');
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    if (chunk.trim()) void log(`Windows modifier shortcut error: ${chunk.trim()}`);
  });

  return () => child.kill();
}


function macKeyCode(key: string) {
  const letters: Record<string, number> = {
    A: 0, S: 1, D: 2, F: 3, H: 4, G: 5, Z: 6, X: 7, C: 8, V: 9, B: 11, Q: 12, W: 13, E: 14, R: 15, Y: 16, T: 17,
    O: 31, U: 32, I: 34, P: 35, L: 37, J: 38, K: 40, N: 45, M: 46
  };
  const digits: Record<string, number> = { '1': 18, '2': 19, '3': 20, '4': 21, '6': 22, '5': 23, '9': 25, '7': 26, '8': 28, '0': 29 };
  const specials: Record<string, number> = { SPACE: 49, TAB: 48, ENTER: 36, RETURN: 36, ESC: 53, ESCAPE: 53, F1: 122, F2: 120, F3: 99, F4: 118, F5: 96, F6: 97, F7: 98, F8: 100, F9: 101, F10: 109, F11: 103, F12: 111, F13: 105, F14: 107, F15: 113, F16: 106, F17: 64, F18: 79, F19: 80, F20: 90 };
  if (letters[key] !== undefined) return letters[key];
  if (digits[key] !== undefined) return digits[key];
  if (specials[key] !== undefined) return specials[key];
  throw new Error(`Unsupported macOS shortcut key: ${key}. Use A-Z, 0-9, Space, Tab, Enter, Esc, or F1-F20.`);
}

function listenForMacHotkey(shortcut: string, onPress: (event?: 'down' | 'up') => void) {
  const parsed = parseShortcut(shortcut);
  const helper = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'mac-hotkey.swift');
  const child = spawn('swift', [helper, parsed.key ? String(macKeyCode(parsed.key)) : '-1', parsed.meta ? '1' : '0', parsed.alt ? '1' : '0', parsed.shift ? '1' : '0', parsed.ctrl ? '1' : '0']);

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (line.trim() === 'REGISTERED') void log(`Shortcut registered: ${shortcut}`);
      if (line.trim() === 'HOTKEY_DOWN') onPress('down');
      if (line.trim() === 'HOTKEY_UP') onPress('up');
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    if (chunk.includes('REGISTER_FAILED')) void log(`Could not register shortcut ${shortcut}. Give Terminal/iTerm Accessibility permission in macOS settings.`);
  });

  return () => child.kill();
}

export function listenForShortcut(shortcut: string, onPress: (event?: 'down' | 'up') => void) {
  if (process.platform === 'win32') return listenForWindowsHotkey(shortcut, onPress);
  if (process.platform === 'darwin') return listenForMacHotkey(shortcut, onPress);
  throw new Error(`Global shortcuts are not supported yet on ${process.platform}. Windows and macOS are supported.`);
}
