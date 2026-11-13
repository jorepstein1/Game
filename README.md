# Hearthold

A medieval idle city builder that runs entirely in the browser. No build step and no dependencies: open `index.html` (or serve the folder with any static server).

## How it plays

- **Place buildings on the map.** Position matters: lumber camps want forests, quarries and mines want hills, farms want water and mills, markets want cottages, taverns boost cottages. Bonus badges preview what each plot would give before you build.
- **Balance the village.** Cottages house villagers (a flat amount per level), working buildings need them, and everyone eats. Food upkeep per villager rises as the town grows, so housing and farms have to keep pace with everything else. Villagers only move in while there is food for them; if the stores run dry, work slows to half and villagers drift away until the farms can feed the rest.
- **Upgrade and expand.** Every building can be levelled up (×2 output per level at 5× the price; cottages, farms and mills gain a flat amount per level instead, at a gentler price, and the Upgrade button says what the level adds). A neighbour's bonus grows with the square root of its level, and cottage upgrades need stone from level 3. Raise your Village Hall into a Manor, Keep, Castle and Palace to unlock new buildings and research, and buy more land as you grow. When the map is full, forest, hills and water can be cleared into open plots for gold. Demolishing returns three quarters of everything the building cost, upgrades included, so a layout can be changed for a modest price. The **Routine upgrades** card at the top of the Build tab makes every cheap upgrade in one tap (those costing under 10 minutes of income each), which leaves the choices that matter: what to build where, which research, when to raise the hall.
- **Follow the Decrees.** A chain of goals with rewards that doubles as the tutorial.
- **A game of check-ins.** The pace is set for a few visits a day. Time away counts in full, so an open game earns no more than a closed one: there is no merchant to catch and no festival, and Collect Taxes pays a single coin, a flourish for the first minutes that leaves the screen once the Manor stands. With five check-ins a day a first reign reaches the Manor in about a quarter of an hour, the Keep in about 4 hours, the Castle in about 12 and the Palace on the evening of the second day (about 37 hours). Acting more often is still faster, because halls, new buildings and abdication wait for a visit: in the balance bot's hands a week at two check-ins a day ends with about half the Crowns of five a day, and seventeen a day with about 60% more. This is a known gap against the pacing targets, printed by `tests/balance.test.js`.
- **Found a new kingdom (prestige).** You can abdicate for Crowns, each a permanent +5% to all production. Crowns on offer are `floor(9 × log10(gold earned this reign / threshold))`, where the threshold is 22M gold, times `(Crown multiplier / 2.5)^4` once more than 30 Crowns are held. Abdication needs a Castle and at least 15 Crowns on offer, which a first reign reaches about when its Palace stands; smaller offers are not made. The Realm tab says whether the offer is small or good, the tab's dot lights at 20 Crowns (about half a day after the Palace), and the confirmation warns about a small offer. Later reigns take a day or two each: about 80 Crowns after a week and 100 (the Legend decree) in eight to nine days at five check-ins a day. A new kingdom begins with a few extra supplies (250 gold, 200 wood, 60 food, 40 stone), enough to skip the first steps and no more.
- **Upgrades get dear.** Above level 3 an upgrade's price is also multiplied by `1.2^(levels above 3)²` (cottages, farms and mills are exempt), and hall levels past Palace cost 50× the last, so each further level is a slower decision than the one before.
- **Repeatable upgrades.** From the Keep onwards the Research tab offers gold sinks with exponentially scaling costs: food, housing and all-production bonuses, plus Monuments that each add a Crown to your next abdication. They reset when you found a new kingdom.
- **Idle.** The game saves every 10 seconds and credits up to 8 hours of time away, or 24 with Stewardship (a Village Hall research costing 200 gold, kept when you found a new kingdom), whether the page was closed or the tab was asleep.
- **Phones.** On narrow screens the game is an app-style screen that never scrolls as a page: the resource bar (a single compact row) on top, the map, a strip with what is selected (or the current decree), beside Collect Taxes until the Manor, a bar holding the build list (or the selected tile's Upgrade and Demolish), and the tab row along the bottom. A tab opens its panel as a sheet over the lower part of the screen, with its own scrolling; tapping the tab again, the sheet's close button or a tile closes it. The map is as large as the shorter side of the space left for it, so a small map is always whole; plots never drop below 40px, and a map too big for that pans inside its frame. A phone on its side puts the map on the left and the controls on the right.

## Saves

Saves live in the browser's `localStorage` and can be exported and imported as text from the Realm tab. Each save carries a version number (`v`), the terrain grid and the current decree by id. Loading rebuilds the game from known fields only, coercing and clamping every value, so older saves are migrated and damaged ones cannot break the page; a save that cannot be read at all is kept under a backup key and a new kingdom is started. Only one tab plays at a time: opening the game in a second tab pauses the first.

## Files

Plain script tags, loaded in this order:

- `index.html` — page shell: one `<section class="screen">` per game mode inside `#app`
- `style.css` — presentation
- `data.js` — data tables and balance constants (buildings, research, repeatable upgrades, decrees, costs)
- `sim.js` — state (`state.meta` survives abdication, `state.run` is the current city), rules, actions and the save format. No DOM, so it also runs in Node: load `data.js` then `sim.js` into one `vm` context, call `startNewGame(0)` and drive it with `advance(seconds)` and the action functions
- `ui.js` — rendering, input, timers and storage

## Tests

```
node tests/sim.test.js        # rules and save format, in Node (no dependencies)
node tests/bot.js             # balance bot: a first reign of 72 hours at five check-ins a day on seeds 11, 22, 33 (no dependencies, seconds)
node tests/bot.js 240 crowns:20 11 2   # arguments: hours, abdication policy, comma-separated seeds, check-ins per day (0 = game always open)
node tests/bot.js compare     # two against five check-ins a day over a week, abdicating at 20 Crowns (about a minute)
node tests/bot.js 170 crowns:20 11,22,33 17   # the same week at seventeen check-ins a day; 0 for a game that is never closed (slow)
node tests/balance.test.js    # holds the game to the pacing targets: milestone times, night value, reign lengths, Crowns per week, what checking in more often is worth, and a second simpler buyer as a cross-check (about ten minutes); GAP lines are targets not met yet
node tests/ui.test.js         # layout and input in headless Chromium (needs Playwright: npm i playwright)
```

`tests/harness.js` loads `data.js` and `sim.js` into a `vm` context with no DOM. The bot is deterministic: the same arguments print the same numbers. It plays in check-ins (time away is credited through `creditAway`, as on a page load) stays for an opening session whenever it founds a new kingdom, and reports purchases per check-in and payback by stage; how it decides is described at the top of `tests/bot.js`.
