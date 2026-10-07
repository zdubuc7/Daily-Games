// Compound: two words are linked if they form a compound word / common two-word term (either order).
// Source: Wiktionary "English compound terms" (all subcategories), split into two common words.
// Host rulings live in sources/compound-extra.txt (added) and sources/compound-reject.txt (removed).
import fs from 'node:fs';
import path from 'node:path';
import { CACHE, fetchJSON, fetchText, readSource, sleep, writeHubCourse } from './lib.mjs';
import { commonWords, isPoolWord, loadPoolFilter } from './words.mjs';

await loadPoolFilter();

async function categoryMembers(cat, seen = new Set()) {
  if (seen.has(cat)) return [];
  seen.add(cat);
  let titles = [], cont = '';
  do {
    const url = `https://en.wiktionary.org/w/api.php?action=query&list=categorymembers&cmtitle=${encodeURIComponent(cat)}&cmlimit=500&cmtype=page|subcat&format=json${cont ? '&cmcontinue=' + encodeURIComponent(cont) : ''}`;
    const j = await fetchJSON(url);
    for (const m of j.query.categorymembers) {
      if (m.ns === 14) titles = titles.concat(await categoryMembers(m.title, seen));
      else if (m.ns === 0) titles.push(m.title);
    }
    cont = j.continue?.cmcontinue || '';
    await sleep(1000);
  } while (cont);
  return titles;
}

const cacheFile = path.join(CACHE, 'wiktionary-compounds.json');
let terms;
if (fs.existsSync(cacheFile) && (Date.now() - fs.statSync(cacheFile).mtimeMs) / 36e5 < 24 * 6) terms = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
else {
  terms = [...new Set(await categoryMembers('Category:English compound terms'))];
  fs.writeFileSync(cacheFile, JSON.stringify(terms));
}
// Capitalized titles are proper nouns (Hollywood, Armstrong) — skip them.
terms = terms.filter((t) => t === t.toLowerCase());
console.log(`  ${terms.length} lowercase Wiktionary compound terms`);

const lines = (f) => readSource(f).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const extra = lines('compound-extra.txt');
const reject = new Set(lines('compound-reject.txt').map((l) => l.toLowerCase()));

const common = await commonWords();
// Closed compounds must themselves be common (appear in the 50k frequency list); open ones need two common halves.
const freq50k = new Set((await fetchText('https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt', 'en_50k.txt')).split('\n').map((l) => l.split(' ')[0]));
const extraSet = new Set(extra.map((t) => t.toLowerCase()));
const rank = new Map(common.map((w, i) => [w, i]));
const ok = (w) => rank.has(w);

// Open / hyphenated terms ("fire truck") must have an English Wikipedia article or redirect,
// which filters out Wiktionary oddities like "heart rat".
const wpFile = path.join(CACHE, 'wikipedia-titles.json');
const wp = fs.existsSync(wpFile) ? JSON.parse(fs.readFileSync(wpFile, 'utf8')) : {};
async function onWikipedia(titles) {
  const todo = [...new Set(titles)].filter((t) => !(t in wp));
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50);
    const j = await fetchJSON('https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&titles=' + encodeURIComponent(batch.join('|')));
    const norm = Object.fromEntries((j.query.normalized || []).map((n) => [n.to, n.from]));
    for (const t of batch) wp[t] = false;
    for (const pg of Object.values(j.query.pages || {})) if (!('missing' in pg) && !('invalid' in pg)) {
      // map back through redirects/normalization to the asked title
      let title = pg.title;
      for (const r of j.query.redirects || []) if (r.to === title && batch.includes(norm[r.from] || r.from)) wp[norm[r.from] || r.from] = true;
      if (batch.includes(norm[title] || title)) wp[norm[title] || title] = true;
    }
    await sleep(300);
  }
  fs.writeFileSync(wpFile, JSON.stringify(wp));
}
const openTerms = terms.concat(extra).map((t) => t.toLowerCase()).filter((t) => /^[a-z]+[ -][a-z]+$/.test(t) && !extraSet.has(t)).filter((t) => {
  const [a, b] = t.split(/[ -]/);
  return rank.get(a) < 6000 && rank.get(b) < 6000;
});
await onWikipedia(openTerms);
console.log(`  ${openTerms.filter((t) => wp[t]).length} of ${openTerms.length} open compounds have a Wikipedia page`);

const pairs = new Map(); // "a|b" -> label
function add(label, a, b) {
  if (!ok(a) || !ok(b) || a === b || reject.has(label.toLowerCase())) return;
  const key = [a, b].sort().join('|');
  if (!pairs.has(key)) pairs.set(key, { label, a, b });
}
for (const raw of terms.concat(extra)) {
  const t = raw.toLowerCase();
  if (!/^[a-z][a-z -]*[a-z]$/.test(t)) continue;
  const parts = t.split(/[ -]/);
  const host = extraSet.has(t);
  if (parts.length === 2) {
    if (host || wp[t]) add(t, parts[0], parts[1]);
    continue;
  }
  if (parts.length > 1) continue;
  if (!host && !freq50k.has(t)) continue;
  // Closed compound: pick the split whose rarer half is most common.
  let best = null;
  for (let i = 3; i <= t.length - 3; i++) {
    const a = t.slice(0, i), b = t.slice(i);
    if (!ok(a) || !ok(b)) continue;
    const score = Math.max(rank.get(a), rank.get(b));
    if (!best || score < best.score) best = { a, b, score };
  }
  if (best) add(t, best.a, best.b);
}

const items = new Map();
const item = (w) => {
  if (!items.has(w)) items.set(w, { label: w, fame: -rank.get(w), hubs: [] });
  return items.get(w);
};
for (const { label, a, b } of pairs.values()) { item(a).hubs.push(label); item(b).hubs.push(label); }
for (const it of items.values()) it.rankOk = isPoolWord(rank.get(it.label), it.label) && it.hubs.length >= 3;
writeHubCourse('compound', [...items.values()], { pool: (it) => it.rankOk, poolSize: 1500, meta: { source: 'Wiktionary "English compound terms" + host list' } });
