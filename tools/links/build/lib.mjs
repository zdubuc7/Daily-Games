// Shared helpers for the course data builders.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../../..');
export const CACHE = process.env.LINKS_CACHE || path.join(ROOT, 'tools/links/.cache');
export const SOURCES = path.join(ROOT, 'tools/links/sources');
export const DATA_OUT = path.join(ROOT, 'site/links/data');
export const UA = 'TheLinksDailyGame/1.0 (github.com; personal non-commercial game)';

fs.mkdirSync(CACHE, { recursive: true });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Download `url` into the cache (re-used for `maxAgeHours`).
export async function cached(url, name, { maxAgeHours = 24 * 6, headers = {} } = {}) {
  const file = path.join(CACHE, name);
  if (fs.existsSync(file) && (Date.now() - fs.statSync(file).mtimeMs) / 36e5 < maxAgeHours) return file;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      const tmp = file + '.part';
      const ws = fs.createWriteStream(tmp);
      for await (const chunk of res.body) ws.write(chunk);
      await new Promise((r) => ws.end(r));
      fs.renameSync(tmp, file);
      return file;
    } catch (e) {
      if (attempt >= 4) throw e;
      console.warn(`  retry ${attempt}: ${e.message}`);
      await sleep(3000 * attempt);
    }
  }
}

export async function fetchText(url, name, opts) {
  return fs.readFileSync(await cached(url, name, opts), 'utf8');
}

// Run a SPARQL query against Wikidata (cached by `name`), returns rows with plain string values.
export async function sparql(query, name, { maxAgeHours = 24 * 6 } = {}) {
  const file = path.join(CACHE, name);
  let json;
  if (fs.existsSync(file) && (Date.now() - fs.statSync(file).mtimeMs) / 36e5 < maxAgeHours) {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch('https://query.wikidata.org/sparql', {
          method: 'POST',
          headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'query=' + encodeURIComponent(query),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 120)}`);
        json = JSON.parse(text);
        fs.writeFileSync(file, text);
        break;
      } catch (e) {
        if (attempt >= 5) throw e;
        console.warn(`  sparql retry ${attempt}: ${e.message.slice(0, 120)}`);
        await sleep(10000 * attempt);
      }
    }
  }
  return json.results.bindings.map((b) => {
    const o = {};
    for (const [k, v] of Object.entries(b)) o[k] = v.value.replace('http://www.wikidata.org/entity/', '');
    return o;
  });
}

// Minimal RFC-4180 CSV parser -> array of objects.
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

// Stream lines of a (possibly gzipped) file.
export async function* lines(file) {
  let stream = fs.createReadStream(file);
  if (file.endsWith('.gz')) stream = stream.pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) yield line;
}

export function readSource(name) {
  return fs.readFileSync(path.join(SOURCES, name), 'utf8');
}

// Build a hub-kind course file. `items` is an array of { label, hubs: [hubLabel...], fame }
// Nodes are sorted by fame (desc) so autocomplete shows famous answers first.
// `pool` is a predicate (item) => bool for tee/pin candidates.
export function writeHubCourse(id, items, { pool = () => true, poolSize = 400, meta = {}, minHubSize = 2, alias = {} } = {}) {
  // Drop hubs with a single member and nodes left with no hubs.
  const hubCount = new Map();
  for (const it of items) for (const h of new Set(it.hubs)) hubCount.set(h, (hubCount.get(h) || 0) + 1);
  items = items
    .map((it) => ({ ...it, hubs: [...new Set(it.hubs)].filter((h) => hubCount.get(h) >= minHubSize) }))
    .filter((it) => it.hubs.length);
  items.sort((a, b) => b.fame - a.fame || a.label.localeCompare(b.label));
  disambiguate(items);
  const hubIndex = new Map();
  const hubs = [];
  const nh = items.map((it) => it.hubs.map((h) => {
    if (!hubIndex.has(h)) { hubIndex.set(h, hubs.length); hubs.push(h); }
    return hubIndex.get(h);
  }));
  const poolIdx = [];
  items.forEach((it, i) => { if (poolIdx.length < poolSize && pool(it)) poolIdx.push(i); });
  const labelIdx = new Map(items.map((it, i) => [it.label, i]));
  const aliasOut = {};
  for (const [a, label] of Object.entries(alias)) if (labelIdx.has(label)) aliasOut[a] = labelIdx.get(label);
  for (const [i, it] of items.entries()) for (const a of it.alias || []) aliasOut[a] = i;
  return writeCourse({ id, kind: 'hub', nodes: items.map((it) => it.label), hubs, nh, pool: poolIdx, alias: aliasOut, meta });
}

// Make labels unique. Answers sharing a name get a " (hint)" suffix (position/years, birth year, series...),
// except a clear favourite (3x the fame of the next) which keeps the bare name.
// Expects items sorted by fame, most famous first.
export function disambiguate(items) {
  const groups = new Map();
  for (const it of items) {
    const k = it.label.toLowerCase();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  const used = new Set();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const bareFirst = group[0].fame > 0 && group[0].fame >= 3 * Math.max(0, group[1].fame);
    group.forEach((it, i) => { if (it.hint && !(i === 0 && bareFirst)) it.label = `${it.label} (${it.hint})`; });
  }
  for (const it of items) {
    let label = it.label, n = 2;
    while (used.has(label.toLowerCase())) label = `${it.label} #${n++}`;
    used.add(label.toLowerCase());
    it.label = label;
  }
}

// Trim a Wikidata description into a short hint: "American jazz singer (1924–1990)" -> "American jazz singer".
export function shortDesc(desc, max = 28) {
  if (!desc) return '';
  let d = desc.replace(/\s*\(.*$/, '').replace(/^(a|an|the) /i, '');
  if (d.length > max) d = d.slice(0, max).replace(/\s+\S*$/, '');
  return d;
}

export function writeCourse(obj) {
  fs.mkdirSync(DATA_OUT, { recursive: true });
  obj.meta = { built: new Date().toISOString().slice(0, 10), ...obj.meta };
  const file = path.join(DATA_OUT, `${obj.id}.json`);
  fs.writeFileSync(file, JSON.stringify(obj));
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  console.log(`  wrote ${obj.id}.json: ${obj.nodes.length} answers, ${(obj.hubs || []).length} hubs, pool ${(obj.pool || []).length}, ${kb} KB`);
  return obj;
}

// GET JSON with polite retries (for rate-limited APIs).
export async function fetchJSON(url, { tries = 6, headers = {} } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
      const text = await res.text();
      if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 80)}`);
      return JSON.parse(text);
    } catch (e) {
      if (attempt >= tries) throw e;
      const wait = 5000 * attempt;
      console.warn(`  retry ${attempt} in ${wait / 1000}s: ${e.message.slice(0, 100)}`);
      await sleep(wait);
    }
  }
}
