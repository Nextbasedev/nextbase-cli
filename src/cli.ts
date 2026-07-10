#!/usr/bin/env node
import { loadHistory, saveTranscript } from './storage.js';
import { startWebApp } from './server.js';
import { openUrl } from './open.js';
import { defaultPolishShortcut, defaultShortcut, loadConfig, modelOptions, providers, updateConfig, type ModelOption, type Provider } from './config.js';
import { createPrompt } from './prompt.js';
import { disableAutostart, enableAutostart, startListenerNow } from './autostart.js';
import { verifyProviderKey } from './verify.js';
import { cleanupOldRecordings, isRecording, startRecording, stopRecording } from './audio.js';
import { listenForShortcut } from './hotkey.js';
import { copySelectedText, pasteIntoActiveApp, shutdownPasteHelper } from './paste.js';
import { transcribeFile } from './transcribe.js';
import { polishDictationIfEnabled, rewriteText, type RewriteMode } from './polish.js';
import { restoreMediaBehavior, startMediaBehavior } from './media.js';
import { captureShortcut } from './shortcut-capture.js';
import { autoDetectInputDevice, listInputDevices, preferredInputDevice } from './devices.js';
import { log, readLogs } from './log.js';
import { clearListenerPid, stopListener, writeListenerPid } from './process-state.js';
import { spawn } from 'node:child_process';

const [command, ...args] = process.argv.slice(2);

async function main() {
  switch (command) {
    case undefined:
    case 'help':
      printHelp();
      break;
    case 'setup':
      await setup(args.includes('--update'));
      break;
    case 'update':
      await update();
      break;
    case 'provider':
      await selectProvider();
      break;
    case 'polish':
      await polishCommand(args);
      break;
    case 'media':
      await mediaCommand(args);
      break;
    case 'autostart':
      await autostartCommand(args);
      break;
    case 'shortcut':
      await setShortcut();
      break;
    case 'status':
      await showStatus();
      break;
    case 'mic':
      await selectMic(args.includes('--auto'));
      break;
    case 'listen':
      await listen();
      break;
    case 'logs':
      console.log(await readLogs());
      break;
    case 'stop': {
      const stopped = await stopListener();
      console.log(stopped ? 'Wisper listener stopped.' : 'No running listener found.');
      break;
    }
    case 'restart': {
      await stopListener();
      await startListenerAndReport();
      break;
    }
    case 'transcribe': {
      const file = args[0];
      if (!file) throw new Error('Usage: wisper transcribe <audio-file>');
      const config = await loadConfig();
      const text = await transcribeFile(file, config);
      await saveTranscript(text, file);
      console.log(text);
      break;
    }
    case 'history': {
      const history = await loadHistory();
      if (!history.length) return console.log('No transcripts yet.');
      for (const item of history.slice(0, Number(args[0] || 20))) {
        console.log(`${item.createdAt}  ${item.text}`);
      }
      break;
    }
    case 'add': {
      const text = args.join(' ').trim();
      if (!text) throw new Error('Usage: wisper add "text"');
      const item = await saveTranscript(text);
      console.log(`Saved transcript ${item.id}`);
      break;
    }
    case 'app':
    case 'open': {
      const url = await startWebApp(Number(args[0] || 3838));
      openUrl(url);
      console.log(`Wisper web app running at ${url}`);
      console.log('Press Ctrl+C to stop.');
      break;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function printHelp() {
  console.log(`wisper-cli

Commands:
  wisper setup            Simple first-time setup
  wisper update           Install latest version and run only missing setup prompts
  wisper provider         Pick provider from a menu
  wisper polish on/off    Enable or disable auto polish
  wisper polish shortcut  Set selected-text polish shortcut
  wisper polish "text"   Rewrite text with Groq polish mode
  wisper media on/off     Lower system volume while recording
  wisper autostart on/off Enable or disable startup listener
  wisper shortcut         Set shortcut from a prompt
  wisper status           Show current setup
  wisper mic              Pick microphone device
  wisper mic --auto       Test microphones and pick working one
  wisper listen           Run background listener
  wisper stop             Stop background listener
  wisper restart          Restart background listener
  wisper logs             Show listener logs
  wisper transcribe <file> Transcribe an audio file
  wisper app              Open local web app
  wisper open             Alias for app
  wisper history [limit]  Print transcript history
  wisper add "text"       Save a manual transcript
  wisper help             Show help
`);
}

async function setup(updateMode = false) {
  console.log(updateMode ? 'Wisper update setup' : 'Wisper setup');
  const prompt = createPrompt();
  try {
    const config = await loadConfig();
    if (!config.provider || !config.model || !config.keys?.[config.provider]) {
      await selectModel(prompt);
    } else if (updateMode) {
      console.log('Model/API key already configured. Keeping existing setup.');
    }

    const latestConfig = await loadConfig();
    if (!latestConfig.shortcut) {
      await setShortcut(true, prompt);
    } else if (updateMode) {
      console.log(`Shortcut already configured: ${latestConfig.shortcut}`);
    }

    const micConfig = await loadConfig();
    if (process.platform === 'win32' && (!micConfig.audioDevice || updateMode)) {
      await autoSelectMic(updateMode);
    }

    const polishConfig = await loadConfig();
    if (polishConfig.autoPolish === undefined) {
      await configureAutoPolish(prompt);
    } else if (updateMode && polishConfig.autoPolish && !polishConfig.keys?.groq) {
      await configureAutoPolish(prompt, true);
    } else if (updateMode) {
      console.log(`Auto polish: ${polishConfig.autoPolish ? 'enabled' : 'disabled'}. Keeping existing setup.`);
    }

    const polishShortcutConfig = await loadConfig();
    if (!polishShortcutConfig.polishShortcut) {
      await updateConfig({ polishShortcut: defaultPolishShortcut });
      console.log(`Polish shortcut set to ${defaultPolishShortcut}.`);
    } else if (updateMode) {
      console.log(`Polish shortcut already configured: ${polishShortcutConfig.polishShortcut}`);
    }

    const mediaConfig = await loadConfig();
    if (mediaConfig.audioDucking === undefined) {
      await configureMediaDucking(prompt);
    } else if (updateMode) {
      console.log(`Audio ducking: ${mediaConfig.audioDucking ? `enabled at ${mediaConfig.audioDuckingVolume ?? 35}%` : 'disabled'}. Keeping existing setup.`);
    }

    const current = await loadConfig();
    if (current.autostart === true) {
      const result = await enableAutostart();
      await updateConfig({ autostart: result.enabled });
      console.log(updateMode ? `Autostart refreshed. ${result.message}` : result.message);
    } else if (current.autostart === undefined || !updateMode) {
      const wantsAutostart = await prompt.confirm('Start Wisper automatically on computer startup?', true);
      if (wantsAutostart) {
        const result = await enableAutostart();
        await updateConfig({ autostart: result.enabled });
        console.log(result.message);
      } else {
        await updateConfig({ autostart: false });
        console.log('Autostart skipped.');
      }
    } else {
      console.log('Autostart disabled. Keeping existing setup.');
    }
  } finally {
    prompt.close();
  }
  await showStatus();
  if (updateMode) {
    await stopListener();
    await startListenerAndReport();
    return;
  }
  console.log('\nStarting Wisper listener now...');
  await listen();
}

async function update() {
  console.log('Updating Wisper CLI...');
  const cacheBust = Date.now();
  const command = process.platform === 'win32'
    ? {
        executable: 'powershell.exe',
        args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `iwr -useb "https://raw.githubusercontent.com/dix105/wisper-cli/master/install.ps1?x=${cacheBust}" | iex; wisper setup --update`]
      }
    : {
        executable: 'bash',
        args: ['-lc', `curl -fsSL "https://raw.githubusercontent.com/dix105/wisper-cli/master/install.sh?x=${cacheBust}" | bash && wisper setup --update`]
      };

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.executable, command.args, { stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Update failed with exit code ${code}`)));
  });
}

async function startListenerAndReport() {
  const listener = startListenerNow();
  console.log(listener.message);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const logs = await readLogs();
  const tail = logs.split(/\r?\n/).slice(-25).join('\n');
  if (tail.includes('Shortcut registered:')) {
    console.log('Listener verified: shortcut registered.');
  } else if (tail.includes('Could not register shortcut')) {
    console.log('Listener started but shortcut registration failed. Run: wisper logs');
  } else {
    console.log('Listener start requested. If shortcut does not work, run: wisper logs');
  }
}

async function configureAutoPolish(prompt = createPrompt(), forceEnable = false) {
  try {
    const wantsAutoPolish = forceEnable || await prompt.confirm('Auto polish dictated text before paste?', false);
    if (!wantsAutoPolish) {
      await updateConfig({ autoPolish: false });
      console.log('Auto polish disabled. Dictation will paste raw transcripts.');
      return;
    }

    const config = await loadConfig();
    let key = config.keys?.groq;
    if (!key) {
      key = await prompt.ask('Paste Groq API key for auto polish: ');
      const verification = await verifyProviderKey('groq', key);
      console.log(verification.message);
    }

    await updateConfig({ autoPolish: true, polishModel: 'llama-3.3-70b-versatile', keys: key ? { groq: key } : undefined });
    console.log('Auto polish enabled. Dictation will be polished before paste.');
  } finally {
    if (arguments.length === 0) prompt.close();
  }
}

async function polishCommand(args: string[]) {
  const action = args[0]?.toLowerCase();

  if (!action || action === 'status') {
    const config = await loadConfig();
    console.log(`Auto polish: ${config.autoPolish ? 'enabled' : 'disabled'}`);
    console.log(`Polish model: ${config.polishModel || 'llama-3.3-70b-versatile'}`);
    console.log(`Polish shortcut: ${config.polishShortcut || defaultPolishShortcut}`);
    console.log(`Groq key: ${config.keys?.groq ? 'saved' : 'not set'}`);
    return;
  }

  if (['on', 'enable', 'enabled'].includes(action)) {
    const prompt = createPrompt();
    try {
      await configureAutoPolish(prompt, true);
    } finally {
      prompt.close();
    }
    await stopListener();
    await startListenerAndReport();
    return;
  }

  if (['off', 'disable', 'disabled'].includes(action)) {
    await updateConfig({ autoPolish: false });
    console.log('Auto polish disabled.');
    await stopListener();
    await startListenerAndReport();
    return;
  }

  if (action === 'shortcut') {
    const prompt = createPrompt();
    try {
      const shortcut = await captureShortcut((await loadConfig()).polishShortcut || defaultPolishShortcut);
      await updateConfig({ polishShortcut: shortcut });
      console.log(`Polish shortcut set to ${shortcut}.`);
    } finally {
      prompt.close();
    }
    await stopListener();
    await startListenerAndReport();
    return;
  }

  const modes = new Set(['clean', 'polish', 'professional', 'shorter', 'friendly']);
  const mode = modes.has(action) ? action as RewriteMode : 'polish';
  const text = (modes.has(action) ? args.slice(1) : args).join(' ').trim();
  if (!text) throw new Error('Usage: wisper polish "text" or wisper polish on/off');

  const rewritten = await rewriteText(text, await loadConfig(), mode);
  console.log(rewritten);
}

async function autostartCommand(args: string[]) {
  const action = args[0]?.toLowerCase() || 'status';

  if (action === 'status') {
    const config = await loadConfig();
    console.log(`Autostart: ${config.autostart ? 'enabled' : 'disabled'}`);
    return;
  }

  if (['on', 'enable', 'enabled'].includes(action)) {
    const result = await enableAutostart();
    await updateConfig({ autostart: result.enabled });
    console.log(result.message);
    return;
  }

  if (['off', 'disable', 'disabled'].includes(action)) {
    const result = await disableAutostart();
    await updateConfig({ autostart: false });
    console.log(result.message);
    return;
  }

  throw new Error('Usage: wisper autostart on/off/status');
}

async function configureMediaDucking(prompt = createPrompt()) {
  try {
    const wantsDucking = await prompt.confirm('Lower system/media volume while recording?', true);
    if (!wantsDucking) {
      await updateConfig({ audioDucking: false });
      console.log('Audio ducking disabled.');
      return;
    }

    await updateConfig({ audioDucking: true, audioDuckingVolume: 35 });
    console.log('Audio ducking enabled. System volume will lower to 35% while recording, then restore.');
  } finally {
    if (arguments.length === 0) prompt.close();
  }
}

async function mediaCommand(args: string[]) {
  const action = args[0]?.toLowerCase();

  if (!action || action === 'status') {
    const config = await loadConfig();
    console.log(`Audio ducking: ${config.audioDucking === false ? 'disabled' : 'enabled'}`);
    console.log(`Duck volume: ${config.audioDuckingVolume ?? 35}%`);
    return;
  }

  if (['on', 'enable', 'enabled'].includes(action)) {
    const volume = Number(args[1] || 35);
    await updateConfig({ audioDucking: true, audioDuckingVolume: Number.isFinite(volume) ? Math.min(100, Math.max(0, volume)) : 35 });
    console.log(`Audio ducking enabled at ${Number.isFinite(volume) ? Math.min(100, Math.max(0, volume)) : 35}%.`);
    return;
  }

  if (['off', 'disable', 'disabled'].includes(action)) {
    await updateConfig({ audioDucking: false });
    await restoreMediaBehavior();
    console.log('Audio ducking disabled.');
    return;
  }

  if (action === 'volume') {
    const volume = Number(args[1]);
    if (!Number.isFinite(volume)) throw new Error('Usage: wisper media volume <0-100>');
    await updateConfig({ audioDucking: true, audioDuckingVolume: Math.min(100, Math.max(0, volume)) });
    console.log(`Audio ducking volume set to ${Math.min(100, Math.max(0, volume))}%.`);
    return;
  }

  if (action === 'test') {
    const config = await loadConfig();
    console.log('Lowering volume for 2 seconds...');
    await startMediaBehavior({ ...config, audioDucking: true });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await restoreMediaBehavior();
    console.log('Volume restored.');
    return;
  }

  throw new Error('Usage: wisper media on/off/status/volume/test');
}

async function selectProvider(prompt = createPrompt()) {
  try {
    const provider = await prompt.choose('Select provider:', providers) as Provider;
    const key = await prompt.ask(`Paste ${provider} API key: `);
    const verification = await verifyProviderKey(provider, key);
    console.log(verification.message);
    await updateConfig({ provider, keys: key ? { [provider]: key } : undefined });
    console.log(`Provider set to ${provider}.`);
  } finally {
    if (arguments.length === 0) prompt.close();
  }
}

async function selectModel(prompt = createPrompt()) {
  try {
    const labels = modelOptions.map((option) => option.label);
    const label = await prompt.choose('Select model:', labels);
    const option = modelOptions.find((candidate) => candidate.label === label) as ModelOption;
    const key = await prompt.ask(`Paste ${option.provider} API key: `);
    const verification = await verifyProviderKey(option.provider, key);
    console.log(verification.message);
    await updateConfig({
      provider: option.provider,
      model: option.model,
      keys: key ? { [option.provider]: key } : undefined
    });
    console.log(`Model set to ${option.label}.`);
  } finally {
    if (arguments.length === 0) prompt.close();
  }
}

async function autoSelectMic(updateMode = false) {
  if (process.platform !== 'win32') return;

  const config = await loadConfig();
  console.log(updateMode ? 'Checking microphone...' : 'Auto-detecting microphone...');
  const result = autoDetectInputDevice(config.audioDevice);
  const bestProbe = result.probes.find((probe) => probe.device === result.device);
  await updateConfig({ audioDevice: result.device });
  console.log(`Microphone set to ${result.device}${bestProbe ? ` (signal ${bestProbe.score.toFixed(5)})` : ''}.`);

  const silent = result.probes.filter((probe) => !probe.ok).map((probe) => probe.device);
  if (silent.length && updateMode) {
    console.log(`Ignored silent/unusable input(s): ${silent.join(', ')}`);
  }
}

async function selectMic(auto = false) {
  if (auto) {
    await autoSelectMic();
    await stopListener();
    await startListenerAndReport();
    return;
  }

  const prompt = createPrompt();
  try {
    const devices = listInputDevices();
    if (!devices.length) throw new Error('No microphone devices found.');
    const audioDevice = await prompt.choose('Select microphone:', devices);
    await updateConfig({ audioDevice });
    console.log(`Microphone set to ${audioDevice}.`);
  } finally {
    prompt.close();
  }
}

async function setShortcut(allowDefault = false, prompt = createPrompt()) {
  try {
    const typed = await prompt.confirm('Capture shortcut by pressing keys now?', true);
    const shortcut = typed
      ? await captureShortcut(defaultShortcut)
      : (await prompt.ask(`Shortcut${allowDefault ? ` [${defaultShortcut}]` : ''}: `) || defaultShortcut);
    await updateConfig({ shortcut });
    console.log(`Shortcut set to ${shortcut}.`);
    if (arguments.length < 2) {
      await stopListener();
      await startListenerAndReport();
    }
  } finally {
    if (arguments.length < 2) prompt.close();
  }
}

async function showStatus() {
  const config = await loadConfig();
  console.log('Current setup:');
  console.log(`  Provider: ${config.provider || 'not set'}`);
  console.log(`  Model: ${config.model || 'not set'}`);
  console.log(`  Shortcut: ${config.shortcut || 'not set'}`);
  console.log(`  Microphone: ${preferredInputDevice(config.audioDevice)}`);
  console.log(`  API key: ${config.provider && config.keys?.[config.provider] ? 'saved' : 'not set'}`);
  console.log(`  Auto polish: ${config.autoPolish ? 'enabled' : 'disabled'}`);
  console.log(`  Polish shortcut: ${config.polishShortcut || defaultPolishShortcut}`);
  console.log(`  Audio ducking: ${config.audioDucking === false ? 'disabled' : `enabled at ${config.audioDuckingVolume ?? 35}%`}`);
  console.log(`  Autostart: ${config.autostart ? 'enabled' : 'not enabled'}`);
}

async function listen() {
  await writeListenerPid();
  process.once('exit', () => { shutdownPasteHelper(); void clearListenerPid(); });
  process.once('SIGINT', () => { shutdownPasteHelper(); void clearListenerPid(); process.exit(0); });
  process.once('SIGTERM', () => { shutdownPasteHelper(); void clearListenerPid(); process.exit(0); });

  const config = await loadConfig();
  const shortcut = config.shortcut || defaultShortcut;
  let busy = false;

  await log('Wisper listener running.');
  await log(`Provider: ${config.provider || 'not set'}`);
  await log(`Model: ${config.model || 'not set'}`);
  await log(`Shortcut: ${shortcut}`);
  await log('Press shortcut once to start recording, again to stop. Press Ctrl+C to stop listener.');

  const stopShortcut = listenForShortcut(shortcut, (event) => {
    void handleShortcutEvent(event).catch((error) => log(`Error: ${error.message}`));
  });
  const polishShortcut = config.polishShortcut || defaultPolishShortcut;
  const stopPolishShortcut = polishShortcut && polishShortcut !== shortcut
    ? listenForShortcut(polishShortcut, (event) => {
        if (event === 'up') return;
        void handlePolishShortcut().catch((error) => log(`Polish error: ${error.message}`));
      })
    : undefined;
  const keepAlive = setInterval(() => undefined, 60_000);
  const stopDeviceWatcher = startInputDeviceWatcher();
  process.once('exit', () => { clearInterval(keepAlive); stopDeviceWatcher?.(); stopPolishShortcut?.(); stopShortcut?.(); });

  if (process.platform === 'darwin') {
    await log('Mac note: if shortcut does not trigger, allow Terminal/iTerm in System Settings → Privacy & Security → Accessibility.');
  }

  function startInputDeviceWatcher() {
    if (process.platform !== 'win32') return undefined;

    let lastSignature = listInputDevices().join('|');
    const interval = setInterval(() => {
      void (async () => {
        if (busy || isRecording()) return;

        const signature = listInputDevices().join('|');
        if (signature === lastSignature) return;
        lastSignature = signature;

        await log('Audio input device change detected. Rechecking microphones...');
        const latestConfig = await loadConfig();
        const result = autoDetectInputDevice(latestConfig.audioDevice);
        await updateConfig({ audioDevice: result.device });
        const probe = result.probes.find((item) => item.device === result.device);
        await log(`Microphone auto-switched to ${result.device}${probe ? ` (signal ${probe.score.toFixed(5)})` : ''}.`);
      })().catch((error) => log(`Mic auto-detect failed: ${error.message}`));
    }, 5_000);

    return () => clearInterval(interval);
  }

  async function handlePolishShortcut() {
    if (busy) return;
    busy = true;
    try {
      await log('Polishing selected text...');
      const selected = await copySelectedText();
      if (!selected) throw new Error('Select text first, then press the polish shortcut.');
      const latestConfig = await loadConfig();
      const polished = await rewriteText(selected, latestConfig, 'polish');
      await pasteIntoActiveApp(polished);
      await saveTranscript(polished, 'polish-shortcut');
      await log('Selected text polished and replaced.');
    } finally {
      busy = false;
    }
  }

  async function handleShortcutEvent(event?: 'down' | 'up') {
    if (busy) return;

    if (event === 'down') {
      if (isRecording()) return;
      const latestConfig = await loadConfig();
      const device = preferredInputDevice(latestConfig.audioDevice);
      await log(`Shortcut held. Recording from ${device}... release shortcut to stop.`);
      await startMediaBehavior(latestConfig).catch((error) => log(`Audio ducking failed: ${error.message}`));
      await startRecording(device);
      return;
    }

    if (event === 'up') {
      if (!isRecording()) return;
      await finishRecording();
      return;
    }

    if (!isRecording()) {
      const latestConfig = await loadConfig();
      const device = preferredInputDevice(latestConfig.audioDevice);
      await log(`Shortcut detected. Recording from ${device}... press shortcut again to stop.`);
      await startMediaBehavior(latestConfig).catch((error) => log(`Audio ducking failed: ${error.message}`));
      await startRecording(device);
      return;
    }
    await finishRecording();
  }

  async function finishRecording() {
    busy = true;
    const totalStart = Date.now();
    try {
      await log('Shortcut released. Stopping recording...');
      const stopStart = Date.now();
      const recording = await stopRecording();
      await restoreMediaBehavior().catch((error) => log(`Audio restore failed: ${error.message}`));
      const stopMs = Date.now() - stopStart;
      if (recording.durationMs < 500) throw new Error('Recording too short. Hold shortcut while speaking, then release.');

      await log(`Recorded ${(recording.durationMs / 1000).toFixed(1)}s audio. WAV finalized in ${stopMs}ms.`);

      const latestConfig = await loadConfig();
      const transcribeStart = Date.now();
      await log('Sending audio to transcription provider...');
      const text = await transcribeFile(recording.file, latestConfig);
      const transcribeMs = Date.now() - transcribeStart;
      if (!text) throw new Error('Empty transcript returned.');

      const polishStart = Date.now();
      if (latestConfig.autoPolish) await log('Polishing dictated text before paste...');
      const finalText = await polishDictationIfEnabled(text, latestConfig);
      const polishMs = Date.now() - polishStart;

      const saveStart = Date.now();
      await saveTranscript(finalText, recording.file);
      const saveMs = Date.now() - saveStart;

      const pasteStart = Date.now();
      await pasteIntoActiveApp(finalText);
      const pasteMs = Date.now() - pasteStart;

      void cleanupOldRecordings();

      await log(`Timing: transcribe ${transcribeMs}ms, polish ${polishMs}ms, save ${saveMs}ms, paste ${pasteMs}ms, total ${Date.now() - totalStart}ms.`);
      await log(`Inserted: ${finalText}`);
    } finally {
      await restoreMediaBehavior().catch(() => undefined);
      busy = false;
    }
  }

  await new Promise(() => undefined);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
