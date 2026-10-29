// Checks ask's planning step against expected answers (no GPU needed).
//   node tests/plan-check.js [http://127.0.0.1:8090]
// e: expected. needed = research/reference useful, wikis = substrings the article titles should contain
// ([] = no article; more articles than listed are wrong unless max allows them), person, transform.
const base = process.argv[2] || 'http://127.0.0.1:8090';
const CASES = [
  ['Eine Katze mit Schweisshelm', { needed: false, wikis: [] }],
  ['Ein Roboter repariert ein Velo', { needed: false, wikis: [] }],
  ['Eine Stadt der Zukunft mit Seilbahnen', { needed: false, wikis: [] }],
  ['Ein Drache aus Zahnrädern', { needed: false, wikis: [] }],
  ['Einhorn mit Regenbogen', { needed: false, wikis: [] }],
  ['Ein Pinguin als Koch', { needed: false, wikis: [] }],
  ['Hund', { needed: false, wikis: [] }],
  ['Wie Musik aussehen würde', { needed: false, wikis: [] }],
  ['Ein Astronaut grilliert auf dem Mond', { needed: false, wikis: [] }],
  ['Eine Bibliothek in einem Baum', { needed: false, wikis: [] }],
  ['Der Zytglogge im Winter', { needed: true, wikis: ['Zytglogge'], transform: false }],
  ['Der Zytglogge als Raumschiff', { needed: true, wikis: ['Zytglogge'], transform: true }],
  ['Das Bundeshaus bei Nacht', { needed: true, wikis: ['Bundeshaus'], transform: false }],
  ['Das Matterhorn als Vulkan', { needed: true, wikis: ['Matterhorn'], transform: true }],
  ['Der Eiffelturm aus Schokolade', { needed: true, wikis: ['Eiffelturm'], transform: true }],
  ['Die Kapellbrücke in Luzern', { needed: true, wikis: ['Kapellbrücke'], transform: false }],
  ['Ein Bartgeier über dem Gletscher', { needed: true, wikis: ['Bartgeier'], transform: false }],
  ['Ein Steinbock auf einem Felsen', { needed: true, wikis: ['Steinbock'], transform: false }],
  ['Ein Axolotl im Aquarium', { needed: true, wikis: ['Axolotl'], transform: false }],
  ['Eine SBB Re 460 in den Alpen', { needed: true, wikis: ['Re 460'], transform: false }],
  ['Ein Tesla Cybertruck im Schnee', { needed: true, wikis: ['Cybertruck'], transform: false }],
  ['Eine Vespa vor einem Café', { needed: true, wikis: ['Vespa'], transform: false }],
  ['Die Mona Lisa als Roboter', { needed: true, wikis: ['Mona Lisa'], transform: true }],
  ['Das Schloss Chillon im Nebel', { needed: true, wikis: ['Chillon'], transform: false }],
  ['Der Berner Bärenpark', { needed: true, wikis: ['Bär'], transform: false }],
  ['Ein Schweizer Taschenmesser als Raumschiff', { needed: true, wikis: ['Taschenmesser'], transform: true }],
  ['Die Aare in Bern im Sommer mit Schwimmern', { needed: true, wikis: ['Aare'], transform: false }],
  ['Ein Glacier Express auf dem Landwasserviadukt', { needed: true, wikis: ['viadukt'], max: 2, transform: false }],
  ['Das Matterhorn im Comic-Stil', { needed: true, wikis: ['Matterhorn'], transform: false }],
  ['Die Golden Gate Bridge aus Lego', { needed: true, wikis: ['Golden Gate'], transform: true }],
  ['Roger Federer spielt Tennis auf dem Mond', { person: true }],
  ['Albert Einstein an einer Wandtafel', { person: true }],
  ['Taylor Swift als Comicfigur', { person: true }],
  ['Der Bundesrat beim Fondue', { person: true }],
  ['e chatz uf em velo dür bärn', { needed: false, wikis: [] }],
  ['un ours qui fait du ski', { needed: false, wikis: [] }],
  ['the Colosseum in Rome at sunset', { needed: true, wikis: ['Kolosseum'], transform: false }],
  ['Ein Murmeltier vor seinem Bau', { needed: true, wikis: ['Murmeltier'], transform: false }],
  ['Eine Leiterplatte, die wie eine Stadt aussieht', { needed: false, wikis: [] }],
  ['Ein Fuchs mit Schutzbrille an einer Drehbank', { needed: false, wikis: [] }],
  // Two named things: both need a search and a photo.
  ['Die Roche-Türme vor dem Eiger in den Schweizer Alpen', { needed: true, wikis: ['Roche', 'Eiger'], transform: false }],
  ['Der Zytglogge vor dem Matterhorn', { needed: true, wikis: ['Zytglogge', 'Matterhorn'], transform: false }],
  ['Ein Steinbock auf der Kapellbrücke', { needed: true, wikis: ['Steinbock', 'Kapellbrücke'], transform: false }],
  ['Der Eiffelturm neben dem Bundeshaus', { needed: true, wikis: ['Eiffelturm', 'Bundeshaus'], transform: false }],
  ['Eine SBB Re 460 fährt über die Golden Gate Bridge', { needed: true, wikis: ['460', 'Golden Gate'], transform: false }],
  ['Ein Bartgeier fliegt über das Matterhorn', { needed: true, wikis: ['Bartgeier', 'Matterhorn'], transform: false }],
  ['Die Kapellbrücke aus Lego vor dem Pilatus', { needed: true, wikis: ['Kapellbrücke', 'Pilatus'], transform: true }],
  // One named thing in a setting: no second photo for the city or region.
  ['Der Zytglogge in Bern im Winter', { needed: true, wikis: ['Zytglogge'], transform: false }],
  ['Ein Steinbock in den Schweizer Alpen', { needed: true, wikis: ['Steinbock'], transform: false }],
  ['Eine Vespa fährt durch Rom', { needed: true, wikis: ['Vespa'], transform: false }],
];

(async () => {
  let ok = 0;
  const rows = [];
  for (const [prompt, e] of CASES) {
    const t0 = Date.now();
    const r = await (await fetch(base + '/api/research/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) })).json();
    const ms = Date.now() - t0;
    const problems = [];
    const wikis = (r.things || []).map((t) => t.wiki).filter(Boolean);
    if (e.person) {
      if (!r.person) problems.push('Person nicht erkannt');
      if (wikis.length) problems.push('Foto trotz Person');
      if (r.needed) problems.push('Recherche trotz Person');
    } else {
      if (e.needed !== undefined && !!r.needed !== e.needed) problems.push(`needed=${r.needed}`);
      for (const w of e.wikis || []) {
        if (!wikis.some((x) => x.toLowerCase().includes(w.toLowerCase()))) problems.push(`kein Artikel ~«${w}»`);
      }
      if (e.wikis && wikis.length > (e.max || e.wikis.length)) problems.push(`zu viele Artikel`);
      if (e.transform !== undefined && wikis.length && !!r.transform !== e.transform) problems.push(`transform=${r.transform}`);
    }
    if (!problems.length) ok++;
    rows.push(`${problems.length ? 'FALSCH' : 'ok    '} ${String(ms).padStart(5)} ms  ${prompt}  →  wiki=«${wikis.join(' + ')}» queries=«${(r.queries || []).join(' + ')}» needed=${r.needed} person=${r.person} transform=${r.transform}${problems.length ? '  [' + problems.join('; ') + ']' : ''}`);
  }
  console.log(rows.join('\n'));
  console.log(`\n${ok}/${CASES.length} richtig`);
})().catch((e) => console.log('Fehler', e.message));
