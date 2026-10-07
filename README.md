# The Round

Daily golf-themed puzzle games for friends. The full spec is in [docs/The_Round_Build_Prompt.md](docs/The_Round_Build_Prompt.md) (original `.docx` alongside it).

**Built so far: The Links (game 4).** The other three holes are placeholders on the landing page.

## The Links

Connect the **tee** to the **pin** one link at a time, following the day's course rule. Every link is a stroke. Three holes a day, scored against par (shortest chain + 2). There's no sign-in and no timer: you play in the browser and copy a spoiler-free result to send to friends.

| Rule | How it's handled |
| --- | --- |
| Scoring | Eagle at the shortest chain … triple bogey at shortest + 5, where you pick up. A chain shorter than ours is an albatross (−3) and the result notes a data gap. |
| Out of bounds | Each hole lists 2–3 auto-detected **overconnected** answers (journeymen like Ryan Fitzpatrick, Russia/China, Missouri…). Using one costs +1 and you take a drop. |
| Wrong link | Swing and miss, +1, then try again from the same spot. On the green it's a missed putt. |
| Mulligan | Your first wrong link of the day is free. |
| Answer list | Autocomplete from the course's full answer list. Small courses also get "See all answers". |
| Course card | Shown before each hole: course, rule, tee → pin, par, out-of-bounds list. |

**Not implemented**, because they need a server and shared accounts: the 8pm cutoff/reveal, the "local knowledge" bonus, and the host review queue. Every course is backed by a dataset, so links are always checked instantly.

### Weekly rotation (from the doc)

Mon Gridiron · Tue Screen (Hollywood, Prime Time, Cinematic Universe) · Wed Words (Compound, Word Ladder, Rhyme Line) · Thu Places (Borders, State Lines) · Fri Studio · Sat Games (Pokédex, Smash) · Sun Words. Each pool cycles through its courses in order across the 3 holes. Cinematic Universe alternates between Marvel and Star Wars.

### Courses and data sources

| Course | Source | Builder |
| --- | --- | --- |
| Gridiron | nflverse rosters, 1946+ (weekly game-day rosters from 2002), plus draft data to judge how famous a player is | `build/gridiron.mjs` |
| Hollywood, Prime Time | IMDb non-commercial datasets (principal cast) | `build/imdb.mjs` |
| Cinematic Universe | Hand-curated `sources/cinematic.json` (MCU + Star Wars) | `build/cinematic.mjs` |
| Studio | Wikidata: songs with 2+ performers, plus band membership | `build/studio.mjs` |
| Borders, State Lines | Fixed lists in `sources/borders.json` and `sources/states.json` | `build/borders.mjs`, `build/states.mjs` |
| Compound | Wiktionary "English compound terms" (open compounds must also have a Wikipedia page) + `sources/compound-extra.txt` / `compound-reject.txt` | `build/compound.mjs` |
| Word Ladder | OpenSubtitles frequency list ∩ ENABLE dictionary (top 20k = "common words") | `build/ladder.mjs` |
| Rhyme Line | CMU Pronouncing Dictionary | `build/rhyme.mjs` |
| Pokédex | PokéAPI CSVs (generations configurable in `sources/config.json`) | `build/pokedex.mjs` |
| Smash | Wikidata video-game characters; crossover games banned via `sources/smash-banned.txt` | `build/smash.mjs` |

## How the automation works

```
tools/links/build/*.mjs  →  site/links/data/<course>.json      (course graphs, committed)
tools/links/generate.mjs →  site/links/puzzles/YYYY-MM-DD.json (3 holes/day, committed)
site/links/              →  static game (GitHub Pages)
```

- `.github/workflows/links.yml` runs **daily**. It keeps puzzles generated 3 weeks ahead, runs the sanity checks, commits, and deploys `site/` to GitHub Pages. If Actions stalls for a while, the game still has weeks of rounds queued.
- On **Mondays** the same workflow first refreshes course data (rosters, IMDb, Wikidata…), then re-checks future puzzles against it. A source that fails keeps its previous data.
- Puzzles are deterministic per date and never change once their day arrives. The day rolls over at midnight US Eastern.
- `site/links/engine.js` is shared by the browser and the generator, so par and link checking always agree.

## Setup: GitHub Pages + your domain

1. Create a GitHub repo and push this folder to its `main` branch.
2. In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. In **Settings → Actions → General → Workflow permissions**, choose **Read and write** so the bot can commit puzzles.
4. Run the workflow once by hand (**Actions → The Links → Run workflow**), or push a commit.
5. Custom domain: in **Settings → Pages → Custom domain**, enter your domain. Then at your DNS provider:
   - apex domain (`example.com`): `A` records to `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - subdomain (`play.example.com`): a `CNAME` record pointing to `<your-username>.github.io`

   Tick **Enforce HTTPS** once the certificate is ready. The game lives at `/links/`, and `/` is The Round's landing page.

## Local commands

```bash
npm run serve              # http://localhost:8765/links/  (add ?d=YYYY-MM-DD to preview any day locally)
npm run links:generate     # top up puzzles
npm run links:test         # sanity checks
npm run links:data         # rebuild every course's data (IMDb step downloads ~1.3 GB)
node tools/links/build/all.mjs gridiron studio   # rebuild just some courses
node tools/links/generate.mjs --date 2026-10-20 --force   # regenerate one day
```

### Testing tools

Menu → Testing tools (password `mulligan`, set by `TOOLS_PASS_SHA256` in `site/links/app.js`).

- **Change course / restore originals — for everyone.** The tools commit the edited `site/links/puzzles/<date>.json` straight to `main` through the GitHub API, which triggers the deploy workflow, so every player gets the change after about 1–2 minutes. The original hole is kept in the file (`original`) so it can be restored. Players who had started a changed hole start it fresh.
  This needs a fine-grained GitHub token (github.com → Settings → Developer settings → Fine-grained tokens) limited to this repo with **Contents: Read and write**. Paste it into the tools once; it's stored only in that browser.
- **Replay this hole / reset my progress** only affect your own browser.

The password only keeps casual players out — it's a static site, so it isn't real security. The token is what actually protects the repo.

### Host controls (optional)

- **Pick a day's courses or write a hole yourself:** edit `tools/links/overrides.json`, e.g.
  `{ "2026-10-20": [{ "course": "states", "tee": "Maine", "pin": "Florida", "ob": ["Tennessee"] }, "pokedex", "smash"] }`.
  The next run regenerates that future day. Par is computed for you.
- **Rule on a disputed compound:** add it to `compound-extra.txt` or `compound-reject.txt`, then rebuild `compound`.
- **Edit any fixed list:** see the files in `tools/links/sources/`, then rebuild that course.
