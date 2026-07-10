import { mkdir, rm, writeFile } from 'node:fs/promises';
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

    // Remove older startup entries if present.
    spawnSync('reg', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'WisperCLI', '/f'], { stdio: 'ignore' });
    spawnSync('schtasks.exe', ['/Delete', '/TN', 'WisperCLI', '/F'], { stdio: 'ignore', windowsHide: true });

    // Use PowerShell ScheduledTasks API. It handles quoting better than schtasks /TR.
    // This starts after interactive login, hidden. A real Windows Service would not work
    // for global hotkeys because services do not run in the user's desktop session.
    const script = `
$ErrorActionPreference = 'Stop'
$Action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument '//B "${file.replaceAll("'", "''")}"'
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'WisperCLI' -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null
`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true
    });

    if (result.status === 0) {
      return { enabled: true, message: 'Autostart enabled as hidden Windows logon task.' };
    }

    const error = (result.stderr || result.stdout || '').trim();
    return { enabled: false, message: `Could not enable Windows autostart task.${error ? ` ${error}` : ''}` };
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

export async function disableAutostart(): Promise<AutostartResult> {
  if (process.platform === 'darwin') {
    const file = join(homedir(), 'Library', 'LaunchAgents', 'com.wisper.cli.plist');
    spawnSync('launchctl', ['unload', file], { stdio: 'ignore' });
    await rm(file, { force: true }).catch(() => undefined);
    return { enabled: false, message: 'Autostart disabled. LaunchAgent removed.' };
  }

  if (process.platform === 'win32') {
    spawnSync('schtasks.exe', ['/Delete', '/TN', 'WisperCLI', '/F'], { stdio: 'ignore', windowsHide: true });
    spawnSync('reg', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'WisperCLI', '/f'], { stdio: 'ignore' });
    return { enabled: false, message: 'Autostart disabled. Windows logon task removed.' };
  }

  if (process.platform === 'linux') {
    spawnSync('systemctl', ['--user', 'disable', 'wisper-cli.service'], { stdio: 'ignore' });
    await rm(join(homedir(), '.config', 'systemd', 'user', 'wisper-cli.service'), { force: true }).catch(() => undefined);
    spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
    return { enabled: false, message: 'Autostart disabled. systemd user service removed.' };
  }

  return { enabled: false, message: `Autostart is not supported yet on ${process.platform}.` };
}
