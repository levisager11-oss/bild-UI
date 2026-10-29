// Guardrails: checks a visitor's wish before an image is made. Level set in the staff menu:
// aus | locker | mittel | streng.
// Two steps: a word list (instant, works offline) and, if ask is set up, a short check by the language model,
// which also catches what the list misses (other languages, paraphrases, mocking real people).

const LEVELS = ['aus', 'locker', 'mittel', 'streng'];
const rank = (level) => Math.max(0, LEVELS.indexOf(level));

// Text in lower case, umlauts kept, common letter tricks undone ("n4ckt", "p0rn", "s e x").
function normalize(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[​-‍﻿­]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[0134@$5!]/g, (c) => ({ 0: 'o', 1: 'i', 3: 'e', 4: 'a', '@': 'a', $: 's', 5: 's', '!': 'i' })[c])
    // single letters with spaces or dots in between ("s e x", "n.a.c.k.t") joined up
    .replace(/\b(?:[a-zäöü][\s._*-]){2,}[a-zäöü]\b/g, (m) => m.replace(/[\s._*-]/g, ''));
}

// [lowest level that uses the rule, category shown to the visitor, pattern on the normalized text].
// \b at the start keeps "gleiche" from matching "leiche"; compound words with the bad word in front still match.
// Exceptions for harmless words: Nacktschnecke, Nacktmull, Killerwal, Taschenmesser, Blutorange, Wettkampf.
const RULES = [
  ['locker', 'Sexuelles', /porn|nackt(?!schneck|mull|katze)|\bnude|\bnaked(?! mole)|nudit|hentai|\bsex\b|sexuell|sexual|erotik|erotisch|\berotic|nsfw|\bpenis|vagina|onlyfans/],
  ['locker', 'Gewalt', /blutbad|blutüberströmt|blutverschmiert|\bgore\b|\bgory|enthaupt|decapitat|zerstückel|dismember|eingeweide|gedärm|\bfolter|torture|vergewaltig|\brape\b|\braped|amoklauf|school ?shooting|selbstmordattentat|suicide bomb/],
  ['locker', 'Selbstverletzung', /selbstmord|suizid|suicid|\bsuicide|\britzen\b|self.?harm|\berhäng|hang(ed|ing|s)? (him|her|my|them|your)sel|\bnoose/],
  ['locker', 'Extremismus', /nazi|hitler|hakenkreuz|swastika|\bkkk\b|ku ?klux|sieg heil|white power|reichskriegsflagge|\bss[- ](offizier|soldat|uniform|rune)|dschihad|jihad|\bisis\b|\btaliban/],
  ['locker', 'Beleidigung', /\bneger|nigg|schwuchtel|\bkanake|\bfaggot/],

  ['mittel', 'Sexuelles', /\bsexy|\bdessous|lingerie|reizwäsche|unterwäsche|stripper|striptease|\bbusen|oben ohne|topless|\bboobs?\b|\bhorny|fetisch|fetish|bondage|\bfick/],
  ['mittel', 'Gewalt', /\bblutig|\bbloody\b|\bguts\b|\bleiche|\bcorpse|dead bod(y|ies)|\btote[nr]?\b|massaker|massacre|\bkill(?!erwal|er whale)|\btöte|\bgetötet|ermord|\bmord\b|mörder|\bmurder|erschiess|erschoss|erstech|erstoch|abschlacht|\bslaughter|\bamok|schiesst auf|shoot(s|ing)? (at|him|her|them|people|someone)|\bterror|bombenanschlag|anschlag auf|hinrichtung|misshandl|\babuse|tierquäl|\bgalgen/],
  ['mittel', 'Drogen', /kokain|cocaine|\bkoks\b|heroin|crystal ?meth|\bmeth\b|ecstasy|\bmdma|\blsd\b|\bkiffen|\bkifft|cannabis|marihuana|marijuana|\bweed\b|\bdrogen|\bdrugs?\b|\bbong\b/],
  ['mittel', 'Beleidigung', /\bhure|\bnutte|fotze|wichser|hurensohn|arschloch|\bbitch|\bslut|\bwhore|\bfuck|\bspast|\bretard|missgeburt|\bschlampe/],

  ['streng', 'Waffen und Kampf', /waffe(?!l)|pistole|gewehr|revolver|\bgun|\brifle|schwert|\bsword|\bknife|\bknives|(?<!taschen|sack)messer|kanone|\bbombe|granate|\bkrieg|\bwar\b|schlacht(?!er)|\bbattle|(?<!wett)kampf|\bkämpf|\bfight|\bpr[üu]gel|\bschiess|\bshoot/],
  ['streng', 'Grusel', /zombie|skelett|skeleton|horror|grusel|\bscary|dämon|\bdemon|teufel|\bdevil|vampir|untot|\bundead|\bblut(?!orange|mond|buche)|\bblood|\btot\b|\bdead\b/],
];

function checkWords(prompt, level) {
  const r = rank(level);
  if (!r) return { ok: true };
  const text = normalize(prompt);
  for (const [min, category, re] of RULES) {
    if (rank(min) > r) continue;
    const m = text.match(re);
    if (m) return { ok: false, category, match: m[0].trim(), by: 'Wortliste' };
  }
  return { ok: true };
}

// What is not OK / still OK per level, for the language model.
const NOT_OK = {
  locker: [
    'nudity, sexual or pornographic content',
    'gore: blood baths, torture, mutilation, rape, school shootings, terror attacks',
    'suicide or self-harm',
    'Nazi, extremist or hate symbols and groups, racist slurs',
    'a real, recognisable person (celebrity, politician, teacher, classmate, any named private person) shown naked, sexual or degraded',
  ],
  mittel: [
    'nudity, sexual or suggestive content, underwear',
    'gore, blood, corpses, torture, realistic violence against people or animals, weapons aimed at people, war crimes, terror, school shootings',
    'suicide or self-harm, drugs, alcohol or smoking by children',
    'extremist or hate symbols and groups, racism, insults, slurs',
    'a real, recognisable person (celebrity, politician, teacher, classmate, any named private person) shown in an embarrassing, mocking, degrading, sexual, violent or criminal way',
    'harassment of a named person, or anything that would clearly upset a 12-year-old',
  ],
  streng: [
    'nudity, sexual or suggestive content, underwear, swimwear close-ups, kissing',
    'any weapon (also swords, guns, cannons, toy-like ones), any fight, battle or war, any violence, also in cartoon style',
    'anything scary or creepy: horror, zombies, skeletons, demons, vampires, blood, death',
    'suicide or self-harm, drugs, alcohol, smoking',
    'extremist or hate symbols and groups, racism, insults, slurs, politics and political figures',
    'any real, named person (celebrity, politician, teacher, classmate)',
    'anything a cautious parent of a 10-year-old would not want on the big screen',
  ],
};
const STILL_OK = {
  locker: 'Everything else is OK, also action-movie or cartoon violence, monsters, horror without gore, crude jokes and swear words.',
  mittel: `OK (be generous, this is for fun and creativity):
- fantasy and adventure: knights with swords, dragons, pirates, friendly monsters, robots, aliens, dinosaurs, space battles, superheroes
- mild spooky things: a haunted house, a ghost, a skeleton pirate, Halloween
- animals hunting in nature, cartoon slapstick, sports
- real people or famous people in a normal, respectful scene (e.g. Roger Federer playing tennis)`,
  streng: 'OK: peaceful, friendly and cheerful pictures: animals, nature, cities, vehicles, food, space, robots, fantasy creatures that are cute and not threatening, sports without contact.',
};
const CATEGORIES = ['Sexuelles', 'Gewalt', 'Waffen und Kampf', 'Grusel', 'Selbstverletzung', 'Drogen', 'Extremismus', 'Beleidigung', 'Blossstellung', 'Personen', 'Anderes'];

function moderationPrompt(level) {
  return `You check wishes typed into an image generator at a public school open day. Visitors include children, parents and teachers; the pictures are shown on a big screen.
The wish may be in German, Swiss German dialect, French, English or with typos. Judge what the picture would show, not single words. Decide if it is OK to draw it.
NOT OK:
${NOT_OK[level].map((s) => '- ' + s).join('\n')}
${STILL_OK[level]}
Reply with JSON only: {"ok": true} or {"ok": false, "category": one of ${CATEGORIES.map((c) => `"${c}"`).join(', ')}}`;
}

module.exports = { LEVELS, normalize, checkWords, moderationPrompt, CATEGORIES };
