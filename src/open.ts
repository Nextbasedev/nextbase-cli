import { spawn } from 'node:child_process';

export function openUrl(url: string) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {
    // Headless/minimal systems may not have an opener (for example xdg-open).
    // The CLI already prints the URL, so opening the browser is best-effort.
  });
  child.unref();
}
