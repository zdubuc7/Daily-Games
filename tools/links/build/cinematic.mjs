// Cinematic Universe: characters linked if they appeared on screen in the same film.
// One franchise per hole, so this writes two courses: marvel.json and starwars.json.
import { readSource, writeHubCourse } from './lib.mjs';

const src = JSON.parse(readSource('cinematic.json'));
for (const id of ['marvel', 'starwars']) {
  const { films, aliases } = src[id];
  const items = new Map();
  for (const [film, chars] of Object.entries(films)) {
    for (const c of new Set(chars)) {
      if (!items.has(c)) items.set(c, { label: c, fame: 0, hubs: [] });
      items.get(c).hubs.push(film);
      items.get(c).fame++;
    }
  }
  writeHubCourse(id, [...items.values()], {
    pool: (it) => it.fame >= 2,
    poolSize: 200,
    alias: aliases,
    meta: { source: 'Hand-curated list (tools/links/sources/cinematic.json)' },
  });
}
