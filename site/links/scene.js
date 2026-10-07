// The Links — top-down golf hole with a camera that follows the ball.
// You start zoomed in on the tee box with a driver; the fairway, rough, hazards and woods scroll
// into view as the ball advances, and the green and cup only appear once you're close.
//
// World units: the cup sits at (0, 0) and the tee is straight "down" the screen (positive y).
// Hole length comes from par; the ball's spots ("links to go") are spread evenly along it.
import { Terrain } from './terrain.js';

const NS = 'http://www.w3.org/2000/svg';
const YPU = 1.38;          // yards per world unit
const GREEN_SPOT = 24;     // a ball one link away sits here (on the green, below the cup)
const FAIR_HW = 27;        // fairway half-width
const CUT = 5;             // first cut of rough around the fairway
const ROUGH_HW = 88;       // rough corridor half-width (woods beyond)
const DROP_LAT = 52;       // lateral offset of a drop after going out of bounds
const BALL_R = 2.1;
const TILE = 32;           // sharp terrain tiles are TILE x TILE world units
const TILE_BLEED = 0.75;   // tiles overlap slightly so no seams show
const MAX_TILES = 80;

const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, reduceMotion() ? Math.min(ms, 150) : ms));
const lerp = (a, b, t) => a + (b - a) * t;
const norm = (v) => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; };
const add = (a, b, k = 1) => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const rot = (v, deg) => { const a = (deg * Math.PI) / 180; return { x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) }; };
const ease = {
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  out: (t) => 1 - (1 - t) ** 3,
  outQuad: (t) => 1 - (1 - t) ** 2,
  in: (t) => t * t * t,
  lin: (t) => t,
};

function tween(ms, fn, easing = ease.inOut) {
  if (reduceMotion()) ms = Math.min(ms, 120);
  return new Promise((resolve) => {
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      fn(easing(t), t);
      if (t < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
}

function seeded(str) {
  let a = 2166136261;
  for (const c of String(str)) { a ^= c.charCodeAt(0); a = Math.imul(a, 16777619); }
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Points of an organic blob around an ellipse (bunkers, ponds).
function blobPts(cx, cy, rx, ry, angle, rand, jitter = 0.16, n = 11) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + (rand() - 0.5) * 2 * jitter;
    pts.push(add({ x: cx, y: cy }, rot({ x: Math.cos(a) * rx * k, y: Math.sin(a) * ry * k }, angle)));
  }
  return pts;
}

// Clubs, as seen from above. Local frame: ball at (0,0), target straight up (-y),
// a right-handed golfer standing to the left. The club swings around `pivot` (the golfer's
// shoulders, which aren't drawn); `hands` is the butt of the grip.
const CLUBS = {
  driver: { pivot: { x: -27, y: 1 }, hands: { x: -17, y: 4.6 }, hosel: { x: -5.3, y: 4.2 }, back: 102, thru: -120, swingMs: [520, 270] },
  wood:   { pivot: { x: -26, y: 1 }, hands: { x: -16, y: 4.4 }, hosel: { x: -4.2, y: 3.7 }, back: 98, thru: -112, swingMs: [500, 270] },
  iron:   { pivot: { x: -24, y: 1 }, hands: { x: -14.5, y: 4 }, hosel: { x: -4.3, y: 3.8 }, back: 90, thru: -104, swingMs: [470, 260] },
  putter: { pivot: { x: -17, y: 2 }, hands: { x: -10, y: 3.4 }, hosel: { x: -2.2, y: 3.3 }, back: 24, thru: -24, swingMs: [420, 300] },
};

export class Scene {
  constructor(svg) {
    this.svg = svg;
    this.wrap = svg.parentElement;
    this.holeLabel = this.wrap.querySelector('.hole-label');
    this.lieLabel = this.wrap.querySelector('.lie');
    this.toastBox = this.wrap.querySelector('.toasts');
    // Layers, bottom to top: painted terrain canvas, the main svg (ball, club, tracer),
    // and a top svg for the flag and effects.
    this.wrap.querySelectorAll('.terrain, .scene-top').forEach((e) => e.remove());
    this.terrainBox = document.createElement('div');
    this.terrainBox.className = 'terrain';
    this.wrap.insertBefore(this.terrainBox, svg);
    this.top = document.createElementNS(NS, 'svg');
    this.top.setAttribute('class', 'scene-top');
    this.top.setAttribute('aria-hidden', 'true');
    svg.after(this.top);
    svg.innerHTML = '';
    this.buildDefs();
    this.decor = el('g', {}, svg);
    this.tracer = el('g', { class: 'tracer' }, svg);
    this.shadow = el('ellipse', { fill: 'url(#ballShadow)' }, svg);
    this.club = el('g', { class: 'club' }, svg);
    this.ball = el('g', { class: 'ball' }, svg);
    el('circle', { r: BALL_R, fill: 'url(#ballGrad)' }, this.ball);
    el('circle', { r: BALL_R, fill: 'url(#dimples)', opacity: 0.35 }, this.ball);
    el('ellipse', { cx: -0.62, cy: -0.72, rx: 0.62, ry: 0.48, fill: '#fff', opacity: 0.85 }, this.ball);
    el('circle', { r: BALL_R, fill: 'none', stroke: 'rgba(60,70,75,.45)', 'stroke-width': 0.18 }, this.ball);
    this.flagLayer = el('g', {}, this.top);
    this.fx = el('g', {}, this.top);
    this.buildClub();
    this.cam = { x: 0, y: 0, w: 120, a: 0.7 };
    this.pos = { x: 0, y: 0 };
    this.aim = 0;
    this.rand = Math.random;
    if (window.ResizeObserver) new ResizeObserver(() => this.refreshTiles()).observe(this.wrap);
  }

  buildDefs() {
    const defs = el('defs', {}, this.svg);
    const radial = (id, stops, attrs = {}) => {
      const g = el('radialGradient', { id, ...attrs }, defs);
      stops.forEach(([o, c, op]) => el('stop', { offset: o, 'stop-color': c, ...(op != null ? { 'stop-opacity': op } : {}) }, g));
    };
    const linear = (id, stops, attrs = {}) => {
      const g = el('linearGradient', { id, ...attrs }, defs);
      stops.forEach(([o, c, op]) => el('stop', { offset: o, 'stop-color': c, ...(op != null ? { 'stop-opacity': op } : {}) }, g));
    };
    radial('ballGrad', [['0', '#ffffff'], ['0.5', '#f3f4f2'], ['0.85', '#c9cfd2'], ['1', '#a9b1b6']], { cx: '38%', cy: '34%', r: '72%' });
    radial('ballShadow', [['0', '#000', 0.5], ['0.6', '#000', 0.28], ['1', '#000', 0]]);
    linear('crown', [['0', '#4a525a'], ['0.45', '#1b1f23'], ['1', '#07090a']], { x1: 0, y1: 0, x2: 0.8, y2: 1 });
    linear('steel', [['0', '#f4f6f7'], ['0.35', '#b9c1c6'], ['0.6', '#e3e7e9'], ['1', '#8e989e']], { x1: 0, y1: 0, x2: 1, y2: 1 });
    linear('graphite', [['0', '#5b636a'], ['0.5', '#202428'], ['1', '#3b4147']], { x1: 0, y1: 0, x2: 0, y2: 1 });
    linear('putterFace', [['0', '#3a4046'], ['1', '#15181b']], { x1: 0, y1: 0, x2: 0, y2: 1 });
    linear('flagCloth', [['0', '#ff5a4c'], ['0.45', '#e2382d'], ['0.7', '#ff6656'], ['1', '#b8241b']], { x1: 0, y1: 0, x2: 1, y2: 0 });
    const pat = (id, w, h, build, attrs = {}) => { const p = el('pattern', { id, width: w, height: h, patternUnits: 'userSpaceOnUse', ...attrs }, defs); build(p); };
    pat('dimples', 0.62, 0.54, (p) => {
      el('circle', { cx: 0.15, cy: 0.13, r: 0.12, fill: '#7d878c' }, p);
      el('circle', { cx: 0.46, cy: 0.4, r: 0.12, fill: '#7d878c' }, p);
    });
    pat('carbon', 0.7, 0.7, (p) => {
      el('rect', { width: 0.35, height: 0.35, fill: 'rgba(255,255,255,.06)' }, p);
      el('rect', { x: 0.35, y: 0.35, width: 0.35, height: 0.35, fill: 'rgba(255,255,255,.06)' }, p);
    }, { patternTransform: 'rotate(45)' });
  }

  // ---- hole layout ---------------------------------------------------------------
  setHole({ links, par, number, seed }) {
    this.D = Math.max(2, links);
    this.par = par || this.D + 2;
    const rand = seeded(seed || 'hole');
    this.rand = rand;
    const byPar = this.par <= 3 ? 150 : this.par === 4 ? 285 : 395 + 80 * (this.par - 5);
    this.yTee = Math.max(byPar, GREEN_SPOT + 92 * (this.D - 1));
    this.yards = Math.round((this.yTee * YPU) / 1);
    // dogleg: one bend, or an S-curve on long holes
    const amp = (rand() < 0.5 ? -1 : 1) * (16 + rand() * 30);
    const sCurve = this.par >= 5 && rand() < 0.5;
    this.cx = (y) => {
      const t = Math.max(0, Math.min(1, (this.yTee - y) / this.yTee));
      return sCurve ? amp * 0.75 * Math.sin(2 * Math.PI * t) : amp * Math.sin(Math.PI * t);
    };
    // green shape around a pin that isn't always dead centre
    this.green = {
      x: (rand() - 0.5) * 10, y: (rand() - 0.5) * 7, rx: 37 + rand() * 4, ry: 31 + rand() * 3,
      p1: rand() * 6.28, p2: rand() * 6.28, a1: 0.06 + rand() * 0.03, a2: 0.04 + rand() * 0.02,
    };
    this.laySide = 1;
    this.hazards = [];
    if (this.holeLabel) this.holeLabel.textContent = `Hole ${number || 1} · Par ${this.par} · ${this.yards} yds`;
    this.drawCourse(rand);
    this.clearTracer();
    this.placeAt(this.D);
  }

  greenR(theta, extra = 0) {
    const g = this.green;
    const e = (g.rx * g.ry) / Math.hypot(g.ry * Math.cos(theta), g.rx * Math.sin(theta));
    return e * (1 + g.a1 * Math.sin(2 * theta + g.p1) + g.a2 * Math.sin(3 * theta + g.p2)) + extra;
  }

  inGreen(p, extra = 0) {
    const dx = p.x - this.green.x, dy = p.y - this.green.y;
    return Math.hypot(dx, dy) <= this.greenR(Math.atan2(dy, dx), extra);
  }

  // Every spot the ball can come to rest on; hazards must stay clear of these.
  restSpots() {
    const spots = [];
    for (let d = 1; d <= this.D; d++) for (const l of [0, -DROP_LAT, DROP_LAT]) spots.push(this.posFor(d, l));
    spots.push(this.greenDrop(-1), this.greenDrop(1));
    return spots;
  }

  // Where an out-of-bounds ball is dropped: the rough on that side, or just off the green.
  greenDrop(side) {
    const th = side > 0 ? 0.35 : Math.PI - 0.35;
    const r = this.greenR(th, 13);
    return { x: this.green.x + Math.cos(th) * r, y: this.green.y + Math.sin(th) * r };
  }


  fits(x, y, rx, ry, angle, margin = 9, { nearGreen = false } = {}) {
    for (const s of this.spots) {
      const v = rot({ x: s.x - x, y: s.y - y }, -angle);
      if ((v.x / (rx + margin)) ** 2 + (v.y / (ry + margin)) ** 2 < 1) return false;
    }
    if (!nearGreen && this.inGreen({ x, y }, Math.max(rx, ry) + 6)) return false;
    if (Math.abs(y - this.yTee) < ry + 16 && Math.abs(x - this.cx(this.yTee)) < rx + 22) return false;
    for (const h of this.hazards) if (Math.hypot(h.x - x, h.y - y) < Math.max(h.rx, h.ry) + Math.max(rx, ry) + 3) return false;
    return true;
  }

  drawCourse(rand) {
    this.decor.innerHTML = '';
    this.flagLayer.innerHTML = '';
    this.spots = this.restSpots();
    const top = -78, bottom = this.yTee + 50;
    // the tree line wanders a little so the corridor doesn't look ruled
    const ph = [rand() * 6, rand() * 6, rand() * 6, rand() * 6];
    const treeLine = (y, side) => ROUGH_HW + 3 + 5 * Math.sin(y / 19 + ph[side > 0 ? 0 : 1]) + 2.5 * Math.sin(y / 7.3 + ph[side > 0 ? 2 : 3]);
    const edge = (side) => { const pts = []; for (let y = top; y <= bottom; y += 4) pts.push({ x: this.cx(y) + side * treeLine(y, side), y }); return pts; };
    const hw = (y) => FAIR_HW + 4 * Math.sin(y / 37 + 1);
    this.hw = hw;
    const fy0 = 14, fy1 = this.yTee - 16;
    const band = (w) => { const l = [], r = []; for (let y = fy0; y <= fy1; y += 4) { l.push({ x: this.cx(y) - w(y), y }); r.push({ x: this.cx(y) + w(y), y }); } return [...l, ...r.reverse()]; };
    let cxMin = 0, cxMax = 0;
    for (let y = top; y <= bottom; y += 10) { cxMin = Math.min(cxMin, this.cx(y)); cxMax = Math.max(cxMax, this.cx(y)); }
    const margin = 135;
    const L = {
      rand, cx: this.cx, hw, top, bottom, fy0, fy1, roughHW: ROUGH_HW, green: this.green,
      x0: cxMin - ROUGH_HW - margin, y0: -200, w: cxMax - cxMin + 2 * (ROUGH_HW + margin), h: this.yTee + 380,
      corridor: [...edge(-1), ...edge(1).reverse()],
      fairway: band(hw), firstCut: band((y) => hw(y) + CUT),
      greenPts: (extra) => { const pts = []; for (let i = 0; i < 44; i++) { const a = (i / 44) * Math.PI * 2, r = this.greenR(a, extra); pts.push({ x: this.green.x + Math.cos(a) * r, y: this.green.y + Math.sin(a) * r }); } return pts; },
      markers: [], water: [], sand: [], trees: [], stakes: [], creek: null,
      tee: { x: this.cx(this.yTee), y: this.yTee, w: 38, h: 24 },
    };
    this.L = L;

    // cart path along one side
    const pathSide = rand() < 0.5 ? -1 : 1;
    this.cartX = (y) => this.cx(y) + pathSide * (ROUGH_HW - 13);
    L.cartPath = [];
    for (let y = this.yTee + 6; y >= -30; y -= 8) L.cartPath.push({ x: this.cartX(y), y });

    // yardage markers in the middle of the fairway: 200 blue, 150 white, 100 red
    for (const [yd, color] of [[200, '#2f6fd6'], [150, '#f4f4f0'], [100, '#d93a35']]) {
      const y = yd / YPU;
      if (y < fy1 - 20 && y > 40) L.markers.push({ x: this.cx(y), y, color });
    }

    const water = (x, y, rx, ry, angle, kind) => {
      L.water.push({ pts: blobPts(x, y, rx, ry, angle, rand, 0.14), x, y, rx, ry });
      this.hazards.push({ type: 'water', x, y, rx, ry, angle, kind });
      const rip = el('g', { class: 'ripples' }, this.decor); // little animated glints
      for (let i = 0; i < 4; i++) el('path', { d: `M${x - rx * 0.5 + i * rx * 0.28} ${y - ry * 0.3 + (i % 2) * ry * 0.4} q1.6 -0.8 3.2 0`, stroke: '#fff', 'stroke-width': 0.3, 'stroke-linecap': 'round', fill: 'none', style: `animation-delay:${i * 0.6}s` }, rip);
    };
    const sand = (x, y, rx, ry, angle) => {
      L.sand.push({ pts: blobPts(x, y, rx, ry, angle, rand, 0.2, 9), x, y, rx, ry, angle });
      this.hazards.push({ type: 'sand', x, y, rx, ry, angle });
    };
    const tryPlace = (n, make) => { for (let i = 0; i < n; i++) if (make()) return true; return false; };

    // fairway bunkers
    const nFair = this.par >= 5 ? 2 + (rand() < 0.5 ? 1 : 0) : 1 + (rand() < 0.6 ? 1 : 0);
    for (let k = 0; k < nFair; k++) {
      tryPlace(25, () => {
        const y = 60 + rand() * (this.yTee - 110), s = rand() < 0.5 ? -1 : 1;
        const rx = 8 + rand() * 6, ry = 5 + rand() * 3, ang = (rand() - 0.5) * 40;
        const x = this.cx(y) + s * (hw(y) + 2 + rand() * 6);
        if (!this.fits(x, y, rx, ry, ang)) return false;
        sand(x, y, rx, ry, ang); return true;
      });
    }
    // greenside bunkers hug the green, never directly in front
    const nGreen = 2 + (this.par >= 5 || rand() < 0.35 ? 1 : 0);
    for (let k = 0; k < nGreen; k++) {
      tryPlace(25, () => {
        const th = rand() * Math.PI * 2 - Math.PI;
        if (Math.abs(th - Math.PI / 2) < 0.55) return false;
        const rx = 10 + rand() * 4, ry = 5.5 + rand() * 2.5;
        const r = this.greenR(th, 6 + ry * 0.6);
        const x = this.green.x + Math.cos(th) * r, y = this.green.y + Math.sin(th) * r;
        const ang = (th * 180) / Math.PI + 90;
        if (!this.fits(x, y, rx, ry, ang, 6, { nearGreen: true })) return false;
        sand(x, y, rx, ry, ang); return true;
      });
    }
    // water: a lake down one side, a pond guarding the green, and/or a creek across a long hole
    const waterRoll = rand();
    if (waterRoll < 0.45) {
      tryPlace(25, () => {
        const s = rand() < 0.5 ? -1 : 1, y = this.yTee * (0.25 + rand() * 0.5);
        const rx = 11 + rand() * 6, ry = 22 + rand() * 20;
        const x = this.cx(y) + s * (ROUGH_HW - rx - 4);
        if (!this.fits(x, y, rx, ry, 0, 7)) return false;
        water(x, y, rx, ry, (rand() - 0.5) * 20, 'lake'); return true;
      });
    } else if (waterRoll < 0.75) {
      tryPlace(15, () => {
        const y = this.green.y + this.greenR(Math.PI / 2, 14 + rand() * 6);
        const rx = 20 + rand() * 8, ry = 6 + rand() * 3;
        const x = this.green.x + (rand() - 0.5) * 16;
        if (!this.fits(x, y, rx, ry, 0, 5, { nearGreen: true })) return false;
        water(x, y, rx, ry, (rand() - 0.5) * 14, 'pond'); return true;
      });
    }
    if (this.par >= 5 || (this.yTee > 330 && rand() < 0.5)) this.creek(rand, L);

    // out-of-bounds stakes along the tree line
    for (let y = top + 10; y < bottom; y += 22) for (const s of [-1, 1]) L.stakes.push({ x: this.cx(y) + s * (ROUGH_HW - 2.5), y });

    // trees: the woods outside the corridor, plus a few clumps standing in the rough
    const kind = () => { const r = rand(); return r < 0.22 ? 'pine' : r < 0.29 ? 'olive' : 'leafy'; };
    for (let y = L.y0 + 4; y < L.y0 + L.h; y += 14) {
      for (let x = L.x0 + 4; x < L.x0 + L.w; x += 15) {
        const jx = x + (rand() - 0.5) * 9, jy = y + (rand() - 0.5) * 9;
        const off = jx - this.cx(jy);
        if (Math.abs(off) < treeLine(jy, Math.sign(off) || 1) + 5 && jy > top + 2 && jy < bottom - 2) continue;
        L.trees.push({ x: jx, y: jy, r: 9.5 + rand() * 4.5, kind: kind() });
      }
    }
    const clumps = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < clumps; k++) {
      tryPlace(20, () => {
        const y = 40 + rand() * (this.yTee - 70), s = rand() < 0.5 ? -1 : 1;
        const x = this.cx(y) + s * (66 + rand() * 12);
        if (!this.fits(x, y, 10, 10, 0, 6) || Math.abs(x - this.cartX(y)) < 12) return false;
        for (let i = 0; i < 2 + Math.floor(rand() * 3); i++) L.trees.push({ x: x + (rand() - 0.5) * 14, y: y + (rand() - 0.5) * 14, r: 7.5 + rand() * 3, kind: kind() });
        this.hazards.push({ type: 'trees', x, y, rx: 10, ry: 10, angle: 0 });
        return true;
      });
    }

    // paint the scenery: a whole-hole base layer, plus sharp tiles streamed in around the camera
    this.terrain = new Terrain(L);
    const base = this.terrain.renderBase();
    base.className = 'base';
    this.world = document.createElement('div');
    this.world.className = 'terrain-world';
    this.world.style.width = `${L.w}px`;
    this.world.style.height = `${L.h}px`;
    this.tileLayer = document.createElement('div');
    this.world.append(base, this.tileLayer);
    this.terrainBox.replaceChildren(this.world);
    this.tiles = new Map();
    this.wanted = [];
    this.hiPpu = this.computeHiPpu();

    // tee peg (vector, so it can disappear when the ball is struck)
    this.teePeg = el('circle', { cx: L.tee.x + 0.3, cy: L.tee.y + 0.4, r: 0.7, fill: '#fff', stroke: 'rgba(0,0,0,.3)', 'stroke-width': 0.15 }, this.decor);
    // the flag: pole and waving cloth, above the ball
    this.flag = el('g', { class: 'flag' }, this.flagLayer);
    el('line', { x1: 0, y1: 0, x2: 0, y2: -16, stroke: 'rgba(40,40,40,.55)', 'stroke-width': 1.05, 'stroke-linecap': 'round' }, this.flag);
    el('line', { x1: 0, y1: 0, x2: 0, y2: -16, stroke: '#f6f6f2', 'stroke-width': 0.7, 'stroke-linecap': 'round' }, this.flag);
    el('circle', { cx: 0, cy: -16.2, r: 0.55, fill: '#f2d24b' }, this.flag);
    el('path', { d: 'M0.35 -15.6 C3 -16.4 6 -14.4 10 -13.2 C6.4 -12.4 3.2 -11.2 0.35 -10.4 Z', fill: 'url(#flagCloth)', class: 'flag-cloth' }, this.flag);
  }

  // A creek winding across the fairway between two rest spots, with a little bridge on the cart path.
  creek(rand, L) {
    const spotsY = [...new Set(this.spots.map((s) => Math.round(s.y)))].sort((a, b) => a - b);
    let best = null;
    for (let i = 0; i < spotsY.length - 1; i++) {
      const gap = spotsY[i + 1] - spotsY[i];
      const mid = (spotsY[i] + spotsY[i + 1]) / 2;
      if (gap > 40 && mid > 70 && mid < this.yTee - 40 && (best == null || Math.abs(mid - this.yTee / 2) < Math.abs(best - this.yTee / 2))) best = mid;
    }
    if (best == null) return;
    const pts = [];
    const ph = rand() * 6;
    for (let x = -ROUGH_HW - 60; x <= ROUGH_HW + 60; x += 9) pts.push({ x: this.cx(best) + x, y: best + Math.sin(x / 23 + ph) * 5 });
    const bx = this.cartX(best);
    let by = best, angle = 0;
    for (let i = 0; i < pts.length - 1; i++) if (pts[i].x <= bx && pts[i + 1].x > bx) { by = lerp(pts[i].y, pts[i + 1].y, (bx - pts[i].x) / (pts[i + 1].x - pts[i].x)); angle = Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x); }
    L.creek = { pts, bridge: { x: bx, y: by, angle } };
    const d = 'M' + pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L');
    el('path', { d, class: 'creek-flow', fill: 'none', stroke: 'rgba(225,240,255,.35)', 'stroke-width': 0.6, 'stroke-dasharray': '2 7', 'stroke-linecap': 'round' }, this.decor);
    this.hazards.push({ type: 'water', x: this.cx(best), y: best, rx: ROUGH_HW + 20, ry: 5, angle: 0, kind: 'creek' });
  }

  // ---- positions, lie, club and camera --------------------------------------------------
  posFor(dist, lateral = 0) {
    if (dist === 0) return { x: 0, y: 0 };
    if (dist === 1) return { x: lateral * 0.25, y: GREEN_SPOT };
    if (dist >= this.D) return { x: this.cx(this.yTee) + lateral, y: this.yTee };
    const y = this.yTee - ((this.D - dist) / (this.D - 1)) * (this.yTee - GREEN_SPOT);
    return { x: this.cx(y) + lateral, y };
  }

  onGreen(p = this.pos) { return this.inGreen(p, 0.5); }

  onTee(p = this.pos) { return Math.abs(p.y - this.yTee) < 12 && Math.abs(p.x - this.cx(this.yTee)) < 19; }

  lie(p = this.pos) {
    if (this.onGreen(p)) return 'Green';
    if (this.inGreen(p, 5)) return 'Fringe';
    if (this.onTee(p)) return 'Tee box';
    for (const h of this.hazards) {
      if (h.type !== 'sand') continue;
      const v = rot({ x: p.x - h.x, y: p.y - h.y }, -h.angle);
      if ((v.x / h.rx) ** 2 + (v.y / h.ry) ** 2 <= 1) return 'Bunker';
    }
    const off = Math.abs(p.x - this.cx(p.y));
    if (p.y > 14 && p.y < this.yTee - 16) {
      if (off <= this.hw(p.y)) return 'Fairway';
      if (off <= this.hw(p.y) + CUT) return 'First cut';
    }
    return 'Rough';
  }

  // The green is drawn bigger than true scale so it reads well, so yardage is compressed near the pin.
  yardsToPin(p = this.pos) {
    const d = Math.hypot(p.x, p.y), R = 45, near = 0.3;
    if (d <= R) return Math.round(d * near);
    const k = (this.yards - R * near) / Math.max(1, this.yTee - R);
    return Math.round(R * near + (d - R) * k);
  }

  inHazard(p, types, margin = 0) {
    for (const h of this.hazards) {
      if (!types.includes(h.type)) continue;
      const v = rot({ x: p.x - h.x, y: p.y - h.y }, -h.angle);
      if ((v.x / (h.rx + margin)) ** 2 + (v.y / (h.ry + margin)) ** 2 <= 1) return true;
    }
    return false;
  }

  // Is this a fair place for the ball to stop? (not in water/trees, inside the corridor,
  // and only on the green when the ball is one link away)
  playable(p, { allowSand = false, allowGreen = false } = {}) {
    if (this.inHazard(p, allowSand ? ['water', 'trees'] : ['water', 'trees', 'sand'], 3)) return false;
    if (Math.abs(p.x - this.cx(p.y)) > ROUGH_HW - 8 || p.y > this.yTee + 30 || p.y < -60) return false;
    if (!allowGreen && this.inGreen(p, 9)) return false;
    return true;
  }

  // Find the nearest playable spot: try sideways first, then a little forward or back,
  // but never behind `maxY` (the ball's current spot), so shots never go backwards.
  safeSpot(p, opts = {}, maxY = Infinity) {
    const off = p.x - this.cx(p.y);
    for (const dy of [0, -6, 6, -12, 12, -18, 18, -26, 26]) {
      const y = p.y + dy;
      if (y > maxY) continue;
      for (const dx of [0, 10, -10, 18, -18]) {
        const q = { x: this.cx(y) + off + dx, y };
        if (this.playable(q, opts)) return q;
      }
    }
    return { ...p };
  }

  // Where a legal link sends the ball. The ball only ever moves toward the hole:
  //  - closer link: to that distance's spot (or onto the green when one link away),
  //  - a link that isn't closer: a short lay-up / chunk that still edges forward,
  //    stopping short of the green so "on the green" always means the pin is one link away.
  targetFor(fromDist, toDist) {
    const p = this.pos;
    if (toDist <= 1) return this.posFor(toDist);
    const floorY = this.green.y + this.greenR(Math.PI / 2, 40); // stay well short of the green
    if (toDist < fromDist) {
      const spot = this.posFor(toDist);
      let y = spot.y;
      if (y > p.y - 20) { // lay-ups already carried us past that spot: keep moving forward a little
        const next = toDist - 1 <= 1 ? floorY : this.posFor(toDist - 1).y + 30;
        y = Math.max(p.y - 30, next);
        if (y >= p.y) y = p.y - 6;
      }
      return this.safeSpot({ x: this.cx(y), y }, {}, p.y);
    }
    const adv = toDist === fromDist ? 26 : 12;
    this.laySide = -(this.laySide || 1);
    let y = Math.max(p.y - adv, floorY);
    if (y > p.y) y = p.y;
    const x = y === p.y ? p.x + this.laySide * 8 : this.cx(y) + this.laySide * 7;
    return this.safeSpot({ x, y }, {}, p.y);
  }

  clubFor(p = this.pos) {
    if (this.onGreen(p)) return { name: 'Putter', type: 'putter' };
    const yd = this.yardsToPin(p);
    if (this.onTee(p) && this.par >= 4) return { name: 'Driver', type: 'driver' };
    if (yd > 235) return { name: '3-wood', type: 'wood' };
    if (yd > 205) return { name: 'Hybrid', type: 'wood' };
    const irons = [[185, '5-iron'], [168, '6-iron'], [152, '7-iron'], [138, '8-iron'], [124, '9-iron'], [100, 'Pitching wedge']];
    for (const [min, name] of irons) if (yd > min) return { name, type: 'iron' };
    return { name: this.inGreen(p, 5) ? 'Putter' : 'Sand wedge', type: this.inGreen(p, 5) ? 'putter' : 'iron' };
  }

  updateLie() {
    if (!this.lieLabel) return;
    const club = this.clubFor();
    const dist = this.onGreen() ? `${Math.max(1, Math.round(this.yardsToPin() * 3))} ft` : `${this.yardsToPin()} yds`;
    this.lieLabel.textContent = `${this.lie()} · ${club.name} · ${dist}`;
  }

  // Camera: x/y = the point to frame, w = zoom (world units across the screen's geometric-mean
  // side, so any screen shape shows about the same amount of course), a = where that point sits
  // within the open area between the HUD overlays (0 = top, 1 = bottom).
  camFor(p = this.pos) {
    if (this.onGreen(p)) return { x: p.x / 2, y: p.y / 2, w: 128, a: 0.55 };
    if (this.onTee(p)) return { x: p.x, y: p.y, w: 112, a: 0.74 };
    return { x: p.x, y: p.y, w: 170, a: 0.7 };
  }

  setInsets(top, bottom) {
    this.insets = { top, bottom };
    this.setCam(this.cam);
  }

  setCam(c) {
    this.cam = c;
    const W = this.wrap.clientWidth || 360, H = this.wrap.clientHeight || 250;
    const vw = c.w * Math.sqrt(W / H), vh = c.w * Math.sqrt(H / W);
    const ins = this.insets || { top: 0, bottom: 0 };
    const open = Math.max(80, H - ins.top - ins.bottom);
    const yPx = ins.top + c.a * open;
    const vx = c.x - vw / 2, vy = c.y - vh * (yPx / H);
    const vb = `${vx.toFixed(2)} ${vy.toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}`;
    this.svg.setAttribute('viewBox', vb);
    this.top.setAttribute('viewBox', vb);
    if (this.world && this.L) {
      const s = W / vw;
      this.world.style.transform = `translate3d(${((this.L.x0 - vx) * s).toFixed(2)}px, ${((this.L.y0 - vy) * s).toFixed(2)}px, 0) scale(${s.toFixed(5)})`;
      this.queueTiles(vx, vy, vw, vh);
    }
  }

  // ---- sharp terrain tiles ----------------------------------------------------------------
  // Pixels per world unit needed so the course stays crisp at the closest camera zoom on this
  // screen (device pixel ratio included). 0 = the base layer is already sharp enough.
  computeHiPpu() {
    if (!this.terrain) return 0;
    const W = this.wrap.clientWidth || 360, H = this.wrap.clientHeight || 640;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const closest = W / (112 * Math.sqrt(W / H)); // css px per unit at the tee-box zoom
    const want = Math.min(20, closest * dpr);
    return want > this.terrain.basePpu * 1.3 ? want : 0;
  }

  queueTiles(vx, vy, vw, vh) {
    if (!this.hiPpu) return;
    const L = this.L;
    const i0 = Math.floor((vx - L.x0) / TILE) - 1, i1 = Math.floor((vx + vw - L.x0) / TILE) + 1;
    const j0 = Math.floor((vy - L.y0) / TILE) - 1, j1 = Math.floor((vy + vh - L.y0) / TILE) + 1;
    const cx = vx + vw / 2, cy = vy + vh / 2;
    this.tileCenter = { x: cx, y: cy };
    const want = [];
    for (let j = Math.max(0, j0); j <= j1; j++) {
      for (let i = Math.max(0, i0); i <= i1; i++) {
        if (L.x0 + i * TILE > L.x0 + L.w || L.y0 + j * TILE > L.y0 + L.h) continue;
        const k = `${i},${j}`;
        if (this.tiles.has(k)) continue;
        const d = Math.hypot(L.x0 + (i + 0.5) * TILE - cx, L.y0 + (j + 0.5) * TILE - cy);
        want.push([d, k]);
      }
    }
    want.sort((a, b) => a[0] - b[0]);
    this.wanted = want.map((w) => w[1]);
    if (this.wanted.length && !this.pumping) { this.pumping = true; requestAnimationFrame(() => this.pumpTiles()); }
  }

  pumpTiles() {
    const t0 = performance.now();
    while (this.wanted.length && performance.now() - t0 < 9) {
      const k = this.wanted.shift();
      if (!this.tiles.has(k)) this.renderTile(k);
    }
    if (this.wanted.length) requestAnimationFrame(() => this.pumpTiles());
    else this.pumping = false;
  }

  renderTile(k) {
    const L = this.L;
    const [i, j] = k.split(',').map(Number);
    const R = { x: L.x0 + i * TILE - TILE_BLEED, y: L.y0 + j * TILE - TILE_BLEED, w: TILE + 2 * TILE_BLEED, h: TILE + 2 * TILE_BLEED };
    const cv = this.terrain.renderRegion(R, this.hiPpu);
    cv.className = 'tile';
    cv.style.left = `${R.x - L.x0}px`;
    cv.style.top = `${R.y - L.y0}px`;
    cv.style.width = `${R.w}px`;
    cv.style.height = `${R.h}px`;
    this.tileLayer.appendChild(cv);
    this.tiles.set(k, cv);
    if (this.tiles.size > MAX_TILES) { // forget the tiles furthest from the camera
      const c = this.tileCenter;
      const far = [...this.tiles.entries()].map(([key, el]) => {
        const [a, b] = key.split(',').map(Number);
        return [Math.hypot(L.x0 + (a + 0.5) * TILE - c.x, L.y0 + (b + 0.5) * TILE - c.y), key, el];
      }).sort((x, y) => y[0] - x[0]);
      for (const [, key, el] of far.slice(0, this.tiles.size - MAX_TILES)) { el.remove(); this.tiles.delete(key); }
    }
  }

  // On resize, rebuild tiles if the needed sharpness changed.
  refreshTiles() {
    const ppu = this.computeHiPpu();
    if (Math.abs(ppu - (this.hiPpu || 0)) > 1.5) {
      this.hiPpu = ppu;
      for (const el of this.tiles.values()) el.remove();
      this.tiles.clear();
    }
    this.setCam(this.cam);
  }

  panTo(target, ms = 600) {
    const from = { ...this.cam };
    return tween(ms, (t) => this.setCam({ x: lerp(from.x, target.x, t), y: lerp(from.y, target.y, t), w: lerp(from.w, target.w, t), a: lerp(from.a, target.a, t) }));
  }

  // Ball drawn at ground point p, lifted by height h (bigger, with its shadow left on the ground).
  drawBall(p, h = 0, scale = 1) {
    const k = (1 + h / 32) * scale;
    const by = p.y - h * 0.45;
    this.ball.setAttribute('transform', `translate(${p.x.toFixed(3)} ${by.toFixed(3)}) scale(${k.toFixed(4)})`);
    this.shadow.setAttribute('cx', p.x + 0.35 + h * 0.18); this.shadow.setAttribute('cy', p.y + 0.55 + h * 0.08);
    this.shadow.setAttribute('rx', BALL_R * (1.35 - Math.min(0.4, h / 110)) * scale); this.shadow.setAttribute('ry', BALL_R * (0.95 - Math.min(0.3, h / 150)) * scale);
    this.shadow.setAttribute('opacity', Math.max(0.3, 1 - h / 70));
    return { x: p.x, y: by };
  }

  // Put the ball at the spot for `dist` links to go, with no animation (hole start / reload).
  placeAt(dist) {
    this.curDist = dist;
    this.pos = this.posFor(dist);
    this.drawBall(this.pos);
    this.ball.style.opacity = 1; this.shadow.style.opacity = 1;
    this.teePeg?.setAttribute('opacity', dist >= this.D ? 1 : 0);
    this.setCam(this.camFor());
    this.aim = this.defaultAim();
    this.setClub({ angle: 0 });
    this.club.style.opacity = 1;
    this.updateLie();
  }

  hideBall() { this.ball.style.opacity = 0; this.shadow.style.opacity = 0; this.club.style.opacity = 0; }

  // ---- the club ---------------------------------------------------------------------------
  buildClub() {
    this.swingG = el('g', {}, this.club);
    this.clubShadow = el('g', { opacity: 0.22, transform: 'translate(1.1 1.4)' }, this.swingG);
    this.shaft = el('line', { 'stroke-width': 0.55, 'stroke-linecap': 'round' }, this.swingG);
    this.shaftHi = el('line', { stroke: 'rgba(255,255,255,.45)', 'stroke-width': 0.14, 'stroke-linecap': 'round' }, this.swingG);
    this.grip = el('line', { stroke: '#16181a', 'stroke-width': 1.2, 'stroke-linecap': 'round' }, this.swingG);
    this.gripRibs = el('line', { stroke: '#3a3f44', 'stroke-width': 1.2, 'stroke-dasharray': '0.18 0.32' }, this.swingG);
    this.ferrule = el('circle', { r: 0.42, fill: '#111' }, this.swingG);
    this.headG = el('g', {}, this.swingG);
    this.clubType = null;
  }

  drawHead(type) {
    const h = this.headG;
    h.innerHTML = '';
    this.clubShadow.innerHTML = '';
    let outline;
    if (type === 'driver' || type === 'wood') {
      const k = type === 'driver' ? 0.86 : 0.66;
      const g = el('g', { transform: `translate(0 2.5) scale(${k}) translate(0 -2.5)` }, h);
      outline = 'M-5 2.5 L5 2.5 C6.8 4 6.6 9.2 2.6 11 C-1.3 12.6 -6.2 10.4 -6.4 6.4 C-6.5 4.6 -6 3.2 -5 2.5 Z';
      el('path', { d: outline, fill: 'url(#crown)', stroke: '#030404', 'stroke-width': 0.3 }, g);
      el('path', { d: outline, fill: 'url(#carbon)' }, g);
      el('path', { d: 'M-5 2.5 L5 2.5 L5.3 3.2 L-5.2 3.3 Z', fill: 'url(#steel)' }, g); // face edge
      for (let x = -3.6; x <= 3.6; x += 1.2) el('line', { x1: x, y1: 2.6, x2: x, y2: 3.15, stroke: 'rgba(60,66,70,.5)', 'stroke-width': 0.12 }, g);
      el('path', { d: 'M-3.6 7.2 C-2 5.4 2.2 5.2 3.8 7', stroke: 'rgba(255,255,255,.28)', 'stroke-width': 0.55, fill: 'none', 'stroke-linecap': 'round' }, g); // crown sheen
      el('path', { d: 'M-0.9 4.1 L0 5.6 L0.9 4.1', stroke: '#e9edef', 'stroke-width': 0.35, fill: 'none', 'stroke-linejoin': 'round' }, g); // alignment chevron
      el('path', { d: outline, fill: '#000', transform: `translate(0 2.5) scale(${k}) translate(0 -2.5)` }, this.clubShadow);
    } else if (type === 'iron') {
      outline = 'M-4.4 2.3 L4.1 2.3 C4.9 2.4 5.2 3.2 4.8 4 L4.2 4.5 L-4.4 4.8 Z';
      el('path', { d: outline, fill: 'url(#steel)', stroke: '#5f686e', 'stroke-width': 0.25 }, h);
      el('path', { d: 'M-3.4 3.4 L3.6 3.2 L3.4 4.1 L-3.4 4.3 Z', fill: 'rgba(90,98,104,.45)' }, h); // cavity back
      for (let x = -3; x <= 3; x += 0.9) el('line', { x1: x, y1: 2.45, x2: x + 0.1, y2: 3, stroke: 'rgba(80,88,94,.55)', 'stroke-width': 0.1 }, h);
      el('path', { d: 'M-4 2.55 L3.9 2.5', stroke: 'rgba(255,255,255,.7)', 'stroke-width': 0.14 }, h);
      el('path', { d: outline, fill: '#000' }, this.clubShadow);
    } else {
      outline = 'M-4.6 2.4 L4.6 2.4 L4.6 3.4 C4.6 7.8 -4.6 7.8 -4.6 3.4 Z';
      el('path', { d: outline, fill: 'url(#putterFace)', stroke: '#0a0b0c', 'stroke-width': 0.3 }, h);
      el('path', { d: 'M-3.2 3.6 C-3.2 6.4 3.2 6.4 3.2 3.6 Z', fill: 'rgba(200,205,210,.25)' }, h);
      el('rect', { x: -4.3, y: 2.45, width: 8.6, height: 0.7, fill: 'url(#steel)' }, h); // face insert
      el('line', { x1: 0, y1: 3.4, x2: 0, y2: 6.6, stroke: '#fff', 'stroke-width': 0.45 }, h);
      el('line', { x1: -1.2, y1: 4.2, x2: -1.2, y2: 6, stroke: '#fff', 'stroke-width': 0.25, opacity: 0.8 }, h);
      el('line', { x1: 1.2, y1: 4.2, x2: 1.2, y2: 6, stroke: '#fff', 'stroke-width': 0.25, opacity: 0.8 }, h);
      el('path', { d: outline, fill: '#000' }, this.clubShadow);
    }
    const graphite = type === 'driver' || type === 'wood';
    this.shaft.setAttribute('stroke', graphite ? 'url(#graphite)' : 'url(#steel)');
  }

  setClub({ angle = 0, type } = {}) {
    type = type || this.clubFor().type;
    const c = CLUBS[type];
    if (type !== this.clubType) { this.drawHead(type); this.clubType = type; }
    const gripEnd = { x: lerp(c.hands.x, c.hosel.x, 0.3), y: lerp(c.hands.y, c.hosel.y, 0.3) };
    const set = (e, a, b) => { e.setAttribute('x1', a.x); e.setAttribute('y1', a.y); e.setAttribute('x2', b.x); e.setAttribute('y2', b.y); };
    set(this.grip, c.hands, gripEnd);
    set(this.gripRibs, c.hands, gripEnd);
    set(this.shaft, gripEnd, c.hosel);
    set(this.shaftHi, { x: gripEnd.x, y: gripEnd.y - 0.12 }, { x: c.hosel.x, y: c.hosel.y - 0.12 });
    this.ferrule.setAttribute('cx', lerp(gripEnd.x, c.hosel.x, 0.93)); this.ferrule.setAttribute('cy', lerp(gripEnd.y, c.hosel.y, 0.93));
    this.swingG.setAttribute('transform', `rotate(${angle} ${c.pivot.x} ${c.pivot.y})`);
    this.club.setAttribute('transform', `translate(${this.pos.x} ${this.pos.y}) rotate(${this.aim})`);
    this.clubAngle = angle;
  }

  aimTo(p) { return (Math.atan2(p.x - this.pos.x, -(p.y - this.pos.y)) * 180) / Math.PI; }
  aimDir() { return rot({ x: 0, y: -1 }, this.aim); }

  defaultAim() {
    const ahead = (this.yTee - GREEN_SPOT) / (this.D - 1);
    if (this.inGreen(this.pos, 30) || this.pos.y < ahead) return this.aimTo({ x: 0, y: 0 });
    const y = Math.max(GREEN_SPOT, this.pos.y - ahead);
    return this.aimTo({ x: this.cx(y), y });
  }

  async aimAt(p) {
    const from = this.aim;
    let to = this.aimTo(p);
    while (to - from > 180) to -= 360;
    while (to - from < -180) to += 360;
    this.club.style.opacity = 1;
    await tween(240, (t) => { this.aim = lerp(from, to, t); this.setClub({ angle: 0 }); });
  }

  // Backswing, pause at the top, downswing; `onImpact` fires as the head reaches the ball.
  async swing({ onImpact, miss = false } = {}) {
    const type = this.clubFor().type;
    const c = CLUBS[type];
    await tween(c.swingMs[0], (t) => this.setClub({ angle: c.back * t, type }), ease.out);
    await sleep(type === 'putter' ? 60 : 140);
    let fired = false;
    const impactAt = c.back / (c.back - c.thru);
    await tween(c.swingMs[1], (t) => {
      this.setClub({ angle: c.back + (c.thru - c.back) * t, type });
      if (!fired && t >= impactAt) { fired = true; if (miss) this.divot(); else onImpact?.(); }
    }, ease.in);
    if (!fired) onImpact?.();
    return type;
  }

  clubAway() { return tween(260, (t) => { this.club.style.opacity = 1 - t; }); }

  async settle() {
    this.updateLie();
    await this.panTo(this.camFor(), 700);
    this.aim = this.defaultAim();
    this.setClub({ angle: 0 });
    await tween(220, (t) => { this.club.style.opacity = t; });
  }

  // ---- ball flight -----------------------------------------------------------------------
  clearTracer() { this.tracer.innerHTML = ''; }

  // Flies along a cubic curve (p0 -> p3) with a shot tracer, the camera chasing the ball.
  async flyCurve(p1, p2, p3, { height = 40, ms = 1200, follow = true, onFrame } = {}) {
    const p0 = { ...this.pos };
    const cam0 = { ...this.cam };
    const far = this.camFor(p3);
    this.clearTracer();
    const glow = el('polyline', { fill: 'none', stroke: 'rgba(255,255,255,.35)', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, this.tracer);
    const line = el('polyline', { fill: 'none', stroke: 'var(--tracer)', 'stroke-width': 0.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, this.tracer);
    const pts = [];
    this.teePeg?.setAttribute('opacity', 0);
    await tween(ms, (t) => {
      const u = 1 - t;
      const p = {
        x: u ** 3 * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t ** 3 * p3.x,
        y: u ** 3 * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t ** 3 * p3.y,
      };
      // golf-ball flight peaks late, then drops steeply
      const h = height * Math.sin(Math.PI * Math.pow(t, 0.8));
      const seen = this.drawBall(p, h);
      pts.push(`${seen.x.toFixed(2)},${seen.y.toFixed(2)}`);
      glow.setAttribute('points', pts.join(' '));
      line.setAttribute('points', pts.join(' '));
      if (follow) this.setCam({ x: p.x, y: p.y, w: lerp(cam0.w, far.w, t) * (1 + 0.3 * Math.sin(Math.PI * t)), a: lerp(cam0.a, far.a, t) });
      onFrame?.(t, p, h);
    }, ease.lin);
    this.pos = { ...p3 };
  }

  fadeTracer(delay = 500) {
    const g = this.tracer;
    setTimeout(() => tween(600, (t) => { g.style.opacity = 1 - t; }).then(() => { g.innerHTML = ''; g.style.opacity = 1; }), delay);
  }

  // A proper shot: flies to a landing point short of `rest`, bounces twice and rolls out to `rest`.
  async fly(rest, { height = 40, ms = 1200, rollout = 16, draw = 0.05 } = {}) {
    const from = { ...this.pos };
    const dir = norm({ x: rest.x - from.x, y: rest.y - from.y });
    const L = Math.hypot(rest.x - from.x, rest.y - from.y);
    rollout = Math.min(rollout, L * 0.3);
    const land = add(rest, dir, -rollout);
    // a gentle draw: starts a touch right of the line and curls back onto it
    const right = { x: -dir.y, y: dir.x };
    const p1 = add(add(from, dir, L * 0.35), right, L * draw);
    const p2 = add(add(from, dir, L * 0.7), right, L * draw * 0.5);
    await this.flyCurve(p1, p2, land, { height, ms });
    this.puff(land);
    const b1 = add(land, dir, rollout * 0.45), b2 = add(b1, dir, rollout * 0.25);
    await tween(280, (t) => this.drawBall({ x: lerp(land.x, b1.x, t), y: lerp(land.y, b1.y, t) }, 5 * Math.sin(Math.PI * t)), ease.lin);
    await tween(200, (t) => this.drawBall({ x: lerp(b1.x, b2.x, t), y: lerp(b1.y, b2.y, t) }, 1.8 * Math.sin(Math.PI * t)), ease.lin);
    await tween(480, (t) => this.drawBall({ x: lerp(b2.x, rest.x, t), y: lerp(b2.y, rest.y, t) }), ease.outQuad);
    this.pos = { ...rest };
    this.drawBall(rest);
    this.fadeTracer();
    this.updateLie();
  }

  async roll(to, ms = 900, { follow = false } = {}) {
    const from = { ...this.pos };
    await tween(ms, (t) => {
      const p = { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) };
      this.drawBall(p);
      if (follow) this.setCam({ ...this.cam, x: lerp(this.cam.x, p.x, 0.08), y: lerp(this.cam.y, p.y, 0.08) });
    }, ease.outQuad);
    this.pos = { ...to };
  }

  // Putt that catches the edge of the cup, spins around the rim and pops out to `spot`.
  async lipOut(spot) {
    const from = { ...this.pos };
    const a0 = Math.atan2(from.y, from.x);
    const R = 2.9;
    const entry = { x: Math.cos(a0) * R, y: Math.sin(a0) * R };
    await tween(760, (t) => this.drawBall({ x: lerp(from.x, entry.x, t), y: lerp(from.y, entry.y, t) }), ease.outQuad);
    const spin = (this.rand() < 0.5 ? -1 : 1) * Math.PI * 1.4;
    await tween(440, (t) => {
      const a = a0 + spin * t;
      this.drawBall({ x: Math.cos(a) * R, y: Math.sin(a) * R }, 0, 1 - 0.12 * Math.sin(Math.PI * t));
    }, ease.lin);
    const a1 = a0 + spin;
    this.pos = { x: Math.cos(a1) * R, y: Math.sin(a1) * R };
    await this.roll(spot, 650);
  }

  // ---- shots called by the game ------------------------------------------------------------
  // A legal link: advance from `fromDist` links-to-go to `toDist` (ob = out-of-bounds answer).
  async shot(fromDist, toDist, { ob = false } = {}) {
    const putting = this.onGreen();
    this.curDist = toDist;
    if (ob) {
      const side = this.rand() < 0.5 ? -1 : 1;
      let drop;
      if (toDist === 1) drop = this.greenDrop(side);
      else {
        const t = this.targetFor(fromDist, toDist);
        drop = this.safeSpot({ x: this.cx(t.y) + side * DROP_LAT, y: t.y }, { allowSand: true }, this.pos.y);
      }
      return this.obShot(drop, side);
    }
    let target = putting && toDist > 1 ? this.safeSpot({ x: this.cx(70) + 6, y: this.green.y + this.greenR(Math.PI / 2, 14) }) : this.targetFor(fromDist, toDist);
    if (putting && toDist === 1) {
      const d = norm({ x: -this.pos.x, y: -this.pos.y });
      target = { x: d.x * 12 + d.y * 4, y: d.y * 12 - d.x * 4 }; // lips out and finishes past the hole
    }
    await this.aimAt(putting && toDist === 1 ? { x: 0, y: 0 } : target);
    const type = this.clubFor().type;
    const closer = toDist < fromDist;
    let launched;
    await this.swing({ onImpact: () => {
      if (putting) launched = toDist === 1 ? this.lipOut(target) : this.roll(target, 1300, { follow: true });
      else if (closer) launched = this.fly(target, type === 'driver' ? { height: 46, ms: 1500, rollout: 22 } : type === 'wood' ? { height: 40, ms: 1350, rollout: 16 } : { height: 38, ms: 1200, rollout: 7 });
      else launched = this.fly(target, toDist === fromDist ? { height: 20, ms: 850, rollout: 6 } : { height: 6, ms: 600, rollout: 5, draw: 0 });
    } });
    this.clubAway();
    await launched;
    if (putting) this.toast(toDist === 1 ? 'Lipped out!' : 'Ran it off the green', 'meh');
    else if (closer) this.toast(toDist === 1 ? 'On the green!' : type === 'driver' ? 'Great drive!' : 'Nice shot!', 'good');
    else if (toDist === fromDist) this.toast('Laid up — no closer', 'meh');
    else this.toast('Chunked it — further from the pin', 'bad');
    await this.settle();
  }

  // A hook or slice: starts on line, then curves hard into the woods. Drop in the rough on that side.
  async obShot(drop, side) {
    const from = { ...this.pos };
    const ahead = this.aimTo({ x: this.cx(from.y - 120), y: from.y - 120 });
    await this.aimAt(add(from, rot({ x: 0, y: -1 }, ahead), 100));
    const dir = this.aimDir();
    const L = Math.min(150, Math.max(90, from.y * 0.7));
    const endY = from.y - L * 0.8;
    const end = { x: this.cx(endY) + side * (ROUGH_HW + 28), y: endY };
    const perp = { x: -dir.y, y: dir.x }; // golfer's right
    const p1 = add(add(from, dir, L * 0.45), perp, side * L * 0.04);
    const p2 = add(add(from, dir, L * 0.8), perp, side * L * 0.32);
    let launched;
    await this.swing({ onImpact: () => { launched = this.flyCurve(p1, p2, end, { height: 44, ms: 1450 }); } });
    this.clubAway();
    await launched;
    this.ball.style.opacity = 0; this.shadow.style.opacity = 0;
    this.leaves(end);
    this.toast(side < 0 ? 'Snap hook — out of bounds!' : 'Big slice — out of bounds!', 'bad');
    this.fadeTracer(700);
    await sleep(1000);
    this.pos = drop;
    await this.panTo(this.camFor(drop), 850);
    this.ball.style.opacity = 1; this.shadow.style.opacity = 1;
    this.toast('+1 penalty · drop in the rough', 'penalty');
    await tween(460, (t) => this.drawBall(drop, 24 * (1 - t)), ease.in);
    await tween(250, (t) => this.drawBall(drop, 3 * Math.sin(Math.PI * t)), ease.lin);
    this.drawBall(drop);
    this.updateLie();
    await this.settle();
  }

  async holed() {
    await this.aimAt({ x: 0, y: 0 });
    if (!this.onGreen()) return this.chipIn();
    let launched;
    await this.swing({ onImpact: () => {
      const from = { ...this.pos };
      launched = (async () => {
        await tween(900, (t) => this.drawBall({ x: lerp(from.x, 0, t), y: lerp(from.y, 0, t) }), ease.outQuad);
        await tween(240, (t) => this.drawBall({ x: 0, y: 0 }, 0, 1 - t * 0.85), ease.in);
        this.ball.style.opacity = 0; this.shadow.style.opacity = 0;
      })();
    } });
    this.clubAway();
    await launched;
    this.pos = { x: 0, y: 0 };
    this.flag.classList.add('celebrate');
    this.confetti();
    this.toast('In the hole!', 'good big');
    await sleep(1500);
    this.flag.classList.remove('celebrate');
  }

  // Holing out from off the green: a low chip that lands on the green and trickles in.
  async chipIn() {
    const from = { ...this.pos };
    const land = { x: lerp(from.x, 0, 0.55), y: lerp(from.y, 0, 0.55) };
    let launched;
    await this.swing({ onImpact: () => {
      launched = (async () => {
        await this.flyCurve(land, land, land, { height: 14, ms: 750, follow: false });
        await tween(900, (t) => this.drawBall({ x: lerp(land.x, 0, t), y: lerp(land.y, 0, t) }), ease.outQuad);
        await tween(240, (t) => this.drawBall({ x: 0, y: 0 }, 0, 1 - t * 0.85), ease.in);
        this.ball.style.opacity = 0; this.shadow.style.opacity = 0;
      })();
    } });
    this.clubAway();
    await launched;
    this.fadeTracer(200);
    this.pos = { x: 0, y: 0 };
    this.flag.classList.add('celebrate');
    this.confetti();
    this.toast('Chipped in!', 'good big');
    await sleep(1500);
    this.flag.classList.remove('celebrate');
  }

  // Wrong link. Off the green it's a shank that squirts forward-right; on the green a missed putt.
  // The ball stays where it ends up and the next shot is played from there.
  async whiff({ penalty = true } = {}) {
    const from = { ...this.pos };
    if (this.onGreen()) {
      const d = norm({ x: -from.x, y: -from.y });
      const dist = Math.hypot(from.x, from.y);
      let past = { x: from.x + d.x * (dist + 7) + d.y * 4.5, y: from.y + d.y * (dist + 7) - d.x * 4.5 };
      if (!this.inGreen(past, -2)) past = { x: d.y * 4.5, y: -d.x * 4.5 }; // just slides by the cup
      await this.aimAt({ x: 0, y: 0 });
      let launched;
      await this.swing({ onImpact: () => { launched = this.roll(past, 1000); } });
      await launched;
      this.toast('Missed putt!', 'bad');
    } else {
      await this.aimAt(add(from, rot({ x: 0, y: -1 }, this.defaultAim()), 100));
      const dir = this.aimDir();
      const opts = { allowSand: true, allowGreen: this.curDist === 1 };
      let sq = rot(dir, 38), len = 6;
      search: for (const L of [18, 12, 8]) {
        for (const a of [38, 26, 50]) {
          const v = rot(dir, a);
          if (this.playable(add(from, v, L + 4), opts) && (opts.allowGreen || !this.inGreen(add(from, v, L + 4), 9))) { sq = v; len = L; break search; }
        }
      }
      const end = add(from, sq, len);
      let launched;
      await this.swing({ onImpact: () => { launched = this.flyCurve(add(from, sq, len * 0.35), add(from, sq, len * 0.7), end, { height: 6, ms: 480, follow: false }); } });
      await launched;
      await this.roll(add(end, sq, 4), 380);
      this.toast('Shanked it!', 'bad');
      this.fadeTracer(300);
    }
    this.clubAway();
    if (penalty) this.toast('+1 penalty stroke', 'penalty');
    await sleep(450);
    await this.settle();
    return from;
  }

  // First wrong link of the day: shank, then the shot is undone and the ball hops back.
  async mulligan() {
    const from = await this.whiff({ penalty: false });
    const stamp = document.createElement('div');
    stamp.className = 'stamp';
    stamp.textContent = 'Mulligan';
    this.wrap.appendChild(stamp);
    await this.clubAway();
    const at = { ...this.pos };
    await tween(650, (t) => this.drawBall({ x: lerp(at.x, from.x, t), y: lerp(at.y, from.y, t) }, 5 * Math.sin(Math.PI * t)), ease.inOut);
    this.pos = from; this.drawBall(from);
    this.updateLie();
    await this.panTo(this.camFor(), 350);
    this.aim = this.defaultAim();
    this.club.style.opacity = 1;
    await tween(500, (t) => this.setClub({ angle: -360 * (1 - t) }), ease.out); // club spins back to address
    this.sparkle();
    this.toast('Free do-over — no penalty', 'good');
    await sleep(600);
    stamp.classList.add('out');
    setTimeout(() => stamp.remove(), 400);
  }

  async pickUp() {
    this.toast('Picked up', 'bad');
    await tween(500, (t) => { this.ball.style.opacity = 1 - t; this.shadow.style.opacity = 1 - t; this.club.style.opacity = 1 - t; });
  }

  // ---- effects --------------------------------------------------------------------------
  toast(text, cls = '') {
    if (!this.toastBox) return;
    const t = document.createElement('div');
    t.className = `toast ${cls}`;
    t.textContent = text;
    this.toastBox.appendChild(t);
    setTimeout(() => t.remove(), 1900);
  }

  particles(at, n, colors, { spread = 10, ms = 650, size = 1 } = {}) {
    for (let i = 0; i < n; i++) {
      const p = el('ellipse', { rx: 0.7 * size, ry: 0.45 * size, fill: colors[i % colors.length] }, this.fx);
      const ang = Math.random() * Math.PI * 2, sp = spread * (0.4 + Math.random() * 0.6);
      tween(ms, (t) => {
        p.setAttribute('cx', at.x + Math.cos(ang) * sp * t);
        p.setAttribute('cy', at.y + Math.sin(ang) * sp * t * 0.6 - 4 * Math.sin(Math.PI * t));
        p.style.opacity = 1 - t;
      }, ease.out).then(() => p.remove());
    }
  }

  puff(at) { this.particles(at, 8, ['var(--rough-hi)', 'var(--stripe)'], { spread: 6, ms: 500 }); }

  divot() {
    const c = CLUBS[this.clubFor().type];
    const base = add(this.pos, rot({ x: c.hosel.x + 5, y: c.hosel.y }, this.aim));
    this.particles(base, 10, ['#7a5a34', 'var(--rough-dark)'], { spread: 12, ms: 650, size: 1.4 });
  }

  leaves(at) { this.particles(at, 16, ['var(--leaf-a-hi)', 'var(--leaf-c)'], { spread: 16, ms: 900, size: 1.8 }); }

  sparkle() {
    const g = el('g', {}, this.fx);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      el('line', { x1: this.pos.x + Math.cos(a) * 3.5, y1: this.pos.y + Math.sin(a) * 3.5, x2: this.pos.x + Math.cos(a) * 7, y2: this.pos.y + Math.sin(a) * 7, stroke: '#ffd84a', 'stroke-width': 0.6, 'stroke-linecap': 'round' }, g);
    }
    setTimeout(() => g.remove(), 900);
  }

  confetti() {
    if (reduceMotion()) return;
    const colors = ['#ffd84a', '#e8423f', '#4aa8ff', '#ffffff', '#7ee07a'];
    for (let i = 0; i < 36; i++) {
      const p = el('rect', { width: 1.6, height: 0.9, fill: colors[i % colors.length] }, this.fx);
      const ang = Math.random() * Math.PI * 2, sp = 10 + Math.random() * 26, r0 = Math.random() * 720;
      tween(1400, (t) => {
        p.setAttribute('transform', `translate(${Math.cos(ang) * sp * t} ${Math.sin(ang) * sp * t}) rotate(${r0 * t})`);
        p.style.opacity = 1 - t * t;
      }, ease.out).then(() => p.remove());
    }
  }
}
