// State Lines: lower-48 states, linked by a shared land border (fixed list).
import { readSource, writeHubCourse } from './lib.mjs';

const src = JSON.parse(readSource('states.json'));
const items = Object.entries(src.states).map(([code, name]) => ({ label: name, fame: 0, alias: [code], hubs: [] }));
const byCode = Object.fromEntries(Object.keys(src.states).map((c, i) => [c, items[i]]));
for (const [a, ns] of Object.entries(src.neighbors)) {
  for (const b of ns) {
    if (!src.neighbors[b]?.includes(a)) throw new Error(`Asymmetric border ${a}-${b}`);
    if (a < b) {
      const hub = `${src.states[a]}–${src.states[b]} border`;
      byCode[a].hubs.push(hub); byCode[b].hubs.push(hub);
    }
  }
}
writeHubCourse('states', items, { meta: { source: 'Fixed list (tools/links/sources/states.json)' } });
