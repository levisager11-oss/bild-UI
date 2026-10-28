// Kiosk server: serves the UI and forwards requests to ComfyUI.
// No dependencies. Start with: node server.js
// Environment: COMFY_URL (default http://192.168.60.37:8188), PORT (default 8080),
//              HOST (default 127.0.0.1, only the kiosk PC itself can open the page)

const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const COMFY_URL = new URL(process.env.COMFY_URL || 'http://192.168.60.37:8188');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const COUNTER_FILE = path.join(DATA_DIR, 'counter.json');
const WORKFLOW = JSON.parse(fs.readFileSync(path.join(__dirname, 'workflow.json'), 'utf8'));
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'system_prompt.txt'), 'utf8');

// Image formats offered in the UI. Flux needs multiples of 16.
const FORMATS = {
  square: { width: 1024, height: 1024, canvas: '1:1' },
  portrait: { width: 832, height: 1216, canvas: '2:3' },
  landscape: { width: 1216, height: 832, canvas: '3:2' },
};

// Style buttons. Keys match public/app.js.
const STYLES = {
  foto: 'a realistic photograph',
  comic: 'a colorful comic illustration with bold black outlines',
  aquarell: 'a soft watercolor painting on textured paper',
  oel: 'an oil painting with visible brush strokes',
  pixel: 'retro pixel art like an 8-bit video game',
  bausteine: 'a scene built entirely from colorful plastic toy bricks',
  skizze: 'a pencil sketch on white paper',
  render: 'a cute stylized 3D render with soft studio lighting',
};

const DEFAULT_SETTINGS = {
  steps: 16,             // sampling steps
  upsampler: true,       // let the language model expand the prompt
  maxVariants: 4,        // 1, 2 or 4
  idleSeconds: 60,       // inactivity before "Bist du noch da?"
  screensaverSeconds: 30, // idle start screen before the screensaver, 0 = off
  showRecent: true,      // mix visitor images into the screensaver
  allowAdvanced: true,   // visitors may open "Profi-Einstellungen"
};

// Samplers visitors can pick in the advanced settings.
const SAMPLERS = ['euler', 'er_sde', 'dpmpp_2m', 'euler_ancestral', 'heun'];
const MAX_SEED = 2 ** 48 - 2;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.otf': 'font/otf',
};

// ---------- Persistent state ----------
fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let settings = { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) };

const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD, local time
let counter = readJson(COUNTER_FILE, { date: today(), images: 0 });
function countImages(n) {
  if (counter.date !== today()) counter = { date: today(), images: 0 };
  counter.images += n;
  writeJson(COUNTER_FILE, counter);
}
function imagesToday() {
  return counter.date === today() ? counter.images : 0;
}

// Last visitor images for the screensaver. Only references to ComfyUI's temp folder, kept in memory.
const RECENT_MAX = 30;
let recent = [];
const finished = new Set();

function cleanSettings(input) {
  const s = { ...settings };
  const int = (v, min, max) => Math.min(max, Math.max(min, Math.round(Number(v))));
  if (input.steps != null) s.steps = int(input.steps, 4, 40);
  if (input.upsampler != null) s.upsampler = !!input.upsampler;
  if (input.maxVariants != null) s.maxVariants = [1, 2, 4].includes(Number(input.maxVariants)) ? Number(input.maxVariants) : s.maxVariants;
  if (input.idleSeconds != null) s.idleSeconds = int(input.idleSeconds, 20, 600);
  if (input.screensaverSeconds != null) s.screensaverSeconds = int(input.screensaverSeconds, 0, 600);
  if (input.showRecent != null) s.showRecent = !!input.showRecent;
  if (input.allowAdvanced != null) s.allowAdvanced = !!input.allowAdvanced;
  return s;
}

// Visitor overrides from "Profi-Einstellungen". Missing values fall back to the settings.
function cleanAdvanced(input) {
  const a = { steps: settings.steps, upsampler: settings.upsampler, sampler: 'euler', seed: null };
  if (!settings.allowAdvanced || !input || typeof input !== 'object') return a;
  const steps = Math.round(Number(input.steps));
  if (steps >= 4 && steps <= 40) a.steps = steps;
  if (typeof input.upsampler === 'boolean') a.upsampler = input.upsampler;
  if (SAMPLERS.includes(input.sampler)) a.sampler = input.sampler;
  const seed = Number(input.seed);
  if (input.seed !== null && input.seed !== '' && Number.isSafeInteger(seed) && seed >= 0 && seed <= MAX_SEED) a.seed = seed;
  return a;
}

// ---------- Workflow ----------
const randomSeed = () => crypto.randomInt(0, 2 ** 48 - 1);

function buildWorkflow({ prompt, format, style, variants, advanced }) {
  const f = FORMATS[format] || FORMATS.square;
  const wf = structuredClone(WORKFLOW);
  const styleText = STYLES[style];
  const adv = cleanAdvanced(advanced);
  const seed = adv.seed ?? randomSeed();

  if (adv.upsampler) {
    let request = `TARGET CANVAS: ${f.canvas}\n${prompt}`;
    if (styleText) request += `\nStyle: ${styleText}.`;
    wf['11'].inputs.prompt = request;
    wf['11'].inputs.system_prompt = SYSTEM_PROMPT;
    wf['11'].inputs['sampling_mode.seed'] = randomSeed();
  } else {
    // Without the language model the prompt goes straight to the text encoder.
    for (const id of ['11', '12', '13']) delete wf[id];
    wf['4'].inputs.text = styleText ? `${prompt}. Style: ${styleText}.` : prompt;
  }
  wf['6'].inputs.width = f.width;
  wf['6'].inputs.height = f.height;
  wf['6'].inputs.batch_size = variants;
  wf['7'].inputs.seed = seed;
  wf['7'].inputs.steps = adv.steps;
  wf['7'].inputs.sampler_name = adv.sampler;

  return {
    workflow: wf,
    info: {
      seed,
      steps: adv.steps,
      sampler: adv.sampler,
      width: f.width,
      height: f.height,
      variants,
      upsampler: adv.upsampler,
      model: wf['1'].inputs.unet_name.replace('.safetensors', ''),
      textEncoder: wf['2'].inputs.clip_name.replace('.safetensors', ''),
      languageModel: adv.upsampler ? WORKFLOW['12'].inputs.clip_name.replace('.safetensors', '') : null,
    },
  };
}

// ---------- Helpers ----------
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
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function comfy(pathname, options = {}) {
  return fetch(new URL(pathname, COMFY_URL), { signal: AbortSignal.timeout(options.timeout || 10000), ...options });
}

function comfyPost(pathname, body) {
  return comfy(pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

// ---------- API ----------
async function handleGenerate(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return sendJson(res, 400, { error: 'Ungültige Anfrage' });
  }
  const prompt = String(body.prompt || '').trim().slice(0, 1000);
  if (!prompt) return sendJson(res, 400, { error: 'Bitte gib eine Beschreibung ein.' });
  const variants = Math.min(settings.maxVariants, [1, 2, 4].includes(Number(body.variants)) ? Number(body.variants) : 1);

  const { workflow, info } = buildWorkflow({ prompt, format: body.format, style: body.style, variants, advanced: body.advanced });
  try {
    const r = await comfyPost('/prompt', {
      prompt: workflow,
      client_id: String(body.clientId || ''),
      extra_data: { preview_method: 'auto' }, // live preview frames over the websocket
    });
    const data = await r.json();
    if (!r.ok) {
      console.error('ComfyUI rejected workflow:', JSON.stringify(data).slice(0, 2000));
      return sendJson(res, 502, { error: 'ComfyUI hat den Auftrag abgelehnt.' });
    }
    sendJson(res, 200, { promptId: data.prompt_id, info, prompt });
  } catch (e) {
    console.error('ComfyUI not reachable:', e.message);
    sendJson(res, 502, { error: 'ComfyUI ist nicht erreichbar.' });
  }
}

// The client reports a finished job. The server checks ComfyUI's history before counting it.
async function handleDone(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return sendJson(res, 400, { error: 'Ungültige Anfrage' });
  }
  const id = String(body.promptId || '');
  if (!/^[\w-]+$/.test(id) || finished.has(id)) return sendJson(res, 200, { imagesToday: imagesToday() });
  try {
    const h = await (await comfy('/history/' + id)).json();
    const out = h[id] && h[id].outputs && h[id].outputs['9'];
    if (out && out.images && out.images.length) {
      finished.add(id);
      countImages(out.images.length);
      const label = String(body.prompt || '').slice(0, 200);
      for (const img of out.images) {
        recent.unshift({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'temp', prompt: label });
      }
      recent = recent.slice(0, RECENT_MAX);
    }
  } catch {}
  sendJson(res, 200, { imagesToday: imagesToday() });
}

async function handleStatus(res) {
  let comfyOk = false;
  let gpu = null;
  let queue = null;
  try {
    const [stats, q] = await Promise.all([
      comfy('/system_stats', { timeout: 3000 }).then((r) => r.json()),
      comfy('/queue', { timeout: 3000 }).then((r) => r.json()),
    ]);
    comfyOk = true;
    const d = stats.devices && stats.devices[0];
    // e.g. "cuda:0 NVIDIA RTX 6000 Ada Generation : cudaMallocAsync"
    if (d) gpu = { name: d.name.replace(/^cuda:\d+\s*/, '').split(' : ')[0].trim(), vramTotal: d.vram_total, vramFree: d.vram_free };
    queue = { running: q.queue_running.length, pending: q.queue_pending.length };
  } catch {}
  sendJson(res, 200, { comfy: comfyOk, comfyUrl: COMFY_URL.origin, gpu, queue, imagesToday: imagesToday(), recentCount: recent.length, settings });
}

async function handleSettings(req, res) {
  try {
    settings = cleanSettings(await readBody(req));
    writeJson(SETTINGS_FILE, settings);
    sendJson(res, 200, { settings });
  } catch {
    sendJson(res, 400, { error: 'Ungültige Einstellungen' });
  }
}

async function handleAdmin(res, action) {
  if (action === 'reset-counter') {
    counter = { date: today(), images: 0 };
    writeJson(COUNTER_FILE, counter);
  } else if (action === 'clear-recent') {
    recent = [];
  } else if (action === 'clear-queue') {
    try {
      await comfyPost('/queue', { clear: true });
      await comfyPost('/interrupt', {});
    } catch {
      return sendJson(res, 502, { error: 'ComfyUI ist nicht erreichbar.' });
    }
  } else {
    return sendJson(res, 404, { error: 'unknown action' });
  }
  sendJson(res, 200, { ok: true });
}

async function handleCancel(res, promptId) {
  try {
    await comfyPost('/interrupt', { prompt_id: promptId });
    await comfyPost('/queue', { delete: [promptId] });
  } catch {}
  sendJson(res, 200, { ok: true });
}

// Examples in public/examples plus the latest visitor images.
function handleScreensaver(res) {
  const examples = readJson(path.join(PUBLIC_DIR, 'examples', 'examples.json'), []).map((e) => ({
    src: 'examples/' + e.file,
    prompt: e.prompt,
    example: true,
  }));
  const visitors = settings.showRecent
    ? recent.map((r) => ({ src: '/comfy/view?' + new URLSearchParams({ filename: r.filename, subfolder: r.subfolder, type: r.type }), prompt: r.prompt }))
    : [];
  sendJson(res, 200, { images: [...visitors, ...examples] });
}

// ---------- Proxy & static ----------
// Forward GET /comfy/<path> to ComfyUI (history, view).
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

const ALLOWED_PROXY = /^\/comfy\/(history\/[\w-]+$|view\?)/;

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

const server = http.createServer(async (req, res) => {
  const url = req.url;
  if (req.method === 'POST') {
    if (url === '/api/generate') return handleGenerate(req, res);
    if (url === '/api/done') return handleDone(req, res);
    if (url === '/api/settings') return handleSettings(req, res);
    if (url.startsWith('/api/cancel/')) return handleCancel(res, url.split('/').pop());
    if (url.startsWith('/api/admin/')) return handleAdmin(res, url.split('/').pop());
    return sendJson(res, 404, { error: 'not found' });
  }
  if (req.method === 'GET') {
    if (url === '/api/status') return handleStatus(res);
    if (url === '/api/screensaver') return handleScreensaver(res);
    if (ALLOWED_PROXY.test(url)) return proxyHttp(req, res);
    return serveStatic(req, res);
  }
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

server.listen(PORT, HOST, () => {
  console.log(`Kiosk läuft auf http://localhost:${PORT}  (ComfyUI: ${COMFY_URL.origin})`);
});
