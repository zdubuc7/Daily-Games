// Gridiron: NFL players linked if they played for the same franchise in any era (relocations = one franchise).
// Data: nflverse rosters (season-end rosters 1946+, weekly game-day rosters 2002+) and draft data for fame.
import { cached, lines, parseCSV, fetchText } from './lib.mjs';
import { writeHubCourse } from './lib.mjs';
import fs from 'node:fs';

const FIRST = 1946;
const THIS_YEAR = new Date().getUTCFullYear();
const REL = 'https://github.com/nflverse/nflverse-data/releases/download/';

// (team code, season) -> franchise name. Codes are reused across eras, so ranges matter.
const F = {
  ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL_R: 'Baltimore Ravens', BUF: 'Buffalo Bills', CAR: 'Carolina Panthers',
  CHI: 'Chicago Bears', CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns', DAL: 'Dallas Cowboys', DEN: 'Denver Broncos',
  DET: 'Detroit Lions', GB: 'Green Bay Packers', HOU_T: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars',
  KC: 'Kansas City Chiefs', LV: 'Las Vegas Raiders', LAC: 'Los Angeles Chargers', LAR: 'Los Angeles Rams', MIA: 'Miami Dolphins',
  MIN: 'Minnesota Vikings', NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants', NYJ: 'New York Jets',
  PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers', SF: 'San Francisco 49ers', SEA: 'Seattle Seahawks', TB: 'Tampa Bay Buccaneers',
  TEN: 'Tennessee Titans', WAS: 'Washington Commanders',
};
function franchise(code, y) {
  switch (code) {
    case 'ARI': case 'ARZ': case 'PHO': case 'CHC': return F.ARI;
    case 'STL': return y <= 1987 ? F.ARI : F.LAR;
    case 'SL': case 'RAM': return F.LAR;
    case 'LA': return y === 1926 ? null : F.LAR;
    case 'CHR': return y === 1960 ? F.LAC : 'Chicago Rockets (AAFC)';
    case 'SD': case 'LAC': return F.LAC;
    case 'OAK': case 'RAI': case 'LV': return F.LV;
    case 'BAL': return y <= 1950 ? 'Baltimore Colts (1947–50)' : y <= 1983 ? F.IND : F.BAL_R;
    case 'BLT': return F.BAL_R;
    case 'IND': return F.IND;
    case 'HOU': return y <= 1996 ? F.TEN : F.HOU_T;
    case 'HST': return F.HOU_T;
    case 'TEN': return F.TEN;
    case 'CLE': case 'CLV': return F.CLE;
    case 'CHB': case 'CHI': return F.CHI;
    case 'DAL': return y === 1952 ? 'Dallas Texans (1952)' : F.DAL;
    case 'COW': return F.DAL;
    case 'TEX': case 'KC': return F.KC;
    case 'NYT': case 'NYJ': return F.NYJ;
    case 'NY': case 'NYG': return F.NYG;
    case 'BOS': return y <= 1948 ? 'Boston Yanks' : F.NE;
    case 'NE': return F.NE;
    case 'BUF': return y <= 1949 ? 'Buffalo Bills (AAFC)' : F.BUF;
    case 'MIA': return y <= 1946 ? 'Miami Seahawks (AAFC)' : F.MIA;
    case 'NYY': return 'New York Yankees (AAFC/NFL)';
    case 'BRK': return 'Brooklyn Dodgers (AAFC)';
    case 'DON': return 'Los Angeles Dons (AAFC)';
    case 'NYB': return 'New York Bulldogs';
    case 'CHH': return 'Chicago Hornets (AAFC)';
    default: return F[code] || null;
  }
}

const players = new Map(); // key -> { name, pos, first, last, teams: Map(franchise -> seasons), ids }
function keyOf(r) { return r.gsis_id || r.pfr_id || r.esb_id || `${r.full_name}|${r.birth_date}`; }
function add(r, season) {
  if (!r.full_name) return;
  if (['CUT', 'DEV', 'TRC', 'TRD', 'NWT', 'RET', ''].includes(r.status)) return;
  const fr = franchise(r.team, season);
  if (!fr) return;
  const k = keyOf(r);
  let p = players.get(k);
  if (!p) players.set(k, p = { name: r.full_name, pos: r.position, first: season, last: season, teams: new Map(), ids: new Set() });
  p.first = Math.min(p.first, season); p.last = Math.max(p.last, season);
  p.teams.set(fr, (p.teams.get(fr) || new Set()).add(season));
  for (const id of [r.gsis_id, r.pfr_id, r.esb_id]) if (id) p.ids.add(id);
}

for (let y = FIRST; y <= THIS_YEAR; y++) {
  let file;
  try { file = await cached(`${REL}rosters/roster_${y}.csv`, `roster_${y}.csv`, { maxAgeHours: y >= THIS_YEAR - 1 ? 24 * 6 : 24 * 365 }); }
  catch { continue; }
  for (const r of parseCSV(fs.readFileSync(file, 'utf8'))) add(r, y);
  if (y >= 2002) {
    try {
      const wf = await cached(`${REL}weekly_rosters/roster_weekly_${y}.csv`, `roster_weekly_${y}.csv`, { maxAgeHours: y >= THIS_YEAR - 1 ? 24 * 6 : 24 * 365 });
      for (const r of parseCSV(fs.readFileSync(wf, 'utf8'))) if (r.status === 'ACT') add(r, y);
    } catch { /* weekly file not published yet */ }
  }
}

// Fame from draft data (career approximate value, Pro Bowls, Hall of Fame).
const draft = parseCSV(await fetchText(`${REL}draft_picks/draft_picks.csv`, 'draft_picks.csv'));
const fameById = new Map();
for (const d of draft) {
  const f = (+d.car_av || 0) + 8 * (+d.probowls || 0) + 10 * (+d.allpro || 0) + (d.hof === 'TRUE' ? 60 : 0);
  for (const id of [d.gsis_id, d.pfr_player_id]) if (id) fameById.set(id, f);
}

const items = [];
for (const p of players.values()) {
  let fame = 0;
  for (const id of p.ids) fame = Math.max(fame, fameById.get(id) || 0);
  const seasons = new Set([...p.teams.values()].flatMap((s) => [...s])).size;
  if (!fame) fame = seasons * 2;
  const years = p.first === p.last ? `${p.first}` : `${p.first}–${String(p.last).slice(-2)}`;
  items.push({ label: p.name, hint: `${p.pos}, ${years}`, fame, seasons, first: p.first, hubs: [...p.teams.keys()] });
}
writeHubCourse('gridiron', items, {
  // Tee/pin: recognizable one-franchise players.
  pool: (it) => it.hubs.length === 1 && it.seasons >= 6 && it.first >= 1975 && it.fame >= 40 && Object.values(F).includes(it.hubs[0]),
  poolSize: 600,
  meta: { source: 'nflverse rosters (1946+) and draft data' },
});
