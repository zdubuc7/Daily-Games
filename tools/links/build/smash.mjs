// Smash: video game characters linked if they appeared together in the same (non-crossover) game.
// Data: Wikidata (game "characters" P674 + character "present in work" P1441).
import { readSource, sparql, writeHubCourse } from './lib.mjs';

const banned = readSource('smash-banned.txt').split('\n').map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#'));

const rawLinks = await sparql(`SELECT DISTINCT ?game ?c WHERE {
  { ?game wdt:P31 wd:Q7889; wdt:P674 ?c. } UNION { ?c wdt:P1441 ?game. ?game wdt:P31 wd:Q7889. }
}`, 'wd-smash-links.json');
const links = rawLinks.filter((r) => /^Q\d+$/.test(r.game) && /^Q\d+$/.test(r.c));
const gameIds = [...new Set(links.map((r) => r.game))];
const charIds = [...new Set(links.map((r) => r.c))];
console.log(`  ${links.length} appearances, ${gameIds.length} games, ${charIds.length} characters`);

async function labels(ids, name, withYear) {
  name += '-v2';
  const out = {};
  for (let i = 0; i < ids.length; i += 2000) {
    const vals = ids.slice(i, i + 2000).map((q) => 'wd:' + q).join(' ');
    const rows = await sparql(`SELECT ?x ?label ?desc ?links ${withYear ? '(MIN(YEAR(?d)) AS ?y)' : ''} WHERE {
      VALUES ?x { ${vals} }
      OPTIONAL { ?x rdfs:label ?en FILTER(LANG(?en) = "en") }
      OPTIONAL { ?x rdfs:label ?mul FILTER(LANG(?mul) = "mul") }
      BIND(COALESCE(?en, ?mul) AS ?label) FILTER(BOUND(?label))
      OPTIONAL { ?x schema:description ?desc FILTER(LANG(?desc) = "en") }
      ?x wikibase:sitelinks ?links.
      ${withYear ? 'OPTIONAL { ?x wdt:P577 ?d }' : ''}
    } ${withYear ? 'GROUP BY ?x ?label ?desc ?links' : ''}`, `${name}-${i}.json`);
    for (const r of rows) out[r.x] = r;
  }
  return out;
}
// Keep only fictional characters (drops historical people, landmarks, etc. that appear "in" games).
const fictional = new Set();
for (let i = 0; i < charIds.length; i += 2000) {
  const vals = charIds.slice(i, i + 2000).map((q) => 'wd:' + q).join(' ');
  const rows = await sparql(`SELECT DISTINCT ?x WHERE { VALUES ?x { ${vals} } ?x wdt:P31/wdt:P279* wd:Q95074. }`, `wd-smash-fictional-${i}.json`);
  for (const r of rows) fictional.add(r.x);
}
console.log(`  ${fictional.size} fictional characters`);
const MAX_ROSTER = 120; // gacha / monster-collecting rosters make meaningless mega-hubs
const gameSize = {};
for (const { game, c } of links) if (fictional.has(c)) gameSize[game] = (gameSize[game] || 0) + 1;
const games = await labels(gameIds, 'wd-smash-games', true);
const chars = await labels(charIds, 'wd-smash-chars', false);

const isBanned = (title) => banned.some((b) => title.toLowerCase().startsWith(b));
const items = new Map();
for (const { game, c } of links) {
  const g = games[game], ch = chars[c];
  if (!g || !ch || !fictional.has(c) || gameSize[game] > MAX_ROSTER || isBanned(g.label)) continue;
  if (!items.has(c)) {
    items.set(c, { label: ch.label, fame: +ch.links, hubs: [], years: [] });
  }
  items.get(c).hubs.push(g.y ? `${g.label} (${g.y})` : g.label);
  items.get(c).years.push([+g.y || 9999, g.label]);
}
// Hint for same-name characters: their earliest game ("Link (The Legend of Zelda)").
const list = [...items.values()].map((it) => ({ ...it, hint: it.years.sort((a, b) => a[0] - b[0])[0][1].slice(0, 32) }));
writeHubCourse('smash', list, {
  pool: (it) => it.fame >= 15 && it.hubs.length >= 2,
  poolSize: 300,
  meta: { source: 'Wikidata (video game characters)' },
});
