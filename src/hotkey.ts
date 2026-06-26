import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import { log } from './log.js';

const require = createRequire(import.meta.url);

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

function eventName(event: KeyEvent) {
  return normalizeKey(event.name || event.rawKey?.name || '');
}

function activeShortcut(down: Record<string, boolean>, currentKey: string) {
  const keys = Object.entries(down)
    .filter(([, pressed]) => pressed)
    .map(([key]) => normalizeKey(key));
  if (!keys.includes(currentKey)) keys.push(currentKey);
  return keys.sort().join('+');
}

function parseShortcut(shortcut: string) {
  const parts = normalizeShortcut(shortcut).split('+').filter(Boolean);
  const key = parts.find((part) => !['CTRL', 'ALT', 'SHIFT', 'META'].includes(part));
  if (!key) throw new Error(`Shortcut needs a final key: ${shortcut}`);
  return {
    ctrl: parts.includes('CTRL'),
    alt: parts.includes('ALT'),
    shift: parts.includes('SHIFT'),
    meta: parts.includes('META'),
    key
  };
}

function windowsVirtualKey(key: string) {
  if (/^[A-Z]$/.test(key)) return key.charCodeAt(0);
  if (/^[0-9]$/.test(key)) return key.charCodeAt(0);
  if (key === 'SPACE') return 0x20;
  if (key === 'TAB') return 0x09;
  if (key === 'ENTER' || key === 'RETURN') return 0x0d;
  if (key === 'ESC' || key === 'ESCAPE') return 0x1b;
  const f = key.match(/^F(\d{1,2})$/);
  if (f) return 0x70 + Number(f[1]) - 1;
  throw new Error(`Unsupported Windows shortcut key: ${key}`);
}

function listenForWindowsHotkey(shortcut: string, onPress: (event?: 'down' | 'up') => void) {
  const parsed = parseShortcut(shortcut);
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

function listenForKeyboardEvents(shortcut: string, onPress: (event?: 'down' | 'up') => void) {
  const { GlobalKeyboardListener } = require('node-global-key-listener') as {
    GlobalKeyboardListener: new () => {
      addListener(listener: (event: KeyEvent, down: Record<string, boolean>) => void): void;
      kill?: () => void;
    };
  };
  const target = normalizeShortcut(shortcut);
  const keyboard = new GlobalKeyboardListener();
  let armed = true;

  keyboard.addListener((event, down) => {
    const key = eventName(event);
    if (!key) return;

    if (event.state === 'UP') {
      armed = true;
      return;
    }

    if (!armed) return;
    if (activeShortcut(down, key) === target) {
      armed = false;
      onPress();
    }
  });

  return () => keyboard.kill?.();
}

export function listenForShortcut(shortcut: string, onPress: (event?: 'down' | 'up') => void) {
  if (process.platform === 'win32') return listenForWindowsHotkey(shortcut, onPress);
  return listenForKeyboardEvents(shortcut, onPress);
}
