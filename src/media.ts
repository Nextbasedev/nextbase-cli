import { spawnSync } from 'node:child_process';
import type { Config } from './config.js';

let originalWindowsVolume: number | undefined;
let ducked = false;

const volumeInterop = String.raw`
Add-Type @"
using System;
using System.Runtime.InteropServices;

public enum EDataFlow { eRender, eCapture, eAll }
public enum ERole { eConsole, eMultimedia, eCommunications }

[ComImport]
[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumeratorComObject { }

[ComImport]
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
  int NotImpl1();
  int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice ppDevice);
}

[ComImport]
[Guid("D666063F-1587-4E43-81F1-B948E807363F")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
  int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, out IAudioEndpointVolume ppInterface);
}

[ComImport]
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr pNotify);
  int UnregisterControlChangeNotify(IntPtr pNotify);
  int GetChannelCount(out uint pnChannelCount);
  int SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
  int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  int GetMasterVolumeLevel(out float pfLevelDB);
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int SetChannelVolumeLevel(uint nChannel, float fLevelDB, Guid pguidEventContext);
  int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, Guid pguidEventContext);
  int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
  int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
  int SetMute(bool bMute, Guid pguidEventContext);
  int GetMute(out bool pbMute);
  int GetVolumeStepInfo(out uint pnStep, out uint pnStepCount);
  int VolumeStepUp(Guid pguidEventContext);
  int VolumeStepDown(Guid pguidEventContext);
  int QueryHardwareSupport(out uint pdwHardwareSupportMask);
  int GetVolumeRange(out float pflVolumeMindB, out float pflVolumeMaxdB, out float pflVolumeIncrementdB);
}

public class VolumeControl {
  public static IAudioEndpointVolume Endpoint() {
    var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDevice device;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eConsole, out device));
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    IAudioEndpointVolume endpoint;
    Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out endpoint));
    return endpoint;
  }
  public static float Get() {
    float level;
    Marshal.ThrowExceptionForHR(Endpoint().GetMasterVolumeLevelScalar(out level));
    return level;
  }
  public static void Set(float level) {
    Marshal.ThrowExceptionForHR(Endpoint().SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(1, level)), Guid.Empty));
  }
}
"@
`;

function runPowerShell(script: string) {
  return spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true
  });
}

function getWindowsVolume() {
  const result = runPowerShell(`${volumeInterop}\n[VolumeControl]::Get()`);
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'Could not read system volume').trim());
  const volume = Number((result.stdout || '').trim().split(/\r?\n/).pop());
  if (!Number.isFinite(volume)) throw new Error('Could not parse system volume.');
  return Math.min(1, Math.max(0, volume));
}

function setWindowsVolume(volume: number) {
  const target = Math.min(1, Math.max(0, volume));
  const result = runPowerShell(`${volumeInterop}\n[VolumeControl]::Set(${target.toFixed(4)})`);
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'Could not set system volume').trim());
}

export async function startMediaBehavior(config: Config) {
  if (process.platform !== 'win32') return;
  if (config.audioDucking === false) return;
  if (ducked) return;

  const current = getWindowsVolume();
  originalWindowsVolume = current;
  const requested = Math.min(1, Math.max(0, (config.audioDuckingVolume ?? 35) / 100));
  const target = Math.min(current, requested);
  if (current - target > 0.01) setWindowsVolume(target);
  ducked = true;
}

export async function restoreMediaBehavior() {
  if (process.platform !== 'win32') return;
  if (!ducked) return;
  ducked = false;
  const original = originalWindowsVolume;
  originalWindowsVolume = undefined;
  if (typeof original === 'number') setWindowsVolume(original);
}
