// Studio: musicians linked if they performed on the same song (features/collaborations),
// or were members of the same band. Data: Wikidata (songs/singles with 2+ performers, band membership).
import { shortDesc, sparql, writeHubCourse } from './lib.mjs';

const Q = (x) => /^Q\d+$/.test(x);
const songRows = (await sparql(`SELECT DISTINCT ?song ?p WHERE {
  VALUES ?t { wd:Q134556 wd:Q7366 wd:Q105543609 wd:Q207628 }
  ?song wdt:P31 ?t; wdt:P175 ?p. ?song wdt:P175 ?p2. FILTER(?p != ?p2)
}`, 'wd-studio-songs.json')).filter((r) => Q(r.song) && Q(r.p));
const performers = [...new Set(songRows.map((r) => r.p))];
const songIds = [...new Set(songRows.map((r) => r.song))];
console.log(`  ${songIds.length} collaborative songs, ${performers.length} performers`);

// Band membership for any performer (either direction of the relation).
const memberRows = [];
for (let i = 0; i < performers.length; i += 1500) {
  const vals = performers.slice(i, i + 1500).map((q) => 'wd:' + q).join(' ');
  const rows = await sparql(`SELECT DISTINCT ?band ?m WHERE {
    VALUES ?x { ${vals} }
    { ?x wdt:P527 ?m. ?m wdt:P31 wd:Q5. BIND(?x AS ?band) } UNION { ?x wdt:P463 ?band. ?band wdt:P31/wdt:P279* wd:Q215380. BIND(?x AS ?m) }
  }`, `wd-studio-members-${i}.json`);
  memberRows.push(...rows.filter((r) => Q(r.band) && Q(r.m)));
}
console.log(`  ${memberRows.length} band memberships`);

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
      ${withYear ? '' : 'OPTIONAL { ?x schema:description ?desc FILTER(LANG(?desc) = "en") }'}
      ?x wikibase:sitelinks ?links.
      ${withYear ? 'OPTIONAL { ?x wdt:P577 ?d }' : ''}
    } ${withYear ? 'GROUP BY ?x ?label ?desc ?links' : ''}`, `${name}-${i}.json`);
    for (const r of rows) out[r.x] = r;
  }
  return out;
}
const people = [...new Set(performers.concat(memberRows.flatMap((r) => [r.band, r.m])))];
const artists = await labels(people, 'wd-studio-artists', false);
const songs = await labels(songIds, 'wd-studio-songlabels', true);

// Soften slurs in song titles shown as link reasons.
const clean = (t) => t.replace(/nigg(a|er)/gi, (m) => m[0] + '****');
const items = new Map();
const item = (q) => {
  const a = artists[q];
  if (!a) return null;
  if (!items.has(q)) items.set(q, { label: a.label, fame: +a.links, hint: shortDesc(a.desc), hubs: [] });
  return items.get(q);
};
for (const { song, p } of songRows) {
  const s = songs[song];
  const it = s && item(p);
  if (it) it.hubs.push(clean(s.y ? `“${s.label}” (${s.y})` : `“${s.label}”`));
}
for (const { band, m } of memberRows) {
  const b = artists[band];
  if (!b) continue;
  const hub = `${b.label} (band)`;
  item(m)?.hubs.push(hub);
  item(band)?.hubs.push(hub);
}
writeHubCourse('studio', [...items.values()], {
  pool: (it) => it.fame >= 70 && it.hubs.length >= 4,
  poolSize: 400,
  meta: { source: 'Wikidata (songs with multiple performers, band membership)' },
});
