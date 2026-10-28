// Checks ask's planning step against expected answers (no GPU needed).
//   node tests/plan-check.js [http://127.0.0.1:8090]
// e: expected. needed = research/reference useful, wiki = substring the article title should contain
// ('' = no article), person, transform.
const base = process.argv[2] || 'http://127.0.0.1:8090';
const CASES = [
  ['Eine Katze mit Schweisshelm', { needed: false, wiki: '' }],
  ['Ein Roboter repariert ein Velo', { needed: false, wiki: '' }],
  ['Eine Stadt der Zukunft mit Seilbahnen', { needed: false, wiki: '' }],
  ['Ein Drache aus Zahnrädern', { needed: false, wiki: '' }],
  ['Einhorn mit Regenbogen', { needed: false, wiki: '' }],
  ['Ein Pinguin als Koch', { needed: false, wiki: '' }],
  ['Hund', { needed: false, wiki: '' }],
  ['Wie Musik aussehen würde', { needed: false, wiki: '' }],
  ['Ein Astronaut grilliert auf dem Mond', { needed: false, wiki: '' }],
  ['Eine Bibliothek in einem Baum', { needed: false, wiki: '' }],
  ['Der Zytglogge im Winter', { needed: true, wiki: 'Zytglogge', transform: false }],
  ['Der Zytglogge als Raumschiff', { needed: true, wiki: 'Zytglogge', transform: true }],
  ['Das Bundeshaus bei Nacht', { needed: true, wiki: 'Bundeshaus', transform: false }],
  ['Das Matterhorn als Vulkan', { needed: true, wiki: 'Matterhorn', transform: true }],
  ['Der Eiffelturm aus Schokolade', { needed: true, wiki: 'Eiffelturm', transform: true }],
  ['Die Kapellbrücke in Luzern', { needed: true, wiki: 'Kapellbrücke', transform: false }],
  ['Ein Bartgeier über dem Gletscher', { needed: true, wiki: 'Bartgeier', transform: false }],
  ['Ein Steinbock auf einem Felsen', { needed: true, wiki: 'Steinbock', transform: false }],
  ['Ein Axolotl im Aquarium', { needed: true, wiki: 'Axolotl', transform: false }],
  ['Eine SBB Re 460 in den Alpen', { needed: true, wiki: 'Re 460', transform: false }],
  ['Ein Tesla Cybertruck im Schnee', { needed: true, wiki: 'Cybertruck', transform: false }],
  ['Eine Vespa vor einem Café', { needed: true, wiki: 'Vespa', transform: false }],
  ['Die Mona Lisa als Roboter', { needed: true, wiki: 'Mona Lisa', transform: true }],
  ['Das Schloss Chillon im Nebel', { needed: true, wiki: 'Chillon', transform: false }],
  ['Der Berner Bärenpark', { needed: true, wiki: 'Bär', transform: false }],
  ['Ein Schweizer Taschenmesser als Raumschiff', { needed: true, wiki: 'Taschenmesser', transform: true }],
  ['Die Aare in Bern im Sommer mit Schwimmern', { needed: true, wiki: 'Aare', transform: false }],
  ['Ein Glacier Express auf dem Landwasserviadukt', { needed: true, wiki: 'viadukt', transform: false }],
  ['Das Matterhorn im Comic-Stil', { needed: true, wiki: 'Matterhorn', transform: false }],
  ['Die Golden Gate Bridge aus Lego', { needed: true, wiki: 'Golden Gate', transform: true }],
  ['Roger Federer spielt Tennis auf dem Mond', { person: true }],
  ['Albert Einstein an einer Wandtafel', { person: true }],
  ['Taylor Swift als Comicfigur', { person: true }],
  ['Der Bundesrat beim Fondue', { person: true }],
  ['e chatz uf em velo dür bärn', { needed: false, wiki: '' }],
  ['un ours qui fait du ski', { needed: false, wiki: '' }],
  ['the Colosseum in Rome at sunset', { needed: true, wiki: 'Kolosseum', transform: false }],
  ['Ein Murmeltier vor seinem Bau', { needed: true, wiki: 'Murmeltier', transform: false }],
  ['Eine Leiterplatte, die wie eine Stadt aussieht', { needed: false, wiki: '' }],
  ['Ein Fuchs mit Schutzbrille an einer Drehbank', { needed: false, wiki: '' }],
];

(async () => {
  let ok = 0;
  const rows = [];
  for (const [prompt, e] of CASES) {
    const t0 = Date.now();
    const r = await (await fetch(base + '/api/research/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) })).json();
    const ms = Date.now() - t0;
    const problems = [];
    if (e.person) {
      if (!r.person) problems.push('Person nicht erkannt');
      if (r.wiki) problems.push('Foto trotz Person');
      if (r.needed) problems.push('Recherche trotz Person');
    } else {
      if (e.needed !== undefined && !!r.needed !== e.needed && !(e.needed === false && !r.needed)) problems.push(`needed=${r.needed}`);
      if (e.wiki === '' && r.wiki) problems.push(`unnötiger Artikel «${r.wiki}»`);
      if (e.wiki && !(r.wiki || '').toLowerCase().includes(e.wiki.toLowerCase())) problems.push(`Artikel «${r.wiki}» statt ~«${e.wiki}»`);
      if (e.transform !== undefined && r.wiki && !!r.transform !== e.transform) problems.push(`transform=${r.transform}`);
    }
    if (!problems.length) ok++;
    rows.push(`${problems.length ? 'FALSCH' : 'ok    '} ${String(ms).padStart(5)} ms  ${prompt}  →  wiki=«${r.wiki || ''}» needed=${r.needed} person=${r.person} transform=${r.transform}${problems.length ? '  [' + problems.join('; ') + ']' : ''}`);
  }
  console.log(rows.join('\n'));
  console.log(`\n${ok}/${CASES.length} richtig`);
})().catch((e) => console.log('Fehler', e.message));
