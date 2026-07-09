import { mkdir, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export type AutostartResult = {
  enabled: boolean;
  message: string;
};

function currentCliCommand() {
  const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url));
  return { executable: process.execPath, args: [cliPath, 'listen'] };
}

function quote(value: string) {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function psQuote(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function startListenerNow(): AutostartResult {
  const command = currentCliCommand();

  if (process.platform === 'win32') {
    const child = spawn(command.executable, command.args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return { enabled: true, message: `Wisper listener started in background. PID: ${child.pid || 'unknown'}` };
  }

  const child = spawn(command.executable, command.args, { detached: true, stdio: 'ignore' });
  child.unref();
  return { enabled: true, message: `Wisper listener started in background. PID: ${child.pid || 'unknown'}` };
}

export async function enableAutostart(): Promise<AutostartResult> {
  const command = currentCliCommand();

  if (process.platform === 'darwin') {
    const dir = join(homedir(), 'Library', 'LaunchAgents');
    const file = join(dir, 'com.wisper.cli.plist');
    await mkdir(dir, { recursive: true });
    await writeFile(file, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>com.wisper.cli</string>
    <key>ProgramArguments</key>
    <array>
      <string>${command.executable}</string>
      ${command.args.map((arg) => `<string>${arg}</string>`).join('\n      ')}
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
  </dict>
</plist>
`);
    spawnSync('launchctl', ['unload', file], { stdio: 'ignore' });
    const result = spawnSync('launchctl', ['load', file], { stdio: 'ignore' });
    return { enabled: result.status === 0, message: result.status === 0 ? 'Autostart enabled with LaunchAgent.' : `Autostart file created at ${file}.` };
  }

  if (process.platform === 'win32') {
    const dir = join(homedir(), '.wisper-cli');
    const file = join(dir, 'wisper-start-hidden.vbs');
    const launchCommand = [quote(command.executable), ...command.args.map(quote)].join(' ');
    await mkdir(dir, { recursive: true });
    await writeFile(file, `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run ${quote(launchCommand)}, 0, False
`);
    const value = `wscript.exe //B ${quote(file)}`;
    const result = spawnSync('reg', ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'WisperCLI', '/t', 'REG_SZ', '/d', value, '/f'], { stdio: 'ignore' });
    return { enabled: result.status === 0, message: result.status === 0 ? 'Autostart enabled in Windows startup apps as hidden background listener.' : 'Could not enable Windows autostart.' };
  }


  if (process.platform === 'linux') {
    const dir = join(homedir(), '.config', 'systemd', 'user');
    const file = join(dir, 'wisper-cli.service');
    await mkdir(dir, { recursive: true });
    await writeFile(file, `[Unit]
Description=Wisper CLI background listener
After=default.target

[Service]
ExecStart=${quote(command.executable)} ${command.args.map(quote).join(' ')}
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
`);
    spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
    const result = spawnSync('systemctl', ['--user', 'enable', 'wisper-cli.service'], { stdio: 'ignore' });
    return { enabled: result.status === 0, message: result.status === 0 ? 'Autostart enabled with systemd user service.' : `Autostart service created at ${file}. Enable it manually if systemd user services are unavailable.` };
  }

  return { enabled: false, message: `Autostart is not supported yet on ${process.platform}.` };
}
