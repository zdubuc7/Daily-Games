> Source: The_Round_Build_Prompt.docx (kept alongside). Markdown copy for quick reference.

# The Round: Build Prompt

Paste everything below this line into an AI coding tool (Claude, ChatGPT, Cursor, etc.).


## Overview

Build a daily web game called The Round for a small private group of friends whose size changes day to day. Each day is a round of golf with four holes, and each hole is a different mini-game. Everyone plays the same puzzles that day. Every hole is scored in golf strokes relative to par, and lower is better.


It must be mobile-first and play in a browser with no install. I am the host: I write the puzzles, schedule them, and settle disputes. Before writing any code, read the open questions at the end and ask me them.


## Round structure
- A round has four holes, played in any order: Off the Board, Lay Up, The Leaderboard, and The Links.
- A player’s daily score is the sum of their four hole scores, shown golf-style (−3, E, +2).
- The clubhouse leaderboard shows today’s scores and a monthly “tour” total. Lowest total wins the month.
- Once a month I can mark a day as a “major,” and every hole that day counts double.
- Daily cutoff: 8pm Eastern by default, configurable. Anything that depends on other players’ answers stays hidden until the cutoff, then is revealed to everyone. Lay Up and The Leaderboard are scored instantly, since they do not depend on other players.
- After finishing, players get a spoiler-free share card (emoji scorecard) to paste into Discord.
- Use a golf theme throughout the interface: holes, par, strokes, scorecard, clubhouse, birdie/eagle/bogey labels. The theme is presentation only; puzzle categories are not golf.

## Hole 1: Off the Board

A category goes live each morning (e.g. “UFC champions who lost their first title defense”). Each player privately submits three different answers before the cutoff. At the cutoff, all answers are revealed together with the names of who submitted each.


### Scoring (per answer, then added together; par is 0)
- Matched by exactly 1 other player: eagle, −2.
- Nobody else gave it: birdie, −1.
- Matched by 2 or more other players: bogey, +1.
- Invalid answer: double bogey, +2.
- Bullseye: I secretly set one deep-cut answer per day. Anyone who submits it gets an extra −1.

### Rules
- Each category has an accepted-answer list, and each answer can have alias spellings (e.g. “Ronaldinho” and “Ronaldinho Gaúcho” count as the same answer). Matching should ignore case, accents, and minor punctuation.
- Answers not on the list go to a host review queue. I accept them (they join the list permanently) or reject them before the reveal. Players can vote on disputed answers; I break ties.
- The reveal should build drama: show crowded answers first, then uniques, and highlight eagles last.

## Hole 2: Lay Up

Five numeric questions (e.g. “Seats in the Camp Nou”). Each question has a 20-second timer to lock in a guess, to prevent googling. The goal is to get as close as possible without going over. Each guess is scored only against the true answer, never against other players.


### Scoring (per question; par is 0)

Measure how far under the answer the guess is, as a percentage of the answer: (answer − guess) ÷ answer.

- Exact: albatross, −3.
- Within 2% under: eagle, −2.
- Within 10% under: birdie, −1.
- Within 25% under: par, 0.
- Within 50% under: bogey, +1.
- More than 50% under: double bogey, +2.
- Over the answer by any amount: triple bogey, +3.
- One question per day is the “signature hole” and counts double.

### Rules
- Answers must be positive numbers that won’t change (retired players’ stats, fixed facts, or stats dated to a specific day).
- Store a source link for every answer and show it on the reveal.
- Reveal: a number line with the player’s guess, then the true answer drops in. Guesses that went over turn red.

## Hole 3: The Leaderboard

Blind ranking. One stat is shown (e.g. “Career rushing yards”) with five empty slots ranked 1 to 5. Items appear one at a time. The player must place each item in an open slot before seeing the next, and placed items can’t be moved. After all five are placed, the true values are revealed one at a time.


### Scoring (count pairs in the wrong order out of 10 possible pairs)
- 0 pairs wrong: eagle, −2.
- 1 pair wrong: birdie, −1.
- 2–3 pairs wrong: par, 0.
- 4–5 pairs wrong: bogey, +1.
- 6 or more pairs wrong: double bogey, +2.

### Rules
- I set the order items appear in, so I can put a “trap” item (famous but low on the stat) early.
- Every stat needs a precise definition and a date it’s counted to.

## Hole 4: The Links

Players connect a start (the tee) to a target (the pin) one link at a time, following that day’s course link rule. Each link is one stroke.


### Scoring

Par is the shortest possible chain plus two.

- Shortest possible chain: eagle, −2.
- Shortest + 1: birdie, −1.
- Shortest + 2: par, 0.
- Shortest + 3: bogey, +1.
- Shortest + 4: double bogey, +2.
- Shortest + 5: triple bogey, +3. The player picks up and the hole ends. This is the maximum score.
- If a player finds a chain shorter than the stored shortest (usually a data gap), score it as an albatross, −3, and flag it for me.

### Hazards and rules
- Out of bounds (taking a drop): each puzzle lists 2–3 overconnected answers. Players may still use them, but each use adds a 1-stroke penalty.
- Wrong link: adds a 1-stroke penalty, and the player tries again from the same spot.
- Mulligan: the first wrong link each day is free.
- Local knowledge: after the cutoff, a completed chain gets −1 for each middle answer nobody else in the group used, up to −2. Because of this, a Links score is provisional until the reveal.
- Course card: before teeing off, show the course name, its link rule, par, and the out-of-bounds list.
- Link checking: where a course has a dataset, validate links instantly and compute the shortest chain automatically. Where it doesn’t, accept unknown links provisionally and send them to the host review queue. If I reject one, apply the wrong-link penalty at the reveal.
- Pick puzzles where the shortest chain is 2–3 links (par 4s and par 5s). Gridiron can run shorter.

### Courses
- Gridiron: NFL players. Linked if they played for the same franchise in any era. A relocated team is one franchise (Oilers = Titans). Use one-franchise players as tee and pin; put journeymen out of bounds. Data: Pro Football Reference rosters.
- Hollywood: actors. Linked if they appeared in the same feature film, credited roles only (credited cameos count). Put the most prolific actors out of bounds. Data: IMDb datasets.
- Prime Time: TV shows. Linked if they share a series-regular cast member. Guest stars and one-episode cameos don’t count. Data: IMDb.
- Cinematic Universe: characters within one franchise per hole (Marvel or Star Wars). Linked if they appeared on screen in the same film, including post-credit scenes. Voice-only roles don’t count. Data: franchise wikis.
- Studio: musicians. Linked if they appeared on the same track: credited features, collaborations, and band members count; samples and remixes don’t. Data: MusicBrainz.
- Borders: countries. Linked if they share a land border. Tee and pin must be on the same landmass. Russia, China, and Brazil make good out-of-bounds picks. Data: fixed list.
- State Lines: lower 48 US states. Linked if they share a border; Four Corners diagonals (Arizona–Colorado, Utah–New Mexico) do not count. Missouri and Tennessee make good out-of-bounds picks. Data: fixed list.
- Compound: words. Linked if the pair forms a compound word or common phrase (fire → fly → paper). Keep a running accepted list; my rulings on disputes are added permanently.
- Word Ladder: words. Linked by changing exactly one letter (cat → cot → dot). Common words only. Tee and pin are the same length. Data: a common-words dictionary.
- Anagram Alley: words. Linked by adding or removing exactly one letter and optionally rearranging the rest. Common words only.
- Rhyme Line: words. Links alternate between rhyming and alliterating (same first sound), starting with a rhyme: cat → hat (rhyme) → house (alliterate) → mouse (rhyme). Pure rhyme chains can’t leave a sound family, so the alternation is required. Data: a rhyming dictionary / pronunciation data such as CMUdict.
- Pokédex: Pokémon. Linked if they share a type. Use single-type Pokémon of distant types as tee and pin. Make the allowed generations configurable. Data: PokéAPI.
- Smash: video game characters. Linked if they appeared together in the same game. Crossover games (Super Smash Bros. and others on a host-editable banned list) don’t count.

### Weekly course rotation
- Monday: Gridiron.
- Tuesday: Screen pool (Hollywood, Prime Time, Cinematic Universe).
- Wednesday: Words pool (Compound, Word Ladder, Anagram Alley, Rhyme Line).
- Thursday: Places pool (Borders, State Lines).
- Friday: Studio.
- Saturday: Games pool (Pokédex, Smash).
- Sunday: Words pool again.
- Within each pool, cycle through the courses in order. I can override any day.

## Host tools
- A host-only area to write and schedule puzzles for every hole days or weeks ahead, with a view of which upcoming days are still empty.
- Off the Board editor: category, accepted answers with aliases, secret bullseye.
- Lay Up editor: question, answer, source link, signature-hole flag.
- Leaderboard editor: stat definition, five items with values and units, appearance order.
- Links editor: course, tee, pin, out-of-bounds list, shortest chain (auto-computed where data exists, entered by me otherwise).
- Review queue for unlisted Off the Board answers and unverified Links links, plus dispute votes.
- Settings: cutoff time, major days, player list.

## Build order
- Build in this order and get each piece working before the next: (1) players, daily round, scorecard, and clubhouse leaderboard; (2) Lay Up and The Leaderboard; (3) Off the Board with the cutoff and reveal; (4) The Links, starting with the fixed-list courses (Borders, State Lines) and word courses before the dataset-backed ones.
- Include a few sample puzzles for each hole so we can play-test immediately.

## Open questions to ask me before you start
- Where should this be hosted, and do I have a preferred stack? (Suggest something simple and free for a small group.)
- How should friends sign in: a shared group code plus a name, Discord login, or something else?
- What happens when someone misses a hole or a whole day: a fixed penalty, or excluded from that day?
- Should puzzles be written only by me, or should the tool draft puzzles with AI for my approval?
