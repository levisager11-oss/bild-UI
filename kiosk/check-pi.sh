#!/usr/bin/env bash
# Prüft auf dem Pi, warum ask oder ComfyUI nicht erreichbar sind. Aufruf: bash check-pi.sh
cd "$(dirname "$(readlink -f "$0")")" || exit 1
NODE=node; [ -x ./node/bin/node ] && NODE=./node/bin/node
[ -f ask-ca.pem ] && export NODE_EXTRA_CA_CERTS="$PWD/ask-ca.pem"

echo "== Uhrzeit (muss stimmen, sonst scheitert HTTPS)"
date
timedatectl 2>/dev/null | grep -E "synchronized|NTP service"
echo
echo "== Node.js: $("$NODE" -v)"
echo
"$NODE" - <<'EOF'
const fs = require('fs');
let url = process.env.ASK_URL || '';
try { url = url || JSON.parse(fs.readFileSync('data/ask.json', 'utf8')).url || ''; } catch {}
if (!url) console.log('ask: data/ask.json fehlt oder hat keine url');
const comfy = process.env.COMFY_URL || 'http://192.168.60.37:8188';
const test = async (name, u) => {
  const host = new URL(u).hostname;
  try {
    const a = await require('dns').promises.lookup(host, { all: true });
    console.log(`${name}: DNS ${host} -> ${a.map((x) => x.address).join(', ')}`);
  } catch (e) { return console.log(`${name}: DNS-Fehler ${e.code}`); }
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
    console.log(`${name}: OK, Antwort HTTP ${r.status} (401 heisst: erreichbar, nur ohne Schlüssel)`);
  } catch (e) {
    console.log(`${name}: FEHLER ${(e.cause && (e.cause.code || e.cause.message)) || e.name || e.message}`);
  }
};
(async () => {
  if (url) await test('ask', url.replace(/\/+$/, '') + '/models');
  await test('ComfyUI', comfy + '/system_stats');
})();
EOF
