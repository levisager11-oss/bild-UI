// Kiosk server: serves the UI and forwards requests to ComfyUI.
// No dependencies. Start with: node server.js
// Settings via environment: COMFY_URL (default http://192.168.60.37:8188), PORT (default 8080)

const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const COMFY_URL = new URL(process.env.COMFY_URL || 'http://192.168.60.37:8188');
const PORT = Number(process.env.PORT || 8080);
const PUBLIC_DIR = path.join(__dirname, 'public');
const WORKFLOW = JSON.parse(fs.readFileSync(path.join(__dirname, 'workflow.json'), 'utf8'));
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'system_prompt.txt'), 'utf8');

// Image formats offered in the UI. Flux needs multiples of 16.
const FORMATS = {
  square: { width: 1024, height: 1024, canvas: '1:1' },
  portrait: { width: 832, height: 1216, canvas: '2:3' },
  landscape: { width: 1216, height: 832, canvas: '3:2' },
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.otf': 'font/otf',
};

const randomSeed = () => crypto.randomInt(0, 2 ** 48 - 1);

function buildWorkflow(prompt, formatKey) {
  const f = FORMATS[formatKey] || FORMATS.square;
  const wf = structuredClone(WORKFLOW);
  wf['11'].inputs.prompt = `TARGET CANVAS: ${f.canvas}\n${prompt}`;
  wf['11'].inputs.system_prompt = SYSTEM_PROMPT;
  wf['11'].inputs['sampling_mode.seed'] = randomSeed();
  wf['6'].inputs.width = f.width;
  wf['6'].inputs.height = f.height;
  wf['7'].inputs.seed = randomSeed();
  return wf;
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 100_000) reject(new Error('too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handleGenerate(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return sendJson(res, 400, { error: 'Ungültige Anfrage' });
  }
  const prompt = String(body.prompt || '').trim().slice(0, 1000);
  if (!prompt) return sendJson(res, 400, { error: 'Bitte gib eine Beschreibung ein.' });

  const workflow = buildWorkflow(prompt, body.format);
  try {
    const r = await fetch(new URL('/prompt', COMFY_URL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: workflow,
        client_id: String(body.clientId || ''),
        extra_data: { preview_method: 'auto' }, // live preview frames over the websocket
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      console.error('ComfyUI rejected workflow:', JSON.stringify(data).slice(0, 2000));
      return sendJson(res, 502, { error: 'ComfyUI hat den Auftrag abgelehnt.' });
    }
    sendJson(res, 200, { promptId: data.prompt_id });
  } catch (e) {
    console.error('ComfyUI not reachable:', e.message);
    sendJson(res, 502, { error: 'ComfyUI ist nicht erreichbar.' });
  }
}

// Forward GET /comfy/<path> to ComfyUI (history, view, queue, system_stats).
function proxyHttp(req, res) {
  const target = new URL(req.url.replace(/^\/comfy/, ''), COMFY_URL);
  const upstream = http.request(target, { method: 'GET', headers: { accept: req.headers.accept || '*/*' } }, (up) => {
    const headers = { 'Cache-Control': 'no-store' };
    if (up.headers['content-type']) headers['Content-Type'] = up.headers['content-type'];
    if (up.headers['content-length']) headers['Content-Length'] = up.headers['content-length'];
    res.writeHead(up.statusCode, headers);
    up.pipe(res);
  });
  upstream.on('error', () => sendJson(res, 502, { error: 'ComfyUI ist nicht erreichbar.' }));
  upstream.end();
}

const ALLOWED_PROXY = /^\/comfy\/(history\/[\w-]+|view\?|queue$|system_stats$|interrupt$)/;

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

async function handleInterrupt(res, promptId) {
  try {
    await fetch(new URL('/interrupt', COMFY_URL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt_id: promptId }),
    });
    await fetch(new URL('/queue', COMFY_URL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete: [promptId] }),
    });
  } catch {}
  sendJson(res, 200, { ok: true });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/generate') return handleGenerate(req, res);
  if (req.method === 'POST' && req.url.startsWith('/api/cancel/')) return handleInterrupt(res, req.url.split('/').pop());
  if (req.method === 'GET' && ALLOWED_PROXY.test(req.url)) return proxyHttp(req, res);
  if (req.method === 'GET') return serveStatic(req, res);
  sendJson(res, 405, { error: 'method not allowed' });
});

// Forward the websocket /comfy/ws to ComfyUI's /ws as a raw TCP pipe.
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/comfy/ws')) return socket.destroy();
  const upstream = net.connect(Number(COMFY_URL.port || 80), COMFY_URL.hostname, () => {
    const lines = [`GET ${req.url.replace(/^\/comfy/, '')} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      const lower = name.toLowerCase();
      if (lower === 'host') lines.push(`Host: ${COMFY_URL.host}`);
      else if (lower === 'origin') continue; // ComfyUI checks Origin against Host
      else lines.push(`${name}: ${req.rawHeaders[i + 1]}`);
    }
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  const close = () => { socket.destroy(); upstream.destroy(); };
  upstream.on('error', close);
  socket.on('error', close);
  upstream.on('close', close);
  socket.on('close', close);
});

server.listen(PORT, () => {
  console.log(`Kiosk läuft auf http://localhost:${PORT}  (ComfyUI: ${COMFY_URL.origin})`);
});
