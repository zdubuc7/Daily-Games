// Sanity checks for the engine, data files, and generated puzzles: node tools/links/test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Course, scoreHole } from '../../site/links/engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (id) => new Course(JSON.parse(fs.readFileSync(path.join(ROOT, 'site/links/data', id + '.json'), 'utf8')));
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

// Scoring table from the build doc (par = shortest + 2).
ok(scoreHole(2, 2, true) === -2, 'eagle');
ok(scoreHole(3, 2, true) === -1, 'birdie');
ok(scoreHole(4, 2, true) === 0, 'par');
ok(scoreHole(5, 2, true) === 1, 'bogey');
ok(scoreHole(6, 2, true) === 2, 'double');
ok(scoreHole(7, 2, true) === 3, 'triple');
ok(scoreHole(9, 2, false) === 3, 'pick up');
ok(scoreHole(1, 2, true) === -3, 'albatross');

// Known facts.
const g = load('gridiron');
const fitz = g.lookup('Ryan Fitzpatrick');
ok(fitz >= 0 && g.out.off[fitz + 1] - g.out.off[fitz] === 9, 'Fitzpatrick played for 9 franchises');
const st = load('states');
ok(!st.linkTo(st.lookup('Arizona'), st.lookup('Colorado')), 'no Four Corners diagonal');
ok(st.linkTo(st.lookup('Missouri'), st.lookup('Tennessee')), 'MO-TN border');
const lad = load('ladder');
ok(lad.linkTo(lad.lookup('cat'), lad.lookup('cot')) && !lad.linkTo(lad.lookup('cat'), lad.lookup('dog')), 'ladder links');
const rh = load('rhyme');
const s1 = rh.linkTo(rh.startState(rh.lookup('cat')), rh.lookup('hat'));
ok(s1 && !rh.linkTo(rh.startState(rh.lookup('cat')), rh.lookup('cow')), 'rhyme first');
ok(rh.linkTo(s1.state, rh.lookup('house')) && !rh.linkTo(s1.state, rh.lookup('bat')), 'then alliterate');

// Every generated puzzle: tee/pin/OB resolve, the stored shortest is achievable and links are legal.
const cache = new Map();
const dir = path.join(ROOT, 'site/links/puzzles');
for (const f of fs.readdirSync(dir).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x))) {
  const day = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  ok(day.holes.length === 3, `${f}: 3 holes`);
  for (const h of day.holes) {
    if (!cache.has(h.course)) cache.set(h.course, load(h.course));
    const c = cache.get(h.course);
    const tee = c.lookup(h.tee), pin = c.lookup(h.pin);
    ok(tee >= 0 && pin >= 0, `${f} ${h.course}: tee/pin exist`);
    const ob = new Set(h.ob.map((x) => c.lookup(x)));
    ok(![...ob].includes(-1) && !ob.has(tee) && !ob.has(pin), `${f}: OB valid`);
    const best = c.best(tee, pin, ob);
    ok(best && best.strokes === h.shortest && h.par === h.shortest + 2, `${f} ${h.course}: shortest ${h.shortest}`);
    let s = c.startState(tee);
    for (const u of best.path.slice(1)) { const r = c.linkTo(s, u); ok(r, `${f}: path link`); s = r.state; }
    if (!day.override) ok(h.shortest >= 2 && h.shortest <= 3, `${f}: shortest in 2..3`);
  }
}
console.log(`All ${checks} checks passed.`);
