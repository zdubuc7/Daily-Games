// Rhyme Line: links alternate rhyme / alliteration, using CMU Pronouncing Dictionary sounds.
// Rhyme = identical sounds from the last stressed vowel onward. Alliteration = same first sound.
import { fetchText, writeCourse } from './lib.mjs';
import { commonWords, isPoolWord, loadPoolFilter } from './words.mjs';

await loadPoolFilter();

const cmu = await fetchText('https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict', 'cmudict.dict');
const pron = new Map();
for (const line of cmu.split('\n')) {
  const m = line.match(/^([a-z']+)\s+(.+?)(\s+#.*)?$/);
  if (!m || pron.has(m[1])) continue; // first pronunciation only
  pron.set(m[1], m[2].split(' '));
}

function rhymeKey(ph) {
  let idx = -1;
  for (const stress of ['1', '2', '0']) {
    for (let i = ph.length - 1; i >= 0; i--) if (ph[i].endsWith(stress)) { idx = i; break; }
    if (idx >= 0) break;
  }
  if (idx < 0) return null;
  return ph.slice(idx).map((p) => p.replace(/\d/, '')).join(' ');
}

const words = [], rk = [], fp = [];
const rIdx = new Map(), fIdx = new Map(), rkeys = [], fkeys = [];
const id = (map, arr, k) => { if (!map.has(k)) { map.set(k, arr.length); arr.push(k); } return map.get(k); };
for (const w of await commonWords()) {
  const ph = pron.get(w);
  if (!ph || w.length < 2) continue;
  const r = rhymeKey(ph);
  if (!r) continue;
  words.push(w);
  rk.push(id(rIdx, rkeys, r));
  fp.push(id(fIdx, fkeys, ph[0].replace(/\d/, '')));
}
const pool = words.map((w, i) => (isPoolWord(i, w) ? i : -1)).filter((i) => i >= 0);
writeCourse({ id: 'rhyme', kind: 'rhyme', nodes: words, rkeys, fkeys, rk, fp, pool, meta: { source: 'CMU Pronouncing Dictionary + OpenSubtitles frequency list' } });
