// The Links — course engine.
// Shared by the browser game and the Node puzzle generator, so it must stay
// dependency-free plain ES modules.
//
// Every course is compiled into the same shape: "states" (usually one per
// answer) and "hubs" (the thing two answers have in common: a franchise, a
// film, a border, a word pattern...). A link A -> B is legal when some hub
// that A exits through also enters B. Searching through hubs instead of
// node-to-node edges keeps BFS linear even when a franchise has 2,000 players.

export const COURSES = {
  gridiron:   { name: 'Gridiron',           rule: 'NFL players are linked if they played for the same franchise in any era. Relocated teams are one franchise (Oilers = Titans).' },
  hollywood:  { name: 'Hollywood',          rule: 'Actors are linked if they were credited in the same feature film.' },
  primetime:  { name: 'Prime Time',         rule: 'TV shows are linked if they share a main cast member.' },
  marvel:     { name: 'Cinematic Universe', rule: 'Marvel Cinematic Universe characters are linked if they appeared on screen in the same film (post-credit scenes count, voice-only does not).' },
  starwars:   { name: 'Cinematic Universe', rule: 'Star Wars characters are linked if they appeared on screen in the same live-action film (voice-only does not count).' },
  studio:     { name: 'Studio',             rule: 'Musicians are linked if they performed on the same song (credited features and collaborations), or were members of the same band.' },
  borders:    { name: 'Borders',            rule: 'Countries are linked if they share a land border.' },
  states:     { name: 'State Lines',        rule: 'Lower-48 states are linked if they share a border. Four Corners diagonals (AZ–CO, UT–NM) do not count.' },
  compound:   { name: 'Compound',           rule: 'Words are linked if together they form a compound word or common two-word term, in either order (fire → fly → paper).' },
  ladder:     { name: 'Word Ladder',        rule: 'Words are linked by changing exactly one letter (cat → cot → dot). Common words only.' },
  rhyme:      { name: 'Rhyme Line',         rule: 'Links alternate: the 1st link must rhyme, the 2nd must alliterate (same first sound), the 3rd rhyme, and so on. cat → hat → house → mouse.' },
  pokedex:    { name: 'Pokédex',            rule: 'Pokémon are linked if they share a type.' },
  smash:      { name: 'Smash',              rule: 'Video game characters are linked if they appeared together in the same game. Crossover games (Smash Bros. and friends) don\'t count.' },
};

export function norm(s) {
  return String(s)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function csr(lists, count) {
  const off = new Int32Array(count + 1);
  for (let i = 0; i < count; i++) off[i + 1] = off[i] + (lists[i] ? lists[i].length : 0);
  const val = new Int32Array(off[count]);
  for (let i = 0; i < count; i++) if (lists[i]) val.set(lists[i], off[i]);
  return { off, val };
}

function invert(fwd, fromCount, toCount) {
  const counts = new Int32Array(toCount + 1);
  for (let i = 0; i < fwd.val.length; i++) counts[fwd.val[i] + 1]++;
  for (let i = 0; i < toCount; i++) counts[i + 1] += counts[i];
  const off = counts.slice();
  const val = new Int32Array(fwd.val.length);
  const fill = counts.slice(0, toCount);
  for (let s = 0; s < fromCount; s++) {
    for (let k = fwd.off[s]; k < fwd.off[s + 1]; k++) val[fill[fwd.val[k]]++] = s;
  }
  return { off, val };
}

const sortLetters = (w) => w.split('').sort().join('');

export class Course {
  constructor(data) {
    this.id = data.id;
    this.kind = data.kind;
    this.info = COURSES[data.id] || { name: data.id, rule: '' };
    this.nodes = data.nodes;
    this.N = data.nodes.length;
    this.pool = data.pool || [];
    this.meta = data.meta || {};
    this.statesPerNode = this.kind === 'rhyme' ? 2 : 1;
    this.S = this.N * this.statesPerNode;

    const out = new Array(this.S);
    let hubLists; // hub -> entering states
    if (this.kind === 'hub') {
      this.hubLabels = data.hubs;
      for (let u = 0; u < this.N; u++) out[u] = data.nh[u] || [];
      this.out = csr(out, this.S);
      this.H = data.hubs.length;
      this.inn = invert(this.out, this.S, this.H);
    } else if (this.kind === 'ladder') {
      const pat = new Map();
      this.hubLabels = [];
      for (let u = 0; u < this.N; u++) {
        const w = this.nodes[u];
        out[u] = [];
        for (let i = 0; i < w.length; i++) {
          const p = w.slice(0, i) + '_' + w.slice(i + 1);
          let h = pat.get(p);
          if (h === undefined) { h = this.hubLabels.length; pat.set(p, h); this.hubLabels.push(p); }
          out[u].push(h);
        }
      }
      this.out = csr(out, this.S);
      this.H = this.hubLabels.length;
      this.inn = invert(this.out, this.S, this.H);
    } else if (this.kind === 'anagram') {
      // Hub "K^" enters every word one letter longer than K; hub "Kv" enters every word whose letters are exactly K.
      const base = new Map(); // sorted key -> words with exactly those letters
      const plus = new Map(); // sorted key -> words that have one extra letter
      const keyOf = this.nodes.map(sortLetters);
      for (let u = 0; u < this.N; u++) {
        const k = keyOf[u];
        if (!base.has(k)) base.set(k, []);
        base.get(k).push(u);
        const seen = new Set();
        for (let i = 0; i < k.length; i++) {
          const sub = k.slice(0, i) + k.slice(i + 1);
          if (seen.has(sub)) continue;
          seen.add(sub);
          if (!plus.has(sub)) plus.set(sub, []);
          plus.get(sub).push(u);
        }
      }
      const hubId = new Map();
      this.hubLabels = [];
      hubLists = [];
      const hub = (name, members) => {
        let h = hubId.get(name);
        if (h === undefined) { h = this.hubLabels.length; hubId.set(name, h); this.hubLabels.push(name); hubLists.push(members); }
        return h;
      };
      for (let u = 0; u < this.N; u++) {
        out[u] = [];
        const k = keyOf[u];
        if (plus.has(k)) out[u].push(hub(k + '^', plus.get(k)));
        const seen = new Set();
        for (let i = 0; i < k.length; i++) {
          const sub = k.slice(0, i) + k.slice(i + 1);
          if (seen.has(sub) || !base.has(sub)) continue;
          seen.add(sub);
          out[u].push(hub(sub + 'v', base.get(sub)));
        }
      }
      this.out = csr(out, this.S);
      this.H = this.hubLabels.length;
      this.inn = csr(hubLists, this.H);
    } else if (this.kind === 'rhyme') {
      // state 2u+0: next link must rhyme; state 2u+1: next link must alliterate.
      const R = data.rkeys.length;
      const F = data.fkeys.length;
      this.H = R + F;
      this.hubLabels = data.rkeys.map(() => 'rhyme').concat(data.fkeys.map(() => 'alliteration'));
      hubLists = Array.from({ length: this.H }, () => []);
      for (let u = 0; u < this.N; u++) {
        out[2 * u] = [data.rk[u]];
        out[2 * u + 1] = [R + data.fp[u]];
        hubLists[data.rk[u]].push(2 * u + 1);
        hubLists[R + data.fp[u]].push(2 * u);
      }
      this.out = csr(out, this.S);
      this.inn = csr(hubLists, this.H);
    } else {
      throw new Error('Unknown course kind ' + this.kind);
    }
    this.rOut = invert(this.inn, this.H, this.S); // state -> hubs that enter it
    this.rIn = invert(this.out, this.S, this.H);  // hub -> states that exit through it

    this.index = new Map();
    for (let u = 0; u < this.N; u++) {
      const k = norm(this.nodes[u]);
      if (!this.index.has(k)) this.index.set(k, u);
    }
    if (data.alias) for (const [a, u] of Object.entries(data.alias)) {
      const k = norm(a);
      if (!this.index.has(k)) this.index.set(k, u);
    }
    this._normed = null;
  }

  nodeOf(s) { return this.statesPerNode === 2 ? s >> 1 : s; }
  startState(node) { return node * this.statesPerNode; }
  label(node) { return this.nodes[node]; }

  lookup(text) {
    const u = this.index.get(norm(text));
    return u === undefined ? -1 : u;
  }

  // Autocomplete. Nodes are stored most-famous first, so the first hits are the best.
  search(q, limit = 8) {
    const n = norm(q);
    if (!n) return [];
    if (!this._normed) this._normed = this.nodes.map(norm);
    const pre = [], word = [], sub = [];
    for (let u = 0; u < this.N && pre.length < limit; u++) {
      const s = this._normed[u];
      if (s.startsWith(n)) pre.push(u);
      else if (word.length < limit && s.includes(' ' + n)) word.push(u);
      else if (sub.length < limit && n.length > 2 && s.includes(n)) sub.push(u);
    }
    return pre.concat(word, sub).slice(0, limit);
  }

  // If `node` is a legal next link from state s, returns { state, hub }.
  linkTo(s, node) {
    const from = this.nodeOf(s);
    if (node === from || node < 0) return null;
    const t = this.statesPerNode === 2 ? node * 2 + (1 - (s & 1)) : node;
    const a = this.out, b = this.rOut;
    for (let i = a.off[s]; i < a.off[s + 1]; i++) {
      const h = a.val[i];
      for (let j = b.off[t]; j < b.off[t + 1]; j++) if (b.val[j] === h) return { state: t, hub: h };
    }
    return null;
  }

  // Human-readable reason for a link (shown after each shot).
  reason(hub, fromNode, toNode) {
    switch (this.kind) {
      case 'hub': return this.hubLabels[hub];
      case 'ladder': {
        const a = this.nodes[fromNode], b = this.nodes[toNode];
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return `${a[i].toUpperCase()} → ${b[i].toUpperCase()}`;
        return 'one letter';
      }
      case 'anagram': {
        const a = this.nodes[fromNode], b = this.nodes[toNode];
        const diff = (x, y) => { const c = y.split(''); for (const ch of x) { const i = c.indexOf(ch); if (i >= 0) c.splice(i, 1); } return c[0] || ''; };
        return b.length > a.length ? `+${diff(a, b).toUpperCase()}` : `−${diff(b, a).toUpperCase()}`;
      }
      case 'rhyme': return this.hubLabels[hub];
    }
    return '';
  }

  // Next link type label for rhyme course (state parity), or null.
  nextLinkType(s) {
    if (this.kind !== 'rhyme') return null;
    return (s & 1) ? 'alliterate' : 'rhyme';
  }

  // Links remaining from every state to `pin` (unweighted). -1 = unreachable.
  distTo(pin) {
    const dist = new Int16Array(this.S).fill(-1);
    const hubSeen = new Int32Array(this.H); // 0 = unseen, >0 = first visitor node+1 (partial), -1 = full
    const q = new Int32Array(this.S);
    let qh = 0, qt = 0;
    for (let p = 0; p < this.statesPerNode; p++) { const s = pin * this.statesPerNode + p; dist[s] = 0; q[qt++] = s; }
    while (qh < qt) {
      const t = q[qh++];
      const tn = this.nodeOf(t);
      const d = dist[t] + 1;
      for (let i = this.rOut.off[t]; i < this.rOut.off[t + 1]; i++) {
        const h = this.rOut.val[i];
        const seen = hubSeen[h];
        if (seen === -1) continue;
        const onlyNode = seen > 0 ? seen - 1 : -1;
        if (seen > 0 && onlyNode === tn) continue;
        hubSeen[h] = seen > 0 ? -1 : tn + 1;
        for (let j = this.rIn.off[h]; j < this.rIn.off[h + 1]; j++) {
          const s = this.rIn.val[j];
          const sn = this.nodeOf(s);
          if (sn === tn || dist[s] >= 0) continue;
          if (onlyNode >= 0 && sn !== onlyNode) continue;
          dist[s] = d; q[qt++] = s;
        }
      }
    }
    return dist;
  }

  // Fewest strokes from tee to pin when every out-of-bounds answer costs an
  // extra stroke. Returns { strokes, links, path: [node...], hubs: [hub...] } or null.
  best(tee, pin, ob = new Set(), maxCost = 12) {
    const cost = new Int16Array(this.S).fill(-1);
    const done = new Uint8Array(this.S);
    const parent = new Int32Array(this.S).fill(-1);
    const via = new Int32Array(this.S).fill(-1);
    const hubSeen = new Int32Array(this.H);
    const buckets = Array.from({ length: maxCost + 3 }, () => []);
    const s0 = this.startState(tee);
    cost[s0] = 0; buckets[0].push(s0);
    for (let c = 0; c <= maxCost; c++) {
      const b = buckets[c];
      for (let k = 0; k < b.length; k++) {
        const s = b[k];
        if (done[s] || cost[s] !== c) continue;
        done[s] = 1;
        const sn = this.nodeOf(s);
        if (sn === pin) return this._path(s, parent, via, c);
        for (let i = this.out.off[s]; i < this.out.off[s + 1]; i++) {
          const h = this.out.val[i];
          const seen = hubSeen[h];
          if (seen === -1) continue;
          const onlyNode = seen > 0 ? seen - 1 : -1;
          if (seen > 0 && onlyNode === sn) continue;
          hubSeen[h] = seen > 0 ? -1 : sn + 1;
          for (let j = this.inn.off[h]; j < this.inn.off[h + 1]; j++) {
            const t = this.inn.val[j];
            const tn = this.nodeOf(t);
            if (tn === sn) continue;
            if (onlyNode >= 0 && tn !== onlyNode) continue;
            const nc = c + 1 + (ob.has(tn) ? 1 : 0);
            if (nc > maxCost + 2) continue;
            if (cost[t] === -1 || nc < cost[t]) { cost[t] = nc; parent[t] = s; via[t] = h; buckets[nc].push(t); }
          }
        }
      }
    }
    return null;
  }

  _path(s, parent, via, strokes) {
    const path = [], hubs = [];
    while (s !== -1) { path.push(this.nodeOf(s)); if (via[s] !== -1) hubs.push(via[s]); s = parent[s]; }
    path.reverse(); hubs.reverse();
    return { strokes, links: path.length - 1, path, hubs };
  }

  // Distinct answers reachable in one link (used to find "overconnected" answers).
  degree(node) {
    const seen = new Set();
    for (let p = 0; p < this.statesPerNode; p++) {
      const s = node * this.statesPerNode + p;
      for (let i = this.out.off[s]; i < this.out.off[s + 1]; i++) {
        const h = this.out.val[i];
        for (let j = this.inn.off[h]; j < this.inn.off[h + 1]; j++) seen.add(this.nodeOf(this.inn.val[j]));
      }
    }
    seen.delete(node);
    return seen.size;
  }
}

// ---- Building a hole ---------------------------------------------------------
// Shared by the daily generator and the in-browser "change course" testing tool.

// Overconnected answers: the highest-degree answers sitting on (or next to) the shortest routes.
function pickOutOfBounds(c, tee, pin, distPin, links, rand) {
  const cand = new Set();
  if (c.kind === 'rhyme') {
    for (let s = 0; s < c.S; s++) if (distPin[s] === links - 1 && c.linkTo(c.startState(tee), c.nodeOf(s))) cand.add(c.nodeOf(s));
  } else {
    const distTee = c.distTo(tee); // undirected courses: distance from tee == distance to tee
    for (let u = 0; u < c.N; u++) {
      if (u === tee || u === pin || distPin[u] < 0 || distTee[u] < 0) continue;
      if (distTee[u] + distPin[u] <= links + 1 && (distTee[u] === 1 || distPin[u] === 1)) cand.add(u);
    }
  }
  cand.delete(tee); cand.delete(pin);
  if (cand.size < 3) return [];
  // Sample big candidate sets so degree() stays cheap, but always keep a broad spread.
  let list = [...cand];
  if (list.length > 600) list = list.sort(() => rand() - 0.5).slice(0, 600);
  const scored = list.map((u) => ({ u, deg: c.degree(u) })).sort((a, b) => b.deg - a.deg);
  const median = scored[Math.floor(scored.length / 2)].deg;
  const n = scored.length >= 8 ? 3 : 2;
  return scored.slice(0, n).filter((x) => x.deg > median * 1.25).map((x) => x.u);
}

// Pick a tee and pin whose fewest-strokes chain is within [lo, hi], with out-of-bounds answers.
export function generateHole(c, rand, { lo = 2, hi = 3, avoid = new Set() } = {}) {
  const pool = c.pool.filter((u) => !avoid.has(c.label(u)));
  if (pool.length < 2) throw new Error(`Pool exhausted for ${c.id}`);
  for (let attempt = 0; attempt < 500; attempt++) {
    const pin = pool[Math.floor(rand() * pool.length)];
    const tee = pool[Math.floor(rand() * pool.length)];
    if (tee === pin) continue;
    if (c.kind === 'ladder' && c.label(tee).length !== c.label(pin).length) continue;
    const distPin = c.distTo(pin);
    const links = distPin[c.startState(tee)];
    if (links < lo || links > hi) continue;
    let ob = pickOutOfBounds(c, tee, pin, distPin, links, rand);
    let best = c.best(tee, pin, new Set(ob));
    while (ob.length && (!best || best.strokes > hi)) { ob = ob.slice(0, -1); best = c.best(tee, pin, new Set(ob)); }
    if (!best || best.strokes < lo || best.strokes > hi) continue;
    return { course: c.id, tee: c.label(tee), pin: c.label(pin), ob: ob.map((u) => c.label(u)), shortest: best.strokes, par: best.strokes + 2, v: c.meta.built };
  }
  throw new Error(`Could not build a ${c.id} hole`);
}

// ---- Scoring -------------------------------------------------------------

export const SCORE_NAMES = { '-3': 'Albatross', '-2': 'Eagle', '-1': 'Birdie', '0': 'Par', '1': 'Bogey', '2': 'Double Bogey', '3': 'Triple Bogey' };

export function scoreName(rel) {
  return SCORE_NAMES[String(Math.max(-3, Math.min(3, rel)))];
}

export function fmtRel(rel) {
  if (rel === 0) return 'E';
  return rel > 0 ? `+${rel}` : `−${-rel}`;
}

// Score a finished hole. `shortest` is the stored fewest-strokes chain; par = shortest + 2.
// Finding a chain shorter than the stored one is an albatross (and flagged as a data gap).
export function scoreHole(strokes, shortest, holed) {
  if (!holed) return 3;
  if (strokes < shortest) return -3;
  return Math.min(3, strokes - (shortest + 2));
}
