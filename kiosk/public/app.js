(() => {
  'use strict';

  // ---------- Fixed values ----------
  const IDLE_COUNTDOWN = 10;    // seconds in "Bist du noch da?"
  const TIMEOUT_MS = 240_000;   // give up on a job after this long
  const FACT_MS = 6000;         // how long each "Wusstest du?" stays
  const SAVER_MS = 7000;        // how long each screensaver image stays
  const STATUS_MS = 5000;       // status polling
  const FORMATS = { square: [1024, 1024], portrait: [832, 1216], landscape: [1216, 832] };
  const STYLES = [
    ['foto', 'Foto'], ['comic', 'Comic'], ['aquarell', 'Aquarell'], ['oel', 'Ölbild'],
    ['pixel', 'Pixel-Art'], ['bausteine', 'Bausteine'], ['skizze', 'Skizze'], ['render', '3D'],
  ];
  const SAMPLERS = ['er_sde', 'euler', 'dpmpp_2m', 'euler_ancestral', 'heun'];
  // Node ids in workflow.json
  const NODE_UPSAMPLER = '11';
  const NODE_ENCODE = '4';
  const NODE_SAMPLER = '7';
  const NODE_DECODE = '8';
  const NODE_IMAGE = '9';
  const NODE_CAPTION = '13';

  // ---------- Elements ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    counter: $('counter'),
    prompt: $('prompt'), field: $('field'), clear: $('clear'), error: $('error'),
    ideas: $('ideas'), shuffle: $('shuffle'), dice: $('dice'), styles: $('styles'),
    formats: $('formats'), counts: $('counts'), openPro: $('openPro'), generate: $('generate'),
    stage: $('stage'), offline: $('offline'), intro: $('intro'), canvas: $('canvas'), frame: $('frame'),
    image: $('image'), grid: $('grid'),
    caption: $('caption'), captionText: $('captionText'), tech: $('tech'), techList: $('techList'),
    progress: $('progress'), progressLabel: $('progressLabel'), progressDetail: $('progressDetail'),
    bar: document.querySelector('.bar'), barFill: $('barFill'), cancel: $('cancel'),
    fact: $('fact'), factTitle: $('factTitle'), factText: $('factText'),
    actions: $('actions'), again: $('again'), showAll: $('showAll'), showCaption: $('showCaption'),
    showTech: $('showTech'), restart: $('restart'),
    idle: $('idle'), idleCount: $('idleCount'),
    saver: $('saver'), saverA: $('saverA'), saverB: $('saverB'), saverPrompt: $('saverPrompt'),
    pro: $('pro'), proSteps: $('proSteps'), seedMode: $('seedMode'), seedFixed: $('seedFixed'),
    proSeed: $('proSeed'), proSeedDice: $('proSeedDice'), proSampler: $('proSampler'),
    proUpsampler: $('proUpsampler'), proResearch: $('proResearch'), proResearchRow: $('proResearchRow'), proReset: $('proReset'),
    proReference: $('proReference'), proReferenceRow: $('proReferenceRow'),
    zoom: $('zoom'), zoomStage: $('zoomStage'), zoomImg: $('zoomImg'), zoomBtn: $('zoomBtn'),
    zoomIn: $('zoomIn'), zoomOut: $('zoomOut'), zoomFit: $('zoomFit'), zoomClose: $('zoomClose'),
    aResearch: $('aResearch'), aGuardrails: $('aGuardrails'), aReference: $('aReference'), aQuality: $('aQuality'),
    admin: $('admin'), adminStatus: $('adminStatus'), adminMsg: $('adminMsg'), adminSave: $('adminSave'),
    adminSaver: $('adminSaver'), adminReload: $('adminReload'),
    login: $('login'), loginForm: $('loginForm'), loginPassword: $('loginPassword'), loginError: $('loginError'), loginSend: $('loginSend'),
    logo: document.querySelector('.topbar .logo'),
    aSteps: $('aSteps'), aIdle: $('aIdle'), aSaver: $('aSaver'), aMaxVariants: $('aMaxVariants'),
    aUpsampler: $('aUpsampler'), aShowRecent: $('aShowRecent'), aAllowAdvanced: $('aAllowAdvanced'), aMail: $('aMail'),
    openMail: $('openMail'), mail: $('mail'), mailPickRow: $('mailPickRow'), mailPick: $('mailPick'),
    mailSingle: $('mailSingle'), mailSingleImg: $('mailSingleImg'), mailTo: $('mailTo'), mailDomains: $('mailDomains'),
    mailError: $('mailError'), mailDone: $('mailDone'), mailDoneText: $('mailDoneText'), mailSend: $('mailSend'),
    phases: [...document.querySelectorAll('[data-phase]')],
  };

  const clientId = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);

  // ---------- State ----------
  let settings = { steps: 16, upsampler: true, maxVariants: 4, idleSeconds: 60, screensaverSeconds: 30, showRecent: true, allowAdvanced: true, research: true, guardrails: 'mittel', mail: true };
  let status = { comfy: true, gpu: null, queue: null, ask: { configured: false }, imagesToday: 0, recentCount: 0 };
  let state = 'idle';           // idle | generating | result
  let format = 'square';
  let count = 1;
  let style = null;
  let advanced = defaultAdvanced();
  let job = null;
  const ignoredIds = new Set(); // cancelled jobs
  let previewUrl = null;
  let ws = null;

  function defaultAdvanced() {
    return { steps: settings.steps, seedMode: 'random', seed: '', sampler: 'er_sde', upsampler: settings.upsampler, research: true, reference: 'auto' };
  }
  function advancedChanged() {
    const d = defaultAdvanced();
    return advanced.steps !== d.steps || advanced.seedMode !== 'random' || advanced.sampler !== d.sampler
      || advanced.upsampler !== d.upsampler || advanced.research !== d.research || advanced.reference !== d.reference;
  }
  // Research and reference photos need ask, must be allowed in the staff menu and not switched off by the visitor.
  const askReady = () => !!(status.ask && status.ask.configured);
  const researchAvailable = () => askReady() && settings.research;
  const referenceAvailable = () => askReady() && settings.reference;
  const researchWanted = () => researchAvailable() && (!settings.allowAdvanced || advanced.research);
  // Reference photo: 'aus' | 'auto' (ask decides) | 'immer' (always the main subject).
  const referenceMode = () => !referenceAvailable() ? 'aus' : settings.allowAdvanced ? advanced.reference : 'auto';
  const referenceWanted = () => referenceMode() !== 'aus';
  const randomSeedValue = () => String(Math.floor(Math.random() * 1e12));

  // ---------- Small helpers ----------
  function shuffled(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const seconds = (ms) => (ms / 1000).toFixed(1).replace('.', ',') + ' s';

  function setChecked(container, value) {
    container.querySelectorAll('[role="radio"]').forEach((b) => {
      const v = b.dataset.value ?? b.dataset.format ?? b.dataset.count ?? b.dataset.seedmode;
      b.setAttribute('aria-checked', String(v === String(value)));
    });
  }
  function getChecked(container) {
    const b = container.querySelector('[aria-checked="true"]');
    return b ? b.dataset.value : null;
  }

  async function postJson(url, body, signal) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || 'Unbekannter Fehler'), { blocked: data.blocked === true });
    return data;
  }

  // ---------- Ideas, dice, styles ----------
  const ideaCount = () => (window.innerHeight < 1000 ? 2 : 4); // fewer ideas on lower screens

  function renderIdeas() {
    el.ideas.replaceChildren(...shuffled(window.PROMPT_IDEAS).slice(0, ideaCount()).map((text) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'idea';
      b.textContent = text;
      b.addEventListener('click', () => {
        el.prompt.value = text;
        markPicked(b);
        onPromptInput();
      });
      return b;
    }));
  }

  function markPicked(button) {
    el.ideas.querySelectorAll('.idea').forEach((x) => x.classList.toggle('is-picked', x === button));
  }

  function rollDice() {
    const d = window.DICE;
    el.prompt.value = `${pick(d.who)} ${pick(d.what)} ${pick(d.where)}`;
    markPicked(null);
    el.field.classList.remove('is-rolled');
    void el.field.offsetWidth;
    el.field.classList.add('is-rolled');
    onPromptInput();
  }

  function renderStyles() {
    el.styles.replaceChildren(...STYLES.map(([key, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'style';
      b.dataset.style = key;
      b.textContent = label;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => setStyle(style === key ? null : key));
      return b;
    }));
  }

  function setStyle(key) {
    style = key;
    el.styles.querySelectorAll('.style').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.style === key)));
  }

  // ---------- Input ----------
  function onPromptInput() {
    el.clear.hidden = !el.prompt.value || state === 'generating';
    showError('');
  }

  function showError(msg) {
    el.error.textContent = msg;
    el.error.hidden = !msg;
    el.field.classList.toggle('has-error', !!msg);
  }

  function setFormat(key) {
    format = key;
    setChecked(el.formats, key);
  }

  function setCount(n) {
    count = Math.min(n, settings.maxVariants);
    setChecked(el.counts, count);
  }

  function applySettings() {
    el.counts.querySelectorAll('button').forEach((b) => (b.disabled = Number(b.dataset.count) > settings.maxVariants || state === 'generating'));
    el.counts.closest('.option').hidden = settings.maxVariants <= 1;
    if (count > settings.maxVariants) setCount(settings.maxVariants);
    el.openPro.hidden = !settings.allowAdvanced;
    if (!settings.allowAdvanced) advanced = defaultAdvanced();
    el.openMail.hidden = settings.mail === false;
    if (settings.mail === false) closeModal(el.mail);
    updateProLink();
  }

  function updateProLink() {
    el.openPro.classList.toggle('is-active', settings.allowAdvanced && advancedChanged());
  }

  // ---------- Stage ----------
  function setState(next) {
    state = next;
    el.stage.dataset.state = next;
    el.intro.hidden = next !== 'idle';
    el.canvas.hidden = next === 'idle';
    el.progress.hidden = next !== 'generating';
    el.actions.hidden = next !== 'result';
    const busy = next === 'generating';
    el.generate.disabled = busy || !status.comfy;
    el.generate.textContent = busy ? 'Bild wird erstellt …' : 'Bild erstellen';
    el.prompt.readOnly = busy;
    el.clear.hidden = busy || !el.prompt.value;
    document.querySelectorAll('#formats button, .style, #dice, #shuffle, .idea, #openPro').forEach((b) => (b.disabled = busy));
    applySettings();
    if (next !== 'result') closeOverlays();
    if (next !== 'generating') stopFacts();
    if (next !== 'result') closeZoom();
    updateZoomBtn();
    requestAnimationFrame(fitFrame);
  }

  // Grid shape for several results: 2 landscape images stack, 2 others sit side by side, 4 make 2x2.
  function gridShape(n, fmt) {
    if (n === 4) return [2, 2];
    if (n === 2) return fmt === 'landscape' ? [1, 2] : [2, 1];
    return [1, 1];
  }

  // Size the frame to the image (or grid) inside the free stage area.
  function fitFrame() {
    if (el.canvas.hidden) return;
    const fmt = (job && job.format) || format;
    let [w, h] = FORMATS[fmt];
    if (!el.grid.hidden && job) {
      const [cols, rows] = gridShape(job.images.length, fmt);
      w *= cols;
      h *= rows;
      el.grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      el.grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    }
    const box = el.canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const scale = Math.min(box.width / w, box.height / h);
    el.frame.style.width = Math.floor(w * scale) + 'px';
    el.frame.style.height = Math.floor(h * scale) + 'px';
  }

  function showPlaceholder(fmt) {
    const [w, h] = FORMATS[fmt];
    setImage(`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#80C1DA"/></svg>`)}`);
  }

  function setImage(src) {
    el.image.src = src;
  }

  function closeOverlays() {
    el.caption.hidden = true;
    el.tech.hidden = true;
    el.showCaption.setAttribute('aria-pressed', 'false');
    el.showTech.setAttribute('aria-pressed', 'false');
    updateZoomBtn();
  }

  function toggleOverlay(which) {
    const box = which === 'caption' ? el.caption : el.tech;
    const open = box.hidden;
    closeOverlays();
    if (!open) return;
    if (which === 'tech') renderTech();
    box.hidden = false;
    (which === 'caption' ? el.showCaption : el.showTech).setAttribute('aria-pressed', 'true');
    updateZoomBtn();
  }

  function setProgress(label, detail, fraction, activePhase) {
    el.progressLabel.textContent = label;
    el.progressDetail.textContent = detail || '';
    el.bar.classList.toggle('is-indeterminate', fraction == null);
    if (fraction != null) el.barFill.style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%';
    const order = ['research', 'text', 'image', 'done'];
    const idx = order.indexOf(activePhase);
    el.phases.forEach((p) => {
      const i = order.indexOf(p.dataset.phase);
      p.classList.toggle('is-active', i === idx);
      p.classList.toggle('is-done', idx >= 0 && i < idx);
    });
    const phase = (name) => el.phases.find((p) => p.dataset.phase === name);
    phase('text').hidden = !!(job && !job.upsampler);
    phase('research').hidden = !(job && job.showResearch);
  }

  // Share of the progress bar for each phase, depending on which phases run.
  function frac(phase, f) {
    const r = job && job.preparing;
    const up = !job || job.upsampler;
    const start = r ? 0.2 : 0.02;
    const spans = {
      research: [0.02, 0.2],
      text: [start, up ? start + 0.3 : start],
      image: [up ? start + 0.3 : start + 0.03, 0.95],
    };
    const [a, b] = spans[phase];
    return a + (b - a) * Math.max(0, Math.min(1, f));
  }

  // ---------- "Wusstest du?" ----------
  let factTimer = null;
  let factQueues = { ai: [], school: [] };
  let factTurn = 'school';

  function nextFact() {
    factTurn = factTurn === 'ai' ? 'school' : 'ai';
    if (!factQueues[factTurn].length) factQueues[factTurn] = shuffled(window.FACTS[factTurn]);
    return { kind: factTurn, text: factQueues[factTurn].pop() };
  }

  function showFact(animate) {
    const f = nextFact();
    const apply = () => {
      el.factTitle.textContent = 'Wusstest du?';
      el.factText.textContent = f.text;
      el.fact.classList.remove('is-fading');
    };
    if (!animate) return apply();
    el.fact.classList.add('is-fading');
    setTimeout(apply, 400);
  }

  function startFacts() {
    stopFacts();
    showFact(false);
    factTimer = setInterval(() => showFact(true), FACT_MS);
  }
  function stopFacts() {
    clearInterval(factTimer);
    factTimer = null;
  }

  // ---------- Generate ----------
  // variation: true for "Nochmal", the upsampler then writes a new caption, so the picture really changes.
  async function generate(prompt, variation = false) {
    prompt = (prompt || '').trim();
    if (!prompt) {
      showError('Schreib zuerst, was auf dem Bild sein soll, oder tippe auf «Würfeln».');
      return;
    }
    if (!status.comfy) {
      showError('Der Bildgenerator ist gerade nicht erreichbar. Bitte sag jemandem von der TF Bern Bescheid.');
      return;
    }
    showError('');
    el.prompt.blur();
    el.captionText.replaceChildren();
    el.grid.hidden = true;
    el.grid.replaceChildren();

    const adv = settings.allowAdvanced
      ? { steps: advanced.steps, sampler: advanced.sampler, upsampler: advanced.upsampler, seed: advanced.seedMode === 'fixed' && advanced.seed !== '' ? Number(advanced.seed) : null }
      : null;
    job = {
      id: null, prompt, format, count, style, info: null, images: [], selected: 0,
      started: false, done: false, tokens: 0, caption: '',
      upsampler: adv ? adv.upsampler : settings.upsampler,
      showResearch: false, researchQuery: '', research: null, references: [], abort: new AbortController(),
      t: { start: 0, researchStart: 0, researchEnd: 0, textStart: 0, textEnd: 0, imageStart: 0, imageEnd: 0, end: 0 },
    };
    setState('generating');
    showPlaceholder(format);
    setProgress('Auftrag wird gesendet', '', null, null);
    startFacts();

    job.timer = setTimeout(() => failJob('Das hat zu lange gedauert.'), TIMEOUT_MS);
    job.poll = setInterval(pollHistory, 2000);

    const current = job;
    const stillCurrent = () => current === job && !current.done;
    try {
      if (researchWanted() || referenceWanted()) await research(current);
      if (!stillCurrent()) return;
      const facts = current.research ? current.research.facts : null;
      const references = current.references.map((r) => ({ name: r.name, subject: r.subject, transform: r.transform }));
      const data = await postJson('/api/generate', { prompt, format, style, variants: count, advanced: adv, facts, references, variation,
        transform: !!(current.plan && current.plan.transform), clientId });
      if (current !== job || current.done) {
        ignoredIds.add(data.promptId);
        fetch('/api/cancel/' + data.promptId, { method: 'POST' }).catch(() => {});
        return;
      }
      job.id = data.promptId;
      job.info = data.info;
      if (!job.started) setProgress('In der Warteschlange', 'gleich geht es los', null, null);
    } catch (e) {
      if (stillCurrent()) e.blocked ? blockJob(e.message) : failJob(e.message);
    }
  }

  // Ask decides whether the prompt needs knowledge from the web and which Wikipedia article fits.
  // Then web research and the reference photo run at the same time.
  // Any failure just skips that part, the image is made anyway.
  async function research(current) {
    const signal = current.abort.signal;
    current.showResearch = true;
    current.t.researchStart = performance.now();
    setProgress('Die KI prüft, ob sie etwas nachschlagen muss', '', null, 'research');
    let plan = null;
    try {
      plan = await postJson('/api/research/plan', { prompt: current.prompt, reference: referenceMode() }, signal);
    } catch {}
    if (current !== job || current.done) return;
    if (plan && plan.blocked) return blockJob(plan.error);
    current.plan = plan;
    // Up to two named things (e.g. "die Roche-Türme vor dem Eiger"): one search and one photo each.
    const things = (plan && Array.isArray(plan.things)) ? plan.things : [];
    const queries = (plan && plan.queries) || [];
    const wikis = referenceWanted() ? things.filter((t) => t.wiki) : [];
    const doResearch = !!(plan && plan.needed && queries.length && researchWanted());
    const doReference = wikis.length > 0;
    if (!doResearch && !doReference) {
      current.showResearch = false;
      current.t.researchStart = 0;
      return;
    }
    if (doResearch) current.researchQuery = queries.join(' · ');
    current.preparing = true;
    const photo = wikis.length > 1 ? 'Referenzbilder' : 'ein Referenzbild';
    const label = doResearch && doReference ? `Die KI recherchiert im Web und sucht ${photo}`
      : doResearch ? 'Die KI recherchiert im Web' : `Die KI sucht ${photo}`;
    const shown = doResearch ? queries : wikis.map((t) => t.wiki);
    setProgress(label, shown.map((s) => `«${s}»`).join(' und '), null, 'research');

    const tasks = [];
    if (doResearch) {
      tasks.push(postJson('/api/research/run', { prompt: current.prompt, queries }, signal)
        .then((r) => { if (r && r.facts) current.research = r; })
        .catch(() => {}));
    }
    const found = [];
    wikis.forEach((t, i) => {
      tasks.push(postJson('/api/reference', { wiki: t.wiki, subject: t.subject }, signal)
        .then((r) => {
          if (r && r.reference) found[i] = { ...r.reference, subject: t.subject || r.reference.title, transform: !!plan.transform };
        })
        .catch(() => {}));
    });
    await Promise.all(tasks);
    // Keep the order of the plan (most important thing first); two articles may share one photo.
    current.references = found.filter((r, i) => r && found.findIndex((x) => x && x.name === r.name) === i);
    current.t.researchEnd = performance.now();
    if (current !== job || current.done) return;
    if (!current.research && !current.references.length) setProgress('Recherche nicht möglich, es geht ohne weiter', '', frac('research', 1), 'research');
    else renderCaption();
  }

  // Thumbnail of the reference photo, served by ComfyUI from its input folder.
  const referenceUrl = (ref) => '/comfy/view?' + new URLSearchParams({ filename: ref.name, type: 'input' });

  function endJob() {
    if (!job) return;
    job.done = true;
    clearTimeout(job.timer);
    clearInterval(job.poll);
  }

  function failJob(msg) {
    if (!job || job.done) return;
    if (job.id) ignoredIds.add(job.id);
    endJob();
    job = null;
    setState('idle');
    showError(`Das hat leider nicht geklappt: ${msg} Versuch es nochmal oder frag jemanden von der TF Bern.`);
  }

  // Guardrails stopped the wish: back to the start, the wish stays in the field, a friendly hint.
  function blockJob(msg) {
    if (!job || job.done) return;
    endJob();
    job = null;
    setState('idle');
    showError(msg);
  }

  function cancelJob() {
    if (!job || job.done) return;
    const id = job.id;
    if (id) ignoredIds.add(id);
    job.abort.abort();
    endJob();
    job = null;
    setState('idle');
    if (id) fetch('/api/cancel/' + id, { method: 'POST' }).catch(() => {});
  }

  const viewUrl = (img) => '/comfy/view?' + new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'temp' });

  function finishJob(images) {
    if (!job || job.done || !images || !images.length) return;
    endJob();
    const current = job;
    current.t.end = performance.now();
    if (!current.t.imageEnd) current.t.imageEnd = current.t.end;
    current.images = images.map(viewUrl);

    // Load all images before showing them, so nothing pops in.
    Promise.all(current.images.map((src) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = resolve;
      img.onerror = reject;
      img.src = src;
    }))).then(() => {
      if (current !== job) return;
      if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
      setProgress('Fertig', '', 1, 'done');
      showResult();
      bumpActivity();
      postJson('/api/done', { promptId: current.id, prompt: current.prompt })
        .then((d) => updateCounter(d.imagesToday))
        .catch(() => {});
    }).catch(() => {
      current.done = false;
      failJob('Das Bild konnte nicht geladen werden.');
    });
  }

  function showResult() {
    if (job.images.length > 1) {
      el.grid.replaceChildren(...job.images.map((src, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-label', `Bild ${i + 1} gross anzeigen`);
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        const n = document.createElement('span');
        n.textContent = i + 1;
        b.append(img, n);
        b.addEventListener('click', () => showSingle(i));
        return b;
      }));
      showGrid();
    } else {
      setImage(job.images[0]);
      el.grid.hidden = true;
      el.showAll.hidden = true;
    }
    el.showCaption.hidden = !job.caption && !job.research && !job.references.length && !(job.info && job.info.site);
    setState('result');
  }

  function showGrid() {
    el.grid.hidden = false;
    el.showAll.hidden = true;
    closeOverlays();
    updateZoomBtn();
    requestAnimationFrame(fitFrame);
  }

  function showSingle(i) {
    job.selected = i;
    setImage(job.images[i]);
    el.grid.hidden = true;
    el.showAll.hidden = false;
    updateZoomBtn();
    requestAnimationFrame(fitFrame);
  }

  function setCaption(text) {
    if (!text || !job) return;
    job.caption = text;
    renderCaption();
  }

  // "Was hat die KI verstanden?": reference photo and research (if any), then the caption for the image model.
  function renderCaption() {
    const parts = [];
    const para = (text, cls) => {
      const p = document.createElement('p');
      p.textContent = text;
      if (cls) p.className = cls;
      parts.push(p);
    };
    const site = job.info && job.info.site;
    if (site) {
      // Photo of a school site from kiosk/reference (CC BY needs the author and license).
      para('Dieses Foto des Standorts hat die KI als Vorlage angeschaut', 'overlay-sub');
      const fig = document.createElement('figure');
      fig.className = 'ref-figure';
      const img = document.createElement('img');
      img.src = referenceUrl(site);
      img.alt = `Referenzfoto: ${site.title}`;
      const cap = document.createElement('figcaption');
      cap.textContent = `${site.title} · ${site.credit}`;
      fig.append(img, cap);
      parts.push(fig);
    }
    if (job.references.length && !site) {
      para(job.references.length > 1 ? 'Diese Fotos hat die KI als Vorlage angeschaut' : 'Dieses Foto hat die KI als Vorlage angeschaut', 'overlay-sub');
      for (const ref of job.references) {
        const fig = document.createElement('figure');
        fig.className = 'ref-figure';
        const img = document.createElement('img');
        img.src = referenceUrl(ref);
        img.alt = `Referenzfoto: ${ref.title}`;
        const cap = document.createElement('figcaption');
        // CC BY-SA and similar licenses require naming the author and the license.
        cap.textContent = `${ref.title} · Foto: ${ref.artist || 'unbekannt'} · ${ref.license} · Wikimedia Commons`;
        fig.append(img, cap);
        parts.push(fig);
      }
    }
    if (job.research) {
      para('Das hat die KI im Web recherchiert', 'overlay-sub');
      para(`Suche: «${job.researchQuery}»`, 'lang');
      para(job.research.facts);
      const hosts = [...new Set((job.research.sources || []).map((s) => {
        try { return new URL(s.url).hostname.replace(/^www\./, ''); } catch { return ''; }
      }).filter(Boolean))];
      if (hosts.length) para('Quellen: ' + hosts.join(', '), 'lang');
    }
    if (job.caption) {
      if (job.research || job.references.length) para('Daraus wurde diese Bildbeschreibung', 'overlay-sub');
      para(job.caption);
      para('Die Beschreibung ist auf Englisch, weil das Bildmodell Englisch am besten versteht.', 'lang');
    }
    el.captionText.replaceChildren(...parts);
  }

  function renderTech() {
    if (!job || !job.info) return;
    const i = job.info;
    const t = job.t;
    const rows = [];
    const add = (term, value) => rows.push([term, value]);
    add('Bildmodell', i.model);
    add('Text-Encoder', i.textEncoder);
    add('Sprachmodell', i.languageModel || 'aus (Text direkt ans Bildmodell)');
    if (i.site) add('Standort-Foto', `${i.site.title} (${i.site.credit})`);
    if (i.logo) add('Logo-Referenz', 'Logo der Technischen Fachschule Bern');
    if (job.references.length && !i.site) {
      const mode = i.reference && i.reference.mode === 'transform' ? 'frei verwandeln' : 'Aussehen übernehmen, Stil und Pose frei';
      job.references.forEach((ref, n) => {
        add(job.references.length > 1 ? `Referenzbild ${n + 1}` : 'Referenzbild', `${ref.title} (Wikipedia), ${ref.license}, eingelesen mit 0,5 Megapixel, Modus: ${mode}`);
      });
    }
    if (job.researchQuery) {
      add('Recherche', job.research
        ? `${job.research.model || 'ask'}, Websuche «${job.researchQuery}»`
        : `Websuche «${job.researchQuery}» nicht möglich`);
    }
    add('Auflösung', `${i.width} × ${i.height} Pixel` + (i.variants > 1 ? `, ${i.variants} Bilder` : ''));
    add('Schritte', `${i.steps}, Sampler ${i.sampler}`);
    add('Seed', String(i.seed) + (i.variants > 1 ? ` (alle ${i.variants} Bilder in einem Durchgang)` : ''));
    if (job.tokens) add('Textbausteine', `${job.tokens} Tokens geschrieben`);
    const parts = [];
    if (t.researchStart && t.researchEnd) parts.push(`Recherche ${seconds(t.researchEnd - t.researchStart)}`);
    if (i.upsampler && t.textStart && t.textEnd) parts.push(`Beschreibung ${seconds(t.textEnd - t.textStart)}`);
    if (t.imageStart && t.imageEnd) parts.push(`Bild ${seconds(t.imageEnd - t.imageStart)}`);
    const begin = t.researchStart || t.start;
    if (begin && t.end) parts.push(`gesamt ${seconds(t.end - begin)}`);
    if (parts.length) add('Dauer', parts.join(' · '));
    if (status.gpu) add('Grafikkarte', status.gpu.name + (status.gpu.vramTotal ? `, ${Math.round(status.gpu.vramTotal / 2 ** 30)} GB Speicher` : ''));

    el.techList.replaceChildren(...rows.flatMap(([term, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = value;
      if (term === 'Seed' && settings.allowAdvanced) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'link-btn';
        b.textContent = 'Seed übernehmen';
        b.addEventListener('click', () => {
          advanced.seedMode = 'fixed';
          advanced.seed = String(i.seed);
          updateProLink();
          b.textContent = 'Übernommen';
          b.disabled = true;
        });
        dd.append(b);
      }
      return [dt, dd];
    }));
  }

  // Backup if the websocket drops: read the result from the history.
  async function pollHistory() {
    if (!job || !job.id || job.done) return;
    if (ws && ws.readyState === WebSocket.OPEN) return;
    try {
      const h = await (await fetch('/comfy/history/' + job.id)).json();
      const entry = h[job.id];
      if (!entry) return;
      if (entry.status && entry.status.status_str === 'error') return failJob('Fehler beim Erstellen.');
      const cap = entry.outputs[NODE_CAPTION];
      if (cap && cap.text) setCaption(cap.text[0]);
      const out = entry.outputs[NODE_IMAGE];
      if (out && out.images) finishJob(out.images);
    } catch {}
  }

  // ---------- Websocket ----------
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/comfy/ws?clientId=${encodeURIComponent(clientId)}`);
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (e) => (typeof e.data === 'string' ? onMessage(JSON.parse(e.data)) : onBinary(e.data));
    ws.onclose = () => setTimeout(connect, 2000);
  }

  function isOurs(promptId) {
    if (!job || job.done) return false;
    if (job.id) return promptId === job.id;
    return !ignoredIds.has(promptId);
  }

  function onMessage({ type, data }) {
    if (!data || !data.prompt_id || !isOurs(data.prompt_id)) return;
    if (!job.id) job.id = data.prompt_id;
    const now = performance.now();
    const t = job.t;
    // Several images get their own caption chain on the server: node ids 11_1, 7_1, 8_1 ... for image 2 and on.
    const n = job.count > 1 && job.upsampler ? job.count : 1;
    const [node, branch] = String(data.node || '').split('_');
    const idx = branch ? Number(branch) : 0;
    const textLabel = n > 1 ? `Die KI beschreibt Bild ${idx + 1} von ${n}` : 'Die KI schreibt eine Bildbeschreibung';
    const imageLabel = n > 1 ? `Bild ${idx + 1} von ${n} entsteht` : job.count > 1 ? `Die ${job.count} Bilder entstehen` : 'Das Bild entsteht';
    // Progress: one slot per image, each half text, half image.
    const at = (phase, f) => {
      if (n === 1) return frac(phase, f);
      const a0 = frac('text', 0);
      const local = phase === 'text' ? f * 0.5 : 0.5 + f * 0.5;
      return a0 + (0.95 - a0) * ((idx + local) / n);
    };

    switch (type) {
      case 'execution_start':
        job.started = true;
        t.start = now;
        if (job.upsampler) setProgress(textLabel, '', at('text', 0), 'text');
        else setProgress(imageLabel, '', at('image', 0), 'image');
        break;
      case 'executing':
        if (node === NODE_UPSAMPLER) {
          if (idx === 0) t.textStart = now;
          setProgress(textLabel, '', at('text', 0), 'text');
        } else if (node === NODE_ENCODE) {
          if (idx === 0 && t.textStart && !t.textEnd) t.textEnd = now;
        } else if (node === NODE_SAMPLER) {
          if (idx === 0 && t.textStart && !t.textEnd) t.textEnd = now;
          if (idx === 0) t.imageStart = now;
          setProgress(imageLabel, '', at('image', 0), 'image');
        } else if (node === NODE_DECODE) {
          if (idx === n - 1) {
            t.imageEnd = now;
            setProgress(job.count > 1 ? 'Die Bilder werden fertiggestellt' : 'Fast fertig', '', 0.96, 'image');
          }
        }
        break;
      case 'progress':
        if (node === NODE_UPSAMPLER) {
          if (idx === 0) job.tokens = data.value;
          // Captions are usually 200 to 450 tokens.
          setProgress(textLabel, `${data.value} Textbausteine`, at('text', Math.min(data.value / 420, 0.95)), 'text');
        } else if (node === NODE_SAMPLER) {
          setProgress(imageLabel, `Schritt ${data.value} von ${data.max}`, at('image', data.value / data.max), 'image');
        }
        break;
      case 'executed':
        if (data.node === NODE_CAPTION && data.output && data.output.text) setCaption(data.output.text[0]);
        if (data.node === NODE_IMAGE && data.output && data.output.images) finishJob(data.output.images);
        break;
      case 'execution_error':
        console.error(data);
        failJob('Fehler beim Erstellen.');
        break;
      case 'execution_interrupted':
        failJob('Der Auftrag wurde abgebrochen.');
        break;
    }
  }

  // Live preview frames: 4 bytes event type, then the image.
  function onBinary(buf) {
    if (state !== 'generating' || !job || !job.started) return;
    const view = new DataView(buf);
    const event = view.getUint32(0);
    let offset;
    if (event === 1) offset = 8; // [type][format][image]
    else if (event === 4) offset = 8 + view.getUint32(4); // [type][meta length][meta][image]
    else return;
    const bytes = new Uint8Array(buf, offset);
    const isPng = bytes[0] === 0x89;
    const url = URL.createObjectURL(new Blob([bytes], { type: isPng ? 'image/png' : 'image/jpeg' }));
    const old = previewUrl;
    previewUrl = url;
    setImage(url);
    if (old) setTimeout(() => URL.revokeObjectURL(old), 1000);
  }

  // ---------- Status & counter ----------
  function updateCounter(n) {
    status.imagesToday = n;
    el.counter.hidden = !n;
    el.counter.innerHTML = '';
    if (!n) return;
    const strong = document.createElement('strong');
    strong.textContent = n.toLocaleString('de-CH');
    el.counter.append('Heute schon ', strong, n === 1 ? ' Bild erstellt' : ' Bilder erstellt');
  }

  async function refreshStatus() {
    try {
      const s = await (await fetch('/api/status', { cache: 'no-store' })).json();
      const oldDefaults = defaultAdvanced();
      const untouched = !advancedChanged();
      status = s;
      settings = s.settings;
      // Follow new defaults from the staff menu unless the visitor changed them.
      if (untouched || !settings.allowAdvanced) advanced = { ...defaultAdvanced(), seedMode: advanced.seedMode, seed: advanced.seed };
      else if (advanced.steps === oldDefaults.steps) advanced.steps = settings.steps;
    } catch {
      status = { ...status, comfy: false };
    }
    el.offline.hidden = status.comfy;
    el.generate.disabled = state === 'generating' || !status.comfy;
    updateCounter(status.imagesToday || 0);
    applySettings();
    if (!el.admin.hidden) renderAdminStatus();
  }

  // ---------- Screensaver ----------
  let saverOn = false;
  let saverList = [];
  let saverIndex = 0;
  let saverTimer = null;
  let saverFront = el.saverA;

  async function startScreensaver() {
    if (saverOn) return;
    saverOn = true;
    try {
      const { images } = await (await fetch('/api/screensaver', { cache: 'no-store' })).json();
      const visitors = shuffled(images.filter((i) => !i.example));
      const examples = shuffled(images.filter((i) => i.example));
      saverList = [];
      while (visitors.length || examples.length) {
        if (examples.length) saverList.push(examples.pop());
        if (visitors.length) saverList.push(visitors.pop());
      }
    } catch {
      saverList = [];
    }
    if (!saverOn) return;
    if (!saverList.length) { saverOn = false; return; }
    el.prompt.blur();
    el.saver.hidden = false;
    saverIndex = 0;
    showSaverImage(0);
    saverTimer = setInterval(() => showSaverImage(1), SAVER_MS);
  }

  function showSaverImage(step, tries = 0) {
    if (!saverOn || tries >= saverList.length) return;
    saverIndex = (saverIndex + step + saverList.length) % saverList.length;
    const item = saverList[saverIndex];
    const pre = new Image();
    pre.onload = () => {
      if (!saverOn) return;
      const back = saverFront === el.saverA ? el.saverB : el.saverA;
      back.src = item.src;
      back.classList.remove('is-visible');
      void back.offsetWidth;
      back.classList.add('is-visible');
      saverFront.classList.remove('is-visible');
      saverFront = back;
      el.saverPrompt.textContent = item.prompt ? `«${item.prompt}»` : '';
    };
    pre.onerror = () => showSaverImage(1, tries + 1); // e.g. visitor image gone after a ComfyUI restart
    pre.src = item.src;
  }

  function stopScreensaver() {
    if (!saverOn) return;
    saverOn = false;
    clearInterval(saverTimer);
    el.saver.hidden = true;
    el.saverA.classList.remove('is-visible');
    el.saverB.classList.remove('is-visible');
  }

  // ---------- Inactivity ----------
  let lastActivity = Date.now();
  let idleShown = false;

  function bumpActivity() {
    lastActivity = Date.now();
    if (idleShown) {
      idleShown = false;
      el.idle.hidden = true;
    }
  }

  function hasSession() {
    return state === 'result' || el.prompt.value.trim() !== '' || !el.error.hidden || format !== 'square'
      || count !== 1 || style !== null || advancedChanged() || !el.pro.hidden || !el.mail.hidden;
  }

  function resetAll() {
    closeZoom();
    if (job && !job.done) cancelJob();
    job = null;
    el.prompt.value = '';
    el.prompt.blur();
    el.captionText.replaceChildren();
    el.grid.hidden = true;
    el.grid.replaceChildren();
    setFormat('square');
    setCount(1);
    setStyle(null);
    advanced = defaultAdvanced();
    closeModal(el.pro);
    closeModal(el.mail);
    closeModal(el.login);
    onPromptInput();
    renderIdeas();
    setState('idle');
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    el.image.removeAttribute('src');
  }

  setInterval(() => {
    const now = Date.now();
    if (saverOn) return;
    if (state === 'generating' || !el.admin.hidden) {
      lastActivity = now;
      return;
    }
    const idleFor = now - lastActivity;
    if (!hasSession()) {
      if (settings.screensaverSeconds > 0 && idleFor > settings.screensaverSeconds * 1000) startScreensaver();
      return;
    }
    const limit = settings.idleSeconds * 1000;
    if (idleFor < limit) return;
    const left = IDLE_COUNTDOWN - Math.floor((idleFor - limit) / 1000);
    if (left <= 0) {
      el.idle.hidden = true;
      idleShown = false;
      resetAll();
      lastActivity = Date.now();
      return;
    }
    idleShown = true;
    el.idle.hidden = false;
    el.idleCount.textContent = left;
  }, 250);

  // ---------- Modals ----------
  function openModal(m) {
    m.hidden = false;
  }
  function closeModal(m) {
    m.hidden = true;
    if (m === el.mail) clearMail();
    if (m === el.login) clearLogin();
  }

  // Steppers: [data-stepper] with − / + buttons around an <output>.
  function stepperValue(name) {
    return Number(document.querySelector(`[data-stepper="${name}"] output`).textContent);
  }
  function setStepper(name, v) {
    document.querySelector(`[data-stepper="${name}"] output`).textContent = v;
  }
  document.querySelectorAll('[data-stepper]').forEach((s) => {
    s.addEventListener('click', (e) => {
      const b = e.target.closest('[data-step]');
      if (!b) return;
      const min = Number(s.dataset.min);
      const max = Number(s.dataset.max);
      const inc = Number(s.dataset.inc || 1);
      const out = s.querySelector('output');
      const v = Math.min(max, Math.max(min, Number(out.textContent) + Number(b.dataset.step) * inc));
      out.textContent = v;
      s.dispatchEvent(new CustomEvent('change', { detail: v }));
    });
  });

  // Plain segment groups in the modals.
  document.querySelectorAll('.modal .segments').forEach((g) => {
    g.addEventListener('click', (e) => {
      const b = e.target.closest('[role="radio"]');
      if (!b) return;
      g.querySelectorAll('[role="radio"]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      g.dispatchEvent(new CustomEvent('change', { detail: b.dataset.value ?? b.dataset.seedmode }));
    });
  });

  // ---- Visitor advanced settings ----
  function renderPro() {
    setStepper('steps', advanced.steps);
    setChecked(el.seedMode, advanced.seedMode);
    el.seedFixed.hidden = advanced.seedMode !== 'fixed';
    el.proSeed.value = advanced.seed;
    setChecked(el.proSampler, advanced.sampler);
    setChecked(el.proUpsampler, advanced.upsampler);
    setChecked(el.proResearch, advanced.research);
    el.proResearchRow.hidden = !researchAvailable();
    setChecked(el.proReference, advanced.reference);
    el.proReferenceRow.hidden = !referenceAvailable();
  }

  el.proSampler.replaceChildren(...SAMPLERS.map((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.value = s;
    b.textContent = s;
    return b;
  }));
  el.proSampler.addEventListener('click', (e) => {
    const b = e.target.closest('[role="radio"]');
    if (!b) return;
    advanced.sampler = b.dataset.value;
    setChecked(el.proSampler, advanced.sampler);
    updateProLink();
  });

  document.querySelector('[data-stepper="steps"]').addEventListener('change', (e) => { advanced.steps = e.detail; updateProLink(); });
  el.seedMode.addEventListener('change', (e) => {
    advanced.seedMode = e.detail;
    if (advanced.seedMode === 'fixed' && !advanced.seed) advanced.seed = randomSeedValue();
    renderPro();
    updateProLink();
  });
  el.proSeed.addEventListener('input', () => {
    el.proSeed.value = el.proSeed.value.replace(/\D/g, '');
    advanced.seed = el.proSeed.value;
  });
  el.proSeedDice.addEventListener('click', () => { advanced.seed = randomSeedValue(); renderPro(); });
  el.proUpsampler.addEventListener('change', (e) => { advanced.upsampler = e.detail === 'true'; updateProLink(); });
  el.proResearch.addEventListener('change', (e) => { advanced.research = e.detail === 'true'; updateProLink(); });
  el.proReference.addEventListener('change', (e) => { advanced.reference = e.detail; updateProLink(); });
  el.proReset.addEventListener('click', () => { advanced = defaultAdvanced(); renderPro(); updateProLink(); });
  el.openPro.addEventListener('click', () => { renderPro(); openModal(el.pro); });

  // ---- Staff menu ----
  function renderAdminStatus() {
    const rows = [
      ['ComfyUI', status.comfy ? `erreichbar (${status.comfyUrl || ''})` : `NICHT erreichbar (${status.comfyUrl || ''})`, !status.comfy],
      ['Grafikkarte', status.gpu ? `${status.gpu.name}, ${Math.round((status.gpu.vramFree || 0) / 2 ** 30)} von ${Math.round((status.gpu.vramTotal || 0) / 2 ** 30)} GB frei` : '–'],
      ['Warteschlange', status.queue ? `${status.queue.running} läuft, ${status.queue.pending} wartet` : '–'],
      ['Bilder heute', String(status.imagesToday || 0)],
      ['Besucherbilder im Schoner', String(status.recentCount || 0)],
      ['ask (Recherche)', !status.ask || !status.ask.configured
        ? 'nicht eingerichtet (data/ask.json fehlt)'
        : `${status.ask.model}, ${status.ask.ok ? 'erreichbar' : `NICHT erreichbar${status.ask.error ? ` (${status.ask.error})` : ''}`}`, !!(status.ask && status.ask.configured && !status.ask.ok)],
      ['Guardrails', !settings.guardrails || settings.guardrails === 'aus'
        ? 'AUS' : `${settings.guardrails}${status.ask && status.ask.configured ? ', Wortliste + ask' : ', nur Wortliste'}`, settings.guardrails === 'aus'],
      ['Gesperrte Wünsche', String(status.blockedCount || 0)],
      ['Mails heute', !status.mail ? '–' : settings.mail === false ? 'Mailversand AUS'
        : `${status.mail.sent} verschickt, ${status.mail.failed} fehlgeschlagen (${status.mail.host})`, !!(status.mail && status.mail.failed)],
      ...(status.mail && status.mail.lastError ? [['  Letzter Mailfehler', status.mail.lastError, true]] : []),
      ...(status.blocked || []).slice(0, 5).map((b) => [`  ${b.at} (${b.by})`, `${b.category}: «${b.prompt}»`]),
      ['Verbindung Seite', ws && ws.readyState === WebSocket.OPEN ? 'Live-Verbindung steht' : 'Live-Verbindung unterbrochen', !(ws && ws.readyState === WebSocket.OPEN)],
    ];
    el.adminStatus.replaceChildren(...rows.flatMap(([k, v, bad]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      if (bad) dd.className = 'is-bad';
      return [dt, dd];
    }));
  }

  function openAdmin() {
    setStepper('adminSteps', settings.steps);
    setStepper('adminIdle', settings.idleSeconds);
    setStepper('adminSaver', settings.screensaverSeconds);
    setChecked(el.aMaxVariants, settings.maxVariants);
    setChecked(el.aUpsampler, settings.upsampler);
    setChecked(el.aShowRecent, settings.showRecent);
    setChecked(el.aAllowAdvanced, settings.allowAdvanced);
    setChecked(el.aMail, settings.mail !== false);
    setChecked(el.aResearch, settings.research);
    setChecked(el.aReference, settings.reference);
    setChecked(el.aQuality, settings.quality || 'maximal');
    setChecked(el.aGuardrails, settings.guardrails || 'mittel');
    el.adminMsg.textContent = '';
    stopScreensaver();
    renderAdminStatus();
    openModal(el.admin);
    refreshStatus();
  }

  el.adminSave.addEventListener('click', async () => {
    try {
      const data = await postJson('/api/settings', {
        steps: stepperValue('adminSteps'),
        idleSeconds: stepperValue('adminIdle'),
        screensaverSeconds: stepperValue('adminSaver'),
        maxVariants: Number(getChecked(el.aMaxVariants)),
        upsampler: getChecked(el.aUpsampler) === 'true',
        showRecent: getChecked(el.aShowRecent) === 'true',
        allowAdvanced: getChecked(el.aAllowAdvanced) === 'true',
        mail: getChecked(el.aMail) === 'true',
        research: getChecked(el.aResearch) === 'true',
        reference: getChecked(el.aReference) === 'true',
        quality: getChecked(el.aQuality) || 'maximal',
        guardrails: getChecked(el.aGuardrails) || 'mittel',
      });
      const wasDefault = !advancedChanged();
      settings = data.settings;
      if (wasDefault || !settings.allowAdvanced) advanced = defaultAdvanced();
      applySettings();
      el.adminMsg.textContent = 'Gespeichert.';
    } catch (e) {
      el.adminMsg.textContent = 'Speichern fehlgeschlagen: ' + e.message;
    }
  });

  el.admin.querySelectorAll('[data-admin]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await postJson('/api/admin/' + b.dataset.admin);
      el.adminMsg.textContent = 'Erledigt: ' + b.textContent;
      refreshStatus();
    } catch (e) {
      el.adminMsg.textContent = 'Fehlgeschlagen: ' + e.message;
    }
  }));
  el.adminSaver.addEventListener('click', () => { closeModal(el.admin); startScreensaver(); });

  // ---------- Password for the staff menu ----------
  // 5× aufs Logo tippen (innert 3 s) oder Strg+Alt+B. Das Passwort prüft der Server.
  function clearLogin() {
    el.loginPassword.value = '';
    el.loginError.hidden = true;
    el.loginPassword.classList.remove('has-error');
  }
  function openLogin() {
    clearLogin();
    openModal(el.login);
    setTimeout(() => el.loginPassword.focus(), 50);
  }
  let logoTaps = [];
  el.logo.addEventListener('pointerdown', () => {
    const now = Date.now();
    logoTaps = logoTaps.filter((t) => now - t < 3000).concat(now);
    if (logoTaps.length >= 5) {
      logoTaps = [];
      if (el.admin.hidden && el.login.hidden) openLogin();
    }
  });
  el.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (el.loginSend.disabled) return;
    el.loginSend.disabled = true;
    try {
      await postJson('/api/admin-login', { password: el.loginPassword.value });
      closeModal(el.login);
      openAdmin();
    } catch (err) {
      el.loginError.textContent = err.message;
      el.loginError.hidden = false;
      el.loginPassword.classList.add('has-error');
      el.loginPassword.select();
    } finally {
      el.loginSend.disabled = false;
    }
  });
  el.adminReload.addEventListener('click', () => location.reload());

  document.querySelectorAll('.modal [data-close]').forEach((b) => b.addEventListener('click', () => closeModal(b.closest('.modal'))));
  document.querySelectorAll('.modal').forEach((m) => m.addEventListener('pointerdown', (e) => { if (e.target === m) closeModal(m); }));

  // ---------- Image by e-mail ----------
  // The address lives only in the input field: cleared when the dialog closes, after sending and on reset.
  const MAIL_DOMAINS = ['@gmail.com', '@icloud.com', '@outlook.com', '@hotmail.com', '@bluewin.ch', '@gmx.ch'];
  const MAIL_RE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
  let mailPicked = 0;
  let mailBusy = false;

  el.mailDomains.replaceChildren(...MAIL_DOMAINS.map((d) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = d;
    b.addEventListener('click', () => {
      // Replace whatever follows the "@" with the picked domain.
      el.mailTo.value = el.mailTo.value.trim().split('@')[0] + d;
      el.mailTo.focus();
      onMailInput();
    });
    return b;
  }));

  function clearMail() {
    el.mailTo.value = '';
    el.mailTo.blur();
    el.mailError.hidden = true;
    el.mailTo.classList.remove('has-error');
    el.mailDone.hidden = true;
    mailBusy = false;
    el.mailSend.disabled = false;
    el.mailSend.textContent = 'Senden';
  }

  function onMailInput() {
    el.mailError.hidden = true;
    el.mailTo.classList.remove('has-error');
    el.mailDone.hidden = true;
  }

  function pickMailImage(i) {
    mailPicked = i;
    el.mailPick.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-checked', String(j === i)));
  }

  function openMail() {
    if (state !== 'result' || !job || !job.images.length || settings.mail === false) return;
    closeZoom();
    clearMail();
    const many = job.images.length > 1;
    el.mailPickRow.hidden = !many;
    el.mailSingle.hidden = many;
    if (many) {
      el.mailPick.replaceChildren(...job.images.map((src, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-label', `Bild ${i + 1}`);
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        const n = document.createElement('span');
        n.textContent = i + 1;
        b.append(img, n);
        b.addEventListener('click', () => pickMailImage(i));
        return b;
      }));
      // Grid on screen: let the visitor choose. One image enlarged: that one.
      pickMailImage(el.grid.hidden ? job.selected || 0 : 0);
    } else {
      el.mailSingleImg.src = job.images[0];
      mailPicked = 0;
    }
    openModal(el.mail);
  }

  async function sendMail() {
    if (mailBusy || !job) return;
    const email = el.mailTo.value.trim();
    if (!MAIL_RE.test(email)) {
      el.mailError.textContent = email ? 'Diese Mail-Adresse sieht nicht richtig aus. Bitte prüf sie nochmal.' : 'Bitte gib deine Mail-Adresse ein.';
      el.mailError.hidden = false;
      el.mailTo.classList.add('has-error');
      el.mailTo.focus();
      return;
    }
    mailBusy = true;
    el.mailSend.disabled = true;
    el.mailSend.textContent = 'Wird gesendet …';
    el.mailError.hidden = true;
    el.mailDone.hidden = true;
    try {
      await postJson('/api/mail', { promptId: job.id, index: mailPicked, email, prompt: job.prompt });
      el.mailDoneText.textContent = `Dein Bild ist an ${email} verschickt. Falls es nicht ankommt, schau im Spam-Ordner nach.`;
      el.mailDone.hidden = false;
      el.mailDone.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      el.mailTo.value = '';
      el.mailTo.blur();
      refreshStatus();
    } catch (e) {
      el.mailError.textContent = e.message;
      el.mailError.hidden = false;
      el.mailError.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } finally {
      mailBusy = false;
      el.mailSend.disabled = false;
      el.mailSend.textContent = 'Senden';
    }
  }

  el.openMail.addEventListener('click', openMail);
  el.mailSend.addEventListener('click', sendMail);
  el.mailTo.addEventListener('input', onMailInput);
  el.mailTo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendMail(); } });

  // ---------- Zoom ----------
  // Full screen view of the result: two fingers to zoom, one finger to move, double tap or +/- to zoom.
  const zoom = { scale: 1, fit: 1, x: 0, y: 0, w: 0, h: 0 };
  const pointers = new Map(); // pointerId -> [x, y] inside the stage
  let pinch = null;           // { dist, scale, mx, my } at the start of a two-finger gesture
  let lastTap = 0;
  let lastTapPos = null;
  let moved = false;

  function updateZoomBtn() {
    el.zoomBtn.hidden = !(state === 'result' && el.grid.hidden && el.caption.hidden && el.tech.hidden);
  }

  function openZoom() {
    if (state !== 'result' || !el.grid.hidden || !el.image.src) return;
    el.zoomImg.onload = () => {
      zoom.w = el.zoomImg.naturalWidth;
      zoom.h = el.zoomImg.naturalHeight;
      fitZoom(false);
    };
    el.zoom.hidden = false;
    el.zoomImg.src = el.image.src;
    if (el.zoomImg.complete && el.zoomImg.naturalWidth) el.zoomImg.onload();
  }

  function closeZoom() {
    el.zoom.hidden = true;
    pointers.clear();
    pinch = null;
  }

  const stageRect = () => el.zoomStage.getBoundingClientRect();
  const maxScale = () => Math.max(zoom.fit * 6, 3);

  function applyZoom(animate) {
    const r = stageRect();
    const sw = zoom.w * zoom.scale;
    const sh = zoom.h * zoom.scale;
    // Keep the picture on screen: centred while smaller than the screen, edges never pulled inwards.
    zoom.x = sw <= r.width ? (r.width - sw) / 2 : Math.min(0, Math.max(r.width - sw, zoom.x));
    zoom.y = sh <= r.height ? (r.height - sh) / 2 : Math.min(0, Math.max(r.height - sh, zoom.y));
    el.zoomImg.classList.toggle('is-animated', !!animate);
    el.zoomImg.style.width = zoom.w + 'px';
    el.zoomImg.style.height = zoom.h + 'px';
    el.zoomImg.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
  }

  function fitZoom(animate) {
    if (!zoom.w) return;
    const r = stageRect();
    zoom.fit = Math.min(r.width / zoom.w, r.height / zoom.h);
    zoom.scale = zoom.fit;
    applyZoom(animate);
  }

  // New scale, keeping the stage point (px, py) under the finger or cursor.
  function zoomAt(newScale, px, py, animate) {
    const s = Math.min(maxScale(), Math.max(zoom.fit, newScale));
    zoom.x = px - ((px - zoom.x) * s) / zoom.scale;
    zoom.y = py - ((py - zoom.y) * s) / zoom.scale;
    zoom.scale = s;
    applyZoom(animate);
  }

  function zoomCenter(factor) {
    const r = stageRect();
    zoomAt(zoom.scale * factor, r.width / 2, r.height / 2, true);
  }

  function stagePoint(e) {
    const r = stageRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  el.zoomStage.addEventListener('pointerdown', (e) => {
    try { el.zoomStage.setPointerCapture(e.pointerId); } catch {}
    pointers.set(e.pointerId, stagePoint(e));
    moved = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, scale: zoom.scale, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 };
    }
    el.zoomStage.classList.add('is-dragging');
  });

  el.zoomStage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    const cur = stagePoint(e);
    pointers.set(e.pointerId, cur);
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      // Move with the midpoint of both fingers, scale with their distance.
      zoom.x += mx - pinch.mx;
      zoom.y += my - pinch.my;
      pinch.mx = mx;
      pinch.my = my;
      zoomAt((pinch.scale * Math.hypot(a[0] - b[0], a[1] - b[1])) / pinch.dist, mx, my, false);
      moved = true;
    } else if (pointers.size === 1) {
      const dx = cur[0] - prev[0];
      const dy = cur[1] - prev[1];
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      zoom.x += dx;
      zoom.y += dy;
      applyZoom(false);
    }
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    const pos = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) el.zoomStage.classList.remove('is-dragging');
    if (e.type !== 'pointerup' || moved || pointers.size) return;
    // Double tap: zoom in at that point, or back to the whole picture.
    const now = Date.now();
    if (now - lastTap < 350 && lastTapPos && Math.hypot(pos[0] - lastTapPos[0], pos[1] - lastTapPos[1]) < 40) {
      if (zoom.scale > zoom.fit * 1.05) fitZoom(true);
      else zoomAt(zoom.fit * 2.5, pos[0], pos[1], true);
      lastTap = 0;
    } else {
      lastTap = now;
      lastTapPos = pos;
    }
  }
  el.zoomStage.addEventListener('pointerup', endPointer);
  el.zoomStage.addEventListener('pointercancel', endPointer);
  el.zoomStage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [px, py] = stagePoint(e);
    zoomAt(zoom.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), px, py, false);
  }, { passive: false });
  window.addEventListener('resize', () => { if (!el.zoom.hidden) fitZoom(false); });

  el.image.addEventListener('click', openZoom);
  el.zoomBtn.addEventListener('click', openZoom);
  el.zoomIn.addEventListener('click', () => zoomCenter(1.6));
  el.zoomOut.addEventListener('click', () => zoomCenter(1 / 1.6));
  el.zoomFit.addEventListener('click', () => fitZoom(true));
  el.zoomClose.addEventListener('click', closeZoom);

  // ---------- Events ----------
  ['pointerdown', 'keydown', 'input', 'wheel'].forEach((t) => document.addEventListener(t, bumpActivity, { capture: true, passive: true }));
  el.idle.addEventListener('pointerdown', (e) => { e.preventDefault(); bumpActivity(); });
  el.saver.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    stopScreensaver();
    bumpActivity();
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('keydown', (e) => {
    // e.code statt nur e.key: Unter Linux liefert Chromium bei Strg+Alt das AltGr-Zeichen («”» statt «b»).
    if (e.ctrlKey && e.altKey && (e.code === 'KeyB' || e.key.toLowerCase() === 'b')) {
      e.preventDefault();
      if (el.admin.hidden) openLogin();
      else closeModal(el.admin);
      return;
    }
    if (e.key === 'Escape') {
      if (saverOn) stopScreensaver();
      closeZoom();
      document.querySelectorAll('.modal').forEach(closeModal);
    }
  });

  el.prompt.addEventListener('input', () => { markPicked(null); onPromptInput(); });
  el.prompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (state !== 'generating') generate(el.prompt.value);
    }
  });
  el.clear.addEventListener('click', () => { el.prompt.value = ''; el.prompt.focus(); onPromptInput(); });
  el.shuffle.addEventListener('click', renderIdeas);
  el.dice.addEventListener('click', rollDice);
  el.formats.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setFormat(b.dataset.format)));
  el.counts.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setCount(Number(b.dataset.count))));
  el.generate.addEventListener('click', () => generate(el.prompt.value));
  el.cancel.addEventListener('click', cancelJob);
  el.again.addEventListener('click', () => generate(job ? job.prompt : el.prompt.value, true));
  el.showAll.addEventListener('click', showGrid);
  el.showCaption.addEventListener('click', () => toggleOverlay('caption'));
  el.showTech.addEventListener('click', () => toggleOverlay('tech'));
  el.restart.addEventListener('click', resetAll);
  window.addEventListener('resize', () => {
    fitFrame();
    // Screen height changed enough for a different number of ideas (e.g. browser went full screen).
    if (state !== 'generating' && el.ideas.children.length !== ideaCount()) renderIdeas();
  });

  // ---------- Start ----------
  renderStyles();
  renderIdeas();
  setState('idle');
  connect();
  refreshStatus();
  setInterval(refreshStatus, STATUS_MS);
})();
