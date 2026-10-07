// Rebuild course data. Each builder runs on its own; a failure (e.g. a rate-limited API)
// keeps that course's previous data file and the rest carry on.
//   node tools/links/build/all.mjs                 # every course
//   node tools/links/build/all.mjs gridiron imdb   # just some
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ALL = ['states', 'borders', 'cinematic', 'ladder', 'rhyme', 'compound', 'pokedex', 'gridiron', 'imdb', 'studio', 'smash'];
const which = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const failed = [];
for (const b of which) {
  console.log(`\n== ${b}`);
  const r = spawnSync(process.execPath, [path.join(here, `${b}.mjs`)], { stdio: 'inherit', timeout: 45 * 60 * 1000 });
  if (r.status !== 0) failed.push(b);
}
if (failed.length) console.log(`\nFailed (kept previous data): ${failed.join(', ')}`);
else console.log('\nAll course data rebuilt.');
