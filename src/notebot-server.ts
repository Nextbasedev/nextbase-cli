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
    :root {
      --bg: #07080d;
      --panel: rgba(15, 18, 28, 0.82);
      --panel-strong: rgba(19, 23, 36, 0.96);
      --line: rgba(255, 255, 255, 0.09);
      --line-strong: rgba(255, 255, 255, 0.16);
      --text: #f7f7fb;
      --muted: #a8adbd;
      --soft: #72798d;
      --green: #91f7c5;
      --violet: #c7b8ff;
      --amber: #ffd98a;
      --red: #ffb4b4;
      --shadow: 0 26px 90px rgba(0, 0, 0, 0.42);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at 12% -10%, rgba(145, 247, 197, 0.22), transparent 34%),
        radial-gradient(circle at 86% 0%, rgba(199, 184, 255, 0.20), transparent 32%),
        linear-gradient(180deg, #0b0d15 0%, var(--bg) 58%, #05060a 100%);
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: .32;
      background-image: linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);
      background-size: 44px 44px;
      mask-image: linear-gradient(to bottom, black, transparent 78%);
    }
    main { position: relative; max-width: 1180px; margin: 0 auto; padding: 30px 18px 72px; }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 34px; }
    .brand { display: flex; align-items: center; gap: 12px; color: #e8eaf3; font-weight: 800; letter-spacing: -.02em; }
    .logo { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 14px; background: linear-gradient(135deg, rgba(145,247,197,.95), rgba(199,184,255,.95)); color: #08090d; box-shadow: 0 12px 36px rgba(145,247,197,.22); }
    .status-pill { display: inline-flex; align-items: center; gap: 8px; min-height: 36px; border: 1px solid var(--line); border-radius: 999px; padding: 8px 13px; color: #d8dcf0; background: rgba(255,255,255,.05); backdrop-filter: blur(18px); font-size: 13px; font-weight: 700; }
    .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--green); box-shadow: 0 0 20px rgba(145,247,197,.8); }
    .hero { display: grid; grid-template-columns: minmax(0, 1.16fr) minmax(290px, .84fr); gap: 18px; align-items: stretch; margin-bottom: 18px; }
    .hero-card, .card, .job { border: 1px solid var(--line); background: linear-gradient(180deg, var(--panel), rgba(10,12,20,.78)); backdrop-filter: blur(22px); box-shadow: var(--shadow); }
    .hero-card { border-radius: 34px; padding: 34px; overflow: hidden; position: relative; }
    .hero-card::after { content: ""; position: absolute; width: 260px; height: 260px; right: -110px; top: -95px; background: radial-gradient(circle, rgba(145,247,197,.20), transparent 65%); }
    .eyebrow { display: inline-flex; align-items: center; gap: 8px; margin-bottom: 18px; color: var(--green); border: 1px solid rgba(145,247,197,.25); background: rgba(145,247,197,.08); padding: 8px 11px; border-radius: 999px; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }
    h1 { margin: 0; max-width: 780px; font-size: clamp(42px, 7vw, 76px); line-height: .9; letter-spacing: -0.075em; }
    h2 { margin: 0; font-size: 20px; letter-spacing: -.03em; }
    h3 { margin: 0; font-size: 17px; letter-spacing: -.025em; }
    p { margin: 0; color: var(--muted); line-height: 1.62; }
    .hero-copy { max-width: 710px; margin-top: 20px; font-size: 17px; color: #c3c8d8; }
    .metric-card { border-radius: 34px; padding: 24px; background: linear-gradient(160deg, rgba(199,184,255,.14), rgba(145,247,197,.08)); border: 1px solid var(--line); box-shadow: var(--shadow); }
    .metric-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 18px; }
    .metric { padding: 14px; border-radius: 20px; background: rgba(255,255,255,.055); border: 1px solid var(--line); }
    .metric b { display:block; font-size: 22px; letter-spacing: -.05em; }
    .metric span { display:block; margin-top: 3px; color: var(--soft); font-size: 12px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; margin-top: 18px; }
    .card { border-radius: 28px; padding: 24px; }
    .card-head { display:flex; align-items:flex-start; justify-content:space-between; gap: 14px; margin-bottom: 18px; }
    .icon { width: 42px; height: 42px; display:grid; place-items:center; border-radius: 16px; background: rgba(255,255,255,.07); border: 1px solid var(--line); }
    .status { color: var(--muted); font-size: 14px; }
    .field { display: flex; gap: 10px; align-items: center; margin-top: 18px; }
    input { width: 100%; min-height: 48px; border: 1px solid var(--line-strong); border-radius: 16px; padding: 0 15px; background: rgba(5,6,10,.58); color: var(--text); outline: none; transition: border .18s ease, box-shadow .18s ease; }
    input:focus { border-color: rgba(145,247,197,.55); box-shadow: 0 0 0 4px rgba(145,247,197,.10); }
    button { min-height: 46px; border: 0; border-radius: 16px; padding: 0 16px; font-weight: 850; letter-spacing: -.01em; color: #07080d; background: var(--green); cursor: pointer; transition: transform .12s ease, opacity .12s ease, box-shadow .12s ease; box-shadow: 0 12px 26px rgba(145,247,197,.12); }
    button:hover { transform: translateY(-1px); box-shadow: 0 16px 36px rgba(145,247,197,.18); }
    button.secondary { background: var(--violet); box-shadow: 0 12px 26px rgba(199,184,255,.12); }
    button.ghost { color: var(--text); background: rgba(255,255,255,.07); border: 1px solid var(--line); box-shadow: none; }
    button.danger { background: var(--red); box-shadow: 0 12px 26px rgba(255,180,180,.12); }
    button:disabled { opacity: .52; cursor: wait; transform: none; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .message { min-height: 20px; margin: 16px 4px 0; color: #cdd3e6; }
    .job { display:none; border-radius: 28px; padding: 20px; margin-top: 18px; }
    .job.running { border-color: rgba(145,247,197,.55); box-shadow: 0 0 0 1px rgba(145,247,197,.08), 0 24px 90px rgba(145,247,197,.08); }
    .job.failed { border-color: rgba(255,180,180,.6); }
    .job-head { display:flex; justify-content:space-between; gap: 14px; align-items:center; margin-bottom: 12px; }
    .progress { height: 9px; overflow:hidden; border-radius: 999px; background: rgba(255,255,255,.08); margin: 14px 0; }
    .bar { width: 38%; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--green), var(--violet)); animation: glide 1.35s ease-in-out infinite alternate; }
    @keyframes glide { from { transform: translateX(-44%); } to { transform: translateX(186%); } }
    .spinner { display:inline-block; width: 12px; height: 12px; border: 2px solid rgba(255,255,255,.18); border-top-color: var(--green); border-radius: 999px; animation: spin 1s linear infinite; margin-right: 8px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .pill { display:inline-flex; align-items:center; gap: 6px; border: 1px solid var(--line); border-radius: 999px; padding: 6px 10px; color: #dfe3f6; background: rgba(255,255,255,.055); font-size: 12px; font-weight: 750; }
    .meetings-card { margin-top: 18px; }
    .meetings-head { display:flex; justify-content:space-between; align-items:center; gap: 12px; margin-bottom: 10px; }
    .meeting { margin-top: 14px; padding: 18px; border: 1px solid var(--line); border-radius: 22px; background: rgba(255,255,255,.045); }
    .meeting-top { display:flex; justify-content:space-between; gap: 12px; align-items:flex-start; margin-bottom: 10px; }
    .task { color: #d7dbeb; font-size: 14px; margin: 7px 0; padding: 9px 10px; border-radius: 12px; background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.06); }
    .empty { padding: 30px; text-align:center; border: 1px dashed var(--line-strong); border-radius: 22px; color: var(--muted); background: rgba(255,255,255,.03); }
    pre { white-space: pre-wrap; color: #d7dbeb; background: rgba(5,6,10,.78); border: 1px solid var(--line); border-radius: 18px; padding: 14px; max-height: 260px; overflow: auto; font-size: 12px; line-height: 1.55; }
    summary { color: #dfe3f6; cursor:pointer; margin-top: 12px; font-weight: 700; }
    @media (max-width: 820px) { .hero, .grid { grid-template-columns: 1fr; } .hero-card { padding: 26px; } .field { flex-direction: column; align-items: stretch; } button { width: 100%; } .metric-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
<main>
  <nav class="topbar">
    <div class="brand"><span class="logo">N</span><span>Nextbase NoteBot</span></div>
    <span class="status-pill"><span class="dot"></span><span id="status-pill">Loading…</span></span>
  </nav>

  <section class="hero">
    <div class="hero-card">
      <span class="eyebrow">Meeting intelligence</span>
      <h1>Turn messy calls into clean decisions.</h1>
      <p class="hero-copy">Record a live meeting or drop in an audio file. NoteBot transcribes multilingual conversations, detects speaker turns with Sarvam Batch, and extracts decisions, tasks, blockers, and owners.</p>
    </div>
    <aside class="metric-card">
      <h2>Pipeline</h2>
      <p style="margin-top:8px">Designed for long real meetings, not 30-second demos.</p>
      <div class="metric-grid">
        <div class="metric"><b>2h</b><span>Sarvam Batch audio</span></div>
        <div class="metric"><b>20</b><span>speaker labels max</span></div>
        <div class="metric"><b>3</b><span>summary layers</span></div>
        <div class="metric"><b>0</b><span>silent owner guessing</span></div>
      </div>
    </aside>
  </section>

  <section class="grid">
    <div class="card">
      <div class="card-head">
        <div><h2>Live meeting</h2><p class="status" id="meeting-status">Checking status…</p></div>
        <div class="icon">🎙️</div>
      </div>
      <div class="row">
        <button onclick="run('/api/start')">Start recording</button>
        <button class="danger" onclick="run('/api/stop')">Stop & generate notes</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div><h2>Process audio</h2><p class="status">Use a remote URL or upload from this computer.</p></div>
        <div class="icon">📁</div>
      </div>
      <div class="field">
        <input id="audio-source" placeholder="https://example.com/meeting.mp3" />
        <button class="secondary" onclick="processRemoteAudio()">Use URL</button>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="ghost" onclick="document.getElementById('audio-file').click()">Choose local audio file</button>
      </div>
      <input id="audio-file" type="file" accept="audio/*,video/mp4,video/webm,.wav,.mp3,.m4a,.mp4,.webm,.ogg,.opus,.flac,.aac" style="display:none" onchange="processUploadedAudio()" />
    </div>
  </section>

  <p class="message" id="message"></p>
  <section class="job" id="job-card">
    <div class="job-head"><strong id="job-title"></strong><span class="pill" id="job-pill">Running</span></div>
    <p class="status" id="job-status"></p>
    <div class="progress" id="job-progress"><div class="bar"></div></div>
    <pre id="job-output"></pre>
  </section>

  <section class="card meetings-card">
    <div class="meetings-head"><h2>Meeting history</h2><span class="pill" id="meeting-count">0 meetings</span></div>
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
  if (!source) { document.getElementById('message').textContent = 'Paste a remote audio URL first.'; return; }
  setBusy(true);
  try {
    document.getElementById('message').textContent = 'Starting remote audio processing...';
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
  document.getElementById('meeting-status').textContent = active ? active.id + ' · ' + active.status : 'No active meeting. Ready when you are.';
  setBusy(Boolean(running));
  renderJob(job);
  document.getElementById('meeting-count').textContent = (data.meetings.length || 0) + ' meetings';
  document.getElementById('meetings').innerHTML = data.meetings.length ? data.meetings.map((note) => {
    const decisions = (note.decisions || []).map((d) => '<div class="task">Decision: ' + escapeHtml(d) + '</div>').join('');
    const tasks = (note.actionItems || []).map((t) => '<div class="task">[' + escapeHtml(t.confidence) + '] ' + escapeHtml(t.task) + (t.owner ? ' — ' + escapeHtml(t.owner) : '') + '</div>').join('');
    return '<article class="meeting"><div class="meeting-top"><div><h3>' + escapeHtml(note.title) + '</h3><p>' + escapeHtml(note.summary || '') + '</p></div><span class="pill">' + ((note.actionItems && note.actionItems.length) || 0) + ' tasks</span></div><div>' + decisions + '</div><div>' + tasks + '</div><details><summary>Transcript</summary><pre>' + escapeHtml(note.transcript || '') + '</pre></details></article>';
  }).join('') : '<div class="empty">No meetings yet. Start a live recording or upload a sample audio file.</div>';
}
function renderJob(job) {
  const card = document.getElementById('job-card');
  if (!job) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  card.className = 'job ' + job.status;
  const running = job.status === 'running';
  document.getElementById('job-title').innerHTML = (running ? '<span class="spinner"></span>' : '') + escapeHtml(job.label);
  document.getElementById('job-pill').textContent = running ? 'Running' : (job.status === 'done' ? 'Complete' : 'Failed');
  document.getElementById('job-status').textContent = running ? 'Processing now. Sarvam Batch can take a few minutes for long meetings.' : (job.status === 'done' ? 'Complete. Latest meeting history is refreshed below.' : 'Failed. Check logs below.');
  document.getElementById('job-progress').style.display = running ? 'block' : 'none';
  document.getElementById('job-output').textContent = job.output || (running ? 'Waiting for logs...' : '');
}
function escapeHtml(value) { return String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
refresh();
setInterval(refresh, 1500);
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
