// Generates The Links daily puzzles (3 holes per day) into site/links/puzzles/YYYY-MM-DD.json.
//
//   node tools/links/generate.mjs              # fill today .. today+DAYS_AHEAD (never touches existing days)
//   node tools/links/generate.mjs --days 60    # look further ahead
//   node tools/links/generate.mjs --revalidate # re-check future days against fresh data, regenerate broken ones
//   node tools/links/generate.mjs --date 2026-10-07 --force   # regenerate one day
//
// Day -> course pool follows the build doc's weekly rotation; each pool cycles its courses in order.
// Host overrides: tools/links/overrides.json, e.g.
//   { "2026-10-12": ["borders", "ladder", "smash"],
//     "2026-10-13": [{ "course": "states", "tee": "Maine", "pin": "Florida", "ob": ["Tennessee"] }, "pokedex", "smash"] }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Course, generateHole } from '../../site/links/engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'site/links/data');
const OUT = path.join(ROOT, 'site/links/puzzles');
const OVERRIDES = path.join(ROOT, 'tools/links/overrides.json');
export const EPOCH = '2026-10-07'; // puzzle #1 (launch day)
const DAYS_AHEAD = 21;
const REPEAT_WINDOW = 45; // days before a tee/pin can be reused on the same course

const POOLS = {
  gridiron: ['gridiron'],
  screen: ['hollywood', 'primetime', 'cinematic'],
  words: ['compound', 'ladder', 'rhyme'],
  places: ['borders', 'states'],
  studio: ['studio'],
  games: ['pokedex', 'smash'],
};
// Sunday=0 ... Saturday=6
const WEEK = ['words', 'gridiron', 'screen', 'words', 'places', 'studio', 'games'];
// Shortest-chain range (in strokes) a puzzle must have. Gridiron may run shorter.
const RANGE = { default: [2, 3], gridiron: [2, 3] };

// ---- dates ----------------------------------------------------------------
export function easternToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const addDays = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dayDiff = (a, b) => Math.round((new Date(a + 'T12:00:00Z') - new Date(b + 'T12:00:00Z')) / 864e5);
const weekday = (d) => new Date(d + 'T12:00:00Z').getUTCDay();

// ---- seeded RNG -----------------------------------------------------------
function hash(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) {
  let a = hash(seed);
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---- courses ----------------------------------------------------------------
const loaded = new Map();
function course(id) {
  if (!loaded.has(id)) {
    const data = JSON.parse(fs.readFileSync(path.join(DATA, id + '.json'), 'utf8'));
    loaded.set(id, new Course(data));
  }
  return loaded.get(id);
}

function overrideFor(date) {
  if (!fs.existsSync(OVERRIDES)) return null;
  return JSON.parse(fs.readFileSync(OVERRIDES, 'utf8'))[date] || null;
}

export function coursesFor(date) {
  const override = overrideFor(date);
  if (override) return override;
  const poolName = WEEK[weekday(date)];
  const pool = POOLS[poolName];
  // k = how many earlier days (since epoch) used this pool, so each pool cycles in order.
  let k = 0;
  for (let d = EPOCH; d < date; d = addDays(d, 1)) if (WEEK[weekday(d)] === poolName) k++;
  return [0, 1, 2].map((i) => {
    const c = pool[(3 * k + i) % pool.length];
    return c === 'cinematic' ? (k % 2 ? 'starwars' : 'marvel') : c;
  });
}

function recentlyUsed(date, courseId) {
  const used = new Set();
  for (let i = -REPEAT_WINDOW; i <= REPEAT_WINDOW; i++) {
    if (i === 0) continue;
    const f = path.join(OUT, addDays(date, i) + '.json');
    if (!fs.existsSync(f)) continue;
    for (const h of JSON.parse(fs.readFileSync(f, 'utf8')).holes) if (h.course === courseId) { used.add(h.tee); used.add(h.pin); }
  }
  return used;
}

function makeHole(id, date, idx, avoid) {
  const [lo, hi] = RANGE[id] || RANGE.default;
  return generateHole(course(id), rng(`${date}#${idx}#${id}`), { lo, hi, avoid });
}

export function makeDay(date) {
  const ids = coursesFor(date);
  const holes = [];
  ids.forEach((entry, i) => {
    if (typeof entry === 'object') { holes.push(finishManual(entry)); return; }
    const avoid = recentlyUsed(date, entry);
    for (const h of holes) if (h.course === entry) { avoid.add(h.tee); avoid.add(h.pin); }
    holes.push(makeHole(entry, date, i, avoid));
  });
  const day = { date, number: dayDiff(date, EPOCH) + 1, holes };
  const override = overrideFor(date);
  if (override) day.override = JSON.stringify(override);
  return day;
}

// Host-written hole in overrides.json: { course, tee, pin, ob? } -> computes shortest/par.
function finishManual(h) {
  const c = course(h.course);
  const tee = c.lookup(h.tee), pin = c.lookup(h.pin);
  if (tee < 0 || pin < 0) throw new Error(`Override hole: unknown tee/pin ${h.tee} / ${h.pin}`);
  const ob = (h.ob || []).map((x) => c.lookup(x)).filter((u) => u >= 0);
  const best = c.best(tee, pin, new Set(ob));
  if (!best) throw new Error(`Override hole ${h.tee} -> ${h.pin} has no chain`);
  return { course: h.course, tee: c.label(tee), pin: c.label(pin), ob: ob.map((u) => c.label(u)), shortest: best.strokes, par: best.strokes + 2, v: c.meta.built };
}

// Is a stored day still valid against the current data? Returns a refreshed copy or null if broken.
function revalidate(day) {
  const holes = [];
  for (const h of day.holes) {
    const c = course(h.course);
    const tee = c.lookup(h.tee), pin = c.lookup(h.pin);
    if (tee < 0 || pin < 0) return null;
    const ob = h.ob.map((x) => c.lookup(x));
    if (ob.some((u) => u < 0)) return null;
    const best = c.best(tee, pin, new Set(ob));
    if (!best) return null;
    holes.push({ ...h, shortest: best.strokes, par: best.strokes + 2, v: c.meta.built });
  }
  return { ...day, holes };
}

function writeIndex() {
  const dates = fs.readdirSync(OUT).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort();
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ epoch: EPOCH, dates }));
}

// ---- main -----------------------------------------------------------------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (n) => args.includes(n);
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  fs.mkdirSync(OUT, { recursive: true });
  const today = easternToday();
  const one = opt('--date');
  const dates = one ? [one] : Array.from({ length: +opt('--days', DAYS_AHEAD) + 1 }, (_, i) => addDays(today, i));
  let made = 0, fixed = 0;
  for (const date of dates) {
    const file = path.join(OUT, date + '.json');
    const exists = fs.existsSync(file);
    // A host override added or changed after the day was generated forces a rebuild (future days only).
    const override = overrideFor(date);
    const stale = exists && date > today && override && JSON.parse(fs.readFileSync(file, 'utf8')).override !== JSON.stringify(override);
    if (exists && !flag('--force') && !stale) {
      if (!flag('--revalidate') || date <= today) continue;
      const day = JSON.parse(fs.readFileSync(file, 'utf8'));
      const fresh = revalidate(day);
      if (fresh && JSON.stringify(fresh) === JSON.stringify(day)) continue;
      const next = fresh || makeDay(date);
      fs.writeFileSync(file, JSON.stringify(next, null, 1));
      fixed++;
      console.log(`${date}: ${fresh ? 'updated par/data version' : 'regenerated (data changed)'}`);
      continue;
    }
    const day = makeDay(date);
    fs.writeFileSync(file, JSON.stringify(day, null, 1));
    made++;
    console.log(`${date} #${day.number}: ` + day.holes.map((h) => `${h.course} ${h.tee} → ${h.pin} (par ${h.par}${h.ob.length ? ', OB ' + h.ob.join('/') : ''})`).join(' | '));
  }
  writeIndex();
  console.log(`Generated ${made} new day(s), updated ${fixed}.`);
}
