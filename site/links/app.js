// The Links — game controller.
import { Course, COURSES, generateHole, scoreHole, scoreName, fmtRel } from './engine.js';
import { Scene } from './scene.js';

const $ = (s) => document.querySelector(s);
const SHARE_EMOJI = { g: '🟩', s: '🟨', o: '⬜', w: '🟥', m: '🔁', h: '⛳', p: '❌' };
const SHORT_NAMES = { 2: 'Dbl Bogey', 3: 'Trpl Bogey' };
const BROWSE_LIMIT = 400; // courses with at most this many answers get a "see all answers" list

// ---- dates --------------------------------------------------------------------
const easternToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const prettyDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const today = easternToday();
const param = new URLSearchParams(location.search).get('d');
// Future days can only be previewed when running locally (for testing).
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const DATE = param && /^\d{4}-\d{2}-\d{2}$/.test(param) && (param <= today || LOCAL) ? param : today;

// ---- storage (per-browser; always wrapped, it can throw) ------------------------
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  keys() { try { return Object.keys(localStorage); } catch { return []; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const TEST_KEY = 'links:test:' + DATE; // testing tool: holes swapped to other courses

// ---- state --------------------------------------------------------------------
let puzzle;            // { date, number, holes: [...] }
let save;              // persisted progress for DATE
const courses = new Map();
let cur = -1;          // current hole index
let H;                 // runtime for the current hole: { c, tee, pin, ob:Set, dist, state }
let busy = false;
let scene;
let suggestions = [], sel = 0;

function blankSave() {
  return { v: 1, mulliganUsed: false, holes: puzzle.holes.map(() => ({ status: 'new', strokes: 0, chain: [], log: [], score: null })) };
}
const persist = () => store.set('links:' + DATE, save);

async function loadCourse(h) {
  if (courses.has(h.course)) return courses.get(h.course);
  const res = await fetch(`data/${h.course}.json?v=${encodeURIComponent(h.v || '')}`);
  if (!res.ok) throw new Error(`Couldn't load the ${h.course} course`);
  const c = new Course(await res.json());
  courses.set(h.course, c);
  return c;
}

const courseName = (h) => COURSES[h.course]?.name || h.course;
const cleanVia = (s) => (s || '').replace(/ \(b\. \d{4}\)$/, '');

// ---- boot ---------------------------------------------------------------------
async function boot() {
  scene = new Scene($('#scene'));
  bindUI();
  try {
    const res = await fetch(`puzzles/${DATE}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error('missing');
    puzzle = await res.json();
    const swaps = store.get(TEST_KEY) || {};
    for (const [i, hole] of Object.entries(swaps)) if (puzzle.holes[i]) puzzle.holes[i] = hole;
  } catch {
    $('#loading').textContent = 'No round posted for today yet — check back soon.';
    return;
  }
  save = store.get('links:' + DATE);
  if (!save || save.holes?.length !== puzzle.holes.length) save = blankSave();
  $('#round-label').textContent = `#${puzzle.number} · ${prettyDate(DATE)}${DATE < today ? ' (archive)' : DATE > today ? ' (preview)' : ''}`;
  if (!store.get('links:seenHelp')) {
    store.set('links:seenHelp', 1);
    $('#loading').hidden = true;
    $('#dlg-help').showModal();
    await new Promise((r) => $('#dlg-help').addEventListener('close', r, { once: true }));
  }
  const first = save.holes.findIndex((h) => h.status !== 'done');
  await openHole(first === -1 ? 0 : first, { card: first !== -1 && save.holes[first].status === 'new' });
  $('#loading').hidden = true;
  if (first === -1) showRound();
}

// ---- holes --------------------------------------------------------------------
async function openHole(i, { card = false } = {}) {
  cur = i;
  const h = puzzle.holes[i];
  $('#loading').hidden = false;
  $('#loading').textContent = 'Walking to the tee…';
  let c;
  try { c = await loadCourse(h); } catch (e) { $('#loading').textContent = e.message; return; }
  $('#loading').hidden = true;
  const tee = c.lookup(h.tee), pin = c.lookup(h.pin);
  H = { c, h, tee, pin, ob: new Set(h.ob.map((x) => c.lookup(x))), dist: c.distTo(pin) };
  // replay the saved chain to find where the ball is
  H.state = c.startState(tee);
  for (const step of save.holes[i].chain) {
    const r = c.linkTo(H.state, c.lookup(step.n));
    if (r) H.state = r.state;
  }
  scene.setHole({ links: H.dist[c.startState(tee)], par: h.par, number: i + 1, seed: `${DATE}#${i}` });
  const s = save.holes[i];
  if (s.status === 'done') { scene.placeAt(s.holed ? 0 : H.dist[H.state]); scene.hideBall(); }
  else if (s.chain.length) scene.placeAt(H.dist[H.state]);
  $('#answer').value = '';
  setMsg('');
  render();
  if (card) showCard();
  else if (s.status === 'done') showResult(i);
  else setAway(false);
}

function showCard() {
  const { h } = H;
  $('#card-hole').textContent = `Hole ${cur + 1} of ${puzzle.holes.length}`;
  $('#card-course').textContent = courseName(h);
  $('#card-rule').textContent = COURSES[h.course]?.rule || '';
  $('#card-tee').textContent = h.tee;
  $('#card-pin').textContent = h.pin;
  $('#card-par').textContent = h.par;
  $('#card-short').textContent = `${h.shortest} stroke${h.shortest === 1 ? '' : 's'}`;
  $('#card-ob-wrap').hidden = !h.ob.length;
  $('#card-ob').innerHTML = h.ob.map((x) => `<span class="stake">${esc(x)}</span>`).join('');
  $('#dlg-card').showModal();
}

function render() {
  const { h, c } = H;
  const s = save.holes[cur];
  const done = s.status === 'done';
  // HUD: hole pod, hole dots, round score
  $('#holes').innerHTML = puzzle.holes.map((hh, i) => {
    const ss = save.holes[i];
    const cls = ss.status === 'done' ? (ss.score < 0 ? 'under' : ss.score > 0 ? 'over' : 'par') : '';
    const tip = ss.status === 'done' ? `${scoreName(ss.score)} ${fmtRel(ss.score)}` : ss.status === 'play' ? `${ss.strokes} strokes so far` : `Par ${hh.par}`;
    return `<button type="button" class="${i === cur ? 'active' : ''} ${cls}" data-hole="${i}" title="Hole ${i + 1}: ${esc(courseName(hh))} — ${tip}">${i + 1}</button>`;
  }).join('');
  $('#pod-hole').textContent = `${cur + 1}/${puzzle.holes.length}`;
  const { total, done: holesDone } = totals();
  const score = $('#pod-score');
  score.textContent = holesDone ? fmtRel(total) : 'E';
  score.className = total < 0 ? 'under' : total > 0 ? 'over' : '';
  $('#hud-course').textContent = `${courseName(h)} · Par ${h.par} · ${scene.yards} yds`;
  // prompt card
  const from = c.label(c.nodeOf(H.state));
  $('#p-eyebrow').textContent = done ? (s.holed ? 'Holed out' : 'Picked up') : `Stroke ${s.strokes + 1} · ${scene.onGreen() ? 'On the green — putt to the pin from' : 'Link from'}`;
  $('#p-from').textContent = done ? h.tee : from;
  $('#p-pin').textContent = h.pin;
  $('#p-sub').textContent = COURSES[h.course]?.rule || '';
  const nt = c.nextLinkType(H.state);
  $('#next-type').hidden = !nt || done;
  if (nt) $('#next-type').innerHTML = `Next link must <strong>${nt}</strong>`;
  $('#ob').innerHTML = h.ob.length ? `<span class="label-ob">OB</span>` + h.ob.map((x) => `<span class="stake">${esc(x)}</span>`).join('') : '';
  $('#btn-browse').hidden = c.N > BROWSE_LIMIT;
  // chain strip
  const parts = [`<li><span class="node tee">${esc(h.tee)}</span></li>`];
  for (const step of s.chain) {
    const isPin = step.n === h.pin;
    parts.push(`<li><span class="link"><span class="arr">→</span><span class="why" title="${esc(cleanVia(step.via))}">${esc(cleanVia(step.via))}</span></span><span class="node ${step.ob ? 'ob' : ''} ${isPin ? 'pin got' : ''}">${esc(step.n)}</span></li>`);
  }
  if (!(done && s.holed)) parts.push(`<li><span class="gap">· · ·</span><span class="node pin">${esc(h.pin)}</span></li>`);
  $('#chain').innerHTML = parts.join('');
  const strip = $('#chain'); strip.scrollLeft = strip.scrollWidth;
  // answer dock
  $('#dock-stroke').textContent = s.strokes;
  $('#dock-mull').classList.toggle('used', save.mulliganUsed);
  $('#dock-mull').title = save.mulliganUsed ? 'Mulligan used today' : 'Mulligan ready — your first wrong link today is free';
  $('#answer').disabled = done || busy;
  $('#answer').placeholder = done ? 'Hole complete' : scene.onGreen() ? `Putt: link ${from} to…` : `Link ${from} to…`;
  const swing = $('#swing');
  swing.disabled = busy;
  swing.classList.toggle('result', done);
  swing.textContent = done ? 'Result' : scene.onGreen() ? 'Putt' : 'Swing';
}

// Prompt card + dock step aside while a shot plays, Krillion-style.
function setAway(away) {
  $('#prompt').classList.toggle('away', away);
  $('#hud-bottom').classList.toggle('away', away);
  if (!away && matchMedia('(pointer: fine)').matches) setTimeout(() => $('#answer').focus(), 60);
}

// ---- playing a stroke --------------------------------------------------------------
async function play(node) {
  const { c, h, pin } = H;
  const s = save.holes[cur];
  if (busy || s.status === 'done') return;
  const from = c.nodeOf(H.state);
  if (node === from) { setMsg(`You're already on ${c.label(node)}.`, 'meh'); return; }
  busy = true;
  hideSuggest();
  $('#answer').value = '';
  setAway(true);
  if (s.status === 'new') s.status = 'play';
  render();

  const link = c.linkTo(H.state, node);
  const d0 = H.dist[H.state];
  if (link) {
    const ob = H.ob.has(node);
    const via = c.reason(link.hub, from, node);
    s.strokes += ob ? 2 : 1;
    s.chain.push({ n: c.label(node), via, ob });
    H.state = link.state;
    const d1 = H.dist[H.state];
    if (node === pin) {
      s.log.push('h');
      persist();
      setMsg(`${c.label(from)} → ${c.label(node)}: ${cleanVia(via)}. In the hole!`, 'good');
      await scene.holed();
      return finishHole(true);
    }
    s.log.push(ob ? 'o' : d1 < d0 ? 'g' : 's');
    persist();
    const tail = ob ? ' Out of bounds: +1 penalty.' : d1 === 1 ? ' You\'re on the green.' : '';
    setMsg(`✓ ${cleanVia(via)}.${tail}`, ob ? 'meh' : 'good');
    render();
    await scene.shot(d0, d1, { ob });
  } else {
    const target = c.label(node);
    if (!save.mulliganUsed) {
      save.mulliganUsed = true;
      s.log.push('m');
      persist();
      setMsg(`✗ ${c.label(from)} and ${target} aren't linked. Mulligan — no penalty this time.`, 'meh');
      render();
      await scene.mulligan();
    } else {
      s.strokes += 1;
      s.log.push('w');
      persist();
      setMsg(`✗ ${c.label(from)} and ${target} aren't linked. +1 penalty stroke.`, 'bad');
      render();
      await scene.whiff();
    }
  }
  if (s.strokes >= h.shortest + 5) {
    await scene.pickUp();
    return finishHole(false);
  }
  busy = false;
  render();
  setAway(false);
}

function finishHole(holed) {
  const s = save.holes[cur];
  const h = H.h;
  s.status = 'done';
  s.holed = holed;
  s.score = scoreHole(s.strokes, h.shortest, holed);
  s.flagged = holed && s.strokes < h.shortest;
  if (!holed) s.log.push('p');
  persist();
  busy = false;
  render();
  setAway(false);
  setTimeout(() => showResult(cur), 350);
}

function chainHTML(items) {
  return items.map((it, i) => i === 0
    ? `<li><span class="node tee">${esc(it.n)}</span></li>`
    : `<li><span class="link"><span class="arr">→</span><span class="why" title="${esc(cleanVia(it.via))}">${esc(cleanVia(it.via))}</span></span><span class="node ${it.ob ? 'ob' : ''} ${it.pin ? 'pin got' : ''}">${esc(it.n)}</span></li>`).join('');
}

function showResult(i) {
  const s = save.holes[i];
  const h = puzzle.holes[i];
  const c = courses.get(h.course);
  $('#res-hole').textContent = `Hole ${i + 1} · ${courseName(h)}`;
  const nameEl = $('#res-name');
  nameEl.textContent = `${scoreName(s.score)} ${fmtRel(s.score)}`;
  nameEl.classList.toggle('over', s.score > 0);
  $('#res-line').textContent = s.holed
    ? `${s.strokes} stroke${s.strokes === 1 ? '' : 's'} on a par ${h.par}.`
    : `Picked up after ${s.strokes} strokes (max score is triple bogey).`;
  $('#res-flag').hidden = !s.flagged;
  $('#res-flag').textContent = 'You found a chain shorter than ours — that\'s an albatross! (Our data must be missing a link.)';
  $('#res-chain').innerHTML = chainHTML([{ n: h.tee }, ...s.chain.map((x) => ({ ...x, pin: x.n === h.pin }))]);
  if (c) {
    const ob = new Set(h.ob.map((x) => c.lookup(x)));
    const best = c.best(c.lookup(h.tee), c.lookup(h.pin), ob);
    $('#res-pro').innerHTML = best ? chainHTML(best.path.map((u, k) => ({ n: c.label(u), via: k ? c.reason(best.hubs[k - 1], best.path[k - 1], u) : '', ob: ob.has(u), pin: k === best.path.length - 1 }))) : '';
  }
  const allDone = save.holes.every((x) => x.status === 'done');
  const nextIdx = save.holes.findIndex((x) => x.status !== 'done');
  $('#res-next').textContent = allDone ? 'See scorecard' : `Play hole ${nextIdx + 1}`;
  $('#res-next').onclick = () => {
    $('#dlg-result').close();
    if (allDone) showRound();
    else openHole(nextIdx, { card: save.holes[nextIdx].status === 'new' });
  };
  $('#dlg-result').showModal();
}

// ---- round summary + share -------------------------------------------------------
function totals() {
  const done = save.holes.filter((x) => x.status === 'done');
  return { total: done.reduce((a, x) => a + x.score, 0), done: done.length };
}

function shareText() {
  const lines = [`The Links #${puzzle.number} ⛳ ${prettyDate(DATE)}`];
  puzzle.holes.forEach((h, i) => {
    const s = save.holes[i];
    const res = s.status === 'done' ? `${scoreName(s.score)} (${fmtRel(s.score)})` : '—';
    lines.push(`${i + 1}. ${courseName(h)} ${s.log.map((x) => SHARE_EMOJI[x]).join('')} ${res}`);
  });
  const { total } = totals();
  lines.push(`Round: ${fmtRel(total)}`);
  lines.push(location.origin + location.pathname.replace(/index\.html$/, ''));
  return lines.join('\n');
}

function showRound() {
  const { total, done } = totals();
  $('#round-total').textContent = done === puzzle.holes.length ? `Round: ${fmtRel(total)}` : `Thru ${done}: ${fmtRel(total)}`;
  $('#round-total').classList.toggle('over', total > 0);
  const rows = puzzle.holes.map((h, i) => {
    const s = save.holes[i];
    return `<tr><td>${i + 1}</td><td>${esc(courseName(h))}</td><td>${h.par}</td><td>${s.status === 'done' ? s.strokes : '–'}</td><td>${s.status === 'done' ? fmtRel(s.score) : '–'}</td></tr>`;
  }).join('');
  const parTotal = puzzle.holes.reduce((a, h) => a + h.par, 0);
  const strokeTotal = save.holes.reduce((a, s) => a + (s.status === 'done' ? s.strokes : 0), 0);
  $('#round-card').innerHTML = `<tr><th>#</th><th>Course</th><th>Par</th><th>Str</th><th>±</th></tr>${rows}<tr class="total"><td></td><td>Total</td><td>${parTotal}</td><td>${strokeTotal}</td><td>${fmtRel(total)}</td></tr>`;
  $('#share-text').textContent = shareText();
  updateCountdown();
  $('#dlg-round').showModal();
}

async function share() {
  const text = shareText();
  const btn = $('#btn-share');
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied! Paste it to your friends';
  } catch {
    // Fallback: select the text so it can be copied manually.
    const r = document.createRange(); r.selectNodeContents($('#share-text'));
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    btn.textContent = 'Press copy to share';
  }
  setTimeout(() => { btn.textContent = 'Copy results'; }, 2500);
}

function updateCountdown() {
  if (DATE !== today) { $('#next-round').innerHTML = `<a href="./">Play today's round →</a>`; return; }
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const mins = (24 * 60) - (et.getHours() * 60 + et.getMinutes());
  $('#next-round').textContent = `Next round in ${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// ---- archive + stats -----------------------------------------------------------------
async function showArchive() {
  const list = $('#archive-list');
  list.innerHTML = '<li class="muted">Loading…</li>';
  $('#dlg-archive').showModal();
  try {
    const idx = await (await fetch('puzzles/index.json', { cache: 'no-cache' })).json();
    const dates = idx.dates.filter((d) => d <= today).reverse();
    list.innerHTML = dates.map((d) => {
      const s = store.get('links:' + d);
      const done = s && s.holes.every((x) => x.status === 'done');
      const r = done ? fmtRel(s.holes.reduce((a, x) => a + x.score, 0)) : s && s.holes.some((x) => x.status !== 'new') ? 'In progress' : 'Not played';
      return `<li><a href="?d=${d}"><span>${prettyDate(d)}${d === today ? ' · Today' : ''}</span><span class="r">${r}</span></a></li>`;
    }).join('') || '<li class="muted">No rounds yet.</li>';
  } catch { list.innerHTML = '<li class="muted">Couldn\'t load the archive.</li>'; }
}

function showStats() {
  const rounds = store.keys().filter((k) => /^links:\d{4}-\d{2}-\d{2}$/.test(k)).map((k) => store.get(k)).filter((s) => s && s.holes.every((x) => x.status === 'done'));
  const scores = rounds.map((s) => s.holes.reduce((a, x) => a + x.score, 0));
  const holes = rounds.flatMap((s) => s.holes);
  const birdies = holes.filter((x) => x.score < 0).length;
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  $('#stats').innerHTML = `
    <div><strong>${rounds.length}</strong><span>Rounds</span></div>
    <div><strong>${scores.length ? (avg > 0 ? '+' : avg < 0 ? '−' : '') + Math.abs(avg).toFixed(1) : '–'}</strong><span>Avg score</span></div>
    <div><strong>${scores.length ? fmtRel(Math.min(...scores)) : '–'}</strong><span>Best round</span></div>
    <div><strong>${birdies}</strong><span>Birdies or better</span></div>`;
  $('#dlg-stats').showModal();
}

function showBrowse() {
  const c = H.c;
  $('#browse-title').textContent = `All ${courseName(H.h)} answers`;
  const list = $('#browse-list');
  const all = [...c.nodes].sort((a, b) => a.localeCompare(b));
  const draw = (q) => {
    const n = q.toLowerCase();
    list.innerHTML = all.filter((x) => !n || x.toLowerCase().includes(n)).map((x) => `<li>${esc(x)}</li>`).join('');
  };
  $('#browse-filter').value = '';
  $('#browse-filter').oninput = (e) => draw(e.target.value);
  list.onclick = (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    $('#answer').value = li.textContent;
    $('#dlg-browse').close();
    $('#answer').focus();
    updateSuggest();
  };
  draw('');
  $('#dlg-browse').showModal();
}

// ---- testing tools ----------------------------------------------------------------------
function showTools() {
  const sel = $('#tool-course');
  const names = { marvel: 'Cinematic Universe (Marvel)', starwars: 'Cinematic Universe (Star Wars)' };
  sel.innerHTML = Object.entries(COURSES)
    .map(([id, c]) => [id, names[id] || c.name])
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, name]) => `<option value="${id}" ${H && H.h.course === id ? 'selected' : ''}>${esc(name)}</option>`).join('');
  $('#tool-swap').textContent = `Swap hole ${cur + 1}`;
  $('#tool-status').textContent = '';
  $('#dlg-tools').showModal();
}

async function swapCourse() {
  const id = $('#tool-course').value;
  $('#tool-status').textContent = 'Building a new hole…';
  try {
    const c = await loadCourse({ course: id, v: '' });
    await new Promise((r) => setTimeout(r, 20));
    const hole = generateHole(c, Math.random, { lo: 2, hi: 3 });
    const swaps = store.get(TEST_KEY) || {};
    swaps[cur] = hole;
    store.set(TEST_KEY, swaps);
    puzzle.holes[cur] = hole;
    resetHoleSave(cur);
    $('#dlg-tools').close();
    openHole(cur, { card: true });
  } catch (e) {
    $('#tool-status').textContent = `Couldn't build that hole: ${e.message}`;
  }
}

function resetHoleSave(i) {
  if (save.holes[i].log.includes('m')) save.mulliganUsed = false;
  save.holes[i] = { status: 'new', strokes: 0, chain: [], log: [], score: null };
  persist();
}

function replayHole() {
  resetHoleSave(cur);
  $('#dlg-tools').close();
  openHole(cur, { card: true });
}

function resetRound() {
  store.del('links:' + DATE);
  store.del(TEST_KEY);
  location.reload();
}

// ---- autocomplete ----------------------------------------------------------------------
function updateSuggest() {
  const q = $('#answer').value;
  const box = $('#suggest');
  if (!H || !q.trim()) { hideSuggest(); return; }
  suggestions = H.c.search(q, 8);
  sel = 0;
  if (!suggestions.length) {
    box.innerHTML = '<li class="empty">Not on the answer list</li>';
    box.hidden = false;
    return;
  }
  box.innerHTML = suggestions.map((u, i) => {
    const label = H.c.label(u);
    const m = label.match(/^(.*?)( \(.+\))$/);
    const html = m ? `${esc(m[1])}<span class="hint">${esc(m[2])}</span>` : esc(label);
    return `<li role="option" id="opt-${i}" data-i="${i}" aria-selected="${i === sel}">${html}</li>`;
  }).join('');
  box.hidden = false;
}
function hideSuggest() { $('#suggest').hidden = true; suggestions = []; }
function moveSel(d) {
  if (!suggestions.length) return;
  sel = (sel + d + suggestions.length) % suggestions.length;
  document.querySelectorAll('#suggest li').forEach((li, i) => li.setAttribute('aria-selected', i === sel));
  document.getElementById('opt-' + sel)?.scrollIntoView({ block: 'nearest' });
}

function submit() {
  if (!H || busy) return;
  if (save.holes[cur].status === 'done') { showResult(cur); return; }
  const text = $('#answer').value.trim();
  if (!text) return;
  let node = H.c.lookup(text);
  if (node < 0 && suggestions.length) node = suggestions[sel];
  if (node < 0) { setMsg('Pick an answer from the list.', 'meh'); return; }
  play(node);
}

// ---- misc -------------------------------------------------------------------------------
function setMsg(text, cls = '') { const m = $('#msg'); m.textContent = text; m.className = 'msg ' + cls; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

function bindUI() {
  $('#play').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  const input = $('#answer');
  input.addEventListener('input', updateSuggest);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
    else if (e.key === 'Escape') hideSuggest();
  });
  input.addEventListener('blur', () => setTimeout(hideSuggest, 150));
  $('#suggest').addEventListener('mousedown', (e) => e.preventDefault());
  $('#suggest').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    sel = +li.dataset.i;
    input.value = H.c.label(suggestions[sel]);
    submit();
  });
  $('#holes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hole]');
    if (!b || busy) return;
    const i = +b.dataset.hole;
    if (i === cur) { if (save.holes[i].status === 'done') showResult(i); return; }
    openHole(i, { card: save.holes[i].status === 'new' });
  });
  $('#card-go').addEventListener('click', () => { $('#dlg-card').close(); setAway(false); });
  const menu = (fn) => () => { $('#dlg-menu').close(); fn(); };
  $('#btn-menu').addEventListener('click', () => $('#dlg-menu').showModal());
  $('#m-help').addEventListener('click', menu(() => $('#dlg-help').showModal()));
  $('#m-archive').addEventListener('click', menu(showArchive));
  $('#m-stats').addEventListener('click', menu(showStats));
  $('#m-round').addEventListener('click', menu(showRound));
  $('#m-tools').addEventListener('click', menu(showTools));
  $('#tool-swap').addEventListener('click', swapCourse);
  $('#tool-reset-hole').addEventListener('click', replayHole);
  $('#tool-reset').addEventListener('click', resetRound);
  // keep the camera framing the open area between the floating HUD panels
  const root = document.documentElement.style;
  const fit = () => {
    const vv = window.visualViewport;
    const kb = vv ? Math.max(0, innerHeight - vv.height - vv.offsetTop) : 0; // on-screen keyboard
    const top = $('#hud-top').offsetHeight;
    const cardBottom = top + 8 + $('#prompt').offsetHeight;
    const bottom = $('#hud-bottom').offsetHeight;
    root.setProperty('--kb', `${kb}px`);
    root.setProperty('--hud-top', `${top}px`);
    root.setProperty('--card-bottom', `${cardBottom}px`);
    root.setProperty('--hud-bottom', `${bottom}px`);
    scene.setInsets(cardBottom, bottom + kb);
  };
  if (window.ResizeObserver) { const ro = new ResizeObserver(fit); for (const id of ['#hud-top', '#hud-bottom', '#prompt']) ro.observe($(id)); }
  addEventListener('resize', fit);
  window.visualViewport?.addEventListener('resize', fit);
  fit();
  $('#btn-share').addEventListener('click', share);
  $('#btn-browse').addEventListener('click', showBrowse);
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
  // click on the backdrop closes info dialogs (not the course card)
  for (const id of ['#dlg-help', '#dlg-archive', '#dlg-stats', '#dlg-browse', '#dlg-round', '#dlg-result', '#dlg-menu', '#dlg-tools']) {
    $(id).addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  }
}

boot();
