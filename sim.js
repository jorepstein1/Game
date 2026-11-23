'use strict';
/* Hearthold — simulation: state, rules, actions and the save format.
   No DOM and no timers, so it runs in Node as well as the browser (load data.js first).
   Actions return { ok, msg, icon } (icon names a sprite for the message) and leave it to the caller to show anything. */

const SAVE_VERSION = 6;
const TERRAIN_GEN = 2; // run.gen: which generator made the map (2 = genTerrain, features; 1 or missing = genTerrainLegacy)
const HALL_KEY = MAP_MID + ',' + MAP_MID;

// state = { v, last, meta, run }
//   meta: survives abdication (Crowns, decree progress, lifetime stats)
//   run:  the current city, replaced wholesale on abdication
// calc is the derived snapshot from compute(): housing, jobs, multipliers and rates.
let state, calc;

// ───────────────────────── State ─────────────────────────
function newMeta(now) {
  return { crowns: 0, bonusCrowns: 0 /* how many of the Crowns came from Monuments */, decree: DECREES[0].id /* the decree being pursued */, decreesDone: {} /* ids already claimed */,
    stats: { clicks: 0, totalGold: 0, prestiges: 0, built: 0, upgrades: 0, started: now || 0 } };
}
// A kingdom founded with Crowns held gets a small head start in resources (none for a first kingdom).
function newRun(seed, crowns) {
  if (seed === undefined) seed = (Math.random() * 2 ** 31) | 0;
  const run = { seed, gen: TERRAIN_GEN, terrain: genTerrain(seed), res: Object.assign({}, START_RES), pop: START_POP, exp: 0, tiles: {},
    levels: newLevels(), // every building of a kind works at its kind's level
    research: {}, repeatables: {}, cleared: 0, starving: false,
    clock: 0,       // seconds of simulated time this run; only moves when the city is stepped
    away: 0,        // seconds of time away credited since the last purchase (the rested bonus counts from there)
    gold: 0,        // gold earned this run
    collected: 0 }; // gold from hand collection this run, up to CLICK_LIMIT
  run.tiles[HALL_KEY] = { kind: 'hall', id: 'hall', level: 1 };
  if (crowns > 0) for (const r in HEAD_START) run.res[r] += HEAD_START[r];
  return run;
}
function newLevels() { const o = {}; for (const id of BUILD_ORDER) o[id] = 1; return o; }
function newState(now) { return { v: SAVE_VERSION, last: now || 0, meta: newMeta(now), run: newRun() }; }
function startNewGame(now) { state = newState(now); calc = compute(); }

function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// ── Terrain ──
// Sites: an open plot with k neighbours of one terrain, counting only tiles inside radius r of the centre (what the
// player has unlocked). k >= 2 is a double site, k >= 3 a triple: where a camp, quarry or farm earns +100% or more.
const STEPS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const ringOf = (x, y) => Math.max(Math.abs(x - MAP_MID), Math.abs(y - MAP_MID));
const onMap = (x, y) => x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE;
function sameAround(g, x, y, r, t) { let k = 0; for (const [dx, dy] of STEPS4) { const a = x + dx, b = y + dy; if (onMap(a, b) && ringOf(a, b) <= r && g[a][b] === t) k++; } return k; }
// Per terrain, how many open plots within radius r are double (2+) and triple (3+) sites. The hall's tile is not a plot.
function siteCounts(g, r) {
  const o = { open: 0, double: { forest: 0, hill: 0, water: 0 }, triple: { forest: 0, hill: 0, water: 0 } };
  for (let x = MAP_MID - r; x <= MAP_MID + r; x++) for (let y = MAP_MID - r; y <= MAP_MID + r; y++) {
    if (g[x][y] !== 'plain' || (x === MAP_MID && y === MAP_MID)) continue;
    o.open++;
    for (const t in o.double) { const k = sameAround(g, x, y, r, t); if (k >= 2) o.double[t]++; if (k >= 3) o.triple[t]++; }
  }
  return o;
}
const sumOf = o => Object.values(o).reduce((a, b) => a + b, 0);

// Features, not single tiles: groves, hill ranges and a lake or river, placed by the seeded RNG. The value of a
// feature is in the open plots on its edges, so none is left solid: a grove's inner tiles become clearings, ranges
// jog and fork, rivers bend. The hall's tile and its four neighbours stay open.
let terrainAttempts = 0; // maps drawn by the last genTerrain call (1 = the first draw passed); read by the tests
function genTerrain(seed) {
  const rnd = mulberry(seed), pick = a => a[(rnd() * a.length) | 0];
  const fixed = (x, y) => Math.abs(x - MAP_MID) + Math.abs(y - MAP_MID) <= 1;
  let g;
  for (let attempt = 0; attempt < 30; attempt++) { // a map the repair pass cannot fix is drawn again from the same RNG
    terrainAttempts = attempt + 1;
    g = []; for (let x = 0; x < MAP_SIZE; x++) g.push(Array(MAP_SIZE).fill('plain'));
    const have = { forest: 0, hill: 0, water: 0 }; // tiles of each so far; the last feature of a kind may be cut short
    const put = (x, y, t) => { if (onMap(x, y) && !fixed(x, y) && g[x][y] === 'plain' && have[t] < BIOME_TILES[t]) { g[x][y] = t; have[t]++; return true; } return false; };
    const blob = (t, size) => { // grown from a seed tile by orthogonal steps; a grove's inner tiles are then cleared
      const cells = [[(rnd() * MAP_SIZE) | 0, (rnd() * MAP_SIZE) | 0]];
      for (let guard = 0; cells.length < size && guard < 40; guard++) { const [x, y] = pick(cells), [dx, dy] = pick(STEPS4), a = x + dx, b = y + dy;
        if (onMap(a, b) && !fixed(a, b) && !cells.some(([p, q]) => p === a && q === b)) cells.push([a, b]); }
      const inSet = (a, b) => cells.some(([p, q]) => p === a && q === b);
      for (const [x, y] of cells) if (t === 'water' || !STEPS4.every(([dx, dy]) => inSet(x + dx, y + dy))) put(x, y, t); // a lake stays whole: a cleared middle could cut it into pieces
    };
    const line = (t, len, wiggle, thick) => { // a range or river: walks one way, now and then stepping aside (a bend is an L, never a diagonal)
      let x = (rnd() * MAP_SIZE) | 0, y = (rnd() * MAP_SIZE) | 0; const [dx, dy] = pick(STEPS4), side = rnd() < 0.5 ? 1 : -1;
      for (let i = 0; i < len; i++) {
        put(x, y, t); if (rnd() < thick) put(x + dy * side, y + dx * side, t);
        if (rnd() < wiggle) { x += dy * side; y += dx * side; put(x, y, t); }
        x += dx; y += dy;
      }
    };
    // Water first, so no grove or range lies across a river and breaks it into pieces.
    for (let guard = 0; guard < 60 && have.water < BIOME_TILES.water; guard++) if (rnd() < 0.5) blob('water', 4 + ((rnd() * 3) | 0)); else line('water', 4 + ((rnd() * 4) | 0), 0.4, 0);
    for (let guard = 0; guard < 60 && have.forest < BIOME_TILES.forest; guard++) blob('forest', 4 + ((rnd() * 5) | 0));
    for (let guard = 0; guard < 60 && have.hill < BIOME_TILES.hill; guard++) line('hill', 3 + ((rnd() * 3) | 0), 0.3, 0.35);
    // Groves and ranges that overlap can still close up into a solid mass: open its inner tiles too (clearings).
    const inner = []; for (let x = 0; x < MAP_SIZE; x++) for (let y = 0; y < MAP_SIZE; y++) if (g[x][y] !== 'plain' && g[x][y] !== 'water' && STEPS4.every(([dx, dy]) => onMap(x + dx, y + dy) && g[x + dx][y + dy] === g[x][y])) inner.push([x, y]);
    for (const [x, y] of inner) g[x][y] = 'plain';
    if (repairTerrain(g, rnd, fixed)) break;
  }
  // If all 30 draws fail (none does for seeds tested, and the tests hold the count to a handful), the last map is kept
  // as it is: a valid grid with its features, short of some guarantee, rather than no map at all.
  return g;
}
// The guarantees (see data.js): the start area has some of every terrain, a double forest site and enough plots;
// by the first expansion every terrain has a double site;
// every expansion adds a triple site and BIOME_DOUBLES double sites; the full map has a triple site of each terrain.
// Water is never a lone tile: each has an orthogonal water neighbour (inside the start area, one inside it too), so
// lakes and rivers read as such and a farm between two of their tiles has a double site.
// Each failure is fixed by turning the fewest open tiles around one plot into that terrain, then everything is
// checked again, since a fix can spoil an earlier ring. Returns false if the map cannot be fixed this way.
function repairTerrain(g, rnd, fixed) {
  const R = MAP_RADIUS, T = ['forest', 'hill', 'water'];
  // Make a new k-site (better than it was at radius `prev`) within radius r, of terrain `want` or any.
  const pocket = (r, k, want, prev) => {
    let best = null, bestCost = Infinity;
    for (let x = MAP_MID - r; x <= MAP_MID + r; x++) for (let y = MAP_MID - r; y <= MAP_MID + r; y++) {
      if (g[x][y] !== 'plain' || (x === MAP_MID && y === MAP_MID)) continue;
      for (const t of want ? [want] : T) {
        if (sameAround(g, x, y, r, t) >= k || (prev >= 0 && ringOf(x, y) <= prev && sameAround(g, x, y, prev, t) >= k)) continue;
        const nb = STEPS4.map(([dx, dy]) => [x + dx, y + dy]).filter(([a, b]) => onMap(a, b) && ringOf(a, b) <= r);
        const open = nb.filter(([a, b]) => g[a][b] === 'plain' && !fixed(a, b)), need = k - sameAround(g, x, y, r, t);
        if (open.length < need) continue;
        open.sort((p, q) => (ringOf(q[0], q[1]) > prev) - (ringOf(p[0], p[1]) > prev)); // turn new land first, so inner rings keep their sites
        const use = open.slice(0, need);
        if (prev >= 0 && ringOf(x, y) <= prev && sameAround(g, x, y, prev, t) + use.filter(([a, b]) => ringOf(a, b) <= prev).length >= k) continue; // would be as good before: no gain
        const wet = ([a, b]) => STEPS4.some(([dx, dy]) => onMap(a + dx, b + dy) && (g[a + dx][b + dy] === 'water' || use.some(([p, q]) => p === a + dx && q === b + dy)));
        const lone = t === 'water' ? use.filter(u => !wet(u)).length : 0; // each lone water tile will need a partner: extending a lake is cheaper
        const cost = need + lone + 0.5 * use.filter(([a, b]) => ringOf(a, b) <= prev).length + rnd() * 0.4;
        if (cost < bestCost) { bestCost = cost; best = { t, use }; }
      }
    }
    if (!best) return false;
    for (const [a, b] of best.use) g[a][b] = best.t;
    return true;
  };
  for (let fix = 0; fix < 60; fix++) {
    const s = R.map(r => siteCounts(g, r)); let ok = true;
    for (const t of T) { let n = 0; for (let x = MAP_MID - R[0]; x <= MAP_MID + R[0]; x++) for (let y = MAP_MID - R[0]; y <= MAP_MID + R[0]; y++) if (g[x][y] === t) n++;
      if (n < BIOME_START[t]) { ok = false; // an odd tile is enough here: the start area is small
        const free = []; for (let x = MAP_MID - R[0]; x <= MAP_MID + R[0]; x++) for (let y = MAP_MID - R[0]; y <= MAP_MID + R[0]; y++) if (g[x][y] === 'plain' && !fixed(x, y)) free.push([x, y]);
        if (!free.length) return false;
        const near = t === 'water' ? free.filter(([x, y]) => STEPS4.some(([dx, dy]) => g[x + dx][y + dy] === 'water' && ringOf(x + dx, y + dy) <= R[0])) : []; // water joins water
        const from = near.length ? near : free, [x, y] = from[(rnd() * from.length) | 0]; g[x][y] = t; break; } }
    if (!ok) continue;
    if (lonelyWater(g).length) { // join it to the water beside it diagonally if there is some, else give it a partner tile
      const [x, y] = lonelyWater(g)[0], inner = ringOf(x, y) <= R[0];
      const opts = STEPS4.map(([dx, dy]) => [x + dx, y + dy]).filter(([a, b]) => onMap(a, b) && g[a][b] === 'plain' && !fixed(a, b) && (!inner || ringOf(a, b) <= R[0]));
      if (!opts.length) { g[x][y] = 'plain'; continue; }
      const joins = ([a, b]) => STEPS4.some(([dx, dy]) => onMap(a + dx, b + dy) && !(a + dx === x && b + dy === y) && g[a + dx][b + dy] === 'water');
      const best = opts.filter(joins); const [a, b] = (best.length ? best : opts)[(rnd() * (best.length || opts.length)) | 0];
      g[a][b] = 'water'; continue;
    }
    if (s[0].double.forest < 1) { if (!pocket(R[0], 2, 'forest', -1)) return false; continue; }
    { const sa = siteCounts(g, BIOME_ALL_DOUBLE), short = T.find(t => !sa.double[t]);
      if (short) { if (!pocket(BIOME_ALL_DOUBLE, 2, short, -1)) return false; continue; } }
    let i = 1;
    for (; i < R.length; i++) {
      if (sumOf(s[i].triple) - sumOf(s[i - 1].triple) < BIOME_TRIPLES) { if (!pocket(R[i], 3, null, R[i - 1])) return false; break; }
      if (sumOf(s[i].double) - sumOf(s[i - 1].double) < BIOME_DOUBLES) { if (!pocket(R[i], 2, null, R[i - 1])) return false; break; }
    }
    if (i < R.length) continue;
    const lone = T.find(t => !s[R.length - 1].triple[t]);
    if (lone) { if (!pocket(R[R.length - 1], 3, lone, -1)) return false; continue; }
    return s[0].open >= BIOME_START_OPEN;
  }
  return false;
}
// Water tiles with no orthogonal water neighbour; a tile in the start area needs that neighbour inside the start area.
function lonelyWater(g) {
  const o = [], r0 = MAP_RADIUS[0];
  for (let x = 0; x < MAP_SIZE; x++) for (let y = 0; y < MAP_SIZE; y++) if (g[x][y] === 'water' &&
    !STEPS4.some(([dx, dy]) => { const a = x + dx, b = y + dy; return onMap(a, b) && g[a][b] === 'water' && (ringOf(x, y) > r0 || ringOf(a, b) <= r0); })) o.push([x, y]);
  return o;
}
// The original generator, one roll per tile. Only version-1 saves use it: they stored no grid, just the seed.
function genTerrainLegacy(seed) {
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
const hallName = level => hallTier(level).name;
const aHall = level => (/^[AEIOU]/.test(hallName(level)) ? 'an ' : 'a ') + hallName(level); // "a Keep", "an Imperial Palace"
// The halls past the Palace open with Crowns held (HALL_CROWNS); none goes past HALL_MAX.
const hallCrowns = level => HALL_CROWNS[level] || 0;
const hallCapped = () => hallLevel() >= HALL_MAX;
// While the next hall needs more Crowns held than the realm has: { level, need }. Otherwise (open, or no next hall) null.
function hallLocked() { const next = hallLevel() + 1; return next <= HALL_MAX && state.meta.crowns < hallCrowns(next) ? { level: next, need: hallCrowns(next) } : null; }
// Whether there is a next hall to save for: not the last one, and not one still shut for want of Crowns.
const nextHallOpen = () => !hallCapped() && !hallLocked();
// The first hall the Crowns held do not open yet, whatever the hall stands at now: { level, need }, or null once all are open.
function hallUnlockAhead() { for (let l = 2; l <= HALL_MAX; l++) if (state.meta.crowns < hallCrowns(l)) return { level: l, need: hallCrowns(l) }; return null; }
const count = id => { let c = 0; const tiles = state.run.tiles; for (const k in tiles) if (tiles[k].kind === 'building' && tiles[k].id === id) c++; return c; };
const mapRadius = () => MAP_RADIUS[state.run.exp];
const unlocked = (x, y) => Math.abs(x - MAP_MID) <= mapRadius() && Math.abs(y - MAP_MID) <= mapRadius();
function neighbors(x, y) { return [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].filter(([a, b]) => unlocked(a, b)); }

const kindLevel = id => (state.run.levels && state.run.levels[id]) || 1;
// Output of one building at its kind's level: linear kinds gain their level-1 amount per level, the rest multiply by OUT_GROWTH.
const levelMultAt = (id, level) => BUILDINGS[id].linear ? level : Math.pow(OUT_GROWTH, level - 1);
const levelMult = t => levelMultAt(t.id, kindLevel(t.id));
function scaleCost(cost, k) { const o = {}; for (const r in cost) o[r] = Math.min(BIG, Math.ceil(cost[r] * k)); return o; } // never Infinity
function addCost(total, cost) { for (const r in cost) total[r] = (total[r] || 0) + cost[r]; return total; }
const canAfford = cost => Object.keys(cost).every(r => state.run.res[r] >= cost[r]);
function pay(cost) { if (!canAfford(cost)) return false; for (const r in cost) state.run.res[r] -= cost[r]; state.run.away = 0; /* a purchase ends the rest */ return true; }
function grant(cost) { for (const r in cost) state.run.res[r] += cost[r]; }
function earnGold(g) { state.run.gold += g; state.meta.stats.totalGold += g; }

// Per-kind tile behaviour. A tile is { kind, id } (the hall also has a level; buildings work at their kind's level); anything that differs between the hall
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
    jobs: t => (BUILDINGS[t.id].work || 0) * kindLevel(t.id),
    upgradeCost: t => kindUpgradeCost(t.id),
  },
};
const tileKind = t => TILE_KINDS[t.kind];
const upgradeCost = t => tileKind(t).upgradeCost(t);
// Prices. What a kind has cost in all, with n standing at level L, is one number, its "worth":
//   worth(n, L) = cost × W(n) × U(L),  W(n) = step(0) + … + step(n-1), step(i) = g^i (past `late.from` copies each
//   further step multiplies by late.growth instead of g),  U(1) = 1, U(L) = lift × u^(L-1) from level 2
//   (g: build growth, u: upgrade growth, lift: a one-off extra step at level 2, so that a cheap first-hall kind
//   keeps pace with the town once it is upgraded; 1 for most kinds)
// and every purchase costs the rise in worth it causes:
//   build   (n → n+1)  = cost × step(n) × U(L)
//   upgrade (L → L+1)  = cost × W(n) × (U(L+1) - U(L))
// So the price of reaching n buildings at level L is the same whatever the order (no exploit in building first
// or upgrading first), and demolishing refunds REFUND_SHARE of the last building's share of the worth.
const buildGrowth = id => BUILDINGS[id].growth;
const upgradeGrowth = id => BUILDINGS[id].upgradeGrowth;
// The price factor of the copy that makes n+1: g^n, or past `late.from` copies the steeper late.growth per copy.
const copyStep = (id, n) => { const g = buildGrowth(id), late = BUILDINGS[id].late;
  return !late || n < late.from ? Math.pow(g, n) : Math.pow(g, late.from - 1) * Math.pow(late.growth, n - late.from + 1); };
const copiesWorth = (id, n) => { let w = 0; for (let i = 0; i < n; i++) w += copyStep(id, i); return w; };
const levelWorth = (id, level) => level <= 1 ? 1 : (BUILDINGS[id].lift || 1) * Math.pow(upgradeGrowth(id), level - 1);
const buildCost = id => scaleCost(BUILDINGS[id].cost, copyStep(id, count(id)) * levelWorth(id, kindLevel(id)));
const kindUpgradeCost = id => scaleCost(BUILDINGS[id].cost, Math.max(1, copiesWorth(id, count(id))) * (levelWorth(id, kindLevel(id) + 1) - levelWorth(id, kindLevel(id))));

// Adjacency: terrain and buildings are separate namespaces (def.adj.terrain / def.adj.building).
function adjBonus(id, x, y) {
  const a = BUILDINGS[id].adj; if (!a) return 0;
  let s = 0;
  for (const [nx, ny] of neighbors(x, y)) {
    const t = state.run.tiles[nx + ',' + ny];
    if (t) { if (t.kind === 'building' && a.building && a.building[t.id]) s += a.building[t.id] * Math.sqrt(kindLevel(t.id)); }
    else if (a.terrain && a.terrain[state.run.terrain[nx][ny]]) s += a.terrain[state.run.terrain[nx][ny]];
  }
  return s;
}
const boosts = (receiver, giver) => (giver === 'tavern' && hasOwn(TRADES, receiver)) || !!(BUILDINGS[receiver].adj && BUILDINGS[receiver].adj.building && BUILDINGS[receiver].adj.building[giver]);
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
// The snapshot the town would have with one more level of a kind (used to preview what an upgrade does).
function afterKindUpgrade(id, opts) { const lv = state.run.levels, keep = lv[id]; lv[id] = kindLevel(id) + 1; const c = compute(opts); lv[id] = keep; return c; }
// Base food income if the town held `pop` villagers (used to preview what more housing would do).
function foodRateAt(pop) { const keep = state.run.pop; state.run.pop = pop; const c = compute(); state.run.pop = keep; return c.base.food + c.foodUsed; } // what the farms leave after upkeep, before the trades eat any
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
// Trades (see data.js, TRADES): Markets, Blacksmiths and Guildhalls share the town's spare food. Each has a need
// (what it eats at full supply: its kind's level, the realm bonus and staffing, less any Tavern beside it; never
// adjacency or research) and the gold it makes at full supply (adjacency and research raise that). From rates only:
//   supply = min(1, spare food / food all trades need)     fed = TRADE_FLOOR + (1 - TRADE_FLOOR) × supply
//   run    = min(1, SMITH_SHARE × iron made / iron wanted)
//   Market gold = full rate × fed       Blacksmith gold = full rate × fed × run
// A Guildhall eats like the others but makes no gold: its boost to its neighbours does not depend on supply.
// The trades take only spare income, never the store, so the store never falls because of them.
// opts.staff: staffing to use instead of the town's own (a preview that assumes housing keeps up).
function compute(opts) {
  opts = opts || {};
  const run = state.run, tiles = {};
  let cap = 0, need = 0, glob = 0;
  for (const k in run.tiles) {
    const t = run.tiles[k], kind = tileKind(t);
    cap += kind.housing(t); need += kind.jobs(t);
    if (t.kind !== 'building') continue;
    const [x, y] = xy(k);
    if (BUILDINGS[t.id].glob) glob += BUILDINGS[t.id].glob * kindLevel(t.id);
    tiles[k] = { adj: adjBonus(t.id, x, y), levelMult: levelMult(t), mult: 0, out: {} };
  }
  const rawCap = cap;
  cap = Math.floor(cap * repBonus('housing'));
  const staff = opts.staff !== undefined ? opts.staff : need ? Math.min(1, run.pop / need) : 1;
  const mult = (1 + HALL_BONUS * (hallLevel() - 1)) * crownMult(state.meta.crowns) * (1 + glob * staff) * repBonus('prod');
  const foodMult = repBonus('food');
  const base = { gold: 0, food: HALL_FORAGE * hallLevel(), wood: 0, stone: 0, iron: 0 }; // the hall's own folk forage
  const rates = Object.assign({}, base), trades = [];
  for (const k in tiles) {
    const t = run.tiles[k], def = BUILDINGS[t.id], trade = TRADES[t.id];
    if (trade) { // settled below, once the town's spare food and iron are known
      const [x, y] = xy(k); let tavern = 0;
      for (const [nx, ny] of neighbors(x, y)) { const n = run.tiles[nx + ',' + ny]; if (n && n.kind === 'building' && n.id === 'tavern') tavern += TAVERN_SAVING * Math.sqrt(kindLevel('tavern')); }
      const gold = def.out ? def.out.gold : 0, crew = mult * (def.work ? staff : 1);
      // Food need grows by TRADE_NEED_GROWTH per kind level while the gold triples, so each level is cheaper in food per
      // gold than the last but still wants more Farms; iron need grows with the gold.
      const m = def.out ? tiles[k].levelMult * (1 + tiles[k].adj) * researchMult(t.id) * crew : 0;
      tiles[k].full = gold * m; tiles[k].tavern = tavern ? 1 - 1 / (1 + tavern) : 0;
      tiles[k].need = trade.food * (gold || 1) * Math.pow(TRADE_NEED_GROWTH, kindLevel(t.id) - 1) * crew / (1 + tavern);
      trades.push({ k, id: t.id, m, live: m * (def.work && run.starving ? STARVE_PENALTY : 1), food: tiles[k].need, iron: (trade.iron || 0) * gold * tiles[k].levelMult * crew });
      continue;
    }
    if (!def.out) continue;
    const m = tiles[k].levelMult * (1 + tiles[k].adj) * researchMult(t.id) * mult * (def.work ? staff : 1) * (def.out.food ? foodMult : 1);
    const live = tiles[k].mult = m * (def.work && run.starving && !def.out.food ? STARVE_PENALTY : 1);
    for (const r in def.out) { base[r] += def.out[r] * m; rates[r] += def.out[r] * live; tiles[k].out[r] = def.out[r] * m; }
  }
  const eaten = upkeep(run.pop), foodMade = base.food, ironMade = base.iron;
  // Food: the trades share what is left after upkeep, so they never starve the town or touch the store.
  const surplus = Math.max(0, foodMade - eaten);
  let foodWanted = 0, ironWanted = 0;
  for (const o of trades) { foodWanted += o.food; ironWanted += o.iron; }
  const supply = foodWanted > 0 ? Math.min(1, surplus / foodWanted) : 0, foodUsed = foodWanted * supply;
  const fed = TRADE_FLOOR + (1 - TRADE_FLOOR) * supply;
  // Iron: forges take at most SMITH_SHARE of the iron made, never the stock, so the stock never falls because of them.
  const smithRun = ironWanted > 0 ? Math.min(1, SMITH_SHARE * Math.max(0, ironMade) / ironWanted) : 0;
  let ironUsed = 0, ironUsedLive = 0;
  for (const o of trades) {
    const def = BUILDINGS[o.id]; tiles[o.k].supply = supply;
    if (!def.out) continue; // a Guildhall: it eats, and boosts its neighbours through adjacency
    const share = fed * (o.id === 'smith' ? smithRun : 1);
    base.gold += def.out.gold * o.m * share; rates.gold += def.out.gold * o.live * share;
    tiles[o.k].mult = o.live * share; tiles[o.k].out.gold = def.out.gold * o.m * share;
    if (o.id === 'smith') { tiles[o.k].run = smithRun; ironUsed += o.iron * smithRun; ironUsedLive += o.iron * smithRun * (o.live / o.m || 0); }
  }
  // Starving towns have no spare food, and their mines and forges slow alike, so the live run is the same.
  base.food -= eaten + foodUsed; rates.food -= eaten + foodUsed;
  base.iron -= ironUsed; rates.iron -= ironUsedLive;
  return { cap, rawCap, need, staff, mult, base, rates, eaten, tiles, foodMade, surplus, foodWanted, foodUsed, supply, fed, ironMade, ironWanted, ironUsed, smithRun };
}
// The snapshot the town would have with one more building of a kind on plot `key` (by default a plot with no
// neighbours, so no adjacency), staffed as now. For previews only.
function afterBuild(id, key) {
  key = key || '-9,-9'; const tiles = state.run.tiles, had = hasOwn(tiles, key), keep = tiles[key], staff = calc ? calc.staff : undefined;
  tiles[key] = { kind: 'building', id }; const c = compute({ staff });
  if (had) tiles[key] = keep; else delete tiles[key];
  return c;
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
  const produced = calc.foodMade; // food made per second before upkeep (and before the trades eat any)
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
  // A rested town works harder: time away past REST_AFTER_HOURS counts for more. Only time away earns it, never an
  // open game. Rest is counted since the last purchase, not since the last load, so looking in without buying
  // costs nothing: 6h + 6h is worth the same as 12h in one stretch.
  // The bonus is credited as extra simulated time, which keeps it honest about housing, food and staffing. So
  // run.clock runs ahead of the real time played, and a town that is starving starves for the extra hours too.
  const rest = s => REST_BONUS * Math.max(0, s - REST_AFTER_HOURS * 3600) + REST_LONG_BONUS * Math.max(0, s - REST_LONG_AFTER_HOURS * 3600), run0 = state.run;
  const rested = rest(run0.away + credited) - rest(run0.away);
  run0.away += credited;
  const before = Object.assign({}, state.run.res);
  advance(credited + rested);
  const gains = {};
  for (const r in RESOURCES) if (state.run.res[r] - before[r] >= 1) gains[r] = state.run.res[r] - before[r];
  return { away: sec, credited, rested, capped: sec > credited, capHours, gains };
}

// ───────────────────────── Actions ─────────────────────────
const fail = msg => ({ ok: false, msg });

function build(key, id) {
  const [x, y] = xy(key), def = hasOwn(BUILDINGS, id) ? BUILDINGS[id] : null;
  if (!def || def.hall > hallLevel() || !unlocked(x, y) || state.run.tiles[key] || state.run.terrain[x][y] !== 'plain') return fail();
  if (!pay(buildCost(id))) return fail('Not enough resources for a ' + def.name + '.');
  state.run.tiles[key] = { kind: 'building', id }; state.meta.stats.built++;
  return { ok: true };
}
// The hall is upgraded on its own tile; buildings are upgraded by kind (upgradeKind).
function upgrade(key) {
  const t = state.run.tiles[key];
  if (!t) return fail();
  if (t.kind === 'building') return upgradeKind(t.id);
  if (t.level >= HALL_MAX) return fail(`The ${hallName(t.level)} is the grandest hall there is.`);
  const lock = hallLocked();
  if (lock) return fail(`A${aHall(lock.level).slice(1)} needs ${lock.need} Crowns held. You hold ${fmt(state.meta.crowns)}.`);
  if (!pay(upgradeCost(t))) return fail();
  t.level++;
  return { ok: true, icon: 'crown', msg: `Your seat is now ${aHall(t.level)}!` };
}
// One upgrade raises every building of a kind, standing or yet to be built.
function upgradeKind(id) {
  if (!hasOwn(BUILDINGS, id) || count(id) < 1 || kindLevel(id) >= MAX_LEVEL || !pay(kindUpgradeCost(id))) return fail();
  state.run.levels[id] = kindLevel(id) + 1; state.meta.stats.upgrades++; // kind upgrades, all time (the first one retires a hint)
  return { ok: true, icon: 'up', msg: `Every ${BUILDINGS[id].name} is now level ${state.run.levels[id]}` };
}
// A building's share of what its kind has cost: the last copy's rise in worth at today's level, which is exactly
// what building it again would cost. Demolition returns REFUND_SHARE of it, so building and demolishing always loses money.
const spentOn = t => scaleCost(BUILDINGS[t.id].cost, copyStep(t.id, Math.max(0, count(t.id) - 1)) * levelWorth(t.id, kindLevel(t.id)));
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
  return { ok: true, icon: 'research', msg: 'Researched ' + r.name };
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
  return { ok: true, icon: 'map', msg: 'Your borders grow!' };
}
// Turning forest, hills or water into an open plot: the way forward once the map is full.
const clearCost = () => scaleCost(CLEAR_COST, Math.pow(CLEAR_GROWTH, state.run.cleared) * researchFx('clearCost'));
function clearLand(key) {
  const [x, y] = xy(key);
  if (!unlocked(x, y) || state.run.tiles[key] || state.run.terrain[x][y] === 'plain' || !pay(clearCost())) return fail();
  state.run.terrain[x][y] = 'plain'; state.run.cleared++;
  return { ok: true, icon: 'lumber', msg: 'The land is cleared.' };
}

// Seconds until the next hall is affordable at today's income (0 if it is; Infinity if a material is not being made).
// null when there is no next hall to wait for: the last hall, or one that needs more Crowns held (see nextHallOpen).
function hallWait() {
  if (!nextHallOpen()) return null;
  const cost = upgradeCost(state.run.tiles[HALL_KEY]); let w = 0;
  for (const r in cost) { const need = cost[r] - state.run.res[r]; if (need > 0) w = Math.max(w, calc.base[r] > 0 ? need / calc.base[r] : Infinity); }
  return w;
}

// Decrees: DECREE_CHOICES of them are open at a time (the earliest ones not yet claimed). Any open decree can be
// claimed once its condition holds, none expires, and the player picks which one to pursue (state.meta.decree).
const decreeById = id => DECREES.find(d => d.id === id) || null;
const openDecrees = () => DECREES.filter(d => !state.meta.decreesDone[d.id]).slice(0, DECREE_CHOICES);
function currentDecree() { const open = openDecrees(); return open.find(d => d.id === state.meta.decree) || open[0] || null; }
const decreesFulfilled = () => DECREES.filter(d => state.meta.decreesDone[d.id]).length;
const decreeMet = d => { if (d.done) return !!d.done(); const [a, b] = d.progress(); return a >= b; };
// With an id: is that open decree fulfilled? Without: is any open decree waiting to be claimed?
function decreeDone(id) { return openDecrees().some(d => (id === undefined || d.id === id) && decreeMet(d)); }
function pursueDecree(id) {
  if (!openDecrees().some(d => d.id === id)) return fail();
  state.meta.decree = id; return { ok: true };
}
function claimDecree(id) {
  const d = openDecrees().find(d => (id === undefined || d.id === id) && decreeMet(d));
  if (!d) return fail();
  grant(d.reward); state.meta.decreesDone[d.id] = 1;
  const next = currentDecree(); state.meta.decree = next ? next.id : null;
  return { ok: true, icon: 'decrees', msg: d.title + ' — reward claimed' };
}

// Abdicate: bank the Crowns in meta and start a fresh run.
function prestige() {
  if (!canPrestige()) return fail();
  const n = pendingCrowns(), meta = state.meta;
  meta.bonusCrowns += repLevel('monument'); meta.crowns += n; meta.stats.prestiges++;
  const kept = RESEARCH.filter(r => r.keep && hasResearch(r.id)); // knowledge that outlasts a reign
  state.run = newRun(undefined, meta.crowns); for (const r of kept) state.run.research[r.id] = 1;
  calc = compute();
  return { ok: true, crowns: n, icon: 'crown', msg: `A new dynasty begins with ${fmt(meta.crowns)} Crowns and a head start.` };
}

// Hand collection: a little gold per tap, there for the first minutes of a reign. It does not grow with income,
// so keeping the game open and tapping earns nothing that matters later.
const clickValue = () => CLICK_GOLD;
// The button is shown only before the Manor, and only until CLICK_LIMIT gold has come in by hand this reign. The interface and the balance bot both ask this, so they agree.
const canCollect = () => hallLevel() < 2 && state.run.collected < CLICK_LIMIT;
function collectTaxes() {
  if (!canCollect()) return { ok: false, gold: 0 };
  const g = Math.min(clickValue(), CLICK_LIMIT - state.run.collected);
  state.run.collected += g; state.run.res.gold += g; earnGold(g); state.meta.stats.clicks++;
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
  return { v: 2, last: o.last, // then on through the version-2 migration below
    meta: { crowns, bonusCrowns: 0, // Crowns already held stay
      decree: quest < LEGACY_DECREE_ORDER.length ? LEGACY_DECREE_ORDER[quest] : null, stats },
    run: { seed: o.seed, res: o.res, pop: o.pop, exp: o.exp, tiles, research: o.research, starving: o.starving, gold: o.runGold } };
}

const TRADE_KINDS = Object.keys(TRADES);
const EAT_NOTE = 'The trades now eat. Markets, Blacksmiths and Guildhalls share the food your town does not eat, and slow down when there is too little, so Farms and Mills matter again. Taverns no longer make gold or boost Cottages: trades beside a Tavern need less food, so it may pay to move one. Your food store is untouched.';
// Returns { state, notes }. Throws if the data is not a save at all (or is from a newer version).
function sanitizeSave(raw, now) {
  if (!isObj(raw)) throw new Error('not a save');
  let o = raw; const notes = [], legacy = o.v === undefined && isObj(o.tiles) && isObj(o.res);
  if (legacy) o = upgradeLegacySave(o);
  const v = int(o.v, 0, 0, 1e9);
  if (!v || !isObj(o.meta) || !isObj(o.run)) throw new Error('not a save');
  if (v > SAVE_VERSION) throw new Error('save is from a newer version');
  // Version 2 had one decree at a time, claimed in order: everything before the current one counts as claimed.
  if (v < 3) { const at = o.meta.decree === null ? DECREES.length : DECREES.findIndex(d => d.id === o.meta.decree), done = {};
    if (o.meta.decree !== undefined) for (const d of DECREES.slice(0, at < 0 ? DECREES.length : at)) if (!DECREES_NEW_IN_V3.includes(d.id)) done[d.id] = 1; // newer ones are still to be had
    if (at < 0 && o.meta.decree !== undefined) notes.push('A decree in this save no longer exists; the decree chain was marked complete.');
    o = Object.assign({}, o, { meta: Object.assign({}, o.meta, { decreesDone: done }) }); }

  if (legacy) notes.push('This kingdom predates the rebalance: cottages, farms and mills now gain a flat amount per level and big towns eat more, so it needs more housing and food than before.');
  const s = newState(now), meta = s.meta, run = s.run, m = o.meta, r = o.run;
  s.last = num(o.last, now, 0, now);

  meta.crowns = int(m.crowns, 0, 0, 1e9);
  meta.bonusCrowns = int(m.bonusCrowns, 0, 0, meta.crowns);
  if (isObj(m.decreesDone)) for (const d of DECREES) if (hasOwn(m.decreesDone, d.id) && m.decreesDone[d.id]) meta.decreesDone[d.id] = 1;
  { const open = DECREES.filter(d => !meta.decreesDone[d.id]).slice(0, DECREE_CHOICES); // pursue the saved one if it is still open
    meta.decree = open.some(d => d.id === m.decree) ? m.decree : open.length ? open[0].id : null; }
  const st = isObj(m.stats) ? m.stats : {};
  for (const k of ['clicks', 'prestiges', 'built', 'upgrades']) meta.stats[k] = int(st[k], 0, 0, 1e15);
  meta.stats.totalGold = num(st.totalGold, 0, 0, BIG);
  meta.stats.started = num(st.started, now, 0, now);

  run.seed = int(r.seed, run.seed, -(2 ** 31), 2 ** 31);
  const grid = r.terrain;
  const gridOk = Array.isArray(grid) && grid.length === MAP_SIZE && grid.every(col => Array.isArray(col) && col.length === MAP_SIZE && col.every(c => typeof c === 'string' && hasOwn(TERRAIN, c)));
  run.gen = int(r.gen, 1, 1, TERRAIN_GEN); // saves from before the marker had their map from the old generator
  run.terrain = gridOk ? grid.map(col => col.slice()) : run.gen === 2 ? genTerrain(run.seed) : genTerrainLegacy(run.seed); // a missing grid (version 1) is regrown from the seed by the generator that made it
  run.terrain[MAP_MID][MAP_MID] = 'plain';
  run.exp = int(r.exp, 0, 0, EXPAND_COST.length);
  run.cleared = int(r.cleared, 0, 0, MAP_SIZE * MAP_SIZE);
  const res = isObj(r.res) ? r.res : {};
  for (const k in RESOURCES) run.res[k] = num(res[k], run.res[k], 0, BIG);
  run.gold = num(r.gold, 0, 0, BIG);
  run.clock = num(r.clock, 0, 0, BIG);
  run.away = num(r.away, 0, 0, 1e9);
  run.collected = num(r.collected, 0, 0, CLICK_LIMIT);
  run.starving = r.starving === true;

  let dropped = 0, mixed = false; const seen = {}; // levels met per kind, for a version-3 save
  const radius = MAP_RADIUS[run.exp], tiles = isObj(r.tiles) ? r.tiles : {}, levels = isObj(r.levels) ? r.levels : {};
  for (const id of BUILD_ORDER) if (v >= 4) run.levels[id] = int(hasOwn(levels, id) ? levels[id] : 1, 1, 1, MAX_LEVEL);
  for (const k in tiles) {
    const t = tiles[k], mt = /^(\d{1,2}),(\d{1,2})$/.exec(k);
    if (!mt || !isObj(t)) { dropped++; continue; }
    const x = +mt[1], y = +mt[2], level = int(t.level, 1, 1, MAX_LEVEL);
    if (k === HALL_KEY) { run.tiles[k].level = Math.min(level, HALL_MAX); continue; } // the centre is always the hall. A hall the Crowns held would not open is kept: loading never takes one away
    if (Math.abs(x - MAP_MID) > radius || Math.abs(y - MAP_MID) > radius || typeof t.id !== 'string' || !hasOwn(BUILDINGS, t.id)) { dropped++; continue; }
    run.tiles[x + ',' + y] = { kind: 'building', id: t.id };
    if (v < 4) { if (hasOwn(seen, t.id) && seen[t.id] !== level) mixed = true; seen[t.id] = hasOwn(seen, t.id) ? Math.min(seen[t.id], level) : level; } // version 3 kept a level per building
    run.terrain[x][y] = 'plain';
  }
  // The kind takes the lowest level among its buildings, so migrating never upgrades anything for free.
  if (v < 4) for (const id in seen) run.levels[id] = seen[id];
  if (v < 4 && mixed) notes.push('Upgrades now apply to every building of a kind. Where your buildings of one kind had different levels, all of them are now at the level of the lowest.');
  // Version 5 gave the trades their jobs: a town that already has one is told once why its gold income changed.
  // Version 5 gave the trades their jobs and version 6 made them eat spare food, with the Tavern feeding them: a town
  // that already has one is told once why its income changed (one note, the latest rules, covers both).
  if (v < 6 && Object.keys(run.tiles).some(k => TRADE_KINDS.includes(run.tiles[k].id) || run.tiles[k].id === 'tavern')) notes.push(EAT_NOTE);
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
