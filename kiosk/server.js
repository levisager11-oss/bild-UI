// Kiosk server: serves the UI and forwards requests to ComfyUI.
// No dependencies. Start with: node server.js
// Environment: COMFY_URL (default http://192.168.60.37:8188), PORT (default 8080),
//              HOST (default 127.0.0.1, only the kiosk PC itself can open the page)

const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const guardrails = require('./guardrails');

const COMFY_URL = new URL(process.env.COMFY_URL || 'http://192.168.60.37:8188');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const COUNTER_FILE = path.join(DATA_DIR, 'counter.json');
const WORKFLOW = JSON.parse(fs.readFileSync(path.join(__dirname, 'workflow.json'), 'utf8'));
const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'system_prompt.txt'), 'utf8');
// System prompt for the prompt upsampler when it also sees a reference image (from the ComfyUI template "FLUX 3 Image Klein: Image Edit").
const EDIT_SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'system_prompt_edit.txt'), 'utf8');

// Image formats offered in the UI. Flux needs multiples of 16.
const FORMATS = {
  square: { width: 1024, height: 1024, canvas: '1:1' },
  portrait: { width: 832, height: 1216, canvas: '2:3' },
  landscape: { width: 1216, height: 832, canvas: '3:2' },
};

// Style buttons. Keys match public/app.js. The longer texts won against short ones in a test (2026-10-29):
// clearer watercolor paper, visible brush strokes, hatching, objects really built from bricks.
const STYLES = {
  foto: 'a high-quality professional photograph with natural light, realistic textures and sharp focus',
  comic: 'a vibrant comic book illustration with bold black ink outlines, flat bright colors and halftone shading',
  aquarell: 'a delicate watercolor painting on textured paper with soft color washes, pigment blooms and white paper showing through',
  oel: 'a classical oil painting on canvas with rich colors and thick, visible impasto brush strokes',
  pixel: 'retro 16-bit pixel art with large, clearly visible square pixels and a limited color palette, like a scene from a classic video game',
  bausteine: 'a scene built entirely from colorful plastic toy bricks, every object made of bricks, macro photograph with shallow depth of field',
  skizze: 'a detailed graphite pencil sketch on white paper with cross-hatching and visible pencil strokes, black and white',
  render: 'a cute stylized 3D animated-film render with soft studio lighting, smooth rounded shapes and rich colors',
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
  reference: true,       // give the image model a free Wikipedia photo of the named thing
  quality: 'maximal',    // schnell | hoch | maximal, see QUALITY_LEVELS
  guardrails: 'mittel',  // aus | locker | mittel | streng, see guardrails.js
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
  if (input.reference != null) s.reference = !!input.reference;
  if (['schnell', 'hoch', 'maximal'].includes(input.quality)) s.quality = input.quality;
  if (guardrails.LEVELS.includes(input.guardrails)) s.guardrails = input.guardrails;
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

const PLAN_PROMPT = `You help an image generator at a school open day. The request may be in German, Swiss German dialect, French, English or with typos.
Decide whether drawing it well needs factual knowledge about a specific real-world thing that an image model may not know exactly:
- named places, landmarks, buildings, bridges, mountains, rivers and lakes
- specific vehicles, machines and products, also by brand or model (a Vespa, a Swiss army knife, an SBB Re 460)
- animal and plant species that are not everyday animals (a bearded vulture, an ibex, an axolotl, an edelweiss)
- artworks, traditions, historical or recent events
Everyday things and generic scenes do NOT need it: a cat, a dog, a fox, a horse, a cow, a penguin, a robot in a workshop, a city of the future, a dragon made of gears, a unicorn.
A city or country that is only the setting (a cat cycling through Bern) does not need it either. Never add a landmark the request does not name.
If research is needed, list the specific things it needs, the most important first, so a reference photo of each can be taken from Wikipedia.
Usually that is one thing. List a second one only when the request itself names two specific things that both need it (e.g. "the Zytglogge in front of the Matterhorn", "an ibex on the Kapellbrücke"). Never more than two.
Reply with JSON only:
{"needed": true or false,
 "things": [{"query": "short web search query that finds what this thing looks like",
             "wiki": "exact title of the German Wikipedia article about this thing, or empty; for names with several meanings the title of the meant article, e.g. Jungfrau (Berg), Mönch (Berg), Pilatus (Bergmassiv), Merkur (Planet)",
             "subject": "short English name of this thing, e.g. the Zytglogge clock tower"}],
 "person": true if the request shows a real, named person or a group of real people (e.g. Roger Federer, the Swiss Federal Council, a famous band),
 "transform": true if the request turns a listed thing into something else or changes its form (e.g. as a spaceship, made of chocolate, as a robot, built from bricks), false if it is shown as it is, also when only a drawing style is asked}
"things" is empty when research is not needed.`;

const SEARCH_PROMPT = `Research the visual appearance of the specific real-world things in an image request. Use the web search.
Then reply with JSON only: {"facts": "3 to 6 short English sentences per named thing with visual facts only: shape, colors, materials, size, typical surroundings, distinctive details", "sources": [{"title": "page title", "url": "https://..."}]}.
Describe the lasting appearance only, no special events, light shows or temporary decorations unless the request asks for them.
No opinions, no history that cannot be seen, no text or labels to render.`;

const SUMMARY_PROMPT = `You get an image request and text from web pages found for it. Extract what the specific real-world things look like, using only the web page text.
Reply with JSON only: {"facts": "3 to 6 short English sentences per named thing with visual facts only: shape, colors, materials, size, typical surroundings, distinctive details"}.
When the request names two things, describe each of them, and do not mix up which facts belong to which.
Describe the lasting appearance only: leave out special events, light shows, festivals, temporary decorations, construction work and seasonal markets, unless the request asks for them.
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
async function webSearch(query) {
  const c = askConfig();
  const r = await fetch(c.url + '/v1/retrieval/process/web/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.apiKey },
    body: JSON.stringify({ queries: [query] }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Websuche antwortet mit HTTP ${r.status}`);
  return ((await r.json()).items || []).filter((i) => /^https?:\/\//.test(i.link || ''));
}

// One search per named thing (at most two), so the second thing is not drowned by results about the first.
async function researchOpenWebUI(prompt, queries) {
  const c = askConfig();
  const lists = await Promise.all(queries.map(webSearch));
  const perQuery = queries.length > 1 ? 2 : 3;
  const seen = new Set();
  const top = [];
  const rest = [];
  for (const items of lists) {
    const fresh = items.filter((i) => !seen.has(i.link) && seen.add(i.link));
    top.push(...fresh.slice(0, perQuery));
    rest.push(...fresh.slice(perQuery, perQuery + (queries.length > 1 ? 3 : 5)));
  }
  if (!top.length) return { facts: '', sources: [] };

  const texts = await Promise.all(top.map((i) => fetchPageText(i.link)));
  const material = top.map((it, n) => `### ${it.title}\n${it.link}\n${texts[n] || it.snippet || ''}`).join('\n\n')
    + '\n\nOther search snippets:\n' + rest.map((i) => `- ${i.title}: ${i.snippet || ''}`).join('\n');

  const { text } = await askChat(SUMMARY_PROMPT, `Image request: ${prompt}\n\nWeb pages:\n${material}`, c.searchExtra);
  const answer = parseJsonAnswer(text);
  let facts = answer ? answer.facts : text;
  if (Array.isArray(facts)) facts = facts.join(' ');
  return { facts: String(facts || '').trim(), sources: top.map((i) => ({ title: i.title || '', url: i.link })) };
}

// The model searches by itself (only if the backend supports it through searchExtra).
async function researchModel(prompt, queries) {
  const { text, sources: attached } = await askChat(SEARCH_PROMPT, `Image request: ${prompt}\nSearch queries: ${queries.join(' | ')}`, askConfig().searchExtra);
  const answer = parseJsonAnswer(text);
  let facts = answer ? answer.facts : text;
  if (Array.isArray(facts)) facts = facts.join(' ');
  return { facts: String(facts || '').trim(), sources: [...attached, ...((answer && Array.isArray(answer.sources)) ? answer.sources : [])] };
}

// Successful ask answers per request, kept for 1 hour: ideas get tapped again and again,
// and "Nochmal" should not wait for ask a second time.
const ASK_CACHE_MS = 60 * 60 * 1000;
// Research facts are cut to this length (room for two named things).
const MAX_FACTS = 1600;
const askCache = new Map();
function cached(key) {
  const hit = askCache.get(key);
  return hit && Date.now() - hit.at < ASK_CACHE_MS ? hit.value : null;
}
function remember(key, value) {
  if (askCache.size > 500) askCache.delete(askCache.keys().next().value);
  askCache.set(key, { at: Date.now(), value });
}

// ---------- Guardrails ----------
// Blocked wishes of this server run, newest first, for the staff menu. Only in memory.
let blocked = [];
let blockedCount = 0;

// Word list first, then ask (if set up). ask failing or slow lets the wish through: the word list still ran.
async function checkPrompt(prompt) {
  const level = settings.guardrails;
  if (!level || level === 'aus') return { ok: true };
  let result = guardrails.checkWords(prompt, level);
  if (result.ok && askConfig().configured) {
    const key = `guard:${level}:${prompt.toLowerCase()}`;
    let verdict = cached(key);
    if (!verdict) {
      try {
        const { text } = await askChat(guardrails.moderationPrompt(level), prompt, { ...askConfig().planExtra, temperature: 0 }, 6000);
        const answer = parseJsonAnswer(text);
        if (answer && typeof answer.ok === 'boolean') {
          verdict = { ok: answer.ok, category: guardrails.CATEGORIES.includes(answer.category) ? answer.category : 'Anderes' };
          remember(key, verdict);
        }
      } catch (e) {
        console.error('guardrail check failed:', errText(e));
      }
    }
    if (verdict && !verdict.ok) result = { ok: false, category: verdict.category, by: 'ask' };
  }
  if (!result.ok) {
    blockedCount++;
    blocked.unshift({ at: new Date().toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }), prompt: prompt.slice(0, 120), category: result.category, by: result.by, match: result.match });
    blocked = blocked.slice(0, 10);
    console.log(`Gesperrt (${result.by}, ${result.category}${result.match ? ', «' + result.match + '»' : ''}): ${prompt.slice(0, 200)}`);
  }
  return result;
}

const blockedReply = (r) => ({
  blocked: true,
  category: r.category,
  error: `Dieses Bild können wir hier leider nicht machen (${r.category}). Probier doch etwas anderes! Findest du, das ist ein Fehler? Dann sprich jemanden vom Stand an.`,
});

async function handleResearchPlan(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return sendJson(res, 400, { error: 'Ungültige Anfrage' });
  }
  const prompt = String(body.prompt || '').trim().slice(0, 1000);
  // The guardrail check runs alongside the plan, so /api/generate later finds its answer in the cache.
  const guard = prompt ? checkPrompt(prompt) : Promise.resolve({ ok: true });
  if ((!settings.research && !settings.reference) || !askConfig().configured || !prompt) {
    const g = await guard;
    return sendJson(res, 200, g.ok ? { needed: false, off: true } : blockedReply(g));
  }
  try {
    const key = 'plan:' + prompt.toLowerCase();
    let plan = cached(key);
    const planning = plan ? Promise.resolve(plan) : askChat(PLAN_PROMPT, prompt, askConfig().planExtra, 8000).then(({ text }) => {
      const p = parseJsonAnswer(text);
      if (!p) throw new Error('ask lieferte kein JSON');
      remember(key, p);
      return p;
    });
    planning.catch(() => {}); // handled below, after the guardrail answer
    const g = await guard;
    if (!g.ok) return sendJson(res, 200, blockedReply(g));
    plan = await planning;
    // Up to two named things, each with its own search and Wikipedia photo. Older answers had one thing at the top level.
    const raw = Array.isArray(plan.things) ? plan.things : [plan];
    const seen = new Set();
    const things = raw
      .filter((t) => t && typeof t === 'object')
      .map((t) => {
        const wiki = settings.reference && plan.person !== true ? String(t.wiki || '').trim().slice(0, 150) : '';
        return { query: String(t.query || '').trim().slice(0, 200), wiki, subject: String(t.subject || '').trim().slice(0, 100) || wiki };
      })
      .filter((t) => (t.query || t.wiki) && !seen.has((t.wiki || t.query).toLowerCase()) && seen.add((t.wiki || t.query).toLowerCase()))
      .slice(0, 2);
    const queries = things.map((t) => t.query).filter(Boolean);
    sendJson(res, 200, {
      // No research and no reference photo for real people.
      needed: settings.research && plan.needed === true && plan.person !== true && queries.length > 0,
      things,
      queries,
      transform: plan.transform === true,
      person: plan.person === true,
    });
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
  const queries = (Array.isArray(body.queries) ? body.queries : [body.query])
    .map((q) => String(q || '').trim().slice(0, 200)).filter(Boolean).slice(0, 2);
  if (!settings.research || !askConfig().configured || !prompt || !queries.length) return sendJson(res, 200, { facts: null, off: true });
  const t0 = Date.now();
  try {
    const c = askConfig();
    const key = `run:${prompt.toLowerCase()}|${queries.join('|').toLowerCase()}`;
    const hit = cached(key);
    if (hit) return sendJson(res, 200, { ...hit, ms: Date.now() - t0, cached: true });
    const result = c.search === 'model' ? await researchModel(prompt, queries) : await researchOpenWebUI(prompt, queries);
    const facts = result.facts.slice(0, MAX_FACTS);
    const seen = new Set();
    const sources = result.sources
      .filter((s) => s && /^https?:\/\//.test(s.url || '') && !seen.has(s.url) && seen.add(s.url))
      .slice(0, 4)
      .map((s) => ({ title: String(s.title || '').slice(0, 120), url: String(s.url).slice(0, 300) }));
    const payload = { facts: facts || null, sources, model: askConfig().model };
    if (payload.facts) remember(key, payload);
    sendJson(res, 200, { ...payload, ms: Date.now() - t0 });
  } catch (e) {
    console.error('ask research failed:', errText(e));
    sendJson(res, 200, { facts: null, error: true });
  }
}

// ---------- Reference photo from Wikipedia ----------
// Only freely licensed lead images (pilicense=free). The photo is uploaded to ComfyUI's input folder.
const WIKI_UA = { 'User-Agent': 'KioskBildgenerator/1.0 (https://tfbern.ch; Tag der offenen Tuer)' };
const REF_CACHE_MS = 60 * 60 * 1000;
const refCache = new Map(); // title -> { at, ref } (ref may be null when nothing was found)

async function wikiJson(url) {
  const r = await fetch(url, { headers: WIKI_UA, signal: AbortSignal.timeout(6000) });
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    throw new Error(`Wikipedia antwortet mit HTTP ${r.status}`); // e.g. rate limit page
  }
}

const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// ask sometimes names an article that does not exist ("Roche-Türme") or a disambiguation page ("Roche-Turm").
// Then the Wikipedia search picks the article. It must contain the first name word of the asked title (Roche, Pilatus),
// so a made-up "Xyz-Turm" does not bring in some other tower.
const words = (s) => String(s).toLowerCase().normalize('NFC').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4);
// The English name from the planning step ("the Pilatus mountain near Lucerne") is searched first: a bare
// "Pilatus" also finds Pontius Pilatus, a singer and an aircraft maker.
async function findReference(title, subject = '') {
  for (const lang of ['de', 'en']) {
    const ref = await referenceFromPage(lang, title, { subject });
    if (ref) return ref;
  }
  const key = words(title)[0];
  if (!key) return null;
  const searches = [
    ...(subject ? [['en', subject.replace(/^(the|a|an)\s+/i, '')]] : []),
    ['de', title],
    ['en', title],
  ];
  for (const [lang, q] of searches) {
    const s = await wikiJson(`https://${lang}.wikipedia.org/w/api.php?format=json&action=query&list=search&srlimit=3&srsearch=${encodeURIComponent(q)}`);
    const hits = ((s.query && s.query.search) || []).map((x) => x.title).filter((t) => words(t).includes(key));
    for (const t of hits.slice(0, 2)) {
      const ref = await referenceFromPage(lang, t, { noPeople: true, subject });
      if (ref) return ref;
    }
  }
  return null;
}

// Wikidata "instance of: human" (P31 = Q5). Search hits can be people even when the request means a mountain.
async function isHuman(item) {
  if (!item) return false;
  const d = await wikiJson(`https://www.wikidata.org/w/api.php?format=json&action=wbgetclaims&property=P31&entity=${encodeURIComponent(item)}`);
  return ((d.claims && d.claims.P31) || []).some((c) => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id === 'Q5');
}

// Does the article fit the English name from the planning step? A title can exist with another meaning:
// "Jungfrau" is virginity in German, "Merkur" a car brand in English. Compared with the English Wikidata label,
// description and aliases ("covered bridge in Lucerne" fits "the Chapel Bridge in Lucerne"). Words match on
// their first 5 letters (tower/towers). Without a subject or a Wikidata item the article is accepted.
const FILLER = new Set(['with', 'from', 'near', 'over', 'into', 'their', 'that', 'this']);
async function fitsSubject(item, pageTitle, subject) {
  const want = words(subject).filter((w) => !FILLER.has(w)).map((w) => w.slice(0, 5));
  if (!item || !want.length) return true;
  const d = await wikiJson(`https://www.wikidata.org/w/api.php?format=json&action=wbgetentities&props=labels|descriptions|aliases&languages=en|de&ids=${encodeURIComponent(item)}`);
  const e = (d.entities && d.entities[item]) || {};
  const texts = [pageTitle];
  for (const k of ['labels', 'descriptions']) for (const v of Object.values(e[k] || {})) texts.push(v.value);
  for (const list of Object.values(e.aliases || {})) for (const v of list) texts.push(v.value);
  const have = new Set(words(texts.join(' ')).map((w) => w.slice(0, 5)));
  return want.some((w) => have.has(w));
}

async function referenceFromPage(lang, title, { noPeople = false, subject = '' } = {}) {
  const api = `https://${lang}.wikipedia.org/w/api.php?format=json&action=query&redirects=1`;
  const d = await wikiJson(`${api}&prop=pageimages|info|pageprops&ppprop=disambiguation|wikibase_item&inprop=url&piprop=thumbnail|name&pithumbsize=1024&pilicense=free&titles=${encodeURIComponent(title)}`);
  const page = Object.values((d.query && d.query.pages) || {})[0];
  if (!page || page.missing !== undefined || !page.pageimage || !page.thumbnail) return null;
  if (page.pageprops && page.pageprops.disambiguation !== undefined) return null;
  if (/\.(svg|gif|tiff?)$/i.test(page.pageimage)) return null; // maps, logos, diagrams
  const item = page.pageprops && page.pageprops.wikibase_item;
  if (noPeople && await isHuman(item)) return null;
  if (subject && !(await fitsSubject(item, page.title, subject))) return null;
  const fileTitle = 'File:' + page.pageimage;
  const m = await wikiJson(`${api}&prop=imageinfo&iiprop=extmetadata|url&titles=${encodeURIComponent(fileTitle)}`);
  const info = Object.values((m.query && m.query.pages) || {})[0];
  const meta = (info && info.imageinfo && info.imageinfo[0] && info.imageinfo[0].extmetadata) || {};
  const license = stripHtml(meta.LicenseShortName && meta.LicenseShortName.value);
  if (!license) return null;

  const img = await fetch(page.thumbnail.source, { headers: WIKI_UA, signal: AbortSignal.timeout(8000) });
  if (!img.ok) throw new Error(`Bild nicht ladbar (HTTP ${img.status})`);
  const buf = Buffer.from(await img.arrayBuffer());
  const name = `kiosk_ref_${crypto.createHash('sha1').update(lang + ':' + page.title).digest('hex').slice(0, 16)}.jpg`;
  const form = new FormData();
  form.append('image', new Blob([buf], { type: img.headers.get('content-type') || 'image/jpeg' }), name);
  form.append('type', 'input');
  form.append('overwrite', 'true');
  const up = await fetch(new URL('/upload/image', COMFY_URL), { method: 'POST', body: form, signal: AbortSignal.timeout(10000) });
  if (!up.ok) throw new Error(`Upload zu ComfyUI fehlgeschlagen (HTTP ${up.status})`);
  const uploaded = await up.json();
  return {
    name: uploaded.name,
    title: page.title,
    pageUrl: page.fullurl,
    file: page.pageimage,
    fileUrl: (info.imageinfo[0] && info.imageinfo[0].descriptionurl) || '',
    license,
    // Drop Wikipedia signature timestamps like "13:37, 2 July 2006 (UTC)".
    artist: stripHtml(meta.Artist && meta.Artist.value).replace(/,?\s*\d{1,2}:\d{2},?\s+\d{1,2}\.?\s+\S+\s+\d{4}\s*\(UTC\)/g, '').trim().slice(0, 120),
    width: page.thumbnail.width,
    height: page.thumbnail.height,
  };
}

async function handleReference(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return sendJson(res, 400, { error: 'Ungültige Anfrage' });
  }
  const title = String(body.wiki || '').trim().slice(0, 150);
  const subject = String(body.subject || '').trim().slice(0, 100);
  if (!settings.reference || !title) return sendJson(res, 200, { reference: null, off: true });
  const cacheKey = `${title}|${subject}`;
  const cached = refCache.get(cacheKey);
  if (cached && Date.now() - cached.at < REF_CACHE_MS) return sendJson(res, 200, { reference: cached.ref, cached: true });
  try {
    const ref = await findReference(title, subject);
    refCache.set(cacheKey, { at: Date.now(), ref });
    sendJson(res, 200, { reference: ref });
  } catch (e) {
    console.error('reference failed:', errText(e));
    sendJson(res, 200, { reference: null, error: true });
  }
}

// Names of reference photos this server uploaded; only these may be used in a workflow.
const knownReference = (name) => [...refCache.values()].some((c) => c.ref && c.ref.name === name);

// ---------- School logo ----------
// The image model does not know the logo. When a request names the school, the real logo goes along as a
// reference image. Only then: other requests stay as they are.
const BRAND_RE = /\btf[\s-]?bern\b|technischen? fachschule/i;
const LOGO_FILE = path.join(__dirname, 'reference', 'tfbern-logo.png');
const LOGO_DESCRIPTION = 'a blue wireframe drawing of a three-dimensional letter T joined with a letter F, and to its right the black words "TECHNISCHE FACHSCHULE" in two bold lines with "BERN" below in a thin line';
// Objects that carry the logo. With a site photo the logo is only added when one of these is named.
const LOGO_OBJECTS = /logo|shirt|hoodie|pulli|pullover|jacke|m(ü|ue)tze|cap\b|becher|tasse|fahne|flagge|tasche|rucksack|sticker|aufkleber|plakat|banner|bus\b|auto\b|fahrzeug|lieferwagen|helm/i;

// School sites: a photo per site in reference/ (see standorte.json). A missing photo is simply skipped.
const SITES = readJson(path.join(__dirname, 'reference', 'standorte.json'), []).map((site) => ({
  ...site,
  re: new RegExp(site.match, 'i'),
  path: path.join(__dirname, 'reference', site.file),
}));

// Upload a local file once to ComfyUI's input folder; resolves to the file name there.
const uploads = new Map();
function ensureUpload(file, name, type) {
  if (!uploads.has(name)) {
    const job = (async () => {
      const form = new FormData();
      form.append('image', new Blob([fs.readFileSync(file)], { type }), name);
      form.append('type', 'input');
      form.append('overwrite', 'true');
      const up = await fetch(new URL('/upload/image', COMFY_URL), { method: 'POST', body: form, signal: AbortSignal.timeout(10000) });
      if (!up.ok) throw new Error(`Upload von ${name} fehlgeschlagen (HTTP ${up.status})`);
      return (await up.json()).name;
    })();
    job.catch(() => uploads.delete(name)); // try again next time
    uploads.set(name, job);
  }
  return uploads.get(name);
}
const ensureLogo = () => ensureUpload(LOGO_FILE, 'kiosk_logo_tfbern.png', 'image/png');

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
  const a = { steps: settings.steps, upsampler: settings.upsampler, sampler: QUALITY.sampler, seed: null };
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

// How to tell the upsampler about the reference photo. Tested in Oct. 2026:
// "transform" works best when the thing becomes something else, "faithful" for styles and plain depictions
// (otherwise the photo's look, framing and pose get copied and a chosen style gets lost).
// With two photos (two named things) the wording is the same, in plural, and both things go into one scene.
const ORDINALS = ['first', 'second', 'third'];
const photosOf = (subjects) => subjects.length === 1
  ? `The first image is a photo of ${subjects[0]}`
  : `The first image is a photo of ${subjects[0]} and the second image is a photo of ${subjects[1]}`;
const REFERENCE_REQUEST = {
  transform: (p, subjects) => {
    const s = subjects.join(' and ');
    const one = subjects.length === 1;
    return `Create a new image for this request (a description of the picture, not text to show): ${p}\n${photosOf(subjects)}, only so you know ${one ? 'its' : 'their'} real shape and details. Follow the request boldly and creatively: transform, restage and relight ${s} exactly as the request asks. The result may look very different from the ${one ? 'photo' : 'photos'}; only the recognizable design of ${s} is taken from ${one ? 'it' : 'them'}. The new form asked for must be obvious at first glance, and the surroundings fit the new form, not the ${one ? 'photo' : 'photos'}.${one ? '' : TWO_THINGS}`;
  },
  faithful: (p, subjects) => {
    const s = subjects.join(' and ');
    const one = subjects.length === 1;
    return `Create a new image for this request (a description of the picture, not text to show): ${p}\n${photosOf(subjects)}, given only so you know ${one ? 'its' : 'their'} real shape and details. Do not copy the ${one ? "photo's" : "photos'"} look, colors, framing, viewpoint or pose. Follow the request boldly: restage, transform and render the whole image fully in the requested style or medium; only the recognizable design of ${s} comes from the ${one ? 'photo' : 'photos'}.${one ? '' : TWO_THINGS}`;
  },
};
const LOOSE_REFERENCE = (two) => `The ${two ? 'photos are' : 'photo is'} only a rough guide to what ${two ? 'these things look' : 'this thing looks'} like, not a template: invent your own composition with your own camera position, distance, framing, light, weather and season, clearly different from the ${two ? 'photos' : 'photo'}, and describe only the essential recognizable features, not every detail of the ${two ? 'photos' : 'photo'}.`;
const TWO_THINGS =' Both things appear together in one single coherent scene, arranged as the request says, each in its own real proportions; this is one new picture, not two photos side by side.';
// With the school's own site photo or logo, every picture came out alike: the photo's viewpoint, the logo on
// white. Each image gets one of these instead (picked from its seed, so images 1..4 differ).
// Tested one by one (experiment 19): views close to the photo (street level, detail, rooftop) still copied it.
const SITE_VIEWS = [
  'a high aerial view from a drone far above, looking down on the roofs and the streets around',
  'seen from far away across the city, the building small in a wide view with lots of surroundings',
  'from a corner at a steep angle along one long side, the facade running diagonally into the distance',
  'a drone view from high above and far to one side, the whole site seen at a slant with its neighbourhood',
  'seen from the far end of a street, the street leading towards the building at one side of the picture',
  'seen from a low angle through trees and branches in the foreground',
];
// No red: the blue logo got recolored on it, and red is not a school color.
const LOGO_COLORS = ['white', 'navy blue', 'black', 'light grey', 'dark green', 'yellow', 'beige', 'anthracite grey', 'light blue'];
const LOGO_SETTINGS = [
  'outdoors in a sunny park',
  'in a bright modern workshop with machines',
  'on a wooden table in a cozy room',
  'in a city street in Bern',
  'in a photo studio with a soft colored backdrop',
  'in a school hallway with students',
];
const pick = (list, n) => list[Math.abs(Math.trunc(n)) % list.length];

// Requests that ask for text in the picture (quotes or words like Aufschrift, Schild, Text, sign).
const WANTS_TEXT = /["«»„“‹›]|aufschrift|aufdruck|beschrift|schrift(?!steller)|schild(?!kr)|text|logo|wort|wörter|buchstab|plakat|sign|label|writing|letters|words?/i;
const ORIENTATION = { '1:1': 'square', '2:3': 'portrait (taller than wide)', '3:2': 'landscape (wider than tall)' };

// Quality settings for every image. Values found in the test night of 2026-10-28/29 (see TESTBERICHT).
// In lab mode (KIOSK_LAB=1) a request may override any of them with `lab`.
const QUALITY = {
  sampler: 'er_sde',          // tested: clearly more real detail than euler (fur, faces, small parts)
  scheduler: 'simple',        // KSampler scheduler, or 'flux2' for the resolution-aware Flux2Scheduler (no visible gain)
  megapixels: null,           // null = by quality level and number of images (QUALITY_LEVELS)
  hires: null,                // second pass { scale, denoise, steps } on the upscaled latent, or null
  sharpen: 0,                 // ImageSharpen alpha after decoding, 0 = off
  refMegapixels: 0.5,         // size the reference photo is read at
  // Wikipedia photos as a guide, not a template (experiments 22/23, ~100 images): with the photo in every step the
  // picture copied its viewpoint, framing, pose and color, and different seeds gave almost the same image. Leaving
  // the photo out of the first 10 % of the steps frees the layout; from 25 % on details got lost. The loose wording
  // frees viewpoint, light and color (a blue Vespa from a white one). Not for the school logo and site photos.
  refRange: [0.1, 1],         // [start, end]: reference photos only in this part of the steps, null = all steps
  refLoose: true,             // tell the upsampler the photos are only a rough guide (own viewpoint, light, season)
  vary: true,                 // site photo / logo: different viewpoint, color and setting per image (SITE_VIEWS ...)
  freeCaption: false,         // with vary: sample the first caption too; tested, no extra gain, and greedy keeps the cache
  text: {                     // prompt upsampler (TextGenerate)
    temperature: 1.0, top_k: 1, top_p: 0.95, min_p: 0.0, repetition_penalty: 1.05, presence_penalty: 1.5,
    thinking: false, max_length: 3584,
  },
  // Upsampler sampling for variations ("Nochmal" and image 2..4): greedy gives the same caption every time,
  // and with the same caption new seeds only make near-identical images (tested).
  variation: { temperature: 0.7, top_k: 40, top_p: 0.9, min_p: 0.05 },
  // Appended to the upsampler system prompt. Without it the upsampler often invents signs, chalkboards
  // and labels whose lettering comes out garbled, and comic pictures got the request as a title (tested);
  // requested text still works. Do not mention the kiosk here: that put a kiosk counter into a dog picture.
  systemExtra: 'Additional rule: add no signs, labels, logos, titles, brand names or written words of your own, and never write the request itself into the image as a title or caption. Only when the request explicitly asks for text (e.g. a sign with certain words), render exactly that text.',
};
const LAB = process.env.KIOSK_LAB === '1';

// Guardrails: extra rule for the prompt upsampler, so it does not add what the level forbids on its own.
const GUARD_SYSTEM = {
  locker: 'Additional rule: never add nudity, sexual content or gore of your own.',
  mittel: 'Additional rule: keep the picture suitable for a family audience with children: no nudity, sexual content, blood, gore or realistic violence against people, even if the request hints at it.',
  streng: 'Additional rule: keep the picture friendly and cheerful for young children: no nudity, no weapons, no fighting, no blood, nothing scary or threatening, even if the request hints at it.',
};

// Output size in megapixels per quality level and number of images. Native 2 MP gave the most natural
// faces and finest detail (tested); 4 images at 2 MP would take about a minute, so fewer pixels there.
const QUALITY_LEVELS = {
  schnell: { 1: 1.0, 2: 1.0, 4: 1.0 },
  hoch: { 1: 1.5, 2: 1.25, 4: 1.0 },
  maximal: { 1: 2.0, 2: 1.5, 4: 1.0 },
};

// Width/height for a format at a megapixel target, multiples of 16.
function sizeFor(f, megapixels) {
  if (!megapixels) return { width: f.width, height: f.height };
  const k = Math.sqrt((megapixels * 1024 * 1024) / (f.width * f.height));
  const r16 = (v) => Math.max(256, Math.round((v * k) / 16) * 16);
  return { width: r16(f.width), height: r16(f.height) };
}

function buildWorkflow({ prompt, format, style, variants, advanced, facts, references = [], lab, variation, brand }) {
  const site = references.some((r) => r.site);
  const reference = references.length ? references[0] : null;
  const f = FORMATS[format] || FORMATS.square;
  const wf = structuredClone(WORKFLOW);
  const adv = cleanAdvanced(advanced);
  const L = LAB && lab && typeof lab === 'object' ? lab : {};
  const styleText = L.styleText !== undefined ? L.styleText : STYLES[style];
  const q = { ...QUALITY, ...L, text: { ...QUALITY.text, ...(L.text || {}) } };
  const steps = L.steps || adv.steps;
  const sampler = L.sampler || adv.sampler;
  const seed = L.seed ?? adv.seed ?? randomSeed();
  // With greedy decoding (top_k 1) the upsampler seed changes nothing, so keep it fixed:
  // ComfyUI then reuses the caption for the same request, e.g. "Nochmal" saves about 8 s.
  const vary = !!q.vary && !!(site || brand);
  const baseText = variation || (vary && q.freeCaption) ? { ...q.text, ...q.variation } : q.text;
  // Extra line for image k: viewpoint for a site photo; color and setting for the logo.
  const hint = (k) => {
    if (!vary) return '';
    let h = '';
    if (site) h += `\nCamera (unless the request names a viewpoint): the camera stands in a different place than in the photo, ${pick(SITE_VIEWS, seed + k)}. Do not repeat the photo's viewpoint and framing.`;
    if (brand) h += `\nUnless the request names colors or a place: the thing carrying the logo is ${pick(LOGO_COLORS, seed + k)}, and the scene is ${pick(LOGO_SETTINGS, seed + 2 * k + 1)}. On a dark color the black words of the logo are printed in white.`;
    return h;
  };
  const textSeed = L.textSeed ?? (baseText.top_k === 1 ? 0 : randomSeed());
  // Several images: each gets its own caption (image 1 as usual, the others as variations), otherwise they look alike.
  const separate = adv.upsampler && variants > 1 && q.scheduler !== 'flux2' && !(q.hires && q.hires.scale > 1) && !L.batch;
  const level = QUALITY_LEVELS[settings.quality] || QUALITY_LEVELS.maximal;
  const { width, height } = sizeFor(f, q.megapixels ?? level[variants] ?? 1.0);
  const factText = facts ? `Visual reference facts from a web search (use them to depict the named things accurately, do not render them as text): ${facts}` : '';
  let positive = ['4', 0];
  let negative = ['5', 0];

  // Reference images go to the image model (ReferenceMultiLatent) and to the upsampler, which can see images:
  // Wikipedia photos of up to two named things (nodes 20, 26) or a site photo, and/or the school logo (node 25).
  const refs = [...references.slice(0, 2).map((r, i) => [['20', '26'][i], r.name]), ...(brand ? [['25', brand.name]] : [])];
  const refImages = Object.fromEntries(refs.map(([node], i) => [`images.image${i}`, [node, 0]]));
  if (refs.length) {
    for (const [node, name] of refs) wf[node] = { class_type: 'LoadImage', inputs: { image: name } };
    wf['21'] = { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['4', 0] } };
    wf['22'] = {
      class_type: 'ReferenceMultiLatent',
      inputs: { positive: ['4', 0], negative: ['21', 0], vae: ['3', 0], resolution: 'resize', 'resolution.megapixels': q.refMegapixels, ...refImages },
    };
    positive = ['22', 0];
    negative = ['22', 1];
    delete wf['5'];
  }
  // Reference photos only in part of the sampling steps (refRange [start, end], 0 = first step); in the other
  // steps the image model sees the text alone. Nodes 27..31.
  // Not with the logo (must stay exact) or a site photo (own tested viewpoint rules).
  const range = refs.length && q.refRange && !brand && !site ? q.refRange : null;
  if (range) {
    const [a, b] = range;
    wf['27'] = { class_type: 'ConditioningSetTimestepRange', inputs: { conditioning: ['22', 0], start: a, end: b } };
    let out = ['27', 0];
    [[0, a], [b, 1]].filter(([s, e]) => e - s > 0.0001).forEach(([s, e], i) => {
      const set = String(28 + 2 * i);
      const join = String(29 + 2 * i);
      wf[set] = { class_type: 'ConditioningSetTimestepRange', inputs: { conditioning: ['4', 0], start: s, end: e } };
      wf[join] = { class_type: 'ConditioningCombine', inputs: { conditioning_1: out, conditioning_2: [set, 0] } };
      out = [join, 0];
    });
    positive = out;
  }

  const refMode = reference ? (adv.upsampler ? (references.some((r) => r.transform) && !styleText ? 'transform' : 'faithful') : 'direct') : null;
  let baseRequest = '';
  if (adv.upsampler) {
    let request;
    let system;
    if (refs.length) {
      request = reference
        ? REFERENCE_REQUEST[refMode](prompt, references.slice(0, 2).map((r) => r.subject))
        : `Create a new image for this request (a description of the picture, not text to show): ${prompt}`;
      if (reference && q.refLoose && !site && !brand) request += `\n${LOOSE_REFERENCE(references.length > 1)}`;
      if (brand) {
        request += `\nThe ${ORDINALS[Math.min(references.length, 2)]} image is the official logo of the Technische Fachschule Bern (TF Bern), a vocational school in Bern, Switzerland: ${LOGO_DESCRIPTION}. Wherever the request means TF Bern, the school, its logo or its branding (for example printed on a T-shirt, a cup or a flag), show exactly this logo, unchanged in shape, colors, lettering and proportions, sharp and readable${vary ? '. The white around the logo in the image is only background, not part of the logo' : ', on a white or light surface'}. Do not invent a different logo.`;
      }
      if (styleText) request += `\nStyle: ${styleText}.`;
      request += `\nThe new image is ${ORIENTATION[f.canvas]}.`;
      // When the thing gets transformed, facts about its real surroundings pull the image back to the photo (tested), so leave them out.
      if (facts && refMode === 'faithful') request += `\nVisual facts from a web search: ${facts}`;
      wf['23'] = { class_type: 'BatchImagesNode', inputs: refImages };
      wf['11'].inputs.image = ['23', 0];
      system = EDIT_SYSTEM_PROMPT;
    } else {
      request = `TARGET CANVAS: ${f.canvas}\n${prompt}`;
      if (styleText) request += `\nStyle: ${styleText}.`;
      if (factText) request += `\n${factText}`;
      system = SYSTEM_PROMPT;
    }
    // The system rule alone did not stop shop signs like "SCHREINEREI" (tested); said in the request it works.
    if (brand) request += '\nApart from this logo, no other lettering, signs or labels.';
    else if (!WANTS_TEXT.test(prompt)) request += '\nNo visible lettering, words, signs or labels anywhere in the picture.';
    const t = baseText;
    baseRequest = request;
    Object.assign(wf['11'].inputs, {
      prompt: request + hint(0),
      system_prompt: [system, q.systemExtra, GUARD_SYSTEM[settings.guardrails]].filter(Boolean).join('\n'),
      max_length: t.max_length,
      thinking: !!t.thinking,
      mtp: t.mtp || 'off',
      'sampling_mode.temperature': t.temperature,
      'sampling_mode.top_k': t.top_k,
      'sampling_mode.top_p': t.top_p,
      'sampling_mode.min_p': t.min_p,
      'sampling_mode.repetition_penalty': t.repetition_penalty,
      'sampling_mode.presence_penalty': t.presence_penalty,
      'sampling_mode.seed': textSeed,
    });
  } else {
    // Without the language model the prompt goes straight to the text encoder.
    for (const id of ['11', '12', '13']) delete wf[id];
    wf['4'].inputs.text = [prompt, styleText && `Style: ${styleText}.`, facts].filter(Boolean).join('. ');
  }

  wf['6'].inputs.width = width;
  wf['6'].inputs.height = height;
  wf['6'].inputs.batch_size = separate ? 1 : variants;

  // Main sampling pass. Node id 7 stays the sampler, the page shows its progress.
  if (q.scheduler === 'flux2') {
    wf['40'] = { class_type: 'RandomNoise', inputs: { noise_seed: seed } };
    wf['41'] = { class_type: 'BasicGuider', inputs: { model: ['1', 0], conditioning: positive } };
    wf['42'] = { class_type: 'KSamplerSelect', inputs: { sampler_name: sampler } };
    wf['43'] = { class_type: 'Flux2Scheduler', inputs: { steps, width, height } };
    wf['7'] = { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['40', 0], guider: ['41', 0], sampler: ['42', 0], sigmas: ['43', 0], latent_image: ['6', 0] } };
  } else {
    Object.assign(wf['7'].inputs, { positive, negative, seed, steps, sampler_name: sampler, scheduler: q.scheduler });
  }
  let latent = ['7', 0];

  // Optional second pass: upscale the latent and refine it (more detail at a higher resolution).
  if (q.hires && q.hires.scale > 1) {
    if (!reference && !wf['5']) wf['5'] = structuredClone(WORKFLOW['5']);
    wf['45'] = { class_type: 'LatentUpscaleBy', inputs: { samples: latent, upscale_method: q.hires.method || 'bicubic', scale_by: q.hires.scale } };
    wf['46'] = {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0], positive, negative, latent_image: ['45', 0],
        seed: seed + 1, steps: q.hires.steps || steps, cfg: 1, sampler_name: sampler, scheduler: q.hires.scheduler || 'simple', denoise: q.hires.denoise,
      },
    };
    latent = ['46', 0];
  }
  // With the flux2 path and no hires pass, node 5 (negative) is unused; ComfyUI ignores unused nodes.
  wf['8'].inputs.samples = latent;
  if (q.sharpen > 0) {
    wf['47'] = { class_type: 'ImageSharpen', inputs: { image: ['8', 0], sharpen_radius: 1, sigma: 1, alpha: q.sharpen } };
    wf['9'].inputs.images = ['47', 0];
  }

  if (separate) {
    // Copy the caption -> encode -> sample -> decode chain for images 2..n, each with a varied caption.
    const chain = ['11', '4', '6', '7', '8', ...(refs.length ? ['21', '22'] : []), ...['27', '28', '29', '30', '31'].filter((n) => wf[n])];
    const decoded = [['8', 0]];
    for (let k = 1; k < variants; k++) {
      const id = (n) => `${n}_${k}`;
      for (const n of chain) {
        const node = structuredClone(wf[n]);
        for (const [key, val] of Object.entries(node.inputs)) {
          if (Array.isArray(val) && chain.includes(val[0])) node.inputs[key] = [id(val[0]), val[1]];
        }
        wf[id(n)] = node;
      }
      Object.assign(wf[id('11')].inputs, {
        'sampling_mode.temperature': q.variation.temperature,
        'sampling_mode.top_k': q.variation.top_k,
        'sampling_mode.top_p': q.variation.top_p,
        'sampling_mode.min_p': q.variation.min_p,
        'sampling_mode.seed': randomSeed(),
      });
      if (vary) wf[id('11')].inputs.prompt = baseRequest + hint(k);
      wf[id('7')].inputs.seed = seed + k;
      decoded.push([id('8'), 0]);
    }
    wf['24'] = { class_type: 'BatchImagesNode', inputs: Object.fromEntries(decoded.map((d, i) => [`images.image${i}`, d])) };
    wf['9'].inputs.images = q.sharpen > 0 ? wf['9'].inputs.images : ['24', 0];
  }

  const hiresSize = q.hires && q.hires.scale > 1
    ? { width: Math.round((width * q.hires.scale) / 16) * 16, height: Math.round((height * q.hires.scale) / 16) * 16 } : null;
  return {
    workflow: wf,
    info: {
      seed,
      steps,
      sampler,
      scheduler: q.scheduler,
      width: hiresSize ? hiresSize.width : width,
      height: hiresSize ? hiresSize.height : height,
      hires: !!hiresSize,
      separateCaptions: separate,
      variation: !!variation,
      variants,
      upsampler: adv.upsampler,
      model: wf['1'].inputs.unet_name.replace('.safetensors', ''),
      textEncoder: wf['2'].inputs.clip_name.replace('.safetensors', ''),
      languageModel: adv.upsampler ? WORKFLOW['12'].inputs.clip_name.replace('.safetensors', '') : null,
      reference: reference ? { mode: refMode, megapixels: q.refMegapixels, count: Math.min(references.length, 2), range: range, loose: !!q.refLoose && !site && !brand } : null,
      logo: !!brand,
      vary: vary ? { view: site ? pick(SITE_VIEWS, seed) : null, color: brand ? pick(LOGO_COLORS, seed) : null } : null,
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
  const guard = await checkPrompt(prompt);
  if (!guard.ok) return sendJson(res, 422, blockedReply(guard));
  const variants = Math.min(settings.maxVariants, [1, 2, 4].includes(Number(body.variants)) ? Number(body.variants) : 1);

  const facts = typeof body.facts === 'string' ? body.facts.trim().slice(0, MAX_FACTS) : '';
  // Only photos this server fetched itself are accepted as references.
  // Up to two photos (two named things). `reference` is the older single-photo form.
  const given = Array.isArray(body.references) ? body.references : body.reference ? [body.reference] : [];
  let references = settings.reference
    ? given
      .filter((r) => r && typeof r.name === 'string' && knownReference(r.name))
      .filter((r, i, all) => all.findIndex((x) => x.name === r.name) === i)
      .slice(0, 2)
      .map((r) => ({ name: r.name, subject: String(r.subject || 'the main subject').slice(0, 100), transform: r.transform === true }))
    : [];
  // School named: the real logo goes along, and for a named site (Felsenau, Lorraine) a photo of the building.
  // A Wikipedia photo about the school itself would compete with them, so drop that one.
  let brand = null;
  let site = null;
  if (BRAND_RE.test(prompt) && !(LAB && body.lab && body.lab.noLogo)) {
    try {
      const known = SITES.find((x) => x.re.test(prompt) && fs.existsSync(x.path));
      references = references.filter((r) => !/fachschule|tf\s?bern/i.test(r.subject));
      if (known) {
        const photo = { name: await ensureUpload(known.path, `kiosk_site_${known.key}.jpg`, 'image/jpeg'), subject: known.subject, transform: body.transform === true, site: true };
        // Only the site photo: Wikipedia photos here are mostly of the quarter around it (Lorraine) and pull away from the building.
        references = [photo];
        site = { name: photo.name, title: known.name, credit: known.credit };
      }
      if (!known || LOGO_OBJECTS.test(prompt)) brand = { name: await ensureLogo() };
    } catch (e) {
      console.error('logo/standort:', errText(e));
    }
  }
  const { workflow, info } = buildWorkflow({ prompt, format: body.format, style: body.style, variants, advanced: body.advanced, facts, references, lab: body.lab, variation: body.variation === true, brand });
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
    sendJson(res, 200, { promptId: data.prompt_id, info: { ...info, site }, prompt });
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
  sendJson(res, 200, { comfy: comfyOk, comfyUrl: COMFY_URL.origin, gpu, queue, ask, imagesToday: imagesToday(), recentCount: recent.length, blocked, blockedCount, settings });
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
    up.on('error', () => res.destroy());
    up.pipe(res);
  });
  // A network drop in the middle of an image: headers are already out, so just cut the response
  // (sending an error then crashed the whole server).
  upstream.on('error', () => (res.headersSent ? res.destroy() : sendJson(res, 502, { error: 'ComfyUI ist nicht erreichbar.' })));
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
    if (url === '/api/reference') return handleReference(req, res);
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

// Safety net for the open day: log a stray error instead of stopping the kiosk.
process.on('uncaughtException', (e) => console.error('Unerwarteter Fehler:', e));
process.on('unhandledRejection', (e) => console.error('Unerwarteter Fehler:', e));

server.listen(PORT, HOST, () => {
  console.log(`Kiosk läuft auf http://localhost:${PORT}  (ComfyUI: ${COMFY_URL.origin})`);
});
