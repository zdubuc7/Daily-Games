// The Links — paints a hole's static scenery (grass, sand, water, trees...) into one canvas.
// The scene module lays the hole out; this module only draws it. The canvas is rendered once per
// hole at a few pixels per world unit, then the camera just moves/scales it (cheap on the GPU),
// while the ball, club, flag and effects stay as crisp vector layers on top.
const TAU = Math.PI * 2;
const MAX_PIXELS = 6e6; // the whole-hole base layer; sharp tiles add detail where you look
const MAX_PPU = 6.5;

// ---- shared noise textures (built once) --------------------------------------------------
let TEX = null;
function textures() {
  if (TEX) return TEX;
  const make = (n, fill) => {
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    const img = g.createImageData(n, n);
    fill(img.data, n);
    g.putImageData(img, 0, 0);
    return c;
  };
  // fine grain: per-pixel speckle with short vertical "blades"
  const grain = make(192, (d, n) => {
    const v = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) v[i] = (Math.random() - 0.5) * 70;
    for (let k = 0; k < n * n * 0.05; k++) {
      const x = (Math.random() * n) | 0, y = (Math.random() * n) | 0, len = 2 + (Math.random() * 3) | 0, s = Math.random() < 0.5 ? -45 : 40;
      for (let j = 0; j < len; j++) v[((y + j) % n) * n + x] += s * (1 - j / len);
    }
    for (let i = 0; i < n * n; i++) { const c = Math.max(0, Math.min(255, 128 + v[i])); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = c; d[i * 4 + 3] = 255; }
  });
  // mottle: soft blotches (blurred random field, tileable)
  const mottle = make(96, (d, n) => {
    let v = new Float32Array(n * n).map(() => Math.random());
    for (let pass = 0; pass < 4; pass++) {
      const o = new Float32Array(n * n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        let s = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) s += v[((y + dy + n) % n) * n + ((x + dx + n) % n)];
        o[y * n + x] = s / 25;
      }
      v = o;
    }
    let lo = 1, hi = 0;
    for (const x of v) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    for (let i = 0; i < n * n; i++) { const c = ((v[i] - lo) / (hi - lo)) * 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = c; d[i * 4 + 3] = 255; }
  });
  // Surface textures, drawn 1 texture pixel = 1 screen pixel so they stay crisp at any zoom.
  // Each is tileable: strokes near an edge are repeated on the opposite side.
  const surface = (n, { blades = 0, len = [1, 3], speck = 40, wide = 1, bias = 0, grains = 0 }) => {
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    const img = g.createImageData(n, n);
    for (let i = 0; i < n * n; i++) { const v = 128 + (Math.random() - 0.5) * speck; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    g.lineCap = 'round';
    for (let i = 0; i < blades; i++) {
      const x = Math.random() * n, y = Math.random() * n, a = bias + (Math.random() - 0.5) * (bias ? 1.2 : Math.PI * 2);
      const l = len[0] + Math.random() * (len[1] - len[0]), v = Math.random();
      g.strokeStyle = v < 0.55 ? `rgba(0,0,0,${0.25 + Math.random() * 0.35})` : `rgba(255,255,255,${0.2 + Math.random() * 0.35})`;
      g.lineWidth = wide * (0.6 + Math.random() * 0.6);
      for (const ox of [0, -n, n]) for (const oy of [0, -n, n]) {
        if ((ox && Math.abs(x + ox - n / 2) > n / 2 + l) || (oy && Math.abs(y + oy - n / 2) > n / 2 + l)) continue;
        g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); g.stroke();
      }
    }
    for (let i = 0; i < grains; i++) {
      const x = Math.random() * n, y = Math.random() * n, r = 0.5 + Math.random() * 1.1;
      g.fillStyle = Math.random() < 0.6 ? `rgba(0,0,0,${0.15 + Math.random() * 0.3})` : `rgba(255,255,255,${0.2 + Math.random() * 0.4})`;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    return c;
  };
  const rough = surface(384, { blades: 16000, len: [2.5, 7], speck: 50, wide: 1.1 });
  const turf = surface(384, { blades: 22000, len: [1, 3], speck: 36, wide: 0.9, bias: -1.57 });
  const putting = surface(384, { blades: 14000, len: [0.8, 1.8], speck: 22, wide: 0.7 });
  const sandTex = surface(384, { speck: 70, grains: 9000 });
  TEX = { grain, mottle, rough, turf, putting, sand: sandTex };
  return TEX;
}

// ---- path helpers -------------------------------------------------------------------------
function bboxOf(pts, pad = 0) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

// Smooth Catmull-Rom curve through points as a Path2D (closed or open).
function smooth(pts, closed = true) {
  const p = new Path2D();
  const n = pts.length;
  const at = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  p.moveTo(pts[0].x, pts[0].y);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    p.bezierCurveTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y);
  }
  if (closed) p.closePath();
  p.bb = bboxOf(pts, 2);
  return p;
}

function poly(pts) {
  const p = new Path2D();
  pts.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)));
  p.closePath();
  p.bb = bboxOf(pts, 2);
  return p;
}

const hsl = (h, s, l, a = 1) => `hsla(${h}, ${s}%, ${l}%, ${a})`;

// ---- the painter ------------------------------------------------------------------------------
// Everything random (tufts, divots, reeds, which tree sprite...) is decided once in the
// constructor, so any region can be painted at any resolution and still match its neighbours.
// That lets the scene show a cheap whole-hole canvas plus sharp tiles where the camera looks.
const inter = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const near = (x, y, r, R) => x + r > R.x && x - r < R.x + R.w && y + r > R.y && y - r < R.y + R.h;

export class Terrain {
  constructor(L) {
    this.L = L;
    const rand = L.rand;
    this.full = { x: L.x0, y: L.y0, w: L.w, h: L.h };
    this.basePpu = Math.min(MAX_PPU, Math.sqrt(MAX_PIXELS / (L.w * L.h)));
    this.patOff = [rand() * 50, rand() * 50, rand() * 50, rand() * 50];

    this.corridor = poly(L.corridor);
    this.cart = smooth(L.cartPath, false);
    this.cart.bb = bboxOf(L.cartPath, 4);
    this.cut = poly(L.firstCut);
    this.fair = poly(L.fairway);
    this.collar = smooth(L.greenPts(5.5));
    this.green = smooth(L.greenPts(0));
    const t = L.tee;
    this.teePath = new Path2D();
    if (this.teePath.roundRect) this.teePath.roundRect(t.x - t.w / 2, t.y - t.h / 2, t.w, t.h, 3);
    else this.teePath.rect(t.x - t.w / 2, t.y - t.h / 2, t.w, t.h);
    this.teePath.bb = { x: t.x - t.w / 2 - 3, y: t.y - t.h / 2 - 3, w: t.w + 6, h: t.h + 6 };

    // grass tufts across the rough
    this.tufts = [];
    for (let i = 0; i < L.h * 1.2; i++) {
      const y = L.top + rand() * (L.bottom - L.top);
      this.tufts.push({ x: L.cx(y) + (rand() - 0.5) * 2 * L.roughHW, y, rx: 1.2 + rand() * 2.2, ry: 0.8 + rand() * 1.4, rot: rand() * TAU, dark: rand() < 0.5 });
    }
    // fine grass blades in the rough (only visible in the sharp tiles)
    this.blades = [];
    for (let i = 0; i < L.h * 9; i++) {
      const y = L.top + rand() * (L.bottom - L.top);
      this.blades.push({ x: L.cx(y) + (rand() - 0.5) * 2 * L.roughHW, y, a: -1.2 - rand() * 0.8, len: 0.6 + rand() * 0.9, dark: rand() < 0.55 });
    }
    this.divots = [];
    for (let i = 0; i < L.h * 0.1; i++) {
      const y = L.fy0 + 20 + rand() * (L.fy1 - L.fy0 - 30);
      this.divots.push({ x: L.cx(y) + (rand() - 0.5) * 2 * (L.hw(y) - 4), y, rot: (rand() - 0.5) * 0.6, brown: rand() < 0.5, rx: 0.25 + rand() * 0.25, ry: 0.45 + rand() * 0.35 });
    }
    this.water = L.water.map((w) => {
      const path = smooth(w.pts);
      return {
        ...w, path,
        refl: Array.from({ length: 5 }, () => ({ a: 0.06 + rand() * 0.07, x: w.x + (rand() - 0.6) * w.rx, y: w.y + (rand() - 0.6) * w.ry, rx: w.rx * (0.3 + rand() * 0.3), ry: 0.7 + rand(), rot: (rand() - 0.5) * 0.4 })),
        reeds: Array.from({ length: 16 }, (_, i) => {
          const p = w.pts[(i + (w.pts.length >> 1)) % w.pts.length];
          return { light: rand() >= 0.5, s: Array.from({ length: 3 }, () => [p.x + (rand() - 0.5) * 2, p.y + (rand() - 0.5) * 2, p.x + (rand() - 0.5) * 3, p.y - 1.5 - rand() * 1.5]) };
        }),
      };
    });
    if (L.creek) {
      this.creek = smooth(L.creek.pts, false);
      this.creek.bb = bboxOf(L.creek.pts, 8);
      this.stones = [];
      for (const p of L.creek.pts) for (let k = 0; k < 2; k++) {
        this.stones.push({ c: `rgba(${150 + rand() * 40 | 0},${150 + rand() * 30 | 0},${130 + rand() * 30 | 0},.55)`, x: p.x + (rand() - 0.5) * 8, y: p.y + (rand() - 0.5) * 6, rx: 0.5 + rand() * 0.6, ry: 0.4 + rand() * 0.4, rot: rand() * TAU });
      }
    }
    this.sand = L.sand.map((s) => ({ ...s, path: smooth(s.pts) }));
    this.teeDivots = Array.from({ length: 18 }, () => ({ x: t.x + (rand() - 0.5) * 20, y: t.y - 3 - rand() * 7, rot: (rand() - 0.5) * 0.5, brown: rand() < 0.6, rx: 0.22 + rand() * 0.2, ry: 0.45 + rand() * 0.35 }));
    const sprites = treeSprites();
    this.trees = L.trees.slice().sort((a, b) => a.y - b.y).map((tr) => {
      const set = sprites[tr.kind] || sprites.leafy;
      return { ...tr, sprite: set[Math.floor(rand() * set.length)], size: (tr.r * 2 * SPRITE) / (2 * SR) * (tr.kind === 'pine' ? 0.92 : 1) };
    });
    // soft tree shadows: a low-res layer that's scaled up (the scaling does the blur)
    const res = 0.55;
    const sh = document.createElement('canvas');
    sh.width = Math.max(1, Math.round(L.w * res));
    sh.height = Math.max(1, Math.round(L.h * res));
    const sg = sh.getContext('2d');
    sg.setTransform(res, 0, 0, res, -L.x0 * res, -L.y0 * res);
    sg.fillStyle = '#000';
    for (const tr of this.trees) { sg.beginPath(); sg.arc(tr.x + tr.r * 0.32, tr.y + tr.r * 0.38, tr.r * 1.02, 0, TAU); sg.fill(); }
    this.shadowCanvas = sh;
    this.shadowRes = res;
  }

  // The whole hole at a modest resolution (always shown, under the sharp tiles).
  renderBase() {
    return this.renderRegion(this.full, this.basePpu);
  }

  // One region (world units) at `ppu` pixels per unit, into its own canvas.
  renderRegion(R, ppu) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(R.w * ppu));
    cv.height = Math.max(1, Math.round(R.h * ppu));
    const g = cv.getContext('2d');
    g.setTransform(ppu, 0, 0, ppu, -R.x * ppu, -R.y * ppu);
    this.draw(g, ppu, R);
    return cv;
  }

  draw(g, ppu, R) {
    const L = this.L, T = textures();
    const sharp = ppu > 8;
    const pattern = (tex, unitsPerPx, k) => {
      const p = g.createPattern(tex, 'repeat');
      p.setTransform(new DOMMatrix([unitsPerPx, 0, 0, unitsPerPx, this.patOff[k], this.patOff[(k + 1) % 4]]));
      return p;
    };
    // texture scales are in world units, so every resolution shows the same grain
    const grainFine = pattern(T.grain, 0.15, 0);
    const grainMid = pattern(T.grain, 0.32, 1);
    const px = 1 / ppu; // one texture pixel per canvas pixel
    const roughTex = pattern(T.rough, px, 0);
    const turfTex = pattern(T.turf, px, 1);
    const puttTex = pattern(T.putting, px, 2);
    const sandTex = pattern(T.sand, px, 3);
    const mottleBig = pattern(T.mottle, 3.2, 2);
    const mottleSmall = pattern(T.mottle, 1.1, 3);
    const clipRect = (bb) => {
      const x0 = Math.max(bb.x, R.x), y0 = Math.max(bb.y, R.y);
      return { x: x0, y: y0, w: Math.min(bb.x + bb.w, R.x + R.w) - x0, h: Math.min(bb.y + bb.h, R.y + R.h) - y0 };
    };
    const texture = (path, tex, alpha, op = 'overlay') => {
      const bb = path.bb ? clipRect(path.bb) : R;
      if (bb.w <= 0 || bb.h <= 0) return;
      g.save(); g.clip(path); g.globalCompositeOperation = op; g.globalAlpha = alpha; g.fillStyle = tex; g.fillRect(bb.x, bb.y, bb.w, bb.h); g.restore();
    };
    const innerShadow = (path, { color, blur, dx, dy }) => {
      const bb = path.bb;
      g.save(); g.clip(path);
      g.shadowColor = color; g.shadowBlur = blur * ppu; g.shadowOffsetX = dx * ppu; g.shadowOffsetY = dy * ppu;
      const frame = new Path2D();
      frame.rect(bb.x - 40, bb.y - 40, bb.w + 80, bb.h + 80);
      frame.addPath(path);
      g.fillStyle = '#000'; g.fill(frame, 'evenodd');
      g.restore();
    };
    const vis = (path) => !path.bb || inter(path.bb, R);

    // ---- woods floor + rough corridor --------------------------------------------------------
    g.fillStyle = hsl(108, 30, 17);
    g.fillRect(R.x, R.y, R.w, R.h);
    g.save(); g.globalCompositeOperation = 'soft-light'; g.globalAlpha = 0.6; g.fillStyle = mottleBig; g.fillRect(R.x, R.y, R.w, R.h); g.restore();
    if (vis(this.corridor)) {
      g.fillStyle = hsl(101, 40, 32);
      g.fill(this.corridor);
      texture(this.corridor, mottleBig, 0.55, 'soft-light');
      texture(this.corridor, mottleSmall, 0.35, 'soft-light');
      texture(this.corridor, roughTex, 0.7, 'overlay');
      g.save(); g.clip(this.corridor);
      for (const t of this.tufts) {
        if (!near(t.x, t.y, 4, R)) continue;
        g.fillStyle = t.dark ? 'rgba(20,50,15,.18)' : 'rgba(150,190,90,.12)';
        g.beginPath(); g.ellipse(t.x, t.y, t.rx, t.ry, t.rot, 0, TAU); g.fill();
      }
      if (sharp) { // individual blades of grass, catching the light
        g.lineWidth = 0.12; g.lineCap = 'round';
        for (const b of this.blades) {
          if (!near(b.x, b.y, 2, R)) continue;
          g.strokeStyle = b.dark ? 'rgba(25,60,18,.45)' : 'rgba(170,205,110,.35)';
          g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(b.x + Math.cos(b.a) * b.len, b.y + Math.sin(b.a) * b.len); g.stroke();
        }
      }
      g.restore();
    }

    // ---- cart path ----------------------------------------------------------------------------
    if (vis(this.cart)) {
      const cart = this.cart;
      g.save();
      g.lineCap = g.lineJoin = 'round';
      g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 6.6; g.translate(0.6, 0.6); g.stroke(cart); g.translate(-0.6, -0.6);
      g.strokeStyle = '#9d9786'; g.lineWidth = 5.6; g.stroke(cart);
      g.strokeStyle = '#d6d0bf'; g.lineWidth = 4.6; g.stroke(cart);
      g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.6; g.strokeStyle = sandTex; g.lineWidth = 4.6; g.stroke(cart);
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 0.25; g.strokeStyle = '#8a8474'; g.lineWidth = 0.18;
      for (let i = 0; i < L.cartPath.length - 1; i++) { // expansion joints
        const a = L.cartPath[i], b = L.cartPath[i + 1];
        if (!near(a.x, a.y, 12, R)) continue;
        const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
        for (let t = 0; t < l; t += 5) {
          const px = a.x + (dx * t) / l, py = a.y + (dy * t) / l, nx = (-dy / l) * 2.3, ny = (dx / l) * 2.3;
          g.beginPath(); g.moveTo(px - nx, py - ny); g.lineTo(px + nx, py + ny); g.stroke();
        }
      }
      g.restore();
    }

    // ---- fairway: first cut, mown fairway with stripes ---------------------------------------
    if (vis(this.cut)) {
      g.fillStyle = hsl(99, 42, 37);
      g.fill(this.cut);
      texture(this.cut, mottleSmall, 0.3, 'soft-light');
      texture(this.cut, roughTex, 0.5);
      const fair = this.fair;
      g.save(); g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowBlur = 1.2 * ppu; g.fillStyle = hsl(96, 47, 45); g.fill(fair); g.restore();
      g.save(); g.clip(fair);
      for (let y = L.fy0, i = 0; y < L.fy1; y += 9, i++) { // stripes perpendicular to the line of play
        if (y + 12 < R.y - 120 || y - 3 > R.y + R.h + 120) continue;
        const s1 = (L.cx(y + 1) - L.cx(y - 1)) / 2, s2 = (L.cx(y + 10) - L.cx(y + 8)) / 2;
        const q = [{ x: L.cx(y) - 120, y: y + 120 * s1 }, { x: L.cx(y) + 120, y: y - 120 * s1 }, { x: L.cx(y + 9) + 120, y: y + 9 - 120 * s2 }, { x: L.cx(y + 9) - 120, y: y + 9 + 120 * s2 }];
        g.fillStyle = i % 2 ? 'rgba(255,255,230,.10)' : 'rgba(0,30,0,.06)';
        g.fill(poly(q));
      }
      g.restore();
      texture(fair, mottleSmall, 0.22, 'soft-light');
      texture(fair, turfTex, 0.5);
      g.save(); g.strokeStyle = 'rgba(10,40,5,.18)'; g.lineWidth = 0.5; g.stroke(fair); g.restore();
      for (const d of this.divots) {
        if (!near(d.x, d.y, 2, R)) continue;
        g.save(); g.translate(d.x, d.y); g.rotate(d.rot);
        g.fillStyle = d.brown ? 'rgba(110,80,45,.32)' : 'rgba(205,190,135,.3)';
        g.beginPath(); g.ellipse(0, 0, d.rx, d.ry, 0, 0, TAU); g.fill();
        g.restore();
      }
      for (let y = L.fy0 + 18; y < L.fy1 - 10; y += 32) {
        g.fillStyle = 'rgba(70,75,70,.55)';
        g.beginPath(); g.arc(L.cx(y) + 0.5, y, 0.32, 0, TAU); g.fill();
      }
      for (const m of L.markers) {
        if (!near(m.x, m.y, 3, R)) continue;
        g.save(); g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 0.6 * ppu; g.shadowOffsetX = 0.25 * ppu; g.shadowOffsetY = 0.25 * ppu;
        g.fillStyle = m.color; g.beginPath(); g.arc(m.x, m.y, 1.25, 0, TAU); g.fill();
        g.restore();
        g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 0.18; g.beginPath(); g.arc(m.x, m.y, 1.25, 0, TAU); g.stroke();
      }
    }

    // ---- water --------------------------------------------------------------------------------
    for (const w of this.water) {
      if (!vis(w.path)) continue;
      const path = w.path;
      g.save(); g.lineJoin = 'round';
      g.strokeStyle = 'rgba(55,70,30,.75)'; g.lineWidth = 3.2; g.stroke(path);
      g.strokeStyle = 'rgba(150,170,110,.35)'; g.lineWidth = 1.2; g.stroke(path);
      g.restore();
      const grad = g.createRadialGradient(w.x, w.y, 0, w.x, w.y, Math.max(w.rx, w.ry));
      grad.addColorStop(0, '#174e7d'); grad.addColorStop(0.7, '#1f6aa0'); grad.addColorStop(1, '#3f8fb9');
      g.fillStyle = grad; g.fill(path);
      texture(path, mottleSmall, 0.25, 'soft-light');
      innerShadow(path, { color: 'rgba(5,25,40,.65)', blur: 2.4, dx: 1.2, dy: 1.4 });
      g.save(); g.clip(path);
      for (const r of w.refl) { g.fillStyle = `rgba(220,240,255,${r.a})`; g.beginPath(); g.ellipse(r.x, r.y, r.rx, r.ry, r.rot, 0, TAU); g.fill(); }
      g.restore();
      g.lineWidth = 0.35;
      for (const r of w.reeds) {
        g.strokeStyle = r.light ? 'rgba(90,110,45,.8)' : 'rgba(40,70,25,.85)';
        for (const [x1, y1, x2, y2] of r.s) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
      }
    }
    if (this.creek && vis(this.creek)) {
      const c = this.creek;
      g.save(); g.lineCap = g.lineJoin = 'round';
      g.strokeStyle = 'rgba(55,70,30,.8)'; g.lineWidth = 10.5; g.stroke(c);
      g.strokeStyle = 'rgba(120,130,90,.6)'; g.lineWidth = 8.8; g.stroke(c);
      g.strokeStyle = '#1d5f92'; g.lineWidth = 7.4; g.stroke(c);
      g.strokeStyle = '#2b78ad'; g.lineWidth = 4.2; g.stroke(c);
      g.strokeStyle = 'rgba(200,230,250,.22)'; g.lineWidth = 1.2; g.setLineDash([3, 4]); g.stroke(c); g.setLineDash([]);
      for (const s of this.stones) { g.fillStyle = s.c; g.beginPath(); g.ellipse(s.x, s.y, s.rx, s.ry, s.rot, 0, TAU); g.fill(); }
      g.restore();
      const b = L.creek.bridge;
      g.save(); g.translate(b.x, b.y); g.rotate(b.angle);
      g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(-4.2, -6.4, 9.2, 13.4);
      g.fillStyle = '#7b5a3a'; g.fillRect(-4.6, -6.6, 9.2, 13.2);
      for (let i = -6.2; i < 6.4; i += 1.4) { g.fillStyle = i % 2.8 < 1.4 ? '#9a7550' : '#8a6745'; g.fillRect(-4.2, i, 8.4, 1.2); }
      g.fillStyle = '#5a3f27'; g.fillRect(-4.8, -6.8, 0.8, 13.6); g.fillRect(4, -6.8, 0.8, 13.6);
      g.restore();
    }

    // ---- bunkers --------------------------------------------------------------------------------
    for (const s of this.sand) {
      if (!vis(s.path)) continue;
      const path = s.path;
      g.save(); g.lineJoin = 'round'; g.strokeStyle = 'rgba(25,60,20,.55)'; g.lineWidth = 2.2; g.stroke(path); g.restore();
      const grad = g.createRadialGradient(s.x - s.rx * 0.2, s.y - s.ry * 0.3, 0, s.x, s.y, Math.max(s.rx, s.ry) * 1.1);
      grad.addColorStop(0, '#f3e6bf'); grad.addColorStop(1, '#d9c27f');
      g.fillStyle = grad; g.fill(path);
      texture(path, sandTex, 0.65);
      texture(path, mottleSmall, 0.25, 'soft-light');
      g.save(); g.clip(path);
      g.translate(s.x, s.y); g.rotate((s.angle * Math.PI) / 180 + 0.3);
      g.strokeStyle = 'rgba(140,110,60,.16)'; g.lineWidth = 0.22;
      for (let k = -s.ry * 1.6; k < s.ry * 1.6; k += 0.9) {
        g.beginPath(); g.moveTo(-s.rx * 1.5, k);
        for (let x = -s.rx * 1.5; x <= s.rx * 1.5; x += 2) g.lineTo(x, k + Math.sin(x * 0.4 + k) * 0.25);
        g.stroke();
      }
      g.restore();
      innerShadow(path, { color: 'rgba(90,65,25,.6)', blur: 2.2, dx: 1.3, dy: 1.5 });
    }

    // ---- tee box --------------------------------------------------------------------------------
    if (vis(this.teePath)) {
      const t = L.tee, teePath = this.teePath;
      g.save(); g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 1.4 * ppu; g.shadowOffsetX = 0.5 * ppu; g.shadowOffsetY = 0.6 * ppu;
      g.fillStyle = hsl(97, 46, 46); g.fill(teePath); g.restore();
      g.save(); g.clip(teePath);
      for (let x = t.x - t.w / 2, i = 0; x < t.x + t.w / 2; x += 3.2, i++) { g.fillStyle = i % 2 ? 'rgba(255,255,230,.09)' : 'rgba(0,30,0,.05)'; g.fillRect(x, t.y - t.h / 2, 3.2, t.h); }
      for (const d of this.teeDivots) {
        g.save(); g.translate(d.x, d.y); g.rotate(d.rot);
        g.fillStyle = d.brown ? 'rgba(115,85,50,.4)' : 'rgba(205,185,125,.38)';
        g.beginPath(); g.ellipse(0, 0, d.rx, d.ry, 0, 0, TAU); g.fill();
        g.restore();
      }
      g.restore();
      texture(teePath, turfTex, 0.5);
      for (const s of [-1, 1]) {
        const mx = t.x + s * 12, my = t.y - 6;
        g.save(); g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 0.8 * ppu; g.shadowOffsetX = 0.7 * ppu; g.shadowOffsetY = 0.8 * ppu;
        const mg = g.createRadialGradient(mx - 0.5, my - 0.6, 0.1, mx, my, 1.7);
        mg.addColorStop(0, '#9cc3ff'); mg.addColorStop(0.45, '#2f6fd6'); mg.addColorStop(1, '#123a80');
        g.fillStyle = mg; g.beginPath(); g.arc(mx, my, 1.6, 0, TAU); g.fill();
        g.restore();
      }
    }

    // ---- green: collar, putting surface, cup ----------------------------------------------
    if (vis(this.collar)) {
      g.fillStyle = hsl(98, 44, 41);
      g.fill(this.collar);
      texture(this.collar, turfTex, 0.45);
      const green = this.green;
      g.save(); g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowBlur = 1.5 * ppu;
      const gg = g.createRadialGradient(L.green.x - 8, L.green.y - 10, 2, L.green.x, L.green.y, 42);
      gg.addColorStop(0, hsl(92, 52, 60)); gg.addColorStop(1, hsl(95, 48, 49));
      g.fillStyle = gg; g.fill(green);
      g.restore();
      g.save(); g.clip(green);
      for (const ang of [0.75, -0.75]) {
        g.save(); g.translate(L.green.x, L.green.y); g.rotate(ang);
        for (let x = -60, i = 0; x < 60; x += 4.5, i++) { g.fillStyle = i % 2 ? 'rgba(255,255,230,.07)' : 'rgba(0,30,0,.04)'; g.fillRect(x, -60, 4.5, 120); }
        g.restore();
      }
      g.restore();
      texture(green, mottleSmall, 0.12, 'soft-light');
      texture(green, puttTex, 0.32);
      g.save(); g.strokeStyle = 'rgba(10,40,5,.25)'; g.lineWidth = 0.35; g.stroke(green); g.restore();
      g.save(); g.strokeStyle = 'rgba(0,0,0,.22)'; g.lineWidth = 0.45; g.lineCap = 'round';
      g.beginPath(); g.moveTo(0, 0); g.lineTo(12, 7); g.stroke();
      g.fillStyle = 'rgba(0,0,0,.16)'; g.beginPath(); g.moveTo(12, 7); g.lineTo(18.5, 5.4); g.lineTo(9.4, 1.6); g.closePath(); g.fill();
      g.restore();
      const cupG = g.createRadialGradient(0.5, 0.6, 0.2, 0, 0, 2.6);
      cupG.addColorStop(0, '#050805'); cupG.addColorStop(0.8, '#0f1a0d'); cupG.addColorStop(1, '#2a3a24');
      g.fillStyle = cupG; g.beginPath(); g.arc(0, 0, 2.5, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(245,245,240,.9)'; g.lineWidth = 0.32; g.beginPath(); g.arc(0, 0, 2.2, Math.PI * 0.9, Math.PI * 2.1); g.stroke();
    }

    // ---- OB stakes -------------------------------------------------------------------------
    for (const s of L.stakes) {
      if (!near(s.x, s.y, 4, R)) continue;
      g.save(); g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 0.6 * ppu; g.shadowOffsetX = 1.2 * ppu; g.shadowOffsetY = 1.4 * ppu;
      g.fillStyle = '#f7f7f2'; g.beginPath(); g.arc(s.x, s.y, 0.75, 0, TAU); g.fill();
      g.restore();
      g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 0.15; g.beginPath(); g.arc(s.x, s.y, 0.75, 0, TAU); g.stroke();
    }

    // ---- trees: soft cast shadows, then canopies ---------------------------------------------
    {
      const r = this.shadowRes, Lx = L.x0, Ly = L.y0;
      const sx = Math.max(0, (R.x - Lx) * r - 2), sy = Math.max(0, (R.y - Ly) * r - 2);
      const sw = Math.min(this.shadowCanvas.width - sx, R.w * r + 4), shh = Math.min(this.shadowCanvas.height - sy, R.h * r + 4);
      if (sw > 0 && shh > 0) {
        g.save(); g.globalAlpha = 0.5; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
        g.drawImage(this.shadowCanvas, sx, sy, sw, shh, Lx + sx / r, Ly + sy / r, sw / r, shh / r);
        g.restore();
      }
    }
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    for (const tr of this.trees) {
      if (!near(tr.x, tr.y, tr.size / 2, R)) continue;
      g.drawImage(tr.sprite, tr.x - tr.size / 2, tr.y - tr.size / 2, tr.size, tr.size);
    }
    // a final, very light grain pass over everything
    g.save(); g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.12; g.fillStyle = roughTex; g.fillRect(R.x, R.y, R.w, R.h); g.restore();
  }
}

// Back-compat: paint the whole hole at the base resolution.
export function renderTerrain(L) {
  const t = new Terrain(L);
  return { canvas: t.renderBase(), ppu: t.basePpu, terrain: t };
}

// ---- trees: pre-rendered, per-pixel lit canopy sprites -------------------------------------
// A canopy is a lumpy dome of leaf clumps. Each pixel gets a height from that dome + clump noise,
// a surface normal from the height field, and is lit by the sun (top-left, high). Low spots between
// clumps fall into shade, and the rim breaks up into ragged leaves.
const SPRITE = 384, SR = 174; // big enough to stay sharp in the high-res tiles
const PALETTES = {
  lush:    [[20, 44, 18], [52, 96, 36], [132, 172, 76]],
  yellow:  [[34, 50, 16], [84, 110, 38], [170, 186, 92]],
  deep:    [[14, 36, 20], [40, 80, 42], [104, 144, 80]],
  olive:   [[48, 48, 18], [104, 100, 42], [184, 166, 88]],
  conifer: [[10, 28, 22], [28, 62, 46], [82, 120, 88]],
};
let SPRITES = null;

function lattice(n, rnd) {
  const v = new Float32Array(n * n);
  for (let i = 0; i < v.length; i++) v[i] = rnd();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const s = (t) => t * t * (3 - 2 * t);
    const at = (a, b) => v[((b % n) + n) % n * n + (((a % n) + n) % n)];
    const top = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * s(xf);
    const bot = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * s(xf);
    return top + (bot - top) * s(yf);
  };
}

function makeSprite(kind, palette, rnd) {
  const c = document.createElement('canvas');
  c.width = c.height = SPRITE;
  const g = c.getContext('2d');
  const img = g.createImageData(SPRITE, SPRITE);
  const n1 = lattice(32, rnd), n2 = lattice(32, rnd), n3 = lattice(32, rnd), n4 = lattice(64, rnd);
  const ox = rnd() * 20, oy = rnd() * 20;
  const conifer = kind === 'conifer';
  const branches = 15 + Math.floor(rnd() * 7), twist = (rnd() - 0.5) * 2;
  const ph = [rnd() * 6, rnd() * 6, rnd() * 6, rnd() * 6];
  const edgeR = (th) => conifer
    ? SR * (0.84 + 0.07 * Math.abs(Math.cos((branches * th) / 2 + ph[0])) + 0.05 * Math.sin(5 * th + ph[1]) + 0.04 * Math.sin(11 * th + ph[2]))
    : SR * (0.86 + 0.06 * Math.sin(3 * th + ph[0]) + 0.05 * Math.sin(5 * th + ph[1]) + 0.035 * Math.sin(9 * th + ph[2]) + 0.025 * Math.sin(14 * th + ph[3]));
  const H = new Float32Array(SPRITE * SPRITE), A = new Float32Array(SPRITE * SPRITE), C = new Float32Array(SPRITE * SPRITE), Lf = new Float32Array(SPRITE * SPRITE);
  const half = SPRITE / 2;
  for (let y = 0; y < SPRITE; y++) for (let x = 0; x < SPRITE; x++) {
    const dx = x - half + 0.5, dy = y - half + 0.5;
    const dist = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
    const er = edgeR(th);
    const i = y * SPRITE + x;
    if (dist > er + 2) continue;
    const d = Math.min(1, dist / er);
    const u = dx / SR, v = dy / SR;
    const dome = Math.sqrt(Math.max(0, 1 - d * d));
    const leaves = n3(u * 16 + ox, v * 16 + oy) * 0.6 + n4(u * 40 + oy, v * 40 + ox) * 0.4; // clumps + individual leaves
    let h, clumps;
    if (conifer) {
      // irregular whorls of branches: a wobbly radial ridge broken up by needle clumps
      const ridge = Math.pow(Math.abs(Math.cos((branches * th) / 2 + twist * d * 3 + n1(u * 3, v * 3) * 2.2)), 1.2);
      const tufts = n2(u * 9 + ox, v * 9 + oy);
      const fade = Math.min(1, Math.max(0, (d - 0.12) / 0.4)); // branch lines don't converge visibly at the tip
      clumps = 0.2 + 0.24 * ridge * fade + 0.6 * tufts;
      h = dome * 0.72 + clumps * 0.3 + leaves * 0.1;
    } else {
      clumps = n1(u * 3.8 + ox, v * 3.8 + oy) * 0.62 + n2(u * 8.5 + oy, v * 8.5 + ox) * 0.38;
      h = dome * 0.72 + clumps * 0.38 + leaves * 0.05;
    }
    H[i] = h; C[i] = clumps; Lf[i] = leaves;
    // ragged rim: leaves thin out toward the edge, more so between clumps
    let a = Math.max(0, Math.min(1, (er - dist) / 1.6));
    const rim = clumps + (1 - d) * 1.4 + leaves * 0.25;
    a *= Math.max(0, Math.min(1, (rim - 0.45) / 0.25));
    A[i] = a;
  }
  const L = (() => { const l = [-0.55, -0.62, 0.56]; const m = Math.hypot(...l); return l.map((x) => x / m); })();
  const [dk, md, lt] = palette;
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const d = img.data;
  for (let y = 1; y < SPRITE - 1; y++) for (let x = 1; x < SPRITE - 1; x++) {
    const i = y * SPRITE + x;
    if (!A[i]) continue;
    const k = 5.5;
    const nx = (H[i - 1] - H[i + 1]) * k, ny = (H[i - SPRITE] - H[i + SPRITE]) * k;
    const nm = Math.hypot(nx, ny, 1);
    const diffuse = Math.max(0, (nx * L[0] + ny * L[1] + L[2]) / nm);
    const ao = 0.5 + 0.5 * Math.min(1, C[i] * 1.25);
    let b = (0.18 + 0.95 * diffuse) * ao * (0.82 + 0.36 * Lf[i]);
    b = Math.max(0, Math.min(1.15, b));
    const col = b < 0.5 ? mix(dk, md, b / 0.5) : mix(md, lt, Math.min(1, (b - 0.5) / 0.6));
    d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2];
    d[i * 4 + 3] = A[i] * 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function treeSprites() {
  if (SPRITES) return SPRITES;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  SPRITES = { leafy: [], olive: [], pine: [] };
  for (const pal of ['lush', 'yellow', 'deep']) for (let i = 0; i < 5; i++) SPRITES.leafy.push(makeSprite('leafy', PALETTES[pal], rnd));
  for (let i = 0; i < 3; i++) SPRITES.olive.push(makeSprite('leafy', PALETTES.olive, rnd));
  for (let i = 0; i < 6; i++) SPRITES.pine.push(makeSprite('conifer', PALETTES.conifer, rnd));
  return SPRITES;
}
