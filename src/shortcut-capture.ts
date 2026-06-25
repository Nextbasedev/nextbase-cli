import { stdin, stdout } from 'node:process';
import { emitKeypressEvents } from 'node:readline';

const modifierLabels = ['CommandOrControl', 'Alt', 'Shift'] as const;

type ModifierLabel = typeof modifierLabels[number];

function modifierFromKey(name?: string): ModifierLabel | '' {
  if (!name) return '';
  const key = name.toLowerCase();
  if (key === 'ctrl' || key === 'control' || key === 'command' || key === 'cmd') return 'CommandOrControl';
  if (key === 'meta') return process.platform === 'darwin' ? 'CommandOrControl' : 'Alt';
  if (key === 'alt' || key === 'option') return 'Alt';
  if (key === 'shift') return 'Shift';
  return '';
}

function displayKey(name?: string) {
  if (!name) return '';
  if (name === 'space') return 'Space';
  if (name.length === 1) return name.toUpperCase();
  return name[0].toUpperCase() + name.slice(1);
}

function isStandaloneKey(key: string) {
  return /^F\d{1,2}$/i.test(key);
}

function preview(modifiers: Set<ModifierLabel>) {
  const parts = modifierLabels.filter((part) => modifiers.has(part));
  stdout.write(`\rShortcut: ${parts.length ? `${parts.join(' + ')} + …` : 'hold Ctrl/Alt/Shift, then press a key'}      `);
}

export async function captureShortcut(defaultShortcut: string): Promise<string> {
  if (!stdin.isTTY) return defaultShortcut;

  emitKeypressEvents(stdin);
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();

  const modifiers = new Set<ModifierLabel>();

  console.log(`Press your shortcut now. Example: ${defaultShortcut}`);
  console.log('Hold Ctrl/Alt/Shift, then press final key. Esc cancels.');
  preview(modifiers);

  return await new Promise<string>((resolve) => {
    const cleanup = (value: string) => {
      stdout.write('\n');
      stdin.off('keypress', onKeypress);
      stdin.setRawMode(wasRaw);
      resolve(value);
    };

    const onKeypress = (_chunk: string, key: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; sequence?: string }) => {
      if (key.name === 'escape') return cleanup(defaultShortcut);
      if (key.ctrl && key.name === 'c') process.exit(130);

      if (key.ctrl) modifiers.add('CommandOrControl');
      if (key.meta) modifiers.add(process.platform === 'darwin' ? 'CommandOrControl' : 'Alt');
      if (key.shift) modifiers.add('Shift');

      const modifier = modifierFromKey(key.name);
      if (modifier) {
        modifiers.add(modifier);
        preview(modifiers);
        return;
      }

      const finalKey = displayKey(key.name);
      if (!finalKey) return;

      const parts = modifierLabels.filter((part) => modifiers.has(part));
      if (parts.length === 0 && !isStandaloneKey(finalKey)) {
        stdout.write('\nPlain keys are not allowed. Hold Ctrl/Alt/Shift or use a function key.\n');
        preview(modifiers);
        return;
      }

      cleanup([...parts, finalKey].join('+'));
    };

    stdin.on('keypress', onKeypress);
  });
}
