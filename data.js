'use strict';
/* Hearthold — data tables and balance constants. No logic, no DOM.
   Loaded first; sim.js and ui.js read these as plain globals. */

const RESOURCES = {
  gold: { name: 'Gold', icon: '💰' }, food: { name: 'Food', icon: '🍞' }, wood: { name: 'Wood', icon: '🪵' },
  stone: { name: 'Stone', icon: '🪨' }, iron: { name: 'Iron', icon: '🔩' },
};
const TERRAIN = {
  plain: { name: 'Open plot', icon: '' }, forest: { name: 'Forest', icon: '🌲' },
  hill: { name: 'Hills', icon: '⛰️' }, water: { name: 'Water', icon: '🌊' },
};

const HALL_TIERS = [
  { name: 'Village Hall', icon: '🛖' }, { name: 'Manor', icon: '🏡' }, { name: 'Keep', icon: '🗼' },
  { name: 'Castle', icon: '🏰' }, { name: 'Palace', icon: '👑' },
];
// Hall costs set the pace: Manor in the first session, Keep about 4 hours in, Castle about 12, Palace about 37
// (five check-ins a day; see tests/balance.test.js). A night away earns roughly a fifth to a third of the Palace.
const HALL_COST = [ // cost to leave level 1, 2, 3, 4; later levels multiply the last by HALL_GROWTH each
  { gold: 4000, wood: 2000, stone: 500 }, { gold: 1.5e5, wood: 5e4, stone: 1.2e4 },
  { gold: 3.2e6, stone: 6.5e5, iron: 1e4 }, { gold: 4e8, stone: 5e7, iron: 1e6 },
];
const HALL_GROWTH = 50;
const HALL_HOUSING = 5;          // villagers housed per hall level
const HALL_FORAGE = 0.5;         // food per second per hall level
const HALL_BONUS = 0.25;         // all production per hall level above 1
const PRESTIGE_HALL = 4;         // hall level needed to abdicate

const MAP_SIZE = 11, MAP_MID = 5;
const MAP_RADIUS = [2, 3, 4, 5]; // unlocked radius around the centre per expansion
const EXPAND_COST = [{ gold: 3e4, wood: 1e4 }, { gold: 3e7, stone: 3e6 }, { gold: 5e8, iron: 3e6 }];
const CLEAR_COST = { gold: 500 }; // clearing forest/hills/water into an open plot
const CLEAR_GROWTH = 2;           // each clearing costs this many times the last

// ── Balance ──
const START_RES = { gold: 20, food: 30, wood: 10, stone: 0, iron: 0 };
const HEAD_START = { gold: 250, wood: 200, food: 60, stone: 40 }; // extra starting stock for a kingdom founded by abdicating: skips the first tutorial steps, no more
const DECREE_CHOICES = 3;        // decrees open at a time
const ROUTINE_RESERVE_SECONDS = 3600; // routine upgrades keep the next hall's price back once it is this close
const START_POP = 3;
const FOOD_PER_POP = 0.08;       // base food upkeep per villager per second
const FOOD_CROWD = 200;          // upkeep per villager is multiplied by 1 + (population / FOOD_CROWD)^2
const STARVE_PENALTY = 0.5;      // output of non-food workplaces while starving
const STARVE_LOSS = 0.01;        // share of villagers who leave per second while starving
const FOOD_RESERVE_SECONDS = 120; // villagers also move in while the stores cover this many seconds of upkeep
const BUILD_GROWTH = 1.3;        // default cost growth per copy of a building already standing
const UPGRADE_BASE = 1.5;        // upgrade cost = base cost × UPGRADE_BASE × UPGRADE_GROWTH^level
const UPGRADE_GROWTH = 5;          // default; a building's own upgradeGrowth overrides it
const LINEAR_UPGRADE_GROWTH = 2.5; // buildings that gain a flat amount per level get cheaper steps
// High levels cost extra: above UPGRADE_CREEP_FROM the price is also multiplied by UPGRADE_CREEP^(levels above)^2,
// so each level is a slower decision than the last and payback grows from minutes to most of a day (linear buildings are exempt).
const UPGRADE_CREEP_FROM = 3;
const UPGRADE_CREEP = 1.2;
const MAX_LEVEL = 60;            // keeps every cost, refund and rate a finite number (level 60 costs about 1e155)
const REFUND_SHARE = 0.75;       // share of build + upgrade costs returned on demolition
const CROWN_BONUS = 0.05;        // production bonus per Crown
// Crowns offered for abdicating = CROWN_RATE × log10(gold earned this reign / threshold), where the threshold is
// CROWN_GOLD × (Crown multiplier ^ CROWN_STEEPEN). A logarithm means each further Crown takes more gold than the
// last, so starting over pays. CROWN_GOLD is set so that a first reign is offered 15 Crowns about when its Palace
// stands (about 37 hours at five check-ins a day) and 20 about half a day later.
const CROWN_RATE = 9;
const CROWN_GOLD = 2.2e7;
const CROWN_STEEPEN = 0;
const CROWN_DEAR_FROM = 30;      // past this many Crowns held the threshold also multiplies by (multiplier / multiplier at 30)^CROWN_DEAR,
const CROWN_DEAR = 4;            // so later reigns must grow further, not just repeat the first reign faster
const CROWN_MIN = 15;            // Crowns that must be on offer before abdication opens: a first Palace, not a first Castle
const CROWN_GOAL = 20;           // Crowns on offer at which the game suggests abdicating
const CLICK_GOLD = 1;            // gold per hand collection: a flourish for the first minutes, not an income
const ROUTINE_SECONDS = 600;     // a "routine" upgrade costs at most this many seconds of income in each material
const ROUTINE_MAX = 200;         // most upgrades one routine action makes
const OFFLINE_HOURS = 8;         // offline progress cap without research
const REST_AFTER_HOURS = 6;      // a rested town: every hour of one absence past this many (within the cap)...
const REST_BONUS = 1;            // ...is worth this much extra, so long absences lose less to the wait for the player
const OFFLINE_REPORT_SECONDS = 60; // shorter absences are credited without a summary

// Buildings. out: per second at level 1. work: villagers needed per level.
// adj: bonus per adjacent terrain type / per adjacent building, times the square root of that building's level.
// linear: housing/output grows by a flat amount per level instead of doubling. growth: build cost growth.
// upgradeGrowth: upgrade cost growth per level (default UPGRADE_GROWTH).
// upgradeAlso: a further material every upgrade from level `from` up costs, growing like the rest of the price.
const BUILDINGS = {
  cottage: { name: 'Cottage', icon: '🏠', hall: 1, cost: { wood: 10 }, house: 5, linear: true, growth: 1.3, upgradeGrowth: LINEAR_UPGRADE_GROWTH, upgradeAlso: { from: 3, cost: { stone: 4 } }, out: { gold: 0.4 },
    adj: { building: { tavern: 0.5 } }, desc: 'Houses villagers, who pay a modest tax.' },
  lumber: { name: 'Lumber Camp', icon: '🪓', hall: 1, cost: { gold: 20 }, work: 2, out: { wood: 0.8 },
    adj: { terrain: { forest: 0.5 } }, desc: 'Fells timber. Wants forest nearby.' },
  farm: { name: 'Farm', icon: '🌾', hall: 1, cost: { gold: 10, wood: 15 }, work: 2, linear: true, growth: 1.25, upgradeGrowth: LINEAR_UPGRADE_GROWTH, out: { food: 1.5 },
    adj: { terrain: { water: 0.5 }, building: { mill: 0.5 } }, desc: 'Feeds the village. Thrives beside water and mills.' },
  quarry: { name: 'Quarry', icon: '⛏️', hall: 1, cost: { gold: 120, wood: 80 }, work: 3, out: { stone: 0.5 },
    adj: { terrain: { hill: 0.5 } }, desc: 'Cuts stone. Wants hills nearby.' },
  market: { name: 'Market', icon: '🏪', hall: 2, cost: { gold: 600, wood: 400, stone: 120 }, work: 3, out: { gold: 4 },
    adj: { building: { cottage: 0.2, guild: 0.5 } }, desc: 'Trade brings gold. Busier when surrounded by cottages.' },
  mill: { name: 'Mill', icon: '🎡', hall: 2, cost: { wood: 800, stone: 300 }, work: 2, linear: true, upgradeGrowth: LINEAR_UPGRADE_GROWTH, out: { food: 2 },
    desc: 'Grinds grain and boosts every farm beside it.' },
  tavern: { name: 'Tavern', icon: '🍺', hall: 2, cost: { gold: 20000, wood: 8000 }, work: 2, out: { gold: 2 },
    desc: 'Merry villagers pay more tax. Boosts cottages beside it.' },
  mine: { name: 'Mine', icon: '🕳️', hall: 3, cost: { gold: 16000, wood: 8000, stone: 4000 }, work: 4, out: { iron: 0.6 },
    adj: { terrain: { hill: 0.5 } }, desc: 'Digs iron ore. Wants hills nearby.' },
  smith: { name: 'Blacksmith', icon: '⚒️', hall: 3, cost: { gold: 30000, stone: 10000, iron: 1000 }, work: 4, out: { gold: 25 },
    adj: { building: { mine: 0.3, guild: 0.5 } }, desc: 'Forges goods worth a fortune. Likes a mine next door.' },
  church: { name: 'Church', icon: '⛪', hall: 3, cost: { gold: 1e5, stone: 4e4, iron: 4000 }, work: 2, glob: 0.05, growth: 1.6,
    desc: 'Inspires the whole realm: +5% to all production per level while fully staffed.' },
  guild: { name: 'Guildhall', icon: '🏦', hall: 4, cost: { gold: 1e6, stone: 3e5, iron: 3e4 }, work: 5, out: { gold: 60 }, growth: 1.3,
    desc: 'Organises the trades. Boosts markets and blacksmiths beside it.' },
};
const BUILD_ORDER = ['cottage', 'lumber', 'farm', 'quarry', 'market', 'mill', 'tavern', 'mine', 'smith', 'church', 'guild'];

// Research. mult: production multiplier per building id.
// fx: other effects, read through researchFx(): clearCost (×), offlineHours (max). keep: survives abdication.
const RESEARCH = [
  { id: 'axes', name: 'Iron-shod Axes', desc: 'Lumber Camps ×2', hall: 1, cost: { gold: 150 }, mult: { lumber: 2 } },
  { id: 'rotation', name: 'Crop Rotation', desc: 'Farms ×2', hall: 1, cost: { gold: 200, wood: 100 }, mult: { farm: 2 } },
  { id: 'tithes', name: 'Tithes', desc: 'Cottage taxes ×2', hall: 1, cost: { gold: 400 }, mult: { cottage: 2 } },
  { id: 'chisels', name: 'Stone Chisels', desc: 'Quarries ×2', hall: 1, cost: { gold: 600, wood: 300 }, mult: { quarry: 2 } },
  { id: 'steward', name: 'Stewardship', desc: 'Offline progress lasts 24h instead of 8h. Kept when you found a new kingdom', hall: 1, cost: { gold: 200 }, fx: { offlineHours: 24 }, keep: true },
  { id: 'plough', name: 'Heavy Plough', desc: 'Farms and Mills ×2', hall: 2, cost: { gold: 12000, stone: 2500 }, mult: { farm: 2, mill: 2 } },
  { id: 'charter', name: 'Market Charter', desc: 'Markets ×2', hall: 2, cost: { gold: 15000, wood: 7500 }, mult: { market: 2 } },
  { id: 'saws', name: 'Two-man Saws', desc: 'Lumber Camps ×2', hall: 2, cost: { gold: 20000, stone: 5000 }, mult: { lumber: 2 } },
  { id: 'survey', name: 'Royal Surveyors', desc: 'Clearing land costs half as much', hall: 2, cost: { gold: 25000, wood: 10000 }, fx: { clearCost: 0.5 } },
  { id: 'ale', name: 'Strong Ale', desc: 'Taverns and cottage taxes ×2', hall: 2, cost: { gold: 40000, wood: 20000 }, mult: { tavern: 2, cottage: 2 } },
  { id: 'masonry', name: 'Masonry', desc: 'Quarries ×2', hall: 3, cost: { gold: 1e6, wood: 5e5 }, mult: { quarry: 2 } },
  { id: 'shafts', name: 'Deep Shafts', desc: 'Mines ×2', hall: 3, cost: { gold: 1.5e6, stone: 5e5 }, mult: { mine: 2 } },
  { id: 'bellows', name: 'Great Bellows', desc: 'Blacksmiths ×2', hall: 3, cost: { gold: 2.5e6, iron: 5e4 }, mult: { smith: 2 } },
  { id: 'almanac', name: "Farmers' Almanac", desc: 'Mills ×2', hall: 4, cost: { gold: 6e6, stone: 1e6 }, mult: { mill: 2 } },
  { id: 'carts', name: 'Ore Carts', desc: 'Mines ×2', hall: 4, cost: { gold: 1.2e7, stone: 2e6 }, mult: { mine: 2 } },
  { id: 'fields', name: 'Three-field System', desc: 'Farms ×3', hall: 4, cost: { gold: 2.5e7, stone: 5e6 }, mult: { farm: 3 } },
  { id: 'aqueduct', name: 'Aqueducts', desc: 'Cottage taxes ×2', hall: 4, cost: { gold: 3.5e7, stone: 8e6 }, mult: { cottage: 2 } },
  { id: 'banking', name: 'Banking', desc: 'Markets and Guildhalls ×2', hall: 4, cost: { gold: 5e7, iron: 3e5 }, mult: { market: 2, guild: 2 } },
  { id: 'marks', name: "Maker's Marks", desc: 'Blacksmiths ×2', hall: 4, cost: { gold: 1e8, iron: 1e6 }, mult: { smith: 2 } },
  { id: 'steel', name: 'Crucible Steel', desc: 'Mines and Blacksmiths ×2', hall: 5, cost: { gold: 2e8, iron: 1e6 }, mult: { mine: 2, smith: 2 } },
  { id: 'mint', name: 'Royal Mint', desc: 'All gold buildings ×2', hall: 5, cost: { gold: 6e8, stone: 5e7 }, mult: { cottage: 2, market: 2, tavern: 2, smith: 2, guild: 2 } },
];

// Repeatable upgrades: gold sinks with exponentially scaling costs. Levels reset on abdication.
const REPEATABLES = [
  { id: 'food', name: 'Granaries', desc: 'Food production +10% per level', hall: 3, cost: { gold: 5e5 }, growth: 2, per: 0.1 },
  { id: 'housing', name: 'Town Planning', desc: 'Housing +10% per level', hall: 3, cost: { gold: 1e6 }, growth: 2, per: 0.1 },
  { id: 'prod', name: 'Royal Roads', desc: 'All production +5% per level', hall: 4, cost: { gold: 2e7 }, growth: 2.5, per: 0.05 },
  { id: 'monument', name: 'Monument', desc: '+1 Crown on your next abdication per level', hall: 5, cost: { gold: 2e9 }, growth: 4, per: 1 },
];
const MAX_REPEATABLE = 500;

// Decrees: goals with rewards. DECREE_CHOICES are open at a time, in this order, and the player works on whichever
// they like. Claimed ones are saved by id, so entries can be added or reordered safely.
// done(): boolean, or progress(): [current, target]. Both read the live game through sim.js helpers.
const DECREES = [
  { id: 'roof', title: 'A Roof Overhead', desc: 'Build a Cottage: pick it in the Build list, then tap an empty green plot.', done: () => count('cottage') >= 1, reward: { wood: 20 } },
  { id: 'timber', title: 'Timber!', desc: 'Build a Lumber Camp. Beside a forest it works 50% faster.', done: () => count('lumber') >= 1, reward: { gold: 40 } },
  { id: 'bread', title: 'Daily Bread', desc: 'Build a Farm so nobody goes hungry.', done: () => count('farm') >= 1, reward: { food: 50, wood: 20 } },
  { id: 'hamlet', title: 'A Growing Hamlet', desc: 'Reach a population of 12.', progress: () => [state.run.pop, 12], reward: { gold: 80 } },
  { id: 'land', title: 'Lay of the Land', desc: 'Give any building an adjacency bonus of 50% or more.', done: () => Object.values(calc.tiles).some(t => t.adj >= 0.5), reward: { wood: 60 } },
  { id: 'bedrock', title: 'Bedrock', desc: 'Build a Quarry.', done: () => count('quarry') >= 1, reward: { gold: 100 } },
  { id: 'learned', title: 'Learned Folk', desc: 'Buy something in the Research tab.', done: () => Object.keys(state.run.research).length >= 1, reward: { gold: 150 } },
  { id: 'coffers', title: 'A Full Treasury', desc: 'Hold 2,000 gold at once. A Manor costs 4,000 gold, 2,000 wood and 500 stone: leave the small upgrades be for a while and let the stores fill.', progress: () => [state.run.res.gold, 2000], reward: { wood: 300, stone: 100 } },
  { id: 'manor', title: 'Lord of the Manor', desc: 'Tap your Village Hall and upgrade it into a Manor.', done: () => hallLevel() >= 2, reward: { gold: 300, wood: 200 } },
  { id: 'market', title: 'Market Day', desc: 'Build a Market.', done: () => count('market') >= 1, reward: { gold: 400 } },
  { id: 'grist', title: 'Grist for the Mill', desc: 'Build a Mill right next to a Farm.', done: () => hasPair('mill', 'farm'), reward: { food: 500 } },
  { id: 'builders', title: 'Master Builders', desc: 'Upgrade any building to level 3.', done: () => Object.values(state.run.tiles).some(t => t.kind === 'building' && t.level >= 3), reward: { stone: 300 } },
  { id: 'horizons', title: 'New Horizons', desc: 'Expand your borders (bottom of the Build tab).', done: () => state.run.exp >= 1, reward: { gold: 1500 } },
  { id: 'town', title: 'A Proper Town', desc: 'Reach a population of 150.', progress: () => [state.run.pop, 150], reward: { gold: 3000 } },
  { id: 'keep', title: 'Stronghold', desc: 'Raise a Keep.', done: () => hallLevel() >= 3, reward: { stone: 20000 } },
  { id: 'deep', title: 'Into the Deep', desc: 'Build a Mine.', done: () => count('mine') >= 1, reward: { gold: 20000 } },
  { id: 'anvil', title: 'Hammer and Anvil', desc: 'Build a Blacksmith.', done: () => count('smith') >= 1, reward: { iron: 1000 } },
  { id: 'bells', title: 'Bells at Dawn', desc: 'Build a Church.', done: () => count('church') >= 1, reward: { gold: 1e5 } },
  { id: 'treasury', title: 'Royal Treasury', desc: 'Earn 500 gold per second.', progress: () => [calc.base.gold, 500], reward: { gold: 5e5 } },
  { id: 'castle', title: 'Seat of Power', desc: 'Raise a Castle.', done: () => hallLevel() >= 4, reward: { iron: 20000 } },
  { id: 'veins', title: 'Veins of Iron', desc: 'Upgrade a Mine to level 4.', done: () => Object.values(state.run.tiles).some(t => t.id === 'mine' && t.level >= 4), reward: { gold: 1e6 } },
  { id: 'spires', title: 'Three Spires', desc: 'Have three Churches standing. Each lifts all production while it is fully staffed.', progress: () => [count('church'), 3], reward: { gold: 3e6 } },
  { id: 'marches', title: 'The Marches', desc: 'Expand your borders a second time.', done: () => state.run.exp >= 2, reward: { stone: 5e5 } },
  { id: 'city', title: 'A Thriving City', desc: 'Reach a population of 750. Villagers need housing, and bigger towns eat more per head.', progress: () => [state.run.pop, 750], reward: { gold: 2e6 } },
  { id: 'guild', title: 'Brotherhood of Trades', desc: 'Build a Guildhall.', done: () => count('guild') >= 1, reward: { gold: 2e6 } },
  { id: 'scholars', title: 'A Seat of Learning', desc: 'Hold twelve pieces of research at once.', progress: () => [Object.keys(state.run.research).length, 12], reward: { iron: 1e5 } },
  { id: 'roads', title: 'All Roads Lead Here', desc: 'Build Royal Roads twice (Research tab, repeatable upgrades).', progress: () => [repLevel('prod'), 2], reward: { gold: 2e7 } },
  { id: 'riches', title: 'Overflowing Coffers', desc: 'Earn 20,000 gold per second.', progress: () => [calc.base.gold, 20000], reward: { gold: 3e7 } },
  { id: 'palace', title: 'Crown Jewel', desc: 'Raise a Palace.', done: () => hallLevel() >= 5, reward: { gold: 1e7 } },
  { id: 'dynasty', title: 'A New Dynasty', desc: 'Found a new kingdom from the Realm tab. It opens at ' + CROWN_MIN + ' Crowns on offer, about when a Palace stands; ' + CROWN_GOAL + ' or more pays best.', done: () => state.meta.stats.prestiges >= 1, reward: { gold: 1000, wood: 500 } },
  { id: 'metropolis', title: 'Metropolis', desc: 'Reach a population of 2,000.', progress: () => [state.run.pop, 2000], reward: { gold: 1e8 } },
  { id: 'golden', title: 'Golden Age', desc: 'Earn 1M gold per second.', progress: () => [calc.base.gold, 1e6], reward: { gold: 1e9 } },
  { id: 'legend', title: 'Legend', desc: 'Hold 100 Crowns.', progress: () => [state.meta.crowns, 100], reward: { gold: 1e9 } },
];
const DECREES_NEW_IN_V3 = ['coffers', 'veins', 'spires', 'marches', 'scholars', 'roads', 'riches']; // added with save version 3
// Version-1 saves stored the decree as an index into this (the original) order.
const LEGACY_DECREE_ORDER = ['roof', 'timber', 'bread', 'hamlet', 'land', 'bedrock', 'learned', 'manor', 'market', 'grist', 'builders',
  'horizons', 'town', 'keep', 'deep', 'anvil', 'bells', 'treasury', 'castle', 'dynasty', 'guild', 'palace', 'golden', 'legend'];
