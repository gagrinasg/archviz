#!/usr/bin/env node
// archviz: check | open | poll | reply | export | serve. Zero deps.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { check, toMermaid } from './rules.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const USAGE = `usage:
  archviz check <model.json>              print best-practice violations (exit 1 on errors)
  archviz open  <model.json>              start the editor (if needed) and open the browser
  archviz poll  <model.json> [--timeout s] wait for the user to press Send/Approve, print feedback JSON
  archviz reply <model.json> <text | ->   show a message to the user in the editor (- reads stdin)
  archviz export <model.json>             print the model as a Mermaid classDiagram
  archviz serve <model.json>              run the editor server in the foreground`;

const [cmd, file, ...rest] = process.argv.slice(2);
if (!cmd || !file) { console.error(USAGE); process.exit(2); }
const modelPath = path.resolve(file);
const base = modelPath.replace(/\.json$/, '');
const serverInfo = `${base}.server.json`;
const feedbackPath = `${base}.feedback.json`;
const replyPath = `${base}.reply.json`;

const readModel = () => JSON.parse(fs.readFileSync(modelPath, 'utf8'));
const semantic = (m) => JSON.stringify({ ...m, layout: undefined });
const readReplies = () => (fs.existsSync(replyPath) ? JSON.parse(fs.readFileSync(replyPath, 'utf8')) : []);

if (cmd === 'check') {
  const v = check(readModel());
  for (const x of v) console.log(`${x.severity.padEnd(5)} ${x.rule.padEnd(24)} ${x.message}`);
  if (!v.length) console.log('ok: no violations');
  process.exit(v.some((x) => x.severity === 'error') ? 1 : 0);
} else if (cmd === 'reply') {
  const text = (rest.join(' ') === '-' ? fs.readFileSync(0, 'utf8') : rest.join(' ')).trim();
  if (!text) { console.error(USAGE); process.exit(2); }
  fs.writeFileSync(replyPath, JSON.stringify([...readReplies(), { text, at: new Date().toISOString() }], null, 2));
} else if (cmd === 'export') {
  process.stdout.write(toMermaid(readModel()));
} else if (cmd === 'serve') {
  serve();
} else if (cmd === 'open') {
  readModel(); // fail fast on missing/invalid JSON
  const url = (await runningUrl()) || (await startDetached());
  console.log(`archviz: ${url}`);
  openBrowser(url);
} else if (cmd === 'poll') {
  const i = rest.indexOf('--timeout');
  await poll(i >= 0 ? Number(rest[i + 1]) : 0);
} else {
  console.error(USAGE);
  process.exit(2);
}

async function runningUrl() {
  try {
    const { url } = JSON.parse(fs.readFileSync(serverInfo, 'utf8'));
    const res = await fetch(`${url}/model`, { signal: AbortSignal.timeout(1000) });
    return res.ok ? url : null;
  } catch { return null; }
}

async function startDetached() {
  fs.rmSync(serverInfo, { force: true });
  spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve', modelPath], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const url = await runningUrl();
    if (url) return url;
  }
  throw new Error('archviz server did not start; try `archviz serve` to see the error');
}

function openBrowser(url) {
  const wsl = process.platform === 'linux' && /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8'));
  const tries = process.platform === 'darwin' ? [['open', [url]]]
    : process.platform === 'win32' ? [['cmd', ['/c', 'start', '', url]]]
    : wsl ? [['wslview', [url]], ['cmd.exe', ['/c', 'start', '', url]], ['xdg-open', [url]]]
    : [['xdg-open', [url]]];
  const attempt = (i) => {
    if (i >= tries.length) return console.log('Open the URL above in your browser.');
    const p = spawn(tries[i][0], tries[i][1], { stdio: 'ignore', detached: true });
    p.on('error', () => attempt(i + 1));
    p.unref();
  };
  attempt(0);
}

async function poll(timeoutSec) {
  const take = () => {
    if (!fs.existsSync(feedbackPath)) return false;
    const items = JSON.parse(fs.readFileSync(feedbackPath, 'utf8'));
    fs.rmSync(feedbackPath);
    console.log(JSON.stringify(items.length === 1 ? items[0] : items, null, 2));
    return true;
  };
  if (take()) return;
  // watchFile (stat polling) instead of fs.watch: survives atomic renames and WSL /mnt drives.
  await new Promise((resolve) => {
    const timer = timeoutSec > 0 && setTimeout(() => {
      fs.unwatchFile(feedbackPath);
      console.error('archviz: no feedback yet; run poll again (queued feedback is kept).');
      process.exitCode = 3;
      resolve();
    }, timeoutSec * 1000);
    fs.watchFile(feedbackPath, { interval: 300 }, () => {
      if (!take()) return;
      fs.unwatchFile(feedbackPath);
      clearTimeout(timer);
      resolve();
    });
  });
}

function serve() {
  const clients = new Set();
  let last = semantic(readModel());
  fs.watchFile(modelPath, { interval: 300 }, () => {
    let m;
    try { m = readModel(); } catch { return; } // mid-write; next tick will catch it
    const s = semantic(m);
    if (s === last) return; // layout-only change (our own PUT /layout)
    last = s;
    for (const res of clients) res.write('data: reload\n\n');
  });
  fs.watchFile(replyPath, { interval: 300 }, () => { for (const res of clients) res.write('data: replies\n\n'); });
  // Template for "Open in editor" links; override with ARCHVIZ_EDITOR_URL, e.g. cursor://file{path}:{line}
  const editor = process.env.ARCHVIZ_EDITOR_URL
    || (process.env.WSL_DISTRO_NAME ? `vscode://vscode-remote/wsl+${process.env.WSL_DISTRO_NAME}{path}:{line}` : 'vscode://file{path}:{line}');
  const root = process.cwd().replaceAll('\\', '/');

  const body = (req) => new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 5e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
  });
  const send = (res, code, type, data) => { res.writeHead(code, { 'content-type': type }); res.end(data); };

  const server = http.createServer(async (req, res) => {
    try {
      const route = `${req.method} ${req.url.split('?')[0]}`;
      if (route === 'GET /') return send(res, 200, 'text/html', fs.readFileSync(path.join(HERE, 'ui.html')));
      if (route === 'GET /rules.mjs') return send(res, 200, 'text/javascript', fs.readFileSync(path.join(HERE, 'rules.mjs')));
      if (route === 'GET /model') return send(res, 200, 'application/json', JSON.stringify({ name: path.basename(base), model: readModel(), root, editor }));
      if (route === 'GET /replies') return send(res, 200, 'application/json', JSON.stringify(readReplies()));
      if (route === 'PUT /layout') {
        const layout = await body(req);
        fs.writeFileSync(modelPath, JSON.stringify({ ...readModel(), layout }, null, 2) + '\n');
        return send(res, 204, 'text/plain', '');
      }
      if (route === 'POST /feedback') {
        const fb = { ...(await body(req)), sentAt: new Date().toISOString() };
        const queued = fs.existsSync(feedbackPath) ? JSON.parse(fs.readFileSync(feedbackPath, 'utf8')) : [];
        fs.writeFileSync(feedbackPath, JSON.stringify([...queued, fb], null, 2));
        return send(res, 204, 'text/plain', '');
      }
      if (route === 'GET /events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write(': hi\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      send(res, 404, 'text/plain', 'not found');
    } catch (e) {
      send(res, 400, 'text/plain', String(e.message));
    }
  });
  // Self-stop when no browser tab has been connected for 30 min; `archviz open` restarts it.
  let idleSince = Date.now();
  setInterval(() => {
    if (clients.size) idleSince = Date.now();
    else if (Date.now() - idleSince > 30 * 60e3) { fs.rmSync(serverInfo, { force: true }); process.exit(0); }
  }, 60e3).unref();

  server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}`;
    fs.writeFileSync(serverInfo, JSON.stringify({ url, pid: process.pid }));
    console.log(`archviz serving ${modelPath} at ${url}`);
  });
}
