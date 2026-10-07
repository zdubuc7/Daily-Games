// Borders: countries linked by a shared land border (fixed list).
import { readSource, writeHubCourse } from './lib.mjs';

const src = JSON.parse(readSource('borders.json'));
const items = new Map(src.countries.map((c) => [c, { label: c, fame: 0, alias: src.aliases[c] || [], hubs: [] }]));
for (const [a, b] of src.borders) {
  if (!items.has(a) || !items.has(b)) throw new Error(`Unknown country in border ${a}-${b}`);
  const hub = `${a}–${b} border`;
  items.get(a).hubs.push(hub); items.get(b).hubs.push(hub);
}
writeHubCourse('borders', [...items.values()], { meta: { source: 'Fixed list (tools/links/sources/borders.json), derived from GeoDataSource country borders' } });
