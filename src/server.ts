import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHistory } from './storage.js';

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};

export async function startWebApp(port = 3838): Promise<string> {
  const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/api/history') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(await loadHistory()));
        return;
      }

      const path = req.url === '/' ? '/index.html' : req.url?.split('?')[0] || '/index.html';
      const file = join(webRoot, path);
      const body = await readFile(file);
      res.setHeader('content-type', contentTypes[extname(file)] || 'text/plain; charset=utf-8');
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end('Not found');
    }
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return `http://127.0.0.1:${port}`;
}
