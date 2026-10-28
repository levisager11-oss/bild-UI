(() => {
  'use strict';

  // ---------- Settings ----------
  const IDLE_MS = 60_000;       // inactivity before the "still there?" prompt
  const IDLE_COUNTDOWN = 10;    // seconds shown in the prompt before reset
  const ideaCount = () => (window.innerHeight < 1000 ? 4 : 6); // fewer ideas on lower screens
  const TIMEOUT_MS = 180_000;   // give up on a job after this long
  const FORMATS = {
    square: [1024, 1024],
    portrait: [832, 1216],
    landscape: [1216, 832],
  };
  // Node ids in workflow.json
  const NODE_UPSAMPLER = '11';
  const NODE_SAMPLER = '7';
  const NODE_DECODE = '8';
  const NODE_IMAGE = '9';
  const NODE_CAPTION = '13';

  // ---------- Elements ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    prompt: $('prompt'), field: $('field'), clear: $('clear'), error: $('error'),
    ideas: $('ideas'), shuffle: $('shuffle'), generate: $('generate'),
    stage: $('stage'), intro: $('intro'), canvas: $('canvas'), frame: $('frame'), image: $('image'),
    caption: $('caption'), captionText: $('captionText'),
    progress: $('progress'), progressLabel: $('progressLabel'), progressDetail: $('progressDetail'),
    bar: document.querySelector('.bar'), barFill: $('barFill'), cancel: $('cancel'),
    actions: $('actions'), again: $('again'), showCaption: $('showCaption'), restart: $('restart'),
    idle: $('idle'), idleCount: $('idleCount'),
    formatButtons: [...document.querySelectorAll('[data-format]')],
    phases: [...document.querySelectorAll('[data-phase]')],
  };

  const clientId = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);

  let state = 'idle';           // idle | generating | result
  let format = 'square';
  let job = null;               // { id, prompt, format, started, timer, poll, done }
  let ignoredIds = new Set();   // cancelled jobs
  let previewUrl = null;
  let ws = null;

  // ---------- Ideas ----------
  function renderIdeas() {
    const pool = [...window.PROMPT_IDEAS];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    el.ideas.replaceChildren(...pool.slice(0, ideaCount()).map((text) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'idea';
      b.textContent = text;
      b.addEventListener('click', () => {
        el.prompt.value = text;
        el.ideas.querySelectorAll('.idea').forEach((x) => x.classList.toggle('is-picked', x === b));
        onPromptInput();
      });
      return b;
    }));
  }

  // ---------- Input ----------
  function onPromptInput() {
    el.clear.hidden = !el.prompt.value;
    showError('');
  }

  function showError(msg) {
    el.error.textContent = msg;
    el.error.hidden = !msg;
    el.field.classList.toggle('has-error', !!msg);
  }

  function setFormat(key) {
    format = key;
    el.formatButtons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.format === key)));
  }

  // ---------- Stage ----------
  function setState(next) {
    state = next;
    el.stage.dataset.state = next;
    el.intro.hidden = next !== 'idle';
    el.canvas.hidden = next === 'idle';
    el.progress.hidden = next !== 'generating';
    el.actions.hidden = next !== 'result';
    el.generate.disabled = next === 'generating';
    el.prompt.readOnly = next === 'generating';
    el.formatButtons.forEach((b) => (b.disabled = next === 'generating'));
    if (next !== 'result') hideCaption();
    el.showCaption.hidden = !el.captionText.textContent;
    requestAnimationFrame(fitImage);
  }

  // Size the image box to the chosen format inside the free stage area.
  function fitImage() {
    if (el.canvas.hidden) return;
    const [w, h] = FORMATS[(job && job.format) || format];
    const box = el.canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const scale = Math.min(box.width / w, box.height / h);
    el.frame.style.width = Math.floor(w * scale) + 'px';
    el.frame.style.height = Math.floor(h * scale) + 'px';
  }

  function showPlaceholder(fmt) {
    const [w, h] = FORMATS[fmt];
    setImage(`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#80C1DA"/></svg>`)}`, 'is-preview');
  }

  function setImage(src, cls) {
    el.image.src = src;
    el.image.className = cls || '';
  }

  function hideCaption() {
    el.caption.hidden = true;
    el.showCaption.setAttribute('aria-pressed', 'false');
  }

  function setProgress(label, detail, fraction, activePhase) {
    el.progressLabel.textContent = label;
    el.progressDetail.textContent = detail || '';
    el.bar.classList.toggle('is-indeterminate', fraction == null);
    if (fraction != null) el.barFill.style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%';
    const order = ['text', 'image', 'done'];
    const idx = order.indexOf(activePhase);
    el.phases.forEach((p) => {
      const i = order.indexOf(p.dataset.phase);
      p.classList.toggle('is-active', i === idx);
      p.classList.toggle('is-done', idx >= 0 && i < idx);
    });
  }

  // ---------- Generate ----------
  async function generate(prompt) {
    prompt = (prompt || '').trim();
    if (!prompt) {
      showError('Schreib zuerst, was auf dem Bild sein soll.');
      return;
    }
    showError('');
    el.prompt.blur();
    el.captionText.textContent = '';

    job = { id: null, prompt, format, started: false, done: false };
    setState('generating');
    showPlaceholder(format);
    setProgress('Auftrag wird gesendet', '', null, null);

    job.timer = setTimeout(() => failJob('Das hat zu lange gedauert.'), TIMEOUT_MS);
    job.poll = setInterval(pollHistory, 2000);

    try {
      const r = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, format, clientId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Unbekannter Fehler');
      if (job && !job.done) {
        job.id = data.promptId;
        if (!job.started) setProgress('In der Warteschlange', 'gleich geht es los', null, null);
      }
    } catch (e) {
      failJob(e.message);
    }
  }

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
    showError(`Das hat leider nicht geklappt: ${msg} Versuch es nochmal oder frag beim Stand nach.`);
  }

  async function cancelJob() {
    if (!job) return;
    const id = job.id;
    if (id) ignoredIds.add(id);
    endJob();
    job = null;
    setState('idle');
    if (id) fetch('/api/cancel/' + id, { method: 'POST' }).catch(() => {});
  }

  function finishJob(imageInfo) {
    if (!job || job.done) return;
    endJob();
    const q = new URLSearchParams({ filename: imageInfo.filename, subfolder: imageInfo.subfolder || '', type: imageInfo.type || 'temp' });
    const img = new Image();
    img.onload = () => {
      setImage(img.src, '');
      if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
      setProgress('Fertig', '', 1, 'done');
      setState('result');
      bumpActivity();
    };
    img.onerror = () => { job.done = false; failJob('Das Bild konnte nicht geladen werden.'); };
    img.src = '/comfy/view?' + q;
  }

  function setCaption(text) {
    if (!text) return;
    el.captionText.textContent = text;
    const note = document.createElement('span');
    note.className = 'lang';
    note.textContent = 'Die Beschreibung ist auf Englisch, weil das Bildmodell Englisch am besten versteht.';
    el.captionText.append(note);
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
      if (out && out.images && out.images[0]) finishJob(out.images[0]);
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

    switch (type) {
      case 'execution_start':
        job.started = true;
        setProgress('Die KI schreibt eine Bildbeschreibung', '', 0.02, 'text');
        break;
      case 'executing':
        if (data.node === NODE_UPSAMPLER) setProgress('Die KI schreibt eine Bildbeschreibung', '', 0.02, 'text');
        else if (data.node === NODE_SAMPLER) setProgress('Das Bild entsteht', '', 0.4, 'image');
        else if (data.node === NODE_DECODE) setProgress('Das Bild wird fertiggestellt', '', 0.96, 'image');
        break;
      case 'progress':
        if (data.node === NODE_UPSAMPLER) {
          // Token count; captions are usually 200 to 450 tokens.
          setProgress('Die KI schreibt eine Bildbeschreibung', `${data.value} Textbausteine`, Math.min(data.value / 420, 0.95) * 0.38 + 0.02, 'text');
        } else if (data.node === NODE_SAMPLER) {
          setProgress('Das Bild entsteht', `Schritt ${data.value} von ${data.max}`, 0.4 + 0.55 * (data.value / data.max), 'image');
        }
        break;
      case 'executed':
        if (data.node === NODE_CAPTION && data.output && data.output.text) setCaption(data.output.text[0]);
        if (data.node === NODE_IMAGE && data.output && data.output.images) finishJob(data.output.images[0]);
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
    setImage(url, 'is-preview');
    if (old) setTimeout(() => URL.revokeObjectURL(old), 1000);
  }

  // ---------- Inactivity reset ----------
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
    return state === 'result' || el.prompt.value.trim() !== '' || !el.error.hidden || format !== 'square';
  }

  function resetAll() {
    if (job) cancelJob();
    el.prompt.value = '';
    el.prompt.blur();
    el.captionText.textContent = '';
    setFormat('square');
    onPromptInput();
    renderIdeas();
    setState('idle');
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    el.image.removeAttribute('src');
  }

  setInterval(() => {
    if (state === 'generating' || !hasSession()) {
      lastActivity = Date.now();
      return;
    }
    const idleFor = Date.now() - lastActivity;
    if (idleFor < IDLE_MS) return;
    const left = IDLE_COUNTDOWN - Math.floor((idleFor - IDLE_MS) / 1000);
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

  // ---------- Events ----------
  ['pointerdown', 'keydown', 'input', 'wheel'].forEach((t) => document.addEventListener(t, bumpActivity, { capture: true, passive: true }));
  el.idle.addEventListener('pointerdown', (e) => { e.preventDefault(); bumpActivity(); });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  el.prompt.addEventListener('input', () => {
    el.ideas.querySelectorAll('.is-picked').forEach((x) => x.classList.remove('is-picked'));
    onPromptInput();
  });
  el.prompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (state !== 'generating') generate(el.prompt.value);
    }
  });
  el.clear.addEventListener('click', () => { el.prompt.value = ''; el.prompt.focus(); onPromptInput(); });
  el.shuffle.addEventListener('click', renderIdeas);
  el.formatButtons.forEach((b) => b.addEventListener('click', () => setFormat(b.dataset.format)));
  el.generate.addEventListener('click', () => generate(el.prompt.value));
  el.cancel.addEventListener('click', cancelJob);
  el.again.addEventListener('click', () => generate(job ? job.prompt : el.prompt.value));
  el.restart.addEventListener('click', resetAll);
  el.showCaption.addEventListener('click', () => {
    const open = el.caption.hidden;
    el.caption.hidden = !open;
    el.showCaption.setAttribute('aria-pressed', String(open));
  });
  window.addEventListener('resize', fitImage);

  // ---------- Start ----------
  renderIdeas();
  setState('idle');
  connect();
})();
