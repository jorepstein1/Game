# Hearthold economy retune: specification (prototype, sim and bot only)

Branch `retune-prototype`. Values below are exactly those in `data.js` and `sim.js` at this commit (round 4: towns
of about 35-40 buildings at the Palace). The UI and most of `tests/sim.test.js` / `tests/balance.test.js` are not
yet updated (14 sim tests fail, as before this round: they test routines and per-tile levels).

## 1. Rules

**Kind levels.** `run.levels = { cottage: 1, lumber: 1, … }` (every id in BUILD_ORDER, starting at 1). A building
tile is `{ kind: 'building', id }` with no level of its own; every building of a kind works at the kind's level,
and a new one is built at it. The hall tile keeps its own `level`. Halls are upgraded manually, one level at a time;
every reign starts at a Village Hall.

**What a kind's level does** (L = kind level):
- output per building = base output × OUT_GROWTH^(L−1) (×3), or × L for `linear` kinds (Cottage housing and tax,
  Farm, Mill); Church: +glob × L to all production while fully staffed;
- jobs per building = work × L; housing per Cottage = house × L;
- adjacency given by a building to a neighbour = bonus × √L of the giver's kind.

**Price rule (worth).** For a kind with n standing at level L:

    worth(n, L) = cost × W(n) × U(L)
    W(n)  = step(0) + step(1) + … + step(n−1)
    step(i) = g^i                                        while i < late.from (or always, if no `late`)
            = g^(late.from−1) × late.growth^(i−late.from+1)   from i = late.from on
    U(1)  = 1,   U(L) = lift × u^(L−1) for L ≥ 2         (lift defaults to 1)

Every purchase costs the rise in worth it causes (each material scaled, rounded up, capped at 1e300):

    build    n → n+1 :  cost × step(n) × U(L)
    upgrade  L → L+1 :  cost × max(1, W(n)) × (U(L+1) − U(L))     (requires n ≥ 1)

So reaching n buildings at level L costs worth(n, L) whatever the order of building and upgrading (no ordering
exploit). **Demolish** refunds REFUND_SHARE (75%) of the last copy's share at today's level,
worth(n, L) − worth(n−1, L), floored; building again costs the full share, so a build–demolish cycle always loses
25% and nothing can be farmed.

**Removed:** routine upgrades (`routineUpgrades`, `routineReserve`, ROUTINE_* constants) and per-tile building
upgrades (`upgrade(key)` on a building tile forwards to `upgradeKind(id)`).

**Rest (offline).** Time away is credited in full up to the offline cap (8 h; 24 h with Stewardship). Of the time
away counted since the last purchase, every second past REST_AFTER_HOURS (1 h) counts REST_BONUS (1.5) extra, and
every second past REST_LONG_AFTER_HOURS (8 h, a night) counts REST_LONG_BONUS (2) more again, as extra simulated
time. A 4 h absence is worth 8.5 h, a night of 8 h 18.5 h, 12 h 36.5 h; the long tier is for players who look in
twice a day and does not touch a five-a-day rhythm, whose longest gap is the night. A purchase ends the rest; looking in without buying does not. An open game never earns it.

**Decrees reworded:** 'builders' = "Raise any kind of building to level 3" (any kind level ≥ 3);
'veins' = "Raise your Mines to level 4" (a Mine stands and the mine level is ≥ 4).

**Save v4.** `run.levels` is saved. Migrating v3 → v4: each kind's level = the highest `level` among its tiles
(1 if none); tile levels are dropped. (Written, not yet tested.)

## 2. Tables

| Kind | Hall | Base cost | Output at level 1 | Per level | g | late | u | lift | Kind upgrades L1→2 … L5→6, 1 standing (gold) |
|---|---|---|---|---|---|---|---|---|---|
| Cottage | 1 | 5 gold, 10 wood | 0.4 gold/s, houses 5 | linear (+level-1 amount) | 2 | ×5 from copy 7 | 6 | 1 | 25 ; 150 ; 900 ; 5.40K ; 32.4K |
| Lumber Camp | 1 | 20 gold, 5 wood | 0.8 wood/s, 2 jobs | ×3 | 3 | ×8 from copy 5 | 18 | 10 | 3.58K ; 61.2K ; 1.10M ; 19.8M ; 357M |
| Farm | 1 | 10 gold, 15 wood | 1.5 food/s, 2 jobs | linear (+level-1 amount) | 2.5 | ×6 from copy 6 | 6 | 1 | 50 ; 300 ; 1.80K ; 10.8K ; 64.8K |
| Quarry | 1 | 120 gold, 80 wood | 0.5 stone/s, 3 jobs | ×3 | 3 | ×8 from copy 5 | 18 | 10 | 21.5K ; 367K ; 6.61M ; 119M ; 2.14B |
| Market | 2 | 80.0K gold, 30.0K wood | 2 gold/s, 3 jobs | ×3 | 2 | - | 4 | 1 | 240K ; 960K ; 3.84M ; 15.4M ; 61.4M |
| Mill | 2 | 60.0K gold, 90.0K wood | 3 food/s, 2 jobs | linear (+level-1 amount) | 2 | - | 4 | 1 | 180K ; 720K ; 2.88M ; 11.5M ; 46.1M |
| Tavern | 2 | 360K gold, 180K wood | 2 gold/s, 2 jobs | ×3 | 2 | - | 4 | 1 | 1.08M ; 4.32M ; 17.3M ; 69.1M ; 276M |
| Mine | 3 | 200K gold, 80.0K wood, 40.0K stone | 0.4 iron/s, 4 jobs | ×3 | 2 | - | 4 | 1 | 600K ; 2.40M ; 9.60M ; 38.4M ; 154M |
| Blacksmith | 3 | 400K gold, 120K stone, 4.00K iron | 12 gold/s, 4 jobs | ×3 | 2 | - | 4 | 1 | 1.20M ; 4.80M ; 19.2M ; 76.8M ; 307M |
| Church | 3 | 500K gold, 100K wood, 10.0K iron | +5% all production, 2 jobs | +5% per level (linear) | 2 | - | 4 | 1 | 1.50M ; 6.00M ; 24.0M ; 96.0M ; 384M |
| Guildhall | 4 | 600K gold, 150K wood, 10.0K iron | 12 gold/s, 5 jobs | ×3 | 2 | - | 4 | 1 | 1.80M ; 7.20M ; 28.8M ; 115M ; 461M |

Halls (cost to leave level 1..4; later levels ×50 each): Manor = 2.50K gold, 1.00K wood, 250 stone; Keep = 126K gold, 84.0K wood, 50.4K stone; Castle = 756K gold, 302K stone; Palace = 11.2M gold, 2.24M stone, 112K iron

Expansions (radius 2→3→4→5): 12.0K gold, 5.00K wood; 500K gold, 100K stone; 4.00M gold, 40.0K iron

| Research | Hall | Cost | Effect |
|---|---|---|---|
| Iron-shod Axes (axes) | 1 | 150 gold | Lumber Camps ×2 |
| Crop Rotation (rotation) | 1 | 200 gold, 100 wood | Farms ×2 |
| Tithes (tithes) | 1 | 400 gold | Cottage taxes ×2 |
| Stone Chisels (chisels) | 1 | 300 gold, 150 wood | Quarries ×2 |
| Stewardship (steward) | 1 | 200 gold | Offline progress lasts 24h instead of 8h. Kept when you found a new kingdom |
| Heavy Plough (plough) | 2 | 300K gold, 75.0K stone | Farms and Mills ×2 |
| Market Charter (charter) | 2 | 400K gold, 200K wood | Markets ×2 |
| Two-man Saws (saws) | 2 | 500K gold, 125K stone | Lumber Camps ×2 |
| Royal Surveyors (survey) | 2 | 600K gold, 250K wood | Clearing land costs half as much |
| Strong Ale (ale) | 2 | 1.00M gold, 500K wood | Taverns and cottage taxes ×2 |
| Masonry (masonry) | 3 | 4.00M gold, 2.00M wood | Quarries ×2 |
| Deep Shafts (shafts) | 3 | 5.00M gold, 1.50M stone | Mines ×2 |
| Great Bellows (bellows) | 3 | 7.50M gold, 100K iron | Blacksmiths ×2 |
| Farmers' Almanac (almanac) | 4 | 15.0M gold, 4.00M stone | Mills ×2 |
| Ore Carts (carts) | 4 | 20.0M gold, 5.00M stone | Mines ×2 |
| Three-field System (fields) | 4 | 25.0M gold, 6.00M stone | Farms ×3 |
| Aqueducts (aqueduct) | 4 | 30.0M gold, 7.50M stone | Cottage taxes ×2 |
| Banking (banking) | 4 | 40.0M gold, 250K iron | Markets and Guildhalls ×2 |
| Maker's Marks (marks) | 4 | 50.0M gold, 500K iron | Blacksmiths ×2 |
| Crucible Steel (steel) | 5 | 100M gold, 1.00M iron | Mines and Blacksmiths ×2 |
| Royal Mint (mint) | 5 | 200M gold, 25.0M stone | All gold buildings ×2 |

| Repeatable | Hall | First cost | Growth | Per level |
|---|---|---|---|---|
| Granaries (food) | 3 | 400K gold | ×2 | Food production +10% per level |
| Town Planning (housing) | 3 | 800K gold | ×2 | Housing +10% per level |
| Royal Roads (prod) | 4 | 4.00M gold | ×2.5 | All production +10% per level |
| Monument (monument) | 5 | 40.0M gold | ×4 | +1 Crown on your next abdication per level |

Constants: OUT_GROWTH 3, BUILD_GROWTH 3, UPGRADE_GROWTH 6, LINEAR_UPGRADE_GROWTH 6, REFUND_SHARE 0.75, MAX_LEVEL 60; CROWN_RATE 13, CROWN_GOLD 1400000, CROWN_STEEPEN 0, CROWN_DEAR_FROM 30, CROWN_DEAR 4, CROWN_MIN 15, CROWN_GOAL 20, CROWN_BONUS 0.05; REST_AFTER_HOURS 1, REST_BONUS 1.5, REST_LONG_AFTER_HOURS 8, REST_LONG_BONUS 2, OFFLINE_HOURS 8 (24 with Stewardship); HALL_BONUS 0.25, HALL_HOUSING 5, HALL_FORAGE 0.5; START_RES {"gold":20,"food":30,"wood":10,"stone":0,"iron":0}, HEAD_START {"gold":250,"wood":200,"food":60,"stone":40}; CLEAR_COST {"gold":500} ×2 per clearing; FOOD_PER_POP 0.08, FOOD_CROWD 200.

Hall-1 research costs that changed for the opening: Stone Chisels 300 gold, 150 wood. The first expansion
(12K gold, 5K wood) falls at the first check-in, with the Keep; the bot buys an expansion as soon as three or
fewer open plots are left.

## 3. Measured results (tests/bot.js, careful buyer)

Five check-ins a day = an opening session of 25 min, then gaps of 4, 4, 4, 4 h and an 8 h night, 3 min open each.
Maps 11, 22, 33, 44, 55, 66. Commands: `node tests/bot.js 60 none 11,22,33,44,55,66 5 log` and
`node tests/bot.js compare 168 11,22,33,44,55,66`. The bot buys, among purchases that do not delay the next hall
(or delay it by at most 3%), the best own payback first; a first building of a kind first (if it delays the hall by
at most 25%); an expansion first once three or fewer open plots are left.

**Per map (never abdicating, 60 h; third expansion from a 72 h run)**

| Map | Manor | Keep | Castle | Palace | 15 Crowns | 20 Crowns | Buildings at Keep / Castle / Palace | Kinds by Palace | Expansions bought | Purchases / check-in (median, most) |
|---|---|---|---|---|---|---|---|---|---|---|
| 11 | 17.2 m | 4.4 h | 12.5 h | 36.8 h | 36.8 h | 48.9 h | 19 / 21 / 35 | 11 | 4.4, 28.7, 61.0 h | 4, 9 |
| 22 | 17.3 m | 4.4 h | 12.5 h | 36.8 h | 36.8 h | 48.9 h | 19 / 21 / 38 | 11 | 4.4, 24.6, 65.1 h | 3, 10 |
| 33 | 17.2 m | 4.4 h | 12.5 h | 36.8 h | 36.8 h | 48.9 h | 19 / 21 / 37 | 11 | 4.4, 24.6, 73.1 h | 3, 10 |
| 44 | 17.2 m | 4.4 h | 12.5 h | 36.8 h | 36.8 h | 48.9 h | 19 / 21 / 35 | 11 | 4.4, 24.6, 57.0 h | 5, 10 |
| 55 | 17.2 m | 4.4 h | 12.5 h | 36.8 h | 36.8 h | 48.9 h | 19 / 21 / 33 | 11 | 4.4, 24.6, 73.1 h | 5, 11 |
| 66 | 17.2 m | 4.4 h | 12.5 h | 40.8 h | 40.8 h | 48.9 h | 19 / 20 / 37 | 11 | 4.4, 24.6, 57.0 h | 5, 9 |

Opening session: 16 to 18 purchases (11 to 13 buildings), Manor at 17 min. No starving on any map.

**Purchases per check-in, first reign, all maps:** median 5 (median 2 builds, 1 kind upgrade, 1 other); kind
upgrades are 27% of build + upgrade purchases; 8% of check-ins buy nothing (the one before the Palace, saving).
First check-in after the opening (Keep, expansion 1, six Hall-1 copies, a Cottage upgrade) 9 to 11; after 4 h
median 5, most 11; after a night median 6, most 9; right after a hall median 2, most 8.
Per check-in before the Palace (mean of 43): Quarry 0.65, Lumber Camp 0.58, Farm 0.56, Cottage upgrade 0.40,
expansion 0.28, Market upgrade 0.28, research 0.28, Mine 0.21, Blacksmith 0.19, Church 0.16, Guildhall 0.16,
Market, Mill, Tavern, Keep, Castle 0.14 each, Cottage 0.07, Blacksmith upgrade 0.07, Mine upgrade 0.02.

**Every build or kind upgrade after the opening:** adds a median 18% to the income of the material it makes
(10th percentile 5%: first Mines and Churches, Cottage upgrades, Taverns); payback median 7.0 h (4.9 to 7.0 h
per map), 10th percentile 0.1 h, 90th 126 h.

**Check-in frequency (168 h, abdicating at 20 Crowns; mean Crowns at 7 days, six maps)**

| Check-ins a day | Crowns | vs five a day |
|---|---|---|
| 2 (abdicate at 20) | 77.8 | 78% |
| 2 (abdicate at 15) | 77.8 | 78% |
| 2 (abdicate once at 15, then at 20) | 85.7 | 86% |
| 5 | 99.3 | 100% |
| 49 | 102.2 | 103% |
| never closed (5 s steps) | 53.8 | 54% |

**Not met:** purchases per check-in median 5 (target 3-4) and most 11 (target 6); first check-in after the opening
9 to 11 (target 5); night most 9 (target 6); 33 buildings at the Palace on map 55 (target 35); third expansion
16 to 36 h after the Palace on half the maps (target within about a day). The bursts are Hall-1 copies (Quarry,
Lumber Camp, Farm at growth 2.5-3): the price of a 40-building town is many cheap copies, and a rested 4 h
absence after a hall buys several at once.
