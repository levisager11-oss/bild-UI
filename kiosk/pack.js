// Baut ein eigenständiges Kiosk-Paket: dist/Kiosk/ und dist/Kiosk.zip.
// Enthält node.exe, damit auf dem Kiosk-PC nichts installiert werden muss.
// Aufruf: node pack.js
// Für den Raspberry Pi: node pack.js --pi  → dist/Kiosk-Pi.zip, ohne node.exe
// (Node.js und Chromium installiert dort install-pi.sh).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PI = process.argv.includes('--pi');
const SRC = __dirname;
const DIST = path.join(SRC, 'dist');
const OUT = path.join(DIST, 'Kiosk');
const ZIP_NAME = PI ? 'Kiosk-Pi.zip' : 'Kiosk.zip';
const ZIP = path.join(DIST, ZIP_NAME);

const FILES = ['server.js', 'guardrails.js', 'mail.js', 'workflow.json', 'system_prompt.txt', 'system_prompt_edit.txt', 'start-kiosk.bat', 'start-kiosk.sh', 'install-pi.sh', 'ask.example.json', 'ask-ca.pem', 'README.md'];
const DIRS = ['public', 'reference'];
// Betreuer-Einstellungen und ask-Zugang mitnehmen, den Bildzähler nicht.
const DATA_FILES = ['ask.json', 'settings.json'];

if (!PI && process.platform !== 'win32') {
  console.error('Das Windows-Paket (mit node.exe) nur unter Windows bauen. Für den Pi: node pack.js --pi');
  process.exit(1);
}

// Nur den Inhalt löschen, nicht die Ordner selbst: Ist dist\Kiosk gerade im Explorer
// oder in einem Terminal offen, lässt Windows den Ordner nicht löschen (EBUSY).
fs.mkdirSync(OUT, { recursive: true });
try {
  for (const e of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, e), { recursive: true, force: true });
  fs.rmSync(ZIP, { force: true });
} catch (err) {
  if (err.code !== 'EBUSY' && err.code !== 'EPERM') throw err;
  console.error(`Kann ${err.path} nicht löschen, er ist noch offen (Explorer, Terminal oder ZIP-Programm).`);
  console.error('Bitte schliessen und node pack.js nochmals starten.');
  process.exit(1);
}
fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });

for (const f of FILES) {
  const from = path.join(SRC, f);
  // Shell-Skripte immer mit Linux-Zeilenenden, auch wenn Git sie unter Windows mit CRLF auscheckt.
  if (f.endsWith('.sh')) fs.writeFileSync(path.join(OUT, f), fs.readFileSync(from, 'utf8').replace(/\r\n/g, '\n'), { mode: 0o755 });
  else fs.copyFileSync(from, path.join(OUT, f));
}
for (const d of DIRS) fs.cpSync(path.join(SRC, d), path.join(OUT, d), { recursive: true });
for (const f of DATA_FILES) {
  const from = path.join(SRC, 'data', f);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(OUT, 'data', f));
  else console.log(`Hinweis: data/${f} fehlt, wird nicht mitgenommen.`);
}

// Das Node, das gerade läuft, ist eine einzelne Datei ohne weitere Abhängigkeiten.
// Nur im Windows-Paket: Der Pi braucht Node für ARM, das installiert install-pi.sh.
if (!PI) {
  fs.mkdirSync(path.join(OUT, 'node'), { recursive: true });
  fs.copyFileSync(process.execPath, path.join(OUT, 'node', 'node.exe'));
  fs.writeFileSync(path.join(OUT, 'node', 'VERSION.txt'), `Node.js ${process.version} (MIT-Lizenz, https://nodejs.org)\n`);
}

if (process.platform === 'win32') {
  // Windows bringt tar mit, das auch ZIP schreiben kann.
  // Fest das tar von Windows nehmen (das von Git-Bash kann kein ZIP).
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(tar, ['-a', '-c', '-f', ZIP_NAME, 'Kiosk'], { cwd: DIST, stdio: 'inherit' });
} else {
  execFileSync('zip', ['-qr', ZIP_NAME, 'Kiosk'], { cwd: DIST, stdio: 'inherit' });
}

const mb = (fs.statSync(ZIP).size / 1e6).toFixed(0);
console.log(PI ? `Fertig: ${ZIP} (${mb} MB) für den Raspberry Pi` : `Fertig: ${ZIP} (${mb} MB), Node ${process.version}`);
if (DATA_FILES.includes('ask.json') && fs.existsSync(path.join(OUT, 'data', 'ask.json'))) {
  console.log('Achtung: Das Paket enthält den ask-Schlüssel (data/ask.json). Nicht weitergeben.');
}
