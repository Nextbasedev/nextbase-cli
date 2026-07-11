import { access, mkdir, rm, writeFile } from 'node:fs/promises';
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

function vbsQuote(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function windowsStartupDir() {
  return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
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
WshShell.Run ${vbsQuote(launchCommand)}, 0, False
`);

    // Remove older startup entries if present.
    spawnSync('reg', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'WisperCLI', '/f'], { stdio: 'ignore' });
    spawnSync('schtasks.exe', ['/Delete', '/TN', 'WisperCLI', '/F'], { stdio: 'ignore', windowsHide: true });

    // Preferred: logon Scheduled Task. Some Windows accounts/policies reject this with 0x80070005.
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

    // Fallback: user Startup folder. This needs no admin/scheduled-task permission and stays hidden.
    const startupDir = windowsStartupDir();
    const startupFile = join(startupDir, 'WisperCLI.vbs');
    await mkdir(startupDir, { recursive: true });
    await writeFile(startupFile, `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run ${vbsQuote(launchCommand)}, 0, False
`);

    const error = (result.stderr || result.stdout || '').trim();
    return {
      enabled: true,
      message: `Autostart enabled via Windows Startup folder because Scheduled Task was blocked.${error ? ` Scheduled Task error: ${error}` : ''}`
    };
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
    await rm(join(windowsStartupDir(), 'WisperCLI.vbs'), { force: true }).catch(() => undefined);
    return { enabled: false, message: 'Autostart disabled. Windows startup entries removed.' };
  }

  if (process.platform === 'linux') {
    spawnSync('systemctl', ['--user', 'disable', 'wisper-cli.service'], { stdio: 'ignore' });
    await rm(join(homedir(), '.config', 'systemd', 'user', 'wisper-cli.service'), { force: true }).catch(() => undefined);
    spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
    return { enabled: false, message: 'Autostart disabled. systemd user service removed.' };
  }

  return { enabled: false, message: `Autostart is not supported yet on ${process.platform}.` };
}

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function autostartStatus(): Promise<AutostartResult> {
  if (process.platform === 'darwin') {
    const file = join(homedir(), 'Library', 'LaunchAgents', 'com.wisper.cli.plist');
    return (await exists(file))
      ? { enabled: true, message: `Autostart enabled: LaunchAgent exists at ${file}.` }
      : { enabled: false, message: 'Autostart disabled: LaunchAgent not found.' };
  }

  if (process.platform === 'win32') {
    const task = spawnSync('schtasks.exe', ['/Query', '/TN', 'WisperCLI'], { stdio: 'ignore', windowsHide: true });
    const startupFile = join(windowsStartupDir(), 'WisperCLI.vbs');
    const startupExists = await exists(startupFile);
    if (task.status === 0 && startupExists) return { enabled: true, message: `Autostart enabled: Scheduled Task and Startup file exist (${startupFile}).` };
    if (task.status === 0) return { enabled: true, message: 'Autostart enabled: Windows Scheduled Task exists.' };
    if (startupExists) return { enabled: true, message: `Autostart enabled: Startup file exists at ${startupFile}.` };
    return { enabled: false, message: 'Autostart disabled: no Scheduled Task or Startup file found.' };
  }

  if (process.platform === 'linux') {
    const service = join(homedir(), '.config', 'systemd', 'user', 'wisper-cli.service');
    return (await exists(service))
      ? { enabled: true, message: `Autostart enabled: systemd user service exists at ${service}.` }
      : { enabled: false, message: 'Autostart disabled: systemd user service not found.' };
  }

  return { enabled: false, message: `Autostart is not supported yet on ${process.platform}.` };
}
