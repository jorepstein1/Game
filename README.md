# Hearthold

A medieval idle city builder that runs entirely in the browser. No build step and no dependencies: open `index.html` (or serve the folder with any static server).

## How it plays

- **Place buildings on the map.** Position matters: lumber camps want forests, quarries and mines want hills, farms want water and mills, markets want cottages, taverns boost cottages. Bonus badges preview what each plot would give before you build.
- **Balance the village.** Cottages house villagers (a flat amount per level), working buildings need them, and everyone eats. Food upkeep per villager rises as the town grows, so housing and farms have to keep pace with everything else. Villagers only move in while there is food for them; if the stores run dry, work slows to half and villagers drift away until the farms can feed the rest.
- **Upgrade and expand.** Every building can be levelled up (×2 output per level; cottages, farms and mills gain a flat amount per level instead, at a gentler price, and the Upgrade button says what the level adds). Raise your Village Hall into a Manor, Keep, Castle and Palace to unlock new buildings and research, and buy more land as you grow. When the map is full, forest, hills and water can be cleared into open plots for gold. Demolishing returns half of everything the building cost, upgrades included.
- **Follow the Decrees.** A chain of goals with rewards that doubles as the tutorial.
- **Catch the merchant.** A caravan wanders onto the map every minute or two (a marker appears in the resource bar): tap it for gold, supplies or a ×3 festival.
- **Found a new kingdom (prestige).** With a Castle you can abdicate for Crowns, each a permanent +5% to all production. Crowns come from lifetime gold earned with diminishing returns: `floor((lifetime gold / 500) ^ 0.25)`, minus those already awarded.
- **Repeatable upgrades.** From the Keep onwards the Research tab offers gold sinks with exponentially scaling costs: food, housing and all-production bonuses, plus Monuments that each add a Crown to your next abdication. They reset when you found a new kingdom.
- **Idle.** The game saves every 10 seconds and credits up to 8 hours of time away (24 with research), whether the page was closed or the tab was asleep.
- **Phones.** On narrow screens the resource bar is a single compact row, a bar fixed at the bottom holds the build list (or the selected tile's Upgrade and Demolish) so the map remains in view, and large maps pan inside their frame so plots stay at least 40px.

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
node tests/bot.js             # balance bot: 4 hours on seeds 11, 22, 33, 44 (no dependencies, about 90 seconds)
node tests/bot.js 6 pct 11    # arguments: hours, abdication policy (none | castle | pct), comma-separated seeds
node tests/ui.test.js         # layout and input in headless Chromium (needs Playwright: npm i playwright)
```

`tests/harness.js` loads `data.js` and `sim.js` into a `vm` context with no DOM. The bot is deterministic: the same arguments print the same numbers.
