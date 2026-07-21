#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPrompt } from './prompt.js';

const [tool, ...args] = process.argv.slice(2);

type Tool = 'wisper' | 'notebot';

function toolPath(toolName: Tool) {
  return fileURLToPath(new URL(toolName === 'wisper' ? './cli.js' : './notebot-cli.js', import.meta.url));
}

function runTool(toolName: Tool, toolArgs: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [toolPath(toolName), ...toolArgs], { stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${toolName} exited with code ${code}`)));
  });
}

function printHelp() {
  console.log(`Nextbase CLI

Usage:
  nextbase                 Open interactive tool menu
  nextbase wisper [args]   Run Wisper commands
  nextbase notebot [args]  Run NoteBot commands

Direct commands still work:
  wisper setup
  notebot open

Tools:
  1. Wisper  - hold-to-record dictation, paste, polish, spell fix
  2. NoteBot - meeting recording, audio import, summaries, tasks, decisions
`);
}

async function menu() {
  const prompt = createPrompt();
  try {
    const choice = await prompt.choose('Choose a Nextbase tool:', [
      'Wisper — dictation / polish / spell fix',
      'NoteBot — meetings / audio notes / tasks',
      'Help'
    ]);

    if (choice.startsWith('Wisper')) return runTool('wisper', []);
    if (choice.startsWith('NoteBot')) return runTool('notebot', []);
    printHelp();
  } finally {
    prompt.close();
  }
}

async function main() {
  if (!tool || tool === 'menu') return menu();
  if (tool === 'help' || tool === '--help' || tool === '-h') return printHelp();
  if (tool === 'wisper') return runTool('wisper', args);
  if (tool === 'notebot' || tool === 'note') return runTool('notebot', args);
  throw new Error(`Unknown Nextbase tool: ${tool}. Run: nextbase help`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
