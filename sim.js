'use strict';
/* Hearthold — simulation: state, rules, actions and the save format.
   No DOM and no timers, so it runs in Node as well as the browser (load data.js first).
   Actions return { ok, msg } and leave it to the caller to show anything. */

const SAVE_VERSION = 2;
const HALL_KEY = MAP_MID + ',' + MAP_MID;

// state = { v, last, meta, run }
//   meta: survives abdication (Crowns, decree progress, lifetime stats)
//   run:  the current city, replaced wholesale on abdication
// calc is the derived snapshot from compute(): housing, jobs, multipliers and rates.
let state, calc;

// ───────────────────────── State ─────────────────────────
function newMeta(now) {
  return { crowns: 0, bonusCrowns: 0 /* how many of the Crowns came from Monuments */, decree: DECREES[0].id,
    stats: { clicks: 0, totalGold: 0, prestiges: 0, built: 0, started: now || 0 } };
}
// A kingdom founded with Crowns held gets a small head start in resources (none for a first kingdom).
function newRun(seed, crowns) {
  if (seed === undefined) seed = (Math.random() * 2 ** 31) | 0;
  const run = { seed, terrain: genTerrain(seed), res: Object.assign({}, START_RES), pop: START_POP, exp: 0, tiles: {},
    research: {}, repeatables: {}, cleared: 0, starving: false,
    clock: 0,       // seconds of simulated time this run; only moves when the city is stepped
    gold: 0 };      // gold earned this run
  run.tiles[HALL_KEY] = { kind: 'hall', id: 'hall', level: 1 };
  if (crowns > 0) for (const r in HEAD_START) run.res[r] += HEAD_START[r];
  return run;
}
function newState(now) { return { v: SAVE_VERSION, last: now || 0, meta: newMeta(now), run: newRun() }; }
function startNewGame(now) { state = newState(now); calc = compute(); }

function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function genTerrain(seed) {
  const rnd = mulberry(seed), g = [];
  for (let x = 0; x < MAP_SIZE; x++) { g.push([]); for (let y = 0; y < MAP_SIZE; y++) {
    const r = rnd(); g[x].push(r < 0.14 ? 'forest' : r < 0.23 ? 'hill' : r < 0.29 ? 'water' : 'plain'); } }
  g[MAP_MID][MAP_MID] = 'plain';
  // The starting 5×5 always has something of everything to play with.
  const want = { forest: 3, hill: 2, water: 2 };
  for (const k in want) {
    let have = 0, guard = 0;
    for (let x = 3; x <= 7; x++) for (let y = 3; y <= 7; y++) if (g[x][y] === k) have++;
    while (have < want[k] && guard++ < 200) {
      const x = 3 + ((rnd() * 5) | 0), y = 3 + ((rnd() * 5) | 0);
      if (g[x][y] === 'plain' && !(x === MAP_MID && y === MAP_MID)) { g[x][y] = k; have++; }
    }
  }
  return g;
}

// ───────────────────────── Helpers ─────────────────────────
const NUMBER_SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
function fmt(n) {
  n = Number(n);
  if (n !== n) return '0';
  if (!isFinite(n)) return '∞';
  const neg = n < 0; n = Math.abs(n); let s;
  if (n < 1000) s = String(Math.floor(n));
  else { const e = Math.floor(Math.log10(n) / 3);
    if (e >= NUMBER_SUFFIX.length) s = n.toExponential(2);
    else { const v = n / 10 ** (e * 3); s = (v < 9.995 ? v.toFixed(2) : v < 99.95 ? v.toFixed(1) : Math.min(999, Math.round(v))) + NUMBER_SUFFIX[e]; } } // never "1000M"
  return (neg ? '-' : '') + s;
}
const fmtRate = n => (n >= 0 ? '+' : '-') + (Math.abs(n) < 100 ? Math.abs(n).toFixed(1) : fmt(Math.abs(n))) + '/s';
const pct = x => '+' + Math.round(x * 100) + '%';
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const xy = key => key.split(',').map(Number);

const hallLevel = () => state.run.tiles[HALL_KEY].level;
const hallTier = level => HALL_TIERS[Math.min(level, HALL_TIERS.length) - 1];
const hallName = level => hallTier(level).name + (level > HALL_TIERS.length ? ' +' + (level - HALL_TIERS.length) : '');
const count = id => { let c = 0; const tiles = state.run.tiles; for (const k in tiles) if (tiles[k].kind === 'building' && tiles[k].id === id) c++; return c; };
const mapRadius = () => MAP_RADIUS[state.run.exp];
const unlocked = (x, y) => Math.abs(x - MAP_MID) <= mapRadius() && Math.abs(y - MAP_MID) <= mapRadius();
function neighbors(x, y) { return [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].filter(([a, b]) => unlocked(a, b)); }

const levelMult = t => BUILDINGS[t.id].linear ? t.level : Math.pow(2, t.level - 1);
function scaleCost(cost, k) { const o = {}; for (const r in cost) o[r] = Math.min(BIG, Math.ceil(cost[r] * k)); return o; } // never Infinity
function addCost(total, cost) { for (const r in cost) total[r] = (total[r] || 0) + cost[r]; return total; }
const canAfford = cost => Object.keys(cost).every(r => state.run.res[r] >= cost[r]);
function pay(cost) { if (!canAfford(cost)) return false; for (const r in cost) state.run.res[r] -= cost[r]; return true; }
function grant(cost) { for (const r in cost) state.run.res[r] += cost[r]; }
function earnGold(g) { state.run.gold += g; state.meta.stats.totalGold += g; }

// Per-kind tile behaviour. A tile is { kind, id, level }; anything that differs between the hall
// and ordinary buildings lives here, so new kinds can be added without touching the rules below.
const TILE_KINDS = {
  hall: {
    removable: false,
    name: t => hallName(t.level),
    icon: t => hallTier(t.level).icon,
    housing: t => HALL_HOUSING * t.level,
    jobs: () => 0,
    upgradeCost: t => t.level <= HALL_COST.length ? HALL_COST[t.level - 1]
      : scaleCost(HALL_COST[HALL_COST.length - 1], Math.pow(HALL_GROWTH, t.level - HALL_COST.length)),
  },
  building: {
    removable: true,
    name: t => BUILDINGS[t.id].name,
    icon: t => BUILDINGS[t.id].icon,
    housing: t => (BUILDINGS[t.id].house || 0) * levelMult(t),
    jobs: t => (BUILDINGS[t.id].work || 0) * t.level,
    upgradeCost: t => { const def = BUILDINGS[t.id], k = UPGRADE_BASE * Math.pow(def.upgradeGrowth || UPGRADE_GROWTH, t.level) * upgradeCreep(t), also = def.upgradeAlso;
      return scaleCost(also && t.level >= also.from ? addCost(Object.assign({}, def.cost), also.cost) : def.cost, k); },
  },
};
const upgradeCreep = t => BUILDINGS[t.id].linear ? 1 : Math.pow(UPGRADE_CREEP, Math.max(0, t.level - UPGRADE_CREEP_FROM) ** 2);
const tileKind = t => TILE_KINDS[t.kind];
const upgradeCost = t => tileKind(t).upgradeCost(t);
const buildGrowth = id => BUILDINGS[id].growth || BUILD_GROWTH;
const buildCost = id => scaleCost(BUILDINGS[id].cost, Math.pow(buildGrowth(id), count(id)));

// Adjacency: terrain and buildings are separate namespaces (def.adj.terrain / def.adj.building).
function adjBonus(id, x, y) {
  const a = BUILDINGS[id].adj; if (!a) return 0;
  let s = 0;
  for (const [nx, ny] of neighbors(x, y)) {
    const t = state.run.tiles[nx + ',' + ny];
    if (t) { if (t.kind === 'building' && a.building && a.building[t.id]) s += a.building[t.id] * Math.sqrt(t.level); }
    else if (a.terrain && a.terrain[state.run.terrain[nx][ny]]) s += a.terrain[state.run.terrain[nx][ny]];
  }
  return s;
}
const boosts = (receiver, giver) => !!(BUILDINGS[receiver].adj && BUILDINGS[receiver].adj.building && BUILDINGS[receiver].adj.building[giver]);
function givesTo(id, x, y) { // how many neighbours would be boosted by placing `id` here
  let c = 0;
  for (const [nx, ny] of neighbors(x, y)) { const t = state.run.tiles[nx + ',' + ny]; if (t && t.kind === 'building' && boosts(t.id, id)) c++; }
  return c;
}
function hasPair(a, b) {
  const tiles = state.run.tiles;
  for (const k in tiles) if (tiles[k].kind === 'building' && tiles[k].id === a) { const [x, y] = xy(k);
    if (neighbors(x, y).some(([nx, ny]) => { const t = tiles[nx + ',' + ny]; return t && t.kind === 'building' && t.id === b; })) return true; }
  return false;
}

const hasResearch = id => !!state.run.research[id];
function researchMult(id) { let m = 1; for (const r of RESEARCH) if (hasResearch(r.id) && r.mult && r.mult[id]) m *= r.mult[id]; return m; }
// Non-production research effects, driven by the `fx` field in the RESEARCH table.
const FX_BASE = { clearCost: 1, offlineHours: OFFLINE_HOURS };
function researchFx(key) {
  let v = FX_BASE[key];
  for (const r of RESEARCH) if (hasResearch(r.id) && r.fx && r.fx[key] !== undefined) v = key === 'offlineHours' ? Math.max(v, r.fx[key]) : v * r.fx[key];
  return v;
}

const repeatable = id => REPEATABLES.find(r => r.id === id);
const repLevel = id => state.run.repeatables[id] || 0;
const repBonus = id => 1 + repeatable(id).per * repLevel(id);
const repCost = r => scaleCost(r.cost, Math.pow(r.growth, repLevel(r.id)));

const foodPerPop = pop => FOOD_PER_POP * (1 + (pop / FOOD_CROWD) ** 2);
const upkeep = pop => pop * foodPerPop(pop);
// Base food income if the town held `pop` villagers (used to preview what more housing would do).
function foodRateAt(pop) { const keep = state.run.pop; state.run.pop = pop; const r = compute().base.food; state.run.pop = keep; return r; }
// Largest population between lo and hi whose upkeep still fits in `budget` food per second.
function sustainablePop(lo, hi, budget) {
  if (upkeep(hi) <= budget) return hi;
  if (upkeep(lo) > budget) return lo;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (upkeep(mid) <= budget) lo = mid; else hi = mid; }
  return lo;
}

// Crowns for abdicating come from the gold earned this reign, on a log scale (see data.js), plus one per Monument level.
const crownMult = crowns => 1 + CROWN_BONUS * crowns;
const crownThreshold = crowns => CROWN_GOLD * Math.pow(crownMult(crowns), CROWN_STEEPEN) * Math.pow(Math.max(1, crownMult(crowns) / crownMult(CROWN_DEAR_FROM)), CROWN_DEAR);
const crownsFor = (runGold, crownsHeld) => Math.max(0, Math.floor(CROWN_RATE * Math.log10(Math.max(1, runGold) / crownThreshold(crownsHeld || 0)) + 1e-9));
const goldForCrowns = (n, crownsHeld) => crownThreshold(crownsHeld || 0) * Math.pow(10, n / CROWN_RATE); // reign gold needed for n Crowns
const pendingCrowns = () => crownsFor(state.run.gold, state.meta.crowns) + repLevel('monument');
const canPrestige = () => hallLevel() >= PRESTIGE_HALL && pendingCrowns() >= CROWN_MIN; // small offers are not worth a reign, so they are not made

// ───────────────────────── Simulation ─────────────────────────
// Returns the derived snapshot. `base` is what the city makes on its own; `rates` is what it is making
// right now, i.e. base less the starvation penalty.
function compute() {
  const run = state.run, tiles = {};
  let cap = 0, need = 0, glob = 0;
  for (const k in run.tiles) {
    const t = run.tiles[k], kind = tileKind(t);
    cap += kind.housing(t); need += kind.jobs(t);
    if (t.kind !== 'building') continue;
    const [x, y] = xy(k);
    if (BUILDINGS[t.id].glob) glob += BUILDINGS[t.id].glob * t.level;
    tiles[k] = { adj: adjBonus(t.id, x, y), levelMult: levelMult(t), mult: 0 };
  }
  const rawCap = cap;
  cap = Math.floor(cap * repBonus('housing'));
  const staff = need ? Math.min(1, run.pop / need) : 1;
  const mult = (1 + HALL_BONUS * (hallLevel() - 1)) * crownMult(state.meta.crowns) * (1 + glob * staff) * repBonus('prod');
  const foodMult = repBonus('food');
  const base = { gold: 0, food: HALL_FORAGE * hallLevel(), wood: 0, stone: 0, iron: 0 }; // the hall's own folk forage
  const rates = Object.assign({}, base);
  for (const k in tiles) {
    const t = run.tiles[k], def = BUILDINGS[t.id]; if (!def.out) continue;
    const m = tiles[k].levelMult * (1 + tiles[k].adj) * researchMult(t.id) * mult * (def.work ? staff : 1) * (def.out.food ? foodMult : 1);
    const live = tiles[k].mult = m * (def.work && run.starving && !def.out.food ? STARVE_PENALTY : 1);
    for (const r in def.out) { base[r] += def.out[r] * m; rates[r] += def.out[r] * live; }
  }
  const eaten = upkeep(run.pop);
  base.food -= eaten; rates.food -= eaten;
  return { cap, rawCap, need, staff, mult, base, rates, eaten, tiles };
}

// Advance the city by dt seconds. Pure rules: no rendering, no wall clock.
function stepCity(dt) {
  const run = state.run;
  calc = compute();
  for (const r in calc.rates) run.res[r] = Math.max(0, run.res[r] + calc.rates[r] * dt);
  earnGold(Math.max(0, calc.rates.gold * dt));
  run.starving = run.res.food <= 0 && calc.rates.food < 0;
  // Population follows food as well as housing, so a hungry town recovers on its own:
  // villagers leave while it starves (down to what the farms can feed), and new ones only move in
  // while the food income, or a healthy stockpile, can carry them.
  const produced = calc.rates.food + calc.eaten; // food made per second before upkeep
  if (run.starving) {
    const floor = sustainablePop(Math.min(run.pop, START_POP), run.pop, produced);
    run.pop = Math.max(floor, run.pop - Math.max(0.2, run.pop * STARVE_LOSS) * dt);
  } else if (run.pop < calc.cap) {
    let target = Math.min(calc.cap, run.pop + Math.max(0.2, calc.cap * 0.02) * dt);
    if (run.res.food <= calc.eaten * FOOD_RESERVE_SECONDS) target = sustainablePop(run.pop, target, produced);
    run.pop = target;
  }
  if (run.pop > calc.cap) run.pop = calc.cap;
  run.clock += dt;
}
function advance(sec) {
  if (!(sec > 0)) return;
  const n = sec <= 0.25 ? 1 : Math.min(1000, Math.ceil(sec / 0.25));
  for (let i = 0; i < n; i++) stepCity(sec / n);
}
// Credit time spent away, capped by the offline limit. Every gap (page load or a resumed tab) goes through here.
function creditAway(sec) {
  sec = sec > 0 && isFinite(sec) ? sec : 0;
  const capHours = researchFx('offlineHours'), credited = Math.min(sec, capHours * 3600);
  const before = Object.assign({}, state.run.res);
  advance(credited);
  const gains = {};
  for (const r in RESOURCES) if (state.run.res[r] - before[r] >= 1) gains[r] = state.run.res[r] - before[r];
  return { away: sec, credited, capped: sec > credited, capHours, gains };
}

// ───────────────────────── Actions ─────────────────────────
const fail = msg => ({ ok: false, msg });

function build(key, id) {
  const [x, y] = xy(key), def = hasOwn(BUILDINGS, id) ? BUILDINGS[id] : null;
  if (!def || def.hall > hallLevel() || !unlocked(x, y) || state.run.tiles[key] || state.run.terrain[x][y] !== 'plain') return fail();
  if (!pay(buildCost(id))) return fail('Not enough resources for a ' + def.name + '.');
  state.run.tiles[key] = { kind: 'building', id, level: 1 }; state.meta.stats.built++;
  return { ok: true };
}
function upgrade(key) {
  const t = state.run.tiles[key];
  if (!t || t.level >= MAX_LEVEL || !pay(upgradeCost(t))) return fail();
  t.level++;
  return { ok: true, msg: t.kind === 'hall' ? `🎉 Your seat is now a ${hallName(t.level)}!` : undefined };
}
// Everything paid for a building: its build price plus each upgrade. Demolition returns REFUND_SHARE of it.
function spentOn(t) {
  const total = addCost({}, scaleCost(BUILDINGS[t.id].cost, Math.pow(buildGrowth(t.id), Math.max(0, count(t.id) - 1))));
  for (let l = 1; l < t.level; l++) addCost(total, upgradeCost({ kind: t.kind, id: t.id, level: l }));
  return total;
}
function demolishRefund(t) { const o = spentOn(t); for (const r in o) o[r] = Math.min(BIG, Math.floor(o[r] * REFUND_SHARE)); return o; }
function demolish(key) {
  const t = state.run.tiles[key];
  if (!t || !tileKind(t).removable) return fail();
  const refund = demolishRefund(t);
  delete state.run.tiles[key]; grant(refund);
  return { ok: true, refund };
}
function buyResearch(id) {
  const r = RESEARCH.find(r => r.id === id);
  if (!r || hasResearch(id) || r.hall > hallLevel() || !pay(r.cost)) return fail();
  state.run.research[id] = 1;
  return { ok: true, msg: '📜 Researched ' + r.name };
}
function buyRepeatable(id) {
  const r = repeatable(id);
  if (!r || r.hall > hallLevel() || repLevel(id) >= MAX_REPEATABLE || !pay(repCost(r))) return fail();
  state.run.repeatables[id] = repLevel(id) + 1;
  return { ok: true };
}
function expand() {
  if (state.run.exp >= EXPAND_COST.length || !pay(EXPAND_COST[state.run.exp])) return fail();
  state.run.exp++;
  return { ok: true, msg: '🗺️ Your borders grow!' };
}
// Turning forest, hills or water into an open plot: the way forward once the map is full.
const clearCost = () => scaleCost(CLEAR_COST, Math.pow(CLEAR_GROWTH, state.run.cleared) * researchFx('clearCost'));
function clearLand(key) {
  const [x, y] = xy(key);
  if (!unlocked(x, y) || state.run.tiles[key] || state.run.terrain[x][y] === 'plain' || !pay(clearCost())) return fail();
  state.run.terrain[x][y] = 'plain'; state.run.cleared++;
  return { ok: true, msg: '🪓 The land is cleared.' };
}

// Routine upgrades: the cheap building upgrades nobody needs to think about, made in one action so they do not
// crowd out the real choices. An upgrade is routine when every material it costs is at most ROUTINE_SECONDS of the
// town's income of that material, so the whole batch can never set the next hall back by much. Cheapest first;
// workplaces wait while there would be no one to staff them. With `preview` nothing is bought: it only counts.
function routineUpgrades(preview) {
  const run = state.run, keep = preview ? JSON.stringify({ tiles: run.tiles, res: run.res }) : null, spent = {};
  let n = 0;
  for (; n < ROUTINE_MAX; n++) {
    calc = compute();
    const made = r => Math.max(0, calc.base[r] + (r === 'food' ? calc.eaten : 0));
    let best = null, bestCost = null, bestSum = Infinity;
    for (const k in run.tiles) {
      const t = run.tiles[k], def = BUILDINGS[t.id];
      if (t.kind !== 'building' || t.level >= MAX_LEVEL || (def.work && calc.need + def.work > calc.cap)) continue;
      const c = upgradeCost(t); let sum = 0, ok = true;
      for (const r in c) { sum += c[r]; if (c[r] > made(r) * ROUTINE_SECONDS || run.res[r] < c[r]) { ok = false; break; } }
      if (ok && sum < bestSum) { best = k; bestCost = c; bestSum = sum; }
    }
    if (!best) break;
    pay(bestCost); run.tiles[best].level++; addCost(spent, bestCost);
  }
  if (preview) { const o = JSON.parse(keep); run.tiles = o.tiles; run.res = o.res; }
  calc = compute();
  return n ? { ok: true, count: n, spent, msg: `⬆️ ${n} routine upgrade${n > 1 ? 's' : ''} made` } : Object.assign(fail('No routine upgrades to make just now.'), { count: 0, spent });
}

const currentDecree = () => DECREES.find(d => d.id === state.meta.decree) || null;
const decreesFulfilled = () => { const d = currentDecree(); return d ? DECREES.indexOf(d) : DECREES.length; };
function decreeDone() {
  const d = currentDecree(); if (!d) return false;
  if (d.done) return !!d.done();
  const [a, b] = d.progress(); return a >= b;
}
function claimDecree() {
  if (!decreeDone()) return fail();
  const d = currentDecree(), next = DECREES[DECREES.indexOf(d) + 1];
  grant(d.reward); state.meta.decree = next ? next.id : null;
  return { ok: true, msg: '✅ ' + d.title + ' — reward claimed' };
}

// Abdicate: bank the Crowns in meta and start a fresh run.
function prestige() {
  if (!canPrestige()) return fail();
  const n = pendingCrowns(), meta = state.meta;
  meta.bonusCrowns += repLevel('monument'); meta.crowns += n; meta.stats.prestiges++;
  const kept = RESEARCH.filter(r => r.keep && hasResearch(r.id)); // knowledge that outlasts a reign
  state.run = newRun(undefined, meta.crowns); for (const r of kept) state.run.research[r.id] = 1;
  calc = compute();
  return { ok: true, crowns: n, msg: `👑 A new dynasty begins with ${fmt(meta.crowns)} Crowns and a head start.` };
}

// Hand collection: a little gold per tap, there for the first minutes of a reign. It does not grow with income,
// so keeping the game open and tapping earns nothing that matters later.
const clickValue = () => CLICK_GOLD;
function collectTaxes() {
  const g = clickValue();
  state.run.res.gold += g; earnGold(g); state.meta.stats.clicks++;
  return { ok: true, gold: g };
}

// ───────────────────────── Saves ─────────────────────────
// A save is the JSON of `state`. Loading never trusts it: sanitizeSave() rebuilds a fresh state and copies
// over only known fields, coerced to the right type and clamped, so a damaged or hand-edited save cannot
// inject markup or leave the game unplayable.
const BIG = 1e300;
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function num(v, def, min, max) {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}
const int = (v, def, min, max) => Math.floor(num(v, def, min, max));

function serialize() { return JSON.stringify(state); }
// Export text: base64 of the UTF-8 bytes, so non-Latin-1 characters cannot make btoa throw.
function encodeSave(json) { return btoa(unescape(encodeURIComponent(json))); }
function decodeSave(text) {
  const bin = atob(String(text).trim());
  try { return decodeURIComponent(escape(bin)); } catch (e) { return bin; } // version-1 exports were plain Latin-1
}

// Version 1 was one flat object with tiles as { b, l }, the decree as an index and wall-clock festival times.
function upgradeLegacySave(o) {
  const tiles = {};
  for (const k in o.tiles) { const t = o.tiles[k]; if (isObj(t)) tiles[k] = { kind: t.b === 'hall' ? 'hall' : 'building', id: t.b, level: t.l }; }
  const stats = isObj(o.stats) ? o.stats : {}, crowns = int(o.crowns, 0, 0, 1e9), quest = int(o.quest, 0, 0, 1e6);
  return { v: 2, last: o.last,
    meta: { crowns, bonusCrowns: 0, // Crowns already held stay
      decree: quest < LEGACY_DECREE_ORDER.length ? LEGACY_DECREE_ORDER[quest] : null, stats },
    run: { seed: o.seed, res: o.res, pop: o.pop, exp: o.exp, tiles, research: o.research, starving: o.starving, gold: o.runGold } };
}

// Returns { state, notes }. Throws if the data is not a save at all (or is from a newer version).
function sanitizeSave(raw, now) {
  if (!isObj(raw)) throw new Error('not a save');
  let o = raw; const notes = [], legacy = o.v === undefined && isObj(o.tiles) && isObj(o.res);
  if (legacy) o = upgradeLegacySave(o);
  const v = int(o.v, 0, 0, 1e9);
  if (!v || !isObj(o.meta) || !isObj(o.run)) throw new Error('not a save');
  if (v > SAVE_VERSION) throw new Error('save is from a newer version');
  // Migrations between later versions go here: if (v < 3) { ... }

  if (legacy) notes.push('This kingdom predates the rebalance: cottages, farms and mills now gain a flat amount per level and big towns eat more, so it needs more housing and food than before.');
  const s = newState(now), meta = s.meta, run = s.run, m = o.meta, r = o.run;
  s.last = num(o.last, now, 0, now);

  meta.crowns = int(m.crowns, 0, 0, 1e9);
  meta.bonusCrowns = int(m.bonusCrowns, 0, 0, meta.crowns);
  if (m.decree === null) meta.decree = null;
  else if (m.decree !== undefined) {
    meta.decree = DECREES.some(d => d.id === m.decree) ? m.decree : null;
    if (meta.decree === null) notes.push('A decree in this save no longer exists; the decree chain was marked complete.');
  }
  const st = isObj(m.stats) ? m.stats : {};
  for (const k of ['clicks', 'prestiges', 'built']) meta.stats[k] = int(st[k], 0, 0, 1e15);
  meta.stats.totalGold = num(st.totalGold, 0, 0, BIG);
  meta.stats.started = num(st.started, now, 0, now);

  run.seed = int(r.seed, run.seed, -(2 ** 31), 2 ** 31);
  const grid = r.terrain;
  const gridOk = Array.isArray(grid) && grid.length === MAP_SIZE && grid.every(col => Array.isArray(col) && col.length === MAP_SIZE && col.every(c => typeof c === 'string' && hasOwn(TERRAIN, c)));
  run.terrain = gridOk ? grid.map(col => col.slice()) : genTerrain(run.seed); // version 1 regenerated terrain from the seed
  run.terrain[MAP_MID][MAP_MID] = 'plain';
  run.exp = int(r.exp, 0, 0, EXPAND_COST.length);
  run.cleared = int(r.cleared, 0, 0, MAP_SIZE * MAP_SIZE);
  const res = isObj(r.res) ? r.res : {};
  for (const k in RESOURCES) run.res[k] = num(res[k], run.res[k], 0, BIG);
  run.gold = num(r.gold, 0, 0, BIG);
  run.clock = num(r.clock, 0, 0, BIG);
  run.starving = r.starving === true;

  let dropped = 0;
  const radius = MAP_RADIUS[run.exp], tiles = isObj(r.tiles) ? r.tiles : {};
  for (const k in tiles) {
    const t = tiles[k], mt = /^(\d{1,2}),(\d{1,2})$/.exec(k);
    if (!mt || !isObj(t)) { dropped++; continue; }
    const x = +mt[1], y = +mt[2], level = int(t.level, 1, 1, MAX_LEVEL);
    if (k === HALL_KEY) { run.tiles[k].level = level; continue; } // the centre is always the hall
    if (Math.abs(x - MAP_MID) > radius || Math.abs(y - MAP_MID) > radius || typeof t.id !== 'string' || !hasOwn(BUILDINGS, t.id)) { dropped++; continue; }
    run.tiles[x + ',' + y] = { kind: 'building', id: t.id, level };
    run.terrain[x][y] = 'plain';
  }
  if (dropped) notes.push(dropped + (dropped === 1 ? ' building in this save was not recognised and was removed.' : ' buildings in this save were not recognised and were removed.'));
  const research = isObj(r.research) ? r.research : {};
  for (const item of RESEARCH) if (research[item.id]) run.research[item.id] = 1;
  const reps = isObj(r.repeatables) ? r.repeatables : {};
  for (const item of REPEATABLES) { const l = int(reps[item.id], 0, 0, MAX_REPEATABLE); if (l) run.repeatables[item.id] = l; }
  run.pop = num(r.pop, START_POP, 0, 1e12); // clamped to housing by the first step
  return { state: s, notes };
}
// Replace the live game with a sanitized save. On any failure the previous game is left untouched.
function adoptSave(raw, now) {
  const prev = state, prevCalc = calc;
  try {
    const out = sanitizeSave(raw, now);
    state = out.state; calc = compute();
    if (state.run.pop > calc.cap) { state.run.pop = calc.cap; calc = compute(); }
    return out.notes;
  } catch (e) { state = prev; calc = prevCalc; throw e; }
}
