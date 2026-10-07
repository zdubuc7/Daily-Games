// Hollywood (actors linked by a shared film) and Prime Time (TV shows linked by a shared main cast member).
// Data: IMDb non-commercial datasets (https://datasets.imdbws.com), principal cast only.
import { cached, lines, writeHubCourse } from './lib.mjs';

const MOVIE_MIN_VOTES = 20000;
const TV_MIN_VOTES = 10000;
const base = 'https://datasets.imdbws.com/';
const get = (f) => cached(base + f, f, { maxAgeHours: 24 * 6 });

console.log('  ratings...');
const votes = new Map();
for await (const l of lines(await get('title.ratings.tsv.gz'))) {
  const [t, , v] = l.split('\t');
  const n = +v;
  if (n >= TV_MIN_VOTES) votes.set(t, n);
}

console.log('  titles...');
const movies = new Map(), shows = new Map();
for await (const l of lines(await get('title.basics.tsv.gz'))) {
  const f = l.split('\t');
  const v = votes.get(f[0]);
  if (!v || f[4] === '1') continue;
  const year = f[5] === '\\N' ? '' : f[5];
  if (f[1] === 'movie' && v >= MOVIE_MIN_VOTES) movies.set(f[0], { title: f[2], year, votes: v });
  else if (f[1] === 'tvSeries' || f[1] === 'tvMiniSeries') shows.set(f[0], { title: f[2], year, votes: v, cast: [] });
}
console.log(`  ${movies.size} movies, ${shows.size} shows`);

console.log('  principals (slow)...');
const movieCast = []; // [tconst, nconst, ordering]
const people = new Map();
for await (const l of lines(await get('title.principals.tsv.gz'))) {
  if (!l.includes('\tact')) continue; // actor / actress
  const f = l.split('\t');
  if (f[3] !== 'actor' && f[3] !== 'actress') continue;
  if (movies.has(f[0])) { movieCast.push([f[0], f[2], +f[1]]); people.set(f[2], null); }
  else if (shows.has(f[0])) { shows.get(f[0]).cast.push(f[2]); people.set(f[2], null); }
}

console.log('  names...');
for await (const l of lines(await get('name.basics.tsv.gz'))) {
  const i = l.indexOf('\t');
  const id = l.slice(0, i);
  if (!people.has(id)) continue;
  const f = l.split('\t');
  people.set(id, { name: f[1], born: f[2] === '\\N' ? '' : f[2] });
}

// ---- Hollywood -----------------------------------------------------------
const actors = new Map();
for (const [t, n, order] of movieCast) {
  const p = people.get(n), m = movies.get(t);
  if (!p) continue;
  if (!actors.has(n)) actors.set(n, { label: p.name, hint: p.born ? `b. ${p.born}` : n, fame: 0, films: 0, hubs: [] });
  const a = actors.get(n);
  a.hubs.push(`${m.title} (${m.year})`);
  a.films++;
  a.fame += Math.log10(m.votes) * (order <= 4 ? 2 : 1);
}
writeHubCourse('hollywood', [...actors.values()], {
  pool: (a) => a.films >= 8,
  poolSize: 500,
  meta: { source: 'IMDb datasets (principal cast of films with 20k+ votes)' },
});

// ---- Prime Time ----------------------------------------------------------
const showItems = [];
for (const s of shows.values()) {
  const hubs = s.cast.map((n) => people.get(n)).filter(Boolean).map((p) => p.name + (p.born ? ` (b. ${p.born})` : ''));
  showItems.push({ label: s.title, hint: s.year, fame: s.votes, hubs });
}
writeHubCourse('primetime', showItems, {
  pool: (s) => s.fame >= 100000,
  poolSize: 400,
  meta: { source: 'IMDb datasets (principal cast of TV series with 10k+ votes)' },
});
