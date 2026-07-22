import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadActiveMeeting, loadMeetings, notebotAudioDir } from './notebot-storage.js';

type DashboardJob = {
  id: string;
  label: string;
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt?: string;
  output: string;
};

const jobs = new Map<string, DashboardJob>();
let latestJobId: string | undefined;

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
    .job { border: 1px solid #3f3f46; background: #0a0b10; border-radius: 16px; padding: 14px; margin-top: 14px; }
    .job.running { border-color: #86efac; box-shadow: 0 0 0 1px rgba(134,239,172,.08), 0 0 40px rgba(134,239,172,.08); }
    .job.failed { border-color: #fecaca; }
    .spinner { display: inline-block; width: 10px; height: 10px; border: 2px solid #334155; border-top-color: #86efac; border-radius: 999px; animation: spin 1s linear infinite; margin-right: 8px; }
    @keyframes spin { to { transform: rotate(360deg); } }
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
      <p>Paste a remote URL or choose a local audio file.</p>
      <input id="audio-source" placeholder="https://example.com/audio.mp3" />
      <div style="height:10px"></div>
      <div class="row">
        <button class="secondary" onclick="processRemoteAudio()">Use Remote URL</button>
        <button onclick="document.getElementById('audio-file').click()">Choose Local File</button>
      </div>
      <input id="audio-file" type="file" accept="audio/*,video/mp4,video/webm,.wav,.mp3,.m4a,.mp4,.webm,.ogg,.opus,.flac,.aac" style="display:none" onchange="processUploadedAudio()" />
    </div>
  </section>

  <p class="status" id="message"></p>
  <section class="job" id="job-card" style="display:none;">
    <strong id="job-title"></strong>
    <p class="status" id="job-status"></p>
    <pre id="job-output"></pre>
  </section>

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
    document.getElementById('message').textContent = data.output || data.message || (data.job ? 'Started: ' + data.job.label : 'Done');
  } catch (e) {
    document.getElementById('message').textContent = e.message;
  } finally {
    setBusy(false);
    await refresh();
  }
}
async function processRemoteAudio() {
  const source = document.getElementById('audio-source').value.trim();
  if (!source) return;
  setBusy(true);
  try {
    const data = await api('/api/audio', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source }) });
    document.getElementById('message').textContent = data.job ? 'Started: ' + data.job.label : (data.output || 'Audio processing started');
  } catch (e) {
    document.getElementById('message').textContent = e.message;
  } finally {
    setBusy(false);
    await refresh();
  }
}
async function processUploadedAudio() {
  const input = document.getElementById('audio-file');
  const file = input.files && input.files[0];
  if (!file) return;
  setBusy(true);
  try {
    document.getElementById('message').textContent = 'Uploading ' + file.name + '...';
    const data = await api('/api/upload-audio?name=' + encodeURIComponent(file.name), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file });
    document.getElementById('message').textContent = data.job ? 'Started: ' + data.job.label : (data.output || 'Audio processing started');
  } catch (e) {
    document.getElementById('message').textContent = e.message;
  } finally {
    input.value = '';
    setBusy(false);
    await refresh();
  }
}
function setBusy(value) { document.querySelectorAll('button').forEach((button) => button.disabled = value); }
async function refresh() {
  const data = await api('/api/state');
  const active = data.active;
  const job = data.latestJob;
  const running = job && job.status === 'running';
  document.getElementById('status-pill').textContent = running ? 'Processing' : (active ? active.status : 'Idle');
  document.getElementById('meeting-status').textContent = active ? active.id + ' · ' + active.status : 'No active meeting.';
  setBusy(Boolean(running));
  renderJob(job);
  document.getElementById('meetings').innerHTML = data.meetings.length ? data.meetings.map((note) => {
    const decisions = (note.decisions || []).map((d) => '<div class="task">Decision: ' + escapeHtml(d) + '</div>').join('');
    const tasks = (note.actionItems || []).map((t) => '<div class="task">[' + escapeHtml(t.confidence) + '] ' + escapeHtml(t.task) + (t.owner ? ' — ' + escapeHtml(t.owner) : '') + '</div>').join('');
    return '<article class="meeting"><h3>' + escapeHtml(note.title) + '</h3><p>' + escapeHtml(note.summary || '') + '</p><div class="pill">' + ((note.actionItems && note.actionItems.length) || 0) + ' tasks</div><div>' + decisions + '</div><div>' + tasks + '</div><details><summary>Transcript</summary><pre>' + escapeHtml(note.transcript || '') + '</pre></details></article>';
  }).join('') : '<p>No meetings yet.</p>';
}
function renderJob(job) {
  const card = document.getElementById('job-card');
  if (!job) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  card.className = 'job ' + job.status;
  document.getElementById('job-title').innerHTML = (job.status === 'running' ? '<span class="spinner"></span>' : '') + escapeHtml(job.label);
  document.getElementById('job-status').textContent = job.status === 'running' ? 'Running now — keep this page open. This can take a few minutes for long meetings.' : (job.status === 'done' ? 'Done' : 'Failed');
  document.getElementById('job-output').textContent = job.output || (job.status === 'running' ? 'Waiting for logs...' : '');
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

function startCliJob(label: string, args: string[]): DashboardJob {
  const id = `job-${Date.now()}`;
  const job: DashboardJob = { id, label, status: 'running', startedAt: new Date().toISOString(), output: '' };
  jobs.set(id, job);
  latestJobId = id;
  const cliPath = fileURLToPath(new URL('./notebot-cli.js', import.meta.url));
  const child = spawn(process.execPath, [cliPath, ...args], { cwd: dirname(cliPath), windowsHide: true });
  const append = (chunk: unknown) => {
    job.output = `${job.output}${String(chunk)}`.slice(-12000);
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.once('error', (error) => {
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    append(`\n${error instanceof Error ? error.message : String(error)}`);
  });
  child.once('exit', (code) => {
    job.status = code === 0 ? 'done' : 'failed';
    job.finishedAt = new Date().toISOString();
    if (code !== 0 && !job.output.trim()) append(`Exited with code ${code}`);
  });
  return job;
}

function latestJob() {
  return latestJobId ? jobs.get(latestJobId) : undefined;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> : {};
}

async function readRaw(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function safeFileName(value: string) {
  const name = basename(value || 'audio-file').replace(/[^a-z0-9._-]/gi, '-');
  return name || 'audio-file';
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
        res.end(JSON.stringify({ active: await loadActiveMeeting(), meetings: await loadMeetings(), latestJob: latestJob() }));
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
        const job = startCliJob('Stop meeting, transcribe, summarize', ['meeting', 'stop']);
        res.statusCode = 202;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ job }));
        return;
      }
      if (req.method === 'POST' && req.url === '/api/audio') {
        const body = await readJson(req);
        const source = typeof body.source === 'string' ? body.source : '';
        const job = startCliJob('Process remote audio URL', ['audio', source]);
        res.statusCode = 202;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ job }));
        return;
      }
      if (req.method === 'POST' && req.url?.startsWith('/api/upload-audio')) {
        const url = new URL(req.url, 'http://127.0.0.1');
        const name = safeFileName(url.searchParams.get('name') || 'audio-file');
        const bytes = await readRaw(req);
        if (bytes.length < 1024) throw new Error('Uploaded audio file is empty or too small.');
        await mkdir(notebotAudioDir, { recursive: true });
        const file = join(notebotAudioDir, `${Date.now()}-${name}`);
        await writeFile(file, bytes);
        const job = startCliJob(`Process uploaded audio: ${name}`, ['audio', file]);
        res.statusCode = 202;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ job }));
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
