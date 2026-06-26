#!/usr/bin/env node
import { loadHistory, saveTranscript } from './storage.js';
import { startWebApp } from './server.js';
import { openUrl } from './open.js';
import { defaultShortcut, loadConfig, modelOptions, providers, updateConfig, type ModelOption, type Provider } from './config.js';
import { createPrompt } from './prompt.js';
import { enableAutostart, startListenerNow } from './autostart.js';
import { verifyProviderKey } from './verify.js';
import { isRecording, startRecording, stopRecording } from './audio.js';
import { listenForShortcut } from './hotkey.js';
import { pasteIntoActiveApp } from './paste.js';
import { transcribeFile } from './transcribe.js';
import { captureShortcut } from './shortcut-capture.js';
import { log, readLogs } from './log.js';
import { clearListenerPid, stopListener, writeListenerPid } from './process-state.js';

const [command, ...args] = process.argv.slice(2);

async function main() {
  switch (command) {
    case undefined:
    case 'help':
      printHelp();
      break;
    case 'setup':
      await setup();
      break;
    case 'provider':
      await selectProvider();
      break;
    case 'shortcut':
      await setShortcut();
      break;
    case 'status':
      await showStatus();
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
      const listener = startListenerNow();
      console.log(listener.message);
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
  wisper provider         Pick provider from a menu
  wisper shortcut         Set shortcut from a prompt
  wisper status           Show current setup
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

async function setup() {
  console.log('Wisper setup');
  const prompt = createPrompt();
  try {
    await selectModel(prompt);
    await setShortcut(true, prompt);
    const wantsAutostart = await prompt.confirm('Start Wisper automatically on computer startup?', true);
    if (wantsAutostart) {
      const result = await enableAutostart();
      await updateConfig({ autostart: result.enabled });
      console.log(result.message);
    } else {
      await updateConfig({ autostart: false });
      console.log('Autostart skipped.');
    }
    const listener = startListenerNow();
    console.log(listener.message);
  } finally {
    prompt.close();
  }
  await showStatus();
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
      const listener = startListenerNow();
      console.log(listener.message);
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
  console.log(`  API key: ${config.provider && config.keys?.[config.provider] ? 'saved' : 'not set'}`);
  console.log(`  Autostart: ${config.autostart ? 'enabled' : 'not enabled'}`);
}

async function listen() {
  await writeListenerPid();
  process.once('exit', () => { void clearListenerPid(); });
  process.once('SIGINT', () => { void clearListenerPid(); process.exit(0); });
  process.once('SIGTERM', () => { void clearListenerPid(); process.exit(0); });

  const config = await loadConfig();
  const shortcut = config.shortcut || defaultShortcut;
  let busy = false;

  await log('Wisper listener running.');
  await log(`Provider: ${config.provider || 'not set'}`);
  await log(`Model: ${config.model || 'not set'}`);
  await log(`Shortcut: ${shortcut}`);
  await log('Press shortcut once to start recording, again to stop. Press Ctrl+C to stop listener.');

  listenForShortcut(shortcut, (event) => {
    void handleShortcutEvent(event).catch((error) => log(`Error: ${error.message}`));
  });

  async function handleShortcutEvent(event?: 'down' | 'up') {
    if (busy) return;

    if (event === 'down') {
      if (isRecording()) return;
      await log('Shortcut held. Recording... release shortcut to stop.');
      await startRecording();
      return;
    }

    if (event === 'up') {
      if (!isRecording()) return;
      await finishRecording();
      return;
    }

    if (!isRecording()) {
      await log('Shortcut detected. Recording... press shortcut again to stop.');
      await startRecording();
      return;
    }
    await finishRecording();
  }

  async function finishRecording() {
    busy = true;
    try {
      await log('Shortcut released. Stopping recording...');
      const recording = await stopRecording();
      if (recording.durationMs < 500) throw new Error('Recording too short. Hold shortcut while speaking, then release.');
      await log(`Transcribing ${Math.round(recording.durationMs / 1000)}s audio...`);
      const latestConfig = await loadConfig();
      const text = await transcribeFile(recording.file, latestConfig);
      if (!text) throw new Error('Empty transcript returned.');
      await saveTranscript(text, recording.file);
      await pasteIntoActiveApp(text);
      await log(`Inserted: ${text}`);
    } finally {
      busy = false;
    }
  }

  await new Promise(() => undefined);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
