// Pokédex: Pokémon linked if they share a type. Tee/pin are single-type Pokémon. Data: PokéAPI CSVs.
import { fetchText, parseCSV, readSource, writeHubCourse } from './lib.mjs';

const cfg = JSON.parse(readSource('config.json')).pokedex;
const base = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/';
const csv = async (f) => parseCSV(await fetchText(base + f, 'pokeapi-' + f));
const [pokemon, ptypes, types, species, names] = await Promise.all(
  ['pokemon.csv', 'pokemon_types.csv', 'types.csv', 'pokemon_species.csv', 'pokemon_species_names.csv'].map(csv));

const typeName = Object.fromEntries(types.map((t) => [t.id, t.identifier[0].toUpperCase() + t.identifier.slice(1)]));
const gen = Object.fromEntries(species.map((s) => [s.id, +s.generation_id]));
const enName = Object.fromEntries(names.filter((n) => n.local_language_id === '9').map((n) => [n.pokemon_species_id, n.name]));
const typesOf = {};
for (const t of ptypes) (typesOf[t.pokemon_id] ||= []).push(typeName[t.type_id]);

const items = [];
for (const p of pokemon) {
  if (p.is_default !== '1') continue;
  const g = gen[p.species_id];
  if (!cfg.generations.includes(g) || !enName[p.species_id]) continue;
  const ts = typesOf[p.id] || [];
  items.push({ label: enName[p.species_id], fame: -Number(p.species_id), hubs: ts.map((t) => `${t} type`), single: ts.length === 1, gen: g });
}
writeHubCourse('pokedex', items, {
  pool: (it) => it.single && cfg.teePinGenerations.includes(it.gen),
  poolSize: 2000,
  meta: { source: 'PokéAPI', generations: cfg.generations },
});
