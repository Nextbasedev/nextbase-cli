import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadActiveMeeting, loadMeetings } from './notebot-storage.js';

const html = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Nextbase NoteBot</title>
  <style>
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #08090d; color: #f4f4f5; }
    main { max-width: 1040px; margin: 0 auto; padding: 32px 20px 64px; }
    .hero { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; margin-bottom: 24px; }
    h1 { margin: 0 0 8px; font-size: 36px; letter-spacing: -0.04em; }
    p { color: #a1a1aa; line-height: 1.6; }
    button { border: 0; border-radius: 14px; padding: 12px 16px; font-weight: 700; color: #09090b; background: #a7f3d0; cursor: pointer; }
    button.secondary { background: #e9d5ff; }
    button.danger { background: #fecaca; }
    button:disabled { opacity: .5; cursor: wait; }
    input { width: min(620px, 100%); border: 1px solid #27272a; border-radius: 14px; padding: 12px 14px; background: #111217; color: #f4f4f5; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
    .card { background: linear-gradient(180deg, #111217, #0c0d12); border: 1px solid #24252d; border-radius: 22px; padding: 18px; box-shadow: 0 20px 80px rgba(0,0,0,.25); }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .status { font-size: 14px; color: #a1a1aa; }
    .pill { display: inline-flex; border: 1px solid #30313a; border-radius: 999px; padding: 4px 9px; color: #c4b5fd; font-size: 12px; }
    .meeting { margin-top: 14px; padding-top: 14px; border-top: 1px solid #24252d; }
    .meeting h3 { margin: 0 0 8px; }
    .task { color: #d4d4d8; font-size: 14px; margin: 5px 0; }
    pre { white-space: pre-wrap; color: #d4d4d8; background: #090a0f; border-radius: 14px; padding: 12px; max-height: 220px; overflow: auto; }
  </style>
</head>
<body>
<main>
  <section class="hero">
    <div>
      <h1>Nextbase NoteBot</h1>
      <p>Record meetings or process an existing local/remote audio file. NoteBot creates multilingual transcripts, summaries, decisions, and responsible action items.</p>
    </div>
    <span class="pill" id="status-pill">Loading…</span>
  </section>

  <section class="grid">
    <div class="card">
      <h2>Live meeting</h2>
      <p class="status" id="meeting-status">Checking status…</p>
      <div class="row">
        <button onclick="run('/api/start')">Start Meeting</button>
        <button class="danger" onclick="run('/api/stop')">Stop & Generate Notes</button>
      </div>
    </div>

    <div class="card">
      <h2>Process audio file</h2>
      <p>Paste a local path or a remote URL.</p>
      <input id="audio-source" placeholder="/Users/me/meeting.wav or https://example.com/audio.mp3" />
      <div style="height:10px"></div>
      <button class="secondary" onclick="processAudio()">Transcribe & Summarize</button>
    </div>
  </section>

  <p class="status" id="message"></p>

  <section class="card" style="margin-top: 16px;">
    <h2>Meetings</h2>
    <div id="meetings"></div>
  </section>
</main>
<script>
async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
async function run(path) {
  setBusy(true);
  try {
    const data = await api(path, { method: 'POST' });
    document.getElementById('message').textContent = data.output || data.message || 'Done';
  } catch (e) {
    document.getElementById('message').textContent = e.message;
  } finally {
    setBusy(false);
    await refresh();
  }
}
async function processAudio() {
  const source = document.getElementById('audio-source').value.trim();
  if (!source) return;
  setBusy(true);
  try {
    const data = await api('/api/audio', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source }) });
    document.getElementById('message').textContent = data.output || 'Audio processed';
  } catch (e) {
    document.getElementById('message').textContent = e.message;
  } finally {
    setBusy(false);
    await refresh();
  }
}
function setBusy(value) { document.querySelectorAll('button').forEach((button) => button.disabled = value); }
async function refresh() {
  const data = await api('/api/state');
  const active = data.active;
  document.getElementById('status-pill').textContent = active ? active.status : 'Idle';
  document.getElementById('meeting-status').textContent = active ? active.id + ' · ' + active.status : 'No active meeting.';
  document.getElementById('meetings').innerHTML = data.meetings.length ? data.meetings.map((note) => {
    const decisions = (note.decisions || []).map((d) => '<div class="task">Decision: ' + escapeHtml(d) + '</div>').join('');
    const tasks = (note.actionItems || []).map((t) => '<div class="task">[' + escapeHtml(t.confidence) + '] ' + escapeHtml(t.task) + (t.owner ? ' — ' + escapeHtml(t.owner) : '') + '</div>').join('');
    return '<article class="meeting"><h3>' + escapeHtml(note.title) + '</h3><p>' + escapeHtml(note.summary || '') + '</p><div class="pill">' + ((note.actionItems && note.actionItems.length) || 0) + ' tasks</div><div>' + decisions + '</div><div>' + tasks + '</div><details><summary>Transcript</summary><pre>' + escapeHtml(note.transcript || '') + '</pre></details></article>';
  }).join('') : '<p>No meetings yet.</p>';
}
function escapeHtml(value) { return String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
refresh();
setInterval(refresh, 2500);
</script>
</body>
</html>`;

function runCli(args: string[]): Promise<{ code: number | null; output: string }> {
  const cliPath = fileURLToPath(new URL('./notebot-cli.js', import.meta.url));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], { cwd: dirname(cliPath), windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    child.once('exit', (code) => resolve({ code, output: output.trim() }));
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> : {};
}

export async function startNoteBotWebApp(port = 3840): Promise<string> {
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/') {
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(html);
        return;
      }
      if (req.url === '/api/state') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ active: await loadActiveMeeting(), meetings: await loadMeetings() }));
        return;
      }
      if (req.method === 'POST' && req.url === '/api/start') {
        const result = await runCli(['meeting', 'start']);
        res.statusCode = result.code === 0 ? 200 : 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ output: result.output }));
        return;
      }
      if (req.method === 'POST' && req.url === '/api/stop') {
        const result = await runCli(['meeting', 'stop']);
        res.statusCode = result.code === 0 ? 200 : 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ output: result.output }));
        return;
      }
      if (req.method === 'POST' && req.url === '/api/audio') {
        const body = await readJson(req);
        const source = typeof body.source === 'string' ? body.source : '';
        const result = await runCli(['audio', source]);
        res.statusCode = result.code === 0 ? 200 : 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ output: result.output }));
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return `http://127.0.0.1:${port}`;
}
