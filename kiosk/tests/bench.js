// Test bench for the kiosk: runs prompts x seeds x variants through a lab server (KIOSK_LAB=1)
// and stores images, captions and GPU times.
//
//   KIOSK_LAB=1 PORT=8090 node --use-system-ca server.js
//   node tests/bench.js tests/experiments/samplers.json <outDir> [http://127.0.0.1:8090]
//
// Experiment file:
// { "name": "...", "seeds": [1, 2],
//   "prompts": [{ "key": "fuchs", "prompt": "...", "format": "square", "style": null, "variants": 1,
//                 "research": false, "reference": false }],
//   "variants": [{ "key": "euler", "lab": { "sampler": "euler" }, "advanced": {} }] }
//
// The upsampler seed is derived from the image seed, so variants that only change image settings
// get the same caption (ComfyUI caches it) and compare fairly.
const fs = require('fs');
const path = require('path');

const [expPath, outDir, base = 'http://127.0.0.1:8090'] = process.argv.slice(2);
if (!expPath || !outDir) {
  console.error('usage: node tests/bench.js <experiment.json> <outDir> [serverUrl]');
  process.exit(1);
}
const exp = JSON.parse(fs.readFileSync(expPath, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const resultsFile = path.join(outDir, 'results.json');
const results = fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, 'utf8')) : {};
const cacheFile = path.join(path.dirname(path.resolve(outDir)), 'research-cache.json');
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Retries while the lab server restarts (connection refused); other errors go through.
async function retry(fn) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= 20 || !/fetch failed|ECONNREFUSED|ECONNRESET/.test(e.message + (e.cause ? e.cause.code : ''))) throw e;
      await sleep(3000);
    }
  }
}
const post = (url, body) => retry(async () => {
  const r = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
});
const getJson = (url) => retry(async () => (await fetch(base + url)).json());
const getBuf = (url) => retry(async () => Buffer.from(await (await fetch(base + url)).arrayBuffer()));

// Plan, research and reference once per prompt text; reused across runs.
async function prepare(p) {
  if (!p.research && !p.reference) return {};
  const key = `${p.prompt}|${!!p.research}|${!!p.reference}`;
  if (cache[key]) {
    // Reference photos must be known to the running server: fetch again (cheap, cached there).
    if (cache[key].wiki && p.reference) await post('/api/reference', { wiki: cache[key].wiki });
    return cache[key];
  }
  const plan = await post('/api/research/plan', { prompt: p.prompt });
  const out = { plan, wiki: plan.wiki };
  const jobs = [];
  if (p.research && plan.needed) jobs.push(post('/api/research/run', { prompt: p.prompt, query: plan.query }).then((r) => (out.facts = r.facts || null)));
  if (p.reference && plan.wiki) {
    jobs.push(post('/api/reference', { wiki: plan.wiki }).then((r) => {
      if (r.reference) out.reference = { name: r.reference.name, subject: plan.subject || r.reference.title, transform: !!plan.transform, title: r.reference.title };
    }));
  }
  await Promise.all(jobs);
  cache[key] = out;
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  return out;
}

async function waitFor(promptId) {
  for (let i = 0; i < 600; i++) {
    const h = (await getJson(`/comfy/history/${promptId}`))[promptId];
    if (h && h.status && (h.status.completed || h.status.status_str === 'error')) return h;
    await sleep(700);
  }
  throw new Error('timeout');
}

function gpuSeconds(h) {
  const msgs = (h.status && h.status.messages) || [];
  const start = msgs.find((m) => m[0] === 'execution_start');
  const end = msgs.find((m) => m[0] === 'execution_success' || m[0] === 'execution_error');
  return start && end ? (end[1].timestamp - start[1].timestamp) / 1000 : null;
}

(async () => {
  const total = exp.prompts.length * exp.seeds.length * exp.variants.length;
  let n = 0;
  for (const p of exp.prompts) {
    const prep = await prepare(p);
    for (const seed of exp.seeds) {
      for (const v of exp.variants) {
        n++;
        const id = `${p.key}__${v.key}__${seed}`;
        const file = path.join(outDir, id + '.png');
        if (fs.existsSync(file) && results[id]) continue; // resume
        const lab = { seed, ...(v.variation || p.variation || (p.variants || 1) > 1 ? {} : { textSeed: seed + 7 }), ...(v.lab || {}), ...(p.lab || {}) };
        if (v.lab && v.lab.text) lab.text = { ...v.lab.text };
        const body = {
          prompt: v.prompt || p.prompt,
          format: p.format || 'square',
          style: v.style !== undefined ? v.style : p.style || null,
          variants: p.variants || 1,
          clientId: 'bench',
          lab,
          advanced: { steps: lab.steps || 16, sampler: lab.sampler || 'euler', upsampler: v.upsampler !== false, ...(v.advanced || {}) },
          variation: !!(v.variation || p.variation),
          transform: !!(prep.plan && prep.plan.transform),
          facts: v.noFacts ? null : prep.facts || null,
          reference: v.noReference ? null : prep.reference || null,
        };
        try {
          const g = await post('/api/generate', body);
          if (!g.promptId) throw new Error(JSON.stringify(g));
          const h = await waitFor(g.promptId);
          if (h.status.status_str === 'error') throw new Error(JSON.stringify(h.status.messages).slice(0, 600));
          const imgs = h.outputs['9'].images;
          const buf = await getBuf('/comfy/view?' + new URLSearchParams(imgs[0]));
          fs.writeFileSync(file, buf);
          for (let k = 1; k < imgs.length; k++) {
            fs.writeFileSync(path.join(outDir, `${id}__${k}.png`), await getBuf('/comfy/view?' + new URLSearchParams(imgs[k])));
          }
          results[id] = {
            prompt: p.key, variant: v.key, seed, gpu: gpuSeconds(h), info: g.info,
            caption: (h.outputs['13'] && h.outputs['13'].text[0]) || '',
            reference: prep.reference ? prep.reference.title : null, facts: !!prep.facts,
          };
          console.log(`[${n}/${total}] ${id}  ${results[id].gpu ? results[id].gpu.toFixed(1) + ' s' : ''}`);
        } catch (e) {
          results[id] = { prompt: p.key, variant: v.key, seed, error: String(e.message).slice(0, 600) };
          console.log(`[${n}/${total}] ${id}  FEHLER ${results[id].error.slice(0, 200)}`);
        }
        fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
      }
    }
  }
  console.log('fertig:', exp.name);
})().catch((e) => {
  console.error('Abbruch:', e.message);
  process.exit(1);
});
