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
  research: true,        // let ask look things up on the web when a prompt needs it
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
  if (input.research != null) s.research = !!input.research;
  return s;
}

// ---------- ask (OpenAI-compatible language model with web search) ----------
// Config in data/ask.json (see ask.example.json) or ASK_URL / ASK_KEY / ASK_MODEL. Read on every use,
// so changes need no restart.
const ASK_FILE = path.join(DATA_DIR, 'ask.json');

function askConfig() {
  const f = readJson(ASK_FILE, {});
  const c = {
    url: (process.env.ASK_URL || f.url || '').replace(/\/+$/, ''),
    apiKey: process.env.ASK_KEY || f.apiKey || '',
    model: process.env.ASK_MODEL || f.model || '',
    planExtra: f.planExtra || {},     // extra request fields for the quick "is research needed?" step
    searchExtra: f.searchExtra || {}, // extra request fields for the research step
    // "openwebui": search with Open WebUI's own search endpoint, read the top pages, let the model summarize.
    // "model": the model searches by itself (searchExtra must switch that on).
    search: f.search === 'model' ? 'model' : 'openwebui',
    timeoutMs: Number(f.timeoutMs) || 25000,
  };
  c.configured = !!(c.url && c.model);
  return c;
}

async function askChat(system, user, extra, timeoutMs) {
  const c = askConfig();
  if (!c.configured) throw new Error('ask ist nicht eingerichtet');
  const headers = { 'Content-Type': 'application/json' };
  if (c.apiKey) headers.Authorization = 'Bearer ' + c.apiKey;
  const r = await fetch(c.url + '/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: c.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.2,
      ...extra,
    }),
    signal: AbortSignal.timeout(timeoutMs || c.timeoutMs),
  });
  if (!r.ok) throw new Error(`ask antwortet mit HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const d = await r.json();
  const msg = (d.choices && d.choices[0] && d.choices[0].message) || {};
  let text = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map((p) => p.text || '').join('') : '';
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim(); // Qwen thinking output
  // Sources the backend attached itself (OpenAI-style url_citation annotations, or a plain list).
  const sources = [];
  for (const a of msg.annotations || []) {
    const u = a.url_citation || a;
    if (u && u.url) sources.push({ title: u.title || '', url: u.url });
  }
  for (const u of d.citations || []) if (typeof u === 'string') sources.push({ title: '', url: u });
  return { text, sources };
}

// Error message with the network cause (e.g. ENOTFOUND, ECONNREFUSED), for the log.
const errText = (e) => e.message + (e.cause ? ` (${e.cause.code || e.cause.message})` : '');

// First JSON object in a model answer, or null.
function parseJsonAnswer(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

const PLAN_PROMPT = `You help an image generator at a school open day. Decide whether drawing the user's image request well needs factual knowledge about specific real-world things that an image model may not know exactly: named places, landmarks and buildings, specific vehicles or machines, animal or plant species, artworks, traditions, historical or recent events, specific products.
Generic scenes do not need it (a cat with a welding helmet, a robot in a workshop, a city of the future, a dragon made of gears).
Reply with JSON only: {"needed": true or false, "query": "short web search query that finds what the specific thing looks like"}.`;

const SEARCH_PROMPT = `Research the visual appearance of the specific real-world things in an image request. Use the web search.
Then reply with JSON only: {"facts": "3 to 6 short English sentences with visual facts only: shape, colors, materials, size, typical surroundings, distinctive details", "sources": [{"title": "page title", "url": "https://..."}]}.
No opinions, no history that cannot be seen, no text or labels to render.`;

const SUMMARY_PROMPT = `You get an image request and text from web pages found for it. Extract what the specific real-world things look like, using only the web page text.
Reply with JSON only: {"facts": "3 to 6 short English sentences with visual facts only: shape, colors, materials, size, typical surroundings, distinctive details"}.
No opinions, no history that cannot be seen, no text or labels to render. If the pages say nothing useful about the appearance, reply {"facts": ""}.`;

// Rough HTML to text: drop scripts, styles and navigation, keep paragraph text.
function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg|nav|header|footer|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|br|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

async function fetchPageText(url) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Kiosk KI-Bildgenerator Technische Fachschule Bern)', Accept: 'text/html' },
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok || !/html/.test(r.headers.get('content-type') || '')) return '';
    return htmlToText((await r.text()).slice(0, 600_000)).slice(0, 3500);
  } catch {
    return '';
  }
}

// Search via Open WebUI, read the top pages, summarize the appearance with the model.
async function researchOpenWebUI(prompt, query) {
  const c = askConfig();
  const r = await fetch(c.url + '/v1/retrieval/process/web/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.apiKey },
    body: JSON.stringify({ queries: [query] }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Websuche antwortet mit HTTP ${r.status}`);
  const items = ((await r.json()).items || []).filter((i) => /^https?:\/\//.test(i.link || ''));
  if (!items.length) return { facts: '', sources: [] };

  const top = items.slice(0, 3);
  const texts = await Promise.all(top.map((i) => fetchPageText(i.link)));
  const material = top.map((it, n) => `### ${it.title}\n${it.link}\n${texts[n] || it.snippet || ''}`).join('\n\n')
    + '\n\nOther search snippets:\n' + items.slice(3, 8).map((i) => `- ${i.title}: ${i.snippet || ''}`).join('\n');

  const { text } = await askChat(SUMMARY_PROMPT, `Image request: ${prompt}\n\nWeb pages:\n${material}`, c.searchExtra);
  const answer = parseJsonAnswer(text);
  let facts = answer ? answer.facts : text;
  if (Array.isArray(facts)) facts = facts.join(' ');
  return { facts: String(facts || '').trim(), sources: top.map((i) => ({ title: i.title || '', url: i.link })) };
}

// The model searches by itself (only if the backend supports it through searchExtra).
async function researchModel(prompt, query) {
  const { text, sources: attached } = await askChat(SEARCH_PROMPT, `Image request: ${prompt}\nSearch query: ${query}`, askConfig().searchExtra);
  const answer = parseJsonAnswer(text);
  let facts = answer ? answer.facts : text;
  if (Array.isArray(facts)) facts = facts.join(' ');
  return { facts: String(facts || '').trim(), sources: [...attached, ...((answer && Array.isArray(answer.sources)) ? answer.sources : [])] };
}

async function handleResearchPlan(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return sendJson(res, 400, { error: 'Ungültige Anfrage' });
  }
  const prompt = String(body.prompt || '').trim().slice(0, 1000);
  if (!settings.research || !askConfig().configured || !prompt) return sendJson(res, 200, { needed: false, off: true });
  try {
    const { text } = await askChat(PLAN_PROMPT, prompt, askConfig().planExtra, 8000);
    const plan = parseJsonAnswer(text) || {};
    const query = String(plan.query || '').trim().slice(0, 200);
    sendJson(res, 200, { needed: plan.needed === true && !!query, query });
  } catch (e) {
    console.error('ask plan failed:', errText(e));
    sendJson(res, 200, { needed: false, error: true });
  }
}

async function handleResearchRun(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return sendJson(res, 400, { error: 'Ungültige Anfrage' });
  }
  const prompt = String(body.prompt || '').trim().slice(0, 1000);
  const query = String(body.query || '').trim().slice(0, 200);
  if (!settings.research || !askConfig().configured || !prompt) return sendJson(res, 200, { facts: null, off: true });
  const t0 = Date.now();
  try {
    const c = askConfig();
    const result = c.search === 'model' ? await researchModel(prompt, query) : await researchOpenWebUI(prompt, query);
    const facts = result.facts.slice(0, 1200);
    const seen = new Set();
    const sources = result.sources
      .filter((s) => s && /^https?:\/\//.test(s.url || '') && !seen.has(s.url) && seen.add(s.url))
      .slice(0, 4)
      .map((s) => ({ title: String(s.title || '').slice(0, 120), url: String(s.url).slice(0, 300) }));
    sendJson(res, 200, { facts: facts || null, sources, ms: Date.now() - t0, model: askConfig().model });
  } catch (e) {
    console.error('ask research failed:', errText(e));
    sendJson(res, 200, { facts: null, error: true });
  }
}

// Reachability of ask for the status display, cached for 30 s.
let askStatus = { checked: 0, ok: false };
async function getAskStatus() {
  const c = askConfig();
  if (!c.configured) return { configured: false };
  if (Date.now() - askStatus.checked > 30000) {
    try {
      const headers = c.apiKey ? { Authorization: 'Bearer ' + c.apiKey } : {};
      const r = await fetch(c.url + '/models', { headers, signal: AbortSignal.timeout(3000) });
      askStatus = { checked: Date.now(), ok: r.ok };
    } catch {
      askStatus = { checked: Date.now(), ok: false };
    }
  }
  return { configured: true, ok: askStatus.ok, model: c.model };
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

function buildWorkflow({ prompt, format, style, variants, advanced, facts }) {
  const f = FORMATS[format] || FORMATS.square;
  const wf = structuredClone(WORKFLOW);
  const styleText = STYLES[style];
  const adv = cleanAdvanced(advanced);
  const seed = adv.seed ?? randomSeed();
  const reference = facts ? `Visual reference facts from a web search (use them to depict the named things accurately, do not render them as text): ${facts}` : '';

  if (adv.upsampler) {
    let request = `TARGET CANVAS: ${f.canvas}\n${prompt}`;
    if (styleText) request += `\nStyle: ${styleText}.`;
    if (reference) request += `\n${reference}`;
    wf['11'].inputs.prompt = request;
    wf['11'].inputs.system_prompt = SYSTEM_PROMPT;
    wf['11'].inputs['sampling_mode.seed'] = randomSeed();
  } else {
    // Without the language model the prompt goes straight to the text encoder.
    for (const id of ['11', '12', '13']) delete wf[id];
    wf['4'].inputs.text = [prompt, styleText && `Style: ${styleText}.`, facts].filter(Boolean).join('. ');
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

  const facts = typeof body.facts === 'string' ? body.facts.trim().slice(0, 1200) : '';
  const { workflow, info } = buildWorkflow({ prompt, format: body.format, style: body.style, variants, advanced: body.advanced, facts });
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
  const ask = await getAskStatus();
  sendJson(res, 200, { comfy: comfyOk, comfyUrl: COMFY_URL.origin, gpu, queue, ask, imagesToday: imagesToday(), recentCount: recent.length, settings });
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
    if (url === '/api/research/plan') return handleResearchPlan(req, res);
    if (url === '/api/research/run') return handleResearchRun(req, res);
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
