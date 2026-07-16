import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import clipboard from 'clipboardy';

let pasteHelper: ChildProcess | undefined;
let pasteHelperPath: string | undefined;

function ensureWindowsPasteHelper() {
  if (pasteHelper && !pasteHelper.killed && pasteHelper.exitCode === null) return pasteHelper;

  pasteHelperPath = join(tmpdir(), `wisper-paste-helper-${process.pid}.vbs`);
  writeFileSync(pasteHelperPath, `
Set WshShell = WScript.CreateObject("WScript.Shell")
Do Until WScript.StdIn.AtEndOfStream
  line = WScript.StdIn.ReadLine
  If line = "PASTE" Then
    WshShell.SendKeys "^v"
  End If
Loop
`);

  pasteHelper = spawn('cscript.exe', ['//Nologo', pasteHelperPath], {
    stdio: ['pipe', 'ignore', 'ignore'],
    windowsHide: true
  });

  pasteHelper!.once('exit', () => {
    pasteHelper = undefined;
    if (pasteHelperPath && existsSync(pasteHelperPath)) {
      try { unlinkSync(pasteHelperPath); } catch {}
    }
  });

  return pasteHelper;
}

function oneShotWindowsPaste() {
  const scriptPath = join(tmpdir(), `wisper-paste-${process.pid}.vbs`);
  writeFileSync(scriptPath, 'Set WshShell = WScript.CreateObject("WScript.Shell")\nWshShell.SendKeys "^v"\n');
  spawnSync('wscript.exe', ['//B', scriptPath], { stdio: 'ignore', windowsHide: true });
  try { unlinkSync(scriptPath); } catch {}
}

export function shutdownPasteHelper() {
  if (pasteHelper && pasteHelper.exitCode === null) {
    pasteHelper.stdin?.end();
    pasteHelper.kill();
  }
  pasteHelper = undefined;
}

async function sendCopyShortcut() {
  if (process.platform === 'darwin') {
    spawnSync('osascript', ['-e', 'tell application "System Events" to keystroke "c" using command down'], { stdio: 'ignore' });
    return;
  }

  if (process.platform === 'win32') {
    const scriptPath = join(tmpdir(), `wisper-copy-${process.pid}.vbs`);
    writeFileSync(scriptPath, 'Set WshShell = WScript.CreateObject("WScript.Shell")\nWshShell.SendKeys "^c"\n');
    spawnSync('wscript.exe', ['//B', scriptPath], { stdio: 'ignore', windowsHide: true });
    try { unlinkSync(scriptPath); } catch {}
    return;
  }

  spawnSync('xdotool', ['key', 'ctrl+c'], { stdio: 'ignore' });
}

async function sendSelectAllAndCopyShortcut() {
  if (process.platform === 'darwin') {
    spawnSync('osascript', ['-e', 'tell application "System Events" to keystroke "a" using command down', '-e', 'delay 0.05', '-e', 'tell application "System Events" to keystroke "c" using command down'], { stdio: 'ignore' });
    return;
  }

  if (process.platform === 'win32') {
    const scriptPath = join(tmpdir(), `wisper-select-copy-${process.pid}.vbs`);
    writeFileSync(scriptPath, 'Set WshShell = WScript.CreateObject("WScript.Shell")\nWshShell.SendKeys "^a"\nWScript.Sleep 50\nWshShell.SendKeys "^c"\n');
    spawnSync('wscript.exe', ['//B', scriptPath], { stdio: 'ignore', windowsHide: true });
    try { unlinkSync(scriptPath); } catch {}
    return;
  }

  spawnSync('xdotool', ['key', 'ctrl+a', 'ctrl+c'], { stdio: 'ignore' });
}

export async function copySelectedText() {
  await sendCopyShortcut();
  await new Promise((resolve) => setTimeout(resolve, 180));
  return (await clipboard.read()).trim();
}

export async function copyFocusedInputText() {
  await sendSelectAllAndCopyShortcut();
  await new Promise((resolve) => setTimeout(resolve, 180));
  return (await clipboard.read()).trim();
}

export async function pasteIntoActiveApp(text: string) {
  await clipboard.write(text);

  if (process.platform === 'darwin') {
    spawnSync('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'], { stdio: 'ignore' });
    return;
  }

  if (process.platform === 'win32') {
    try {
      const helper = ensureWindowsPasteHelper();
      if (!helper.stdin?.write('PASTE\n')) {
        await new Promise((resolve) => helper.stdin?.once('drain', resolve));
      }
    } catch {
      oneShotWindowsPaste();
    }
    return;
  }

  spawnSync('xdotool', ['key', 'ctrl+v'], { stdio: 'ignore' });
}
