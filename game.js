'use strict';
/* Hearthold — a medieval idle city builder. No dependencies; state lives in localStorage. */

// ───────────────────────── Data ─────────────────────────
const RES = {
  gold: { n: 'Gold', i: '💰' }, food: { n: 'Food', i: '🍞' }, wood: { n: 'Wood', i: '🪵' },
  stone: { n: 'Stone', i: '🪨' }, iron: { n: 'Iron', i: '🔩' },
};
const TERRAIN = {
  plain: { n: 'Open plot', i: '' }, forest: { n: 'Forest', i: '🌲' },
  hill: { n: 'Hills', i: '⛰️' }, water: { n: 'Water', i: '🌊' },
};
const HALL = [
  { n: 'Village Hall', i: '🛖' }, { n: 'Manor', i: '🏡' }, { n: 'Keep', i: '🗼' },
  { n: 'Castle', i: '🏰' }, { n: 'Palace', i: '👑' },
];
const HALL_COST = [
  { gold: 500, wood: 300, stone: 100 }, { gold: 6000, wood: 3000, stone: 2000 },
  { gold: 8e4, stone: 3e4, iron: 3000 }, { gold: 2e6, stone: 5e5, iron: 8e4 },
];
const EXPAND_COST = [{ gold: 2000, wood: 1000 }, { gold: 6e4, stone: 2e4 }, { gold: 2e6, iron: 5e4 }];
const HALF = [2, 3, 4, 5]; // unlocked radius around the centre per expansion
const N = 11, MID = 5;
const FOOD_PER_POP = 0.08;

// out: per second at level 1. work: villagers needed per level. adj: bonus per adjacent thing.
const B = {
  hall: { n: 'Village Hall', i: '🛖' },
  cottage: { n: 'Cottage', i: '🏠', hall: 1, cost: { wood: 10 }, house: 5, out: { gold: 0.4 }, adj: { tavern: 0.5 },
    d: 'Houses villagers, who pay a modest tax.' },
  lumber: { n: 'Lumber Camp', i: '🪓', hall: 1, cost: { gold: 20 }, work: 2, out: { wood: 0.8 }, adj: { forest: 0.5 },
    d: 'Fells timber. Wants forest nearby.' },
  farm: { n: 'Farm', i: '🌾', hall: 1, cost: { gold: 10, wood: 15 }, work: 2, out: { food: 1.5 }, adj: { water: 0.5, mill: 0.5 },
    d: 'Feeds the village. Thrives beside water and mills.' },
  quarry: { n: 'Quarry', i: '⛏️', hall: 1, cost: { gold: 60, wood: 40 }, work: 3, out: { stone: 0.5 }, adj: { hill: 0.5 },
    d: 'Cuts stone. Wants hills nearby.' },
  market: { n: 'Market', i: '🏪', hall: 2, cost: { gold: 150, wood: 100, stone: 30 }, work: 3, out: { gold: 4 }, adj: { cottage: 0.2, guild: 0.5 },
    d: 'Trade brings gold. Busier when surrounded by cottages.' },
  mill: { n: 'Mill', i: '🎡', hall: 2, cost: { wood: 120, stone: 60 }, work: 2, out: { food: 2 },
    d: 'Grinds grain and boosts every farm beside it.' },
  tavern: { n: 'Tavern', i: '🍺', hall: 2, cost: { gold: 300, wood: 150 }, work: 2, out: { gold: 2 },
    d: 'Merry villagers pay more tax. Boosts cottages beside it.' },
  mine: { n: 'Mine', i: '🕳️', hall: 3, cost: { gold: 800, wood: 400, stone: 200 }, work: 4, out: { iron: 0.4 }, adj: { hill: 0.5 },
    d: 'Digs iron ore. Wants hills nearby.' },
  smith: { n: 'Blacksmith', i: '⚒️', hall: 3, cost: { gold: 1500, stone: 500, iron: 50 }, work: 4, out: { gold: 25 }, adj: { mine: 0.3, guild: 0.5 },
    d: 'Forges goods worth a fortune. Likes a mine next door.' },
  church: { n: 'Church', i: '⛪', hall: 3, cost: { gold: 5000, stone: 2000, iron: 200 }, work: 2, glob: 0.05, scale: 1.6,
    d: 'Inspires the whole realm: +5% to all production per level.' },
  guild: { n: 'Guildhall', i: '🏦', hall: 4, cost: { gold: 25000, stone: 8000, iron: 1500 }, work: 5, out: { gold: 60 }, scale: 1.3,
    d: 'Organises the trades. Boosts markets and blacksmiths beside it.' },
};
const BUILD_ORDER = ['cottage', 'lumber', 'farm', 'quarry', 'market', 'mill', 'tavern', 'mine', 'smith', 'church', 'guild'];

// m: production multiplier per building id. Special keys: click, caravan, offline.
const R = [
  { id: 'axes', n: 'Iron-shod Axes', d: 'Lumber Camps ×2', hall: 1, cost: { gold: 150 }, m: { lumber: 2 } },
  { id: 'rotation', n: 'Crop Rotation', d: 'Farms ×2', hall: 1, cost: { gold: 200, wood: 100 }, m: { farm: 2 } },
  { id: 'tithes', n: 'Tithes', d: 'Cottage taxes ×2', hall: 1, cost: { gold: 400 }, m: { cottage: 2 } },
  { id: 'chisels', n: 'Stone Chisels', d: 'Quarries ×2', hall: 1, cost: { gold: 600, wood: 300 }, m: { quarry: 2 } },
  { id: 'seal', n: 'Royal Seal', d: 'Collecting taxes by hand ×5', hall: 2, cost: { gold: 1200 }, click: 5 },
  { id: 'plough', n: 'Heavy Plough', d: 'Farms and Mills ×2', hall: 2, cost: { gold: 2500, stone: 500 }, m: { farm: 2, mill: 2 } },
  { id: 'charter', n: 'Market Charter', d: 'Markets ×2', hall: 2, cost: { gold: 3000, wood: 1500 }, m: { market: 2 } },
  { id: 'saws', n: 'Two-man Saws', d: 'Lumber Camps ×2', hall: 2, cost: { gold: 4000, stone: 1000 }, m: { lumber: 2 } },
  { id: 'caravan', n: 'Caravan Routes', d: 'Merchants visit twice as often', hall: 2, cost: { gold: 5000, wood: 2000 }, caravan: 1 },
  { id: 'ale', n: 'Strong Ale', d: 'Taverns and cottage taxes ×2', hall: 2, cost: { gold: 8000, wood: 4000 }, m: { tavern: 2, cottage: 2 } },
  { id: 'steward', n: 'Stewardship', d: 'Offline progress lasts 24h instead of 8h', hall: 3, cost: { gold: 15000 }, offline: 1 },
  { id: 'masonry', n: 'Masonry', d: 'Quarries ×2', hall: 3, cost: { gold: 20000, wood: 10000 }, m: { quarry: 2 } },
  { id: 'shafts', n: 'Deep Shafts', d: 'Mines ×2', hall: 3, cost: { gold: 30000, stone: 10000 }, m: { mine: 2 } },
  { id: 'bellows', n: 'Great Bellows', d: 'Blacksmiths ×2', hall: 3, cost: { gold: 50000, iron: 1000 }, m: { smith: 2 } },
  { id: 'fields', n: 'Three-field System', d: 'Farms ×3', hall: 4, cost: { gold: 3e5, stone: 5e4 }, m: { farm: 3 } },
  { id: 'banking', n: 'Banking', d: 'Markets and Guildhalls ×2', hall: 4, cost: { gold: 5e5, iron: 1e4 }, m: { market: 2, guild: 2 } },
  { id: 'marks', n: "Maker's Marks", d: 'Blacksmiths ×2', hall: 4, cost: { gold: 1e6, iron: 3e4 }, m: { smith: 2 } },
  { id: 'steel', n: 'Crucible Steel', d: 'Mines and Blacksmiths ×2', hall: 5, cost: { gold: 5e7, iron: 5e5 }, m: { mine: 2, smith: 2 } },
  { id: 'mint', n: 'Royal Mint', d: 'All gold buildings ×2', hall: 5, cost: { gold: 2e8, stone: 1e7 }, m: { cottage: 2, market: 2, tavern: 2, smith: 2, guild: 2 } },
];

const Q = [
  { t: 'A Roof Overhead', d: 'Build a Cottage: pick it in the Build tab, then click an empty green plot.', c: () => count('cottage') >= 1, r: { wood: 20 } },
  { t: 'Timber!', d: 'Build a Lumber Camp. Beside a forest it works 50% faster.', c: () => count('lumber') >= 1, r: { gold: 40 } },
  { t: 'Daily Bread', d: 'Build a Farm so nobody goes hungry.', c: () => count('farm') >= 1, r: { food: 50, wood: 20 } },
  { t: 'A Growing Hamlet', d: 'Reach a population of 12.', p: () => [S.pop, 12], r: { gold: 80 } },
  { t: 'Lay of the Land', d: 'Give any building an adjacency bonus of 50% or more.', c: () => Object.values(C.t).some(t => t.adj >= 0.5), r: { wood: 60 } },
  { t: 'Bedrock', d: 'Build a Quarry.', c: () => count('quarry') >= 1, r: { gold: 100 } },
  { t: 'Learned Folk', d: 'Buy something in the Research tab.', c: () => Object.keys(S.research).length >= 1, r: { gold: 150 } },
  { t: 'Lord of the Manor', d: 'Click your Village Hall and upgrade it into a Manor.', c: () => hallL() >= 2, r: { gold: 300, wood: 200 } },
  { t: 'Market Day', d: 'Build a Market.', c: () => count('market') >= 1, r: { gold: 400 } },
  { t: 'Grist for the Mill', d: 'Build a Mill right next to a Farm.', c: () => hasPair('mill', 'farm'), r: { food: 500 } },
  { t: 'Master Builders', d: 'Upgrade any building to level 3.', c: () => Object.values(S.tiles).some(t => t.b !== 'hall' && t.l >= 3), r: { stone: 300 } },
  { t: 'New Horizons', d: 'Expand your borders (bottom of the Build tab).', c: () => S.exp >= 1, r: { gold: 1500 } },
  { t: 'A Proper Town', d: 'Reach a population of 150.', p: () => [S.pop, 150], r: { gold: 3000 } },
  { t: 'Stronghold', d: 'Raise a Keep.', c: () => hallL() >= 3, r: { stone: 1500 } },
  { t: 'Into the Deep', d: 'Build a Mine.', c: () => count('mine') >= 1, r: { gold: 4000 } },
  { t: 'Hammer and Anvil', d: 'Build a Blacksmith.', c: () => count('smith') >= 1, r: { iron: 150 } },
  { t: 'Bells at Dawn', d: 'Build a Church.', c: () => count('church') >= 1, r: { gold: 15000 } },
  { t: 'Royal Treasury', d: 'Earn 1,000 gold per second.', p: () => [C.rates.gold, 1000], r: { gold: 60000 } },
  { t: 'Seat of Power', d: 'Raise a Castle.', c: () => hallL() >= 4, r: { iron: 3000 } },
  { t: 'A New Dynasty', d: 'Found a new kingdom from the Realm tab.', c: () => S.stats.prestiges >= 1, r: { gold: 5000, wood: 2000 } },
  { t: 'Brotherhood of Trades', d: 'Build a Guildhall.', c: () => count('guild') >= 1, r: { gold: 2e5 } },
  { t: 'Crown Jewel', d: 'Raise a Palace.', c: () => hallL() >= 5, r: { gold: 5e6 } },
  { t: 'Golden Age', d: 'Earn 1M gold per second.', p: () => [C.rates.gold, 1e6], r: { gold: 1e9 } },
  { t: 'Legend', d: 'Hold 25 Crowns.', p: () => [S.crowns, 25], r: { gold: 1e11 } },
];

// ───────────────────────── State ─────────────────────────
const SAVE_KEY = 'hearthold-save-v1';
let S, C, terrain;
let sel = {};            // { build: id } or { tile: 'x,y' }
let tab = 'build';
let pressing = false;
let merch = { next: 70, left: 0 };
let warnedStarve = false;

function freshState(keep) {
  const s = {
    seed: (Math.random() * 2 ** 31) | 0,
    res: { gold: 50, food: 30, wood: 30, stone: 0, iron: 0 },
    pop: 3, exp: 0, tiles: {}, research: {}, starving: false, buffUntil: 0,
    quest: 0, crowns: 0, runGold: 0, last: Date.now(),
    stats: { clicks: 0, totalGold: 0, merchants: 0, prestiges: 0, built: 0, started: Date.now() },
  };
  s.tiles[MID + ',' + MID] = { b: 'hall', l: 1 };
  if (keep) { s.crowns = keep.crowns; s.quest = keep.quest; s.stats = keep.stats; }
  return s;
}

function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function genTerrain(seed) {
  const rnd = mulberry(seed), g = [];
  for (let x = 0; x < N; x++) { g.push([]); for (let y = 0; y < N; y++) {
    const r = rnd(); g[x].push(r < 0.14 ? 'forest' : r < 0.23 ? 'hill' : r < 0.29 ? 'water' : 'plain'); } }
  g[MID][MID] = 'plain';
  // The starting 5×5 always has something of everything to play with.
  const want = { forest: 3, hill: 2, water: 2 };
  for (const k in want) {
    let have = 0, guard = 0;
    for (let x = 3; x <= 7; x++) for (let y = 3; y <= 7; y++) if (g[x][y] === k) have++;
    while (have < want[k] && guard++ < 200) {
      const x = 3 + ((rnd() * 5) | 0), y = 3 + ((rnd() * 5) | 0);
      if (g[x][y] === 'plain' && !(x === MID && y === MID)) { g[x][y] = k; have++; }
    }
  }
  return g;
}

// ───────────────────────── Helpers ─────────────────────────
const SUF = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
function fmt(n) {
  if (!isFinite(n)) return '∞';
  const neg = n < 0; n = Math.abs(n); let s;
  if (n < 1000) s = String(Math.floor(n));
  else { const e = Math.floor(Math.log10(n) / 3);
    if (e >= SUF.length) s = n.toExponential(2);
    else { const v = n / 10 ** (e * 3); s = (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : v.toFixed(0)) + SUF[e]; } }
  return (neg ? '-' : '') + s;
}
const fmtRate = n => (n >= 0 ? '+' : '-') + (Math.abs(n) < 100 ? Math.abs(n).toFixed(1) : fmt(Math.abs(n))) + '/s';
const pct = x => '+' + Math.round(x * 100) + '%';
const hallL = () => S.tiles[MID + ',' + MID].l;
const hallInfo = l => HALL[Math.min(l, HALL.length) - 1];
const hallName = l => hallInfo(l).n + (l > HALL.length ? ' +' + (l - HALL.length) : '');
const count = id => { let c = 0; for (const k in S.tiles) if (S.tiles[k].b === id) c++; return c; };
const unlocked = (x, y) => Math.abs(x - MID) <= HALF[S.exp] && Math.abs(y - MID) <= HALF[S.exp];
const xy = key => key.split(',').map(Number);
function neighbors(x, y) { return [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].filter(([a, b]) => unlocked(a, b)); }
function adjBonus(id, x, y) {
  const a = B[id].adj; if (!a) return 0;
  let s = 0;
  for (const [nx, ny] of neighbors(x, y)) {
    const t = S.tiles[nx + ',' + ny];
    if (t) { if (a[t.b]) s += a[t.b] * t.l; } else if (a[terrain[nx][ny]]) s += a[terrain[nx][ny]];
  }
  return s;
}
function givesTo(id, x, y) { // how many neighbours would be boosted by placing `id` here
  let c = 0;
  for (const [nx, ny] of neighbors(x, y)) { const t = S.tiles[nx + ',' + ny]; if (t && B[t.b].adj && B[t.b].adj[id]) c++; }
  return c;
}
function hasPair(a, b) {
  for (const k in S.tiles) if (S.tiles[k].b === a) { const [x, y] = xy(k);
    if (neighbors(x, y).some(([nx, ny]) => (S.tiles[nx + ',' + ny] || {}).b === b)) return true; }
  return false;
}
function resMult(id) { let m = 1; for (const r of R) if (S.research[r.id] && r.m && r.m[id]) m *= r.m[id]; return m; }
const has = id => !!S.research[id];
const buffOn = () => S.buffUntil > Date.now();

function scaleCost(cost, k) { const o = {}; for (const r in cost) o[r] = Math.ceil(cost[r] * k); return o; }
const buildCost = id => scaleCost(B[id].cost, Math.pow(B[id].scale || 1.18, count(id)));
function upCost(t) {
  if (t.b === 'hall') return t.l <= HALL_COST.length ? HALL_COST[t.l - 1] : scaleCost(HALL_COST[HALL_COST.length - 1], Math.pow(25, t.l - HALL_COST.length));
  return scaleCost(B[t.b].cost, 1.5 * Math.pow(3, t.l));
}
const canAfford = c => Object.keys(c).every(r => S.res[r] >= c[r]);
function pay(c) { if (!canAfford(c)) return false; for (const r in c) S.res[r] -= c[r]; return true; }
function grant(c) { for (const r in c) S.res[r] += c[r]; }
const costHTML = c => '<span class="cost">' + Object.keys(c).map(r =>
  `<span class="${S.res[r] < c[r] ? 'lack' : ''}">${RES[r].i} ${fmt(c[r])}</span>`).join('') + '</span>';
const pendingCrowns = () => Math.floor(Math.sqrt(S.runGold / 2e4));

// ───────────────────────── Simulation ─────────────────────────
function compute() {
  let cap = 0, need = 0, glob = 0;
  const t = {};
  for (const k in S.tiles) {
    const tl = S.tiles[k], d = B[tl.b];
    if (tl.b === 'hall') { cap += 5 * tl.l; continue; }
    const [x, y] = xy(k), lm = Math.pow(2, tl.l - 1);
    if (d.house) cap += d.house * lm;
    if (d.work) need += d.work * tl.l;
    if (d.glob) glob += d.glob * tl.l;
    t[k] = { adj: adjBonus(tl.b, x, y), lm };
  }
  const staff = need ? Math.min(1, S.pop / need) : 1;
  const g = (1 + 0.25 * (hallL() - 1)) * (1 + 0.1 * S.crowns) * (1 + glob) * (buffOn() ? 3 : 1);
  const rates = { gold: 0, food: 0.5 * hallL(), wood: 0, stone: 0, iron: 0 }; // the hall's own folk forage
  for (const k in t) {
    const tl = S.tiles[k], d = B[tl.b]; if (!d.out) continue;
    const eff = d.work ? staff * (S.starving && !d.out.food ? 0.5 : 1) : 1;
    const m = t[k].m = t[k].lm * (1 + t[k].adj) * resMult(tl.b) * g * eff;
    for (const r in d.out) rates[r] += d.out[r] * m;
  }
  const eaten = S.pop * FOOD_PER_POP;
  rates.food -= eaten;
  return { cap, need, staff, g, rates, eaten, t };
}
function tick(dt) {
  C = compute();
  for (const r in C.rates) S.res[r] += C.rates[r] * dt;
  const g = C.rates.gold * dt; S.runGold += g; S.stats.totalGold += g;
  if (S.res.food <= 0) { S.res.food = 0; S.starving = C.rates.food < 0; } else S.starving = false;
  if (S.pop < C.cap && !S.starving) S.pop = Math.min(C.cap, S.pop + Math.max(0.2, C.cap * 0.02) * dt);
  if (S.pop > C.cap) S.pop = C.cap;
}
function advance(sec) {
  const n = sec <= 0.25 ? 1 : Math.min(1000, Math.ceil(sec / 0.25));
  for (let i = 0; i < n; i++) tick(sec / n);
}
const clickVal = () => (hallL() ** 2 + 0.05 * Math.max(0, C.rates.gold)) * (has('seal') ? 5 : 1) * (1 + 0.1 * S.crowns);

// ───────────────────────── Actions ─────────────────────────
function build(key) {
  const id = sel.build, [x, y] = xy(key);
  if (!id || S.tiles[key] || terrain[x][y] !== 'plain') return;
  if (!pay(buildCost(id))) return toast('Not enough resources for a ' + B[id].n + '.');
  S.tiles[key] = { b: id, l: 1 }; S.stats.built++;
  popKey = key;
}
function upgrade(key) {
  const t = S.tiles[key]; if (!t || !pay(upCost(t))) return;
  t.l++; popKey = key;
  if (t.b === 'hall') toast(`🎉 Your seat is now a ${hallName(t.l)}!`);
}
function demolish(key) {
  const t = S.tiles[key]; if (!t || t.b === 'hall') return;
  delete S.tiles[key];
  grant(scaleCost(B[t.b].cost, 0.5 * Math.pow(B[t.b].scale || 1.18, count(t.b))));
}
function research(id) {
  const r = R.find(r => r.id === id);
  if (r && !S.research[id] && pay(r.cost)) { S.research[id] = 1; toast('📜 Researched ' + r.n); }
}
function expand() { if (S.exp < EXPAND_COST.length && pay(EXPAND_COST[S.exp])) { S.exp++; toast('🗺️ Your borders grow!'); } }
function questDone() { const q = Q[S.quest]; return q && (q.c ? q.c() : q.p()[0] >= q.p()[1]); }
function claim() {
  if (!questDone()) return;
  const q = Q[S.quest]; grant(q.r); S.quest++;
  toast('✅ ' + q.t + ' — reward claimed');
}
function prestige() {
  const n = pendingCrowns();
  if (hallL() < 4 || n < 1) return;
  confirmBox('Found a new kingdom?', `You abdicate and start over on fresh land. Buildings, resources and research are lost, but you keep
    <b>${n} 👑 Crown${n > 1 ? 's' : ''}</b>, each worth +10% to all production forever.`, () => {
    S.stats.prestiges++;
    S = freshState({ crowns: S.crowns + n, quest: S.quest, stats: S.stats });
    terrain = genTerrain(S.seed); sel = {}; C = compute(); save(); redraw();
    toast(`👑 A new dynasty begins with ${S.crowns} Crowns.`);
  });
}
function clickMerchant() {
  $('merchant').hidden = true; merch.left = 0; S.stats.merchants++;
  const r = Math.random();
  if (r < 0.5) { const g = Math.max(30, C.rates.gold * 120); S.res.gold += g; S.runGold += g; S.stats.totalGold += g;
    toast(`🐪 The merchant pays ${fmt(g)} gold for your wares!`); }
  else if (r < 0.75) { S.buffUntil = Date.now() + 60000; toast('🎪 A festival! All production ×3 for 60 seconds.'); }
  else { for (const k of ['food', 'wood', 'stone', 'iron']) if (k !== 'iron' || hallL() >= 3)
      S.res[k] += Math.max(k === 'iron' ? 5 : 25, (C.rates[k] + (k === 'food' ? C.eaten : 0)) * 120);
    toast('🐪 The merchant unloads a wagon of supplies!'); }
}

// ───────────────────────── Rendering ─────────────────────────
const $ = id => document.getElementById(id);
let popKey = null;

function renderRes() {
  let h = '';
  for (const r in RES) {
    if (r === 'iron' && hallL() < 3 && !S.res.iron) continue;
    if (r === 'stone' && !S.res.stone && !count('quarry')) continue;
    const bad = r === 'food' && S.starving;
    h += `<div class="chip${bad ? ' bad' : ''}" title="${RES[r].n}">${RES[r].i} <b>${fmt(S.res[r])}</b><small class="${C.rates[r] < 0 ? 'neg' : ''}">${fmtRate(C.rates[r])}</small></div>`;
  }
  h += `<div class="chip${C.staff < 1 ? ' bad' : ''}" title="Population / housing — jobs to fill">👥 <b>${Math.floor(S.pop)}/${fmt(C.cap)}</b><small class="${C.staff < 1 ? 'neg' : ''}">${fmt(C.need)} jobs</small></div>`;
  if (S.crowns) h += `<div class="chip crown" title="Crowns: +10% production each">👑 <b>${S.crowns}</b></div>`;
  if (buffOn()) h += `<div class="chip buff">🎪 ×3 ${Math.ceil((S.buffUntil - Date.now()) / 1000)}s</div>`;
  $('res').innerHTML = h;
  $('clickval').textContent = '+' + fmt(Math.max(1, clickVal()));
  $('subtitle').textContent = hallName(hallL()) + ' of ' + Math.floor(S.pop) + ' souls';
}

function renderMap() {
  const half = HALF[S.exp], n = half * 2 + 1, m = $('map');
  m.style.setProperty('--n', n);
  let h = '';
  for (let y = MID - half; y <= MID + half; y++) for (let x = MID - half; x <= MID + half; x++) {
    const k = x + ',' + y, t = S.tiles[k], tr = terrain[x][y];
    let cls = 'tile ' + tr, inner = TERRAIN[tr].i;
    if (t) {
      cls += ' built' + (t.b === 'hall' ? ' hall' : '');
      inner = (t.b === 'hall' ? hallInfo(t.l).i : B[t.b].i) + (t.l > 1 ? `<span class="lv">${t.l}</span>` : '');
      if (C.t[k] && C.t[k].adj > 0) inner += `<span class="bn">${pct(C.t[k].adj)}</span>`;
    } else if (tr === 'plain' && sel.build) {
      cls += ' can';
      const a = adjBonus(sel.build, x, y), gv = givesTo(sel.build, x, y);
      if (a > 0) inner = `<span class="pv">${pct(a)}</span>`; else if (gv) inner = `<span class="pv">▲${gv}</span>`;
    }
    if (sel.tile === k) cls += ' sel';
    if (popKey === k) cls += ' pop';
    h += `<button class="${cls}" data-act="tile" data-id="${k}">${inner}</button>`;
  }
  m.innerHTML = h; popKey = null;
}

function defStats(id) {
  const d = B[id]; let h = '';
  if (d.house) h += `<p class="stat">🏠 Houses <b>${d.house}</b> villagers</p>`;
  if (d.out) h += `<p class="stat">Produces ` + Object.keys(d.out).map(r => `<b>${d.out[r]} ${RES[r].i}/s</b>`).join(' ') + (d.work ? ` · needs ${d.work} 👥` : '') + '</p>';
  if (d.glob) h += `<p class="stat">All production <b>${pct(d.glob)}</b> · needs ${d.work} 👥</p>`;
  for (const a in d.adj || {}) h += `<p class="stat"><b>${pct(d.adj[a])}</b> per adjacent ${TERRAIN[a] ? TERRAIN[a].n + ' ' + TERRAIN[a].i : B[a].n + ' ' + B[a].i + ' (per level)'}</p>`;
  for (const o of BUILD_ORDER) if (B[o].adj && B[o].adj[id]) h += `<p class="stat">Boosts adjacent ${B[o].n}s ${B[o].i} by <b>${pct(B[o].adj[id])}</b> per level</p>`;
  return h;
}
function renderInspector() {
  let h;
  if (sel.build) {
    const d = B[sel.build];
    h = `<h3>${d.i} ${d.n}</h3><p>${d.d}</p>${defStats(sel.build)}<p class="muted">Click an open plot to build. Badges on the map show the bonus each plot would give. Esc cancels.</p>`;
  } else if (sel.tile && S.tiles[sel.tile]) {
    const k = sel.tile, t = S.tiles[k], c = upCost(t), ok = canAfford(c);
    if (t.b === 'hall') {
      const next = BUILD_ORDER.filter(b => B[b].hall === t.l + 1).map(b => B[b].i + ' ' + B[b].n);
      h = `<h3>${hallInfo(t.l).i} ${hallName(t.l)}</h3><p>The heart of your realm. Its household forages a little food, and each level adds +25% to all production and makes tax collection richer.</p>
        <p class="stat">Realm bonus: <b>×${C.g.toFixed(2)}</b></p>
        ${next.length ? `<p class="stat">Next level unlocks: <b>${next.join(', ')}</b></p>` : ''}
        ${t.l === 3 ? '<p class="stat">A Castle lets you found a new kingdom for 👑 Crowns.</p>' : ''}
        <div class="row"><button class="btn${ok ? '' : ' cant'}" data-act="up" data-id="${k}">Raise a ${hallName(t.l + 1)} ${costHTML(c)}</button></div>`;
    } else {
      const d = B[t.b], info = C.t[k] || { adj: 0, m: 0, lm: 1 };
      h = `<h3>${d.i} ${d.n} <span class="muted">level ${t.l}</span></h3>`;
      if (d.house) h += `<p class="stat">🏠 Houses <b>${fmt(d.house * info.lm)}</b></p>`;
      if (d.out) h += '<p class="stat">Making ' + Object.keys(d.out).map(r => `<b>${fmtRate(d.out[r] * info.m)} ${RES[r].i}</b>`).join(' ') + '</p>';
      if (d.glob) h += `<p class="stat">All production <b>${pct(d.glob * t.l)}</b></p>`;
      if (d.adj) h += `<p class="stat">Adjacency bonus: <b>${pct(info.adj)}</b></p>`;
      if (d.work) h += `<p class="stat">Workers: ${d.work * t.l} 👥${C.staff < 1 ? ` <span style="color:var(--bad)">(${Math.round(C.staff * 100)}% staffed — build cottages)</span>` : ''}</p>`;
      h += `<div class="row"><button class="btn${ok ? '' : ' cant'}" data-act="up" data-id="${k}">Upgrade ×2 ${costHTML(c)}</button>
        <button class="btn alt" data-act="demolish" data-id="${k}">Demolish</button></div>`;
    }
  } else if (sel.tile) {
    const [x, y] = xy(sel.tile), tr = terrain[x][y];
    const fans = BUILD_ORDER.filter(b => B[b].adj && B[b].adj[tr]).map(b => B[b].i + ' ' + B[b].n + 's');
    h = tr === 'plain' ? '<h3>Open plot</h3><p>Good, level ground. Pick something from the Build tab to raise here.</p>'
      : `<h3>${TERRAIN[tr].i} ${TERRAIN[tr].n}</h3><p>Nothing can be built here, but ${fans.join(' and ')} beside it work 50% harder.</p>`;
  } else {
    h = '<h3>Welcome, my liege</h3><p>Pick a building below and place it on the map. <b>Where</b> you build matters: neighbours and terrain give bonuses.</p><p class="muted">Click any building to upgrade it. Follow the Decrees tab if you are unsure what to do next.</p>';
  }
  $('inspector').innerHTML = h;
}

const TABS = { build: '🔨 Build', research: '📜 Research', decrees: '🎯 Decrees', realm: '👑 Realm' };
function renderTabs() {
  const dots = { decrees: questDone(), research: R.some(r => !S.research[r.id] && r.hall <= hallL() && canAfford(r.cost)),
    realm: hallL() >= 4 && pendingCrowns() >= Math.max(1, S.crowns) };
  $('tabs').innerHTML = Object.keys(TABS).map(t =>
    `<button class="${t === tab ? 'on' : ''}" data-act="tab" data-id="${t}">${TABS[t]}${dots[t] ? '<i class="dot"></i>' : ''}</button>`).join('');
}
function renderPanel() {
  let h = '';
  if (tab === 'build') {
    for (const id of BUILD_ORDER) {
      const d = B[id];
      if (d.hall > hallL()) { if (d.hall === hallL() + 1) h += `<div class="card locked"><div class="ic">🔒</div><div class="bd">${d.n} — requires a ${hallName(d.hall)}</div></div>`; continue; }
      const c = buildCost(id);
      h += `<button class="card${sel.build === id ? ' on' : ''}${canAfford(c) ? '' : ' cant'}" data-act="pick" data-id="${id}">
        <div class="ic">${d.i}</div><div class="bd"><div class="nm">${d.n} <span>×${count(id)}</span></div><div class="muted">${d.d}</div>${costHTML(c)}</div></button>`;
    }
    if (S.exp < EXPAND_COST.length) { const c = EXPAND_COST[S.exp], n = HALF[S.exp + 1] * 2 + 1;
      h += `<hr><button class="card${canAfford(c) ? '' : ' cant'}" data-act="expand"><div class="ic">🗺️</div><div class="bd"><div class="nm">Expand borders</div><div class="muted">Claim the surrounding land (${n}×${n}).</div>${costHTML(c)}</div></button>`; }
  } else if (tab === 'research') {
    const avail = R.filter(r => !S.research[r.id] && r.hall <= hallL()), owned = R.filter(r => S.research[r.id]);
    for (const r of avail) h += `<button class="card${canAfford(r.cost) ? '' : ' cant'}" data-act="research" data-id="${r.id}">
      <div class="ic">📜</div><div class="bd"><div class="nm">${r.n}</div><div class="muted">${r.d}</div>${costHTML(r.cost)}</div></button>`;
    if (!avail.length) h += '<p class="muted">Your scholars have nothing new to offer for now.</p>';
    if (R.some(r => r.hall > hallL())) h += `<p class="muted">More to discover once you raise a ${hallName(hallL() + 1)}.</p>`;
    if (owned.length) h += '<hr><p class="muted">Known: ' + owned.map(r => r.n).join(', ') + '</p>';
  } else if (tab === 'decrees') {
    const q = Q[S.quest];
    if (q) {
      const done = questDone();
      h += `<h3>${q.t}</h3><p>${q.d}</p>`;
      if (q.p) { const [a, b] = q.p(); h += `<div class="bar"><i style="width:${Math.min(100, a / b * 100)}%"></i></div><p class="muted">${fmt(a)} / ${fmt(b)}</p>`; }
      h += `<p>Reward: ${costHTML(q.r).replace(/lack/g, '')}</p>
        <div class="row"><button class="btn ${done ? 'glow' : 'cant'}" data-act="claim">${done ? 'Claim reward' : 'In progress…'}</button></div>`;
    } else h += '<h3>All decrees fulfilled</h3><p>The bards will sing of your reign. Now see how far the numbers go.</p>';
    h += `<hr><p class="muted">Decrees fulfilled: ${S.quest} / ${Q.length}</p>`;
  } else {
    const n = pendingCrowns(), ok = hallL() >= 4 && n >= 1;
    h += `<h3>👑 Dynasty</h3><p>Once you hold a Castle you may abdicate and found a new kingdom. You start over, but earn Crowns that boost all production by 10% each, forever.</p>
      <p class="stat">Crowns held: <b>${S.crowns}</b> (${pct(S.crowns * 0.1)}) · on abdication: <b>+${n}</b></p>
      <div class="row"><button class="btn${ok ? '' : ' cant'}" data-act="prestige">${hallL() < 4 ? 'Requires a Castle' : `Found a new kingdom (+${n} 👑)`}</button></div>
      <hr><h3>Chronicle</h3>
      <p class="stat">Gold earned, all time: <b>${fmt(S.stats.totalGold)}</b></p>
      <p class="stat">Buildings raised: <b>${S.stats.built}</b> · Taxes collected by hand: <b>${S.stats.clicks}</b></p>
      <p class="stat">Merchants met: <b>${S.stats.merchants}</b> · Kingdoms founded: <b>${S.stats.prestiges + 1}</b></p>
      <hr><div class="row"><button class="btn alt" data-act="save">Save now</button><button class="btn alt" data-act="export">Export</button>
      <button class="btn alt" data-act="import">Import</button><button class="btn" data-act="wipe">Hard reset</button></div>
      <p class="muted">The game saves itself every 10 seconds and keeps working while you are away.</p>`;
  }
  $('panel').innerHTML = h;
}
function redraw() { C = compute(); renderRes(); renderMap(); renderInspector(); renderTabs(); renderPanel(); }

function toast(msg) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
  const box = $('toasts'); while (box.children.length >= 4) box.firstChild.remove();
  box.appendChild(el); setTimeout(() => el.remove(), 4000);
}
function fx(x, y, text) {
  const el = document.createElement('div'); el.className = 'fx'; el.textContent = text;
  el.style.left = x + 'px'; el.style.top = y + 'px'; document.body.appendChild(el); setTimeout(() => el.remove(), 900);
}
let modalYes = null;
function modal(html) { $('modalbox').innerHTML = html; $('modal').hidden = false; }
function confirmBox(title, body, yes) {
  modalYes = yes;
  modal(`<h2>${title}</h2><p>${body}</p><div class="row"><button class="btn" data-act="yes">Yes</button><button class="btn alt" data-act="close">Cancel</button></div>`);
}

// ───────────────────────── Persistence ─────────────────────────
function save() { S.last = Date.now(); try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ } }
function adopt(obj) {
  if (!obj || !obj.tiles || !obj.res || !obj.tiles[MID + ',' + MID]) throw new Error('bad save');
  const f = freshState();
  S = Object.assign(f, obj); S.res = Object.assign(f.res, obj.res); S.stats = Object.assign(f.stats, obj.stats);
  for (const k in S.tiles) if (!B[S.tiles[k].b]) delete S.tiles[k];
  terrain = genTerrain(S.seed);
}
function load() {
  try { adopt(JSON.parse(localStorage.getItem(SAVE_KEY))); } catch (e) { S = freshState(); terrain = genTerrain(S.seed); }
  C = compute();
  const away = Math.min((Date.now() - S.last) / 1000, (has('steward') ? 24 : 8) * 3600);
  if (away > 60) {
    const before = Object.assign({}, S.res);
    advance(away);
    const gains = Object.keys(RES).filter(r => S.res[r] - before[r] >= 1).map(r => `<p class="stat">${RES[r].i} ${RES[r].n}: <b>+${fmt(S.res[r] - before[r])}</b></p>`).join('');
    const hrs = Math.floor(away / 3600), mins = Math.floor(away % 3600 / 60);
    modal(`<h2>Welcome back, my liege</h2><p>Your villagers kept working for ${hrs ? hrs + 'h ' : ''}${mins}m while you were away.</p>
      ${gains || '<p class="muted">Sadly the stores did not grow. Check on your food supply.</p>'}<div class="row"><button class="btn" data-act="close">Splendid</button></div>`);
  }
}

// ───────────────────────── Input ─────────────────────────
const ACT = {
  tile(k) {
    const [x, y] = xy(k);
    if (!S.tiles[k] && terrain[x][y] === 'plain' && sel.build) build(k); else sel = sel.tile === k ? {} : { tile: k };
  },
  pick(id) { sel = sel.build === id ? {} : { build: id }; },
  tab(id) { tab = id; },
  up(k) { upgrade(k); },
  demolish(k) { demolish(k); sel = {}; },
  research, expand, claim, prestige,
  save() { save(); toast('💾 Saved.'); },
  export() { modal(`<h2>Export save</h2><p class="muted">Copy this text somewhere safe.</p><textarea readonly onclick="this.select()">${btoa(JSON.stringify(S))}</textarea><div class="row"><button class="btn" data-act="close">Done</button></div>`); },
  import() { modal('<h2>Import save</h2><p class="muted">Paste an exported save. This replaces your current kingdom.</p><textarea id="imp"></textarea><div class="row"><button class="btn" data-act="doimport">Import</button><button class="btn alt" data-act="close">Cancel</button></div>'); },
  doimport() {
    try { adopt(JSON.parse(atob($('imp').value.trim()))); S.last = Date.now(); sel = {}; save(); $('modal').hidden = true; toast('Kingdom restored.'); }
    catch (e) { toast('That save could not be read.'); }
  },
  wipe() { confirmBox('Burn it all down?', 'This erases everything, Crowns included. There is no undo.', () => {
    S = freshState(); terrain = genTerrain(S.seed); sel = {}; save(); }); },
  yes() { $('modal').hidden = true; const f = modalYes; modalYes = null; if (f) f(); },
  close() { $('modal').hidden = true; },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || el.classList.contains('locked')) return;
  ACT[el.dataset.act](el.dataset.id); redraw();
});
document.addEventListener('pointerdown', () => { pressing = true; });
for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, () => { pressing = false; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { sel = {}; $('modal').hidden = true; redraw(); } });
$('clicker').addEventListener('click', e => {
  const g = Math.max(1, clickVal());
  S.res.gold += g; S.runGold += g; S.stats.totalGold += g; S.stats.clicks++;
  const r = e.currentTarget.getBoundingClientRect();
  fx((e.clientX || r.left + r.width / 2) - 10 + (Math.random() * 30 - 15), (e.clientY || r.top) - 20, '+' + fmt(g));
  renderRes();
});
$('merchant').addEventListener('click', () => { clickMerchant(); redraw(); });

// ───────────────────────── Loop ─────────────────────────
load();
redraw();
let lastT = Date.now(), frame = 0;
setInterval(() => {
  const now = Date.now(), dt = Math.max(0, (now - lastT) / 1000); lastT = now;
  advance(dt);
  const step = Math.min(dt, 1);
  if (merch.left > 0) { merch.left -= step; if (merch.left <= 0) $('merchant').hidden = true; }
  else if ((merch.next -= step) <= 0) {
    merch.next = (60 + Math.random() * 90) * (has('caravan') ? 0.5 : 1); merch.left = 20;
    const m = $('merchant'); m.style.left = 8 + Math.random() * 70 + '%'; m.style.top = 8 + Math.random() * 70 + '%'; m.hidden = false;
  }
  if (S.starving && !warnedStarve) { toast('🍞 Your villagers are starving! Work slows to half — build more farms.'); warnedStarve = true; }
  if (!S.starving) warnedStarve = false;
  frame++;
  if (frame % 3 === 0) renderRes();
  if (frame % 10 === 0 && !pressing) { renderTabs(); renderPanel(); renderInspector(); }
  if (frame % 100 === 0) save();
}, 100);
window.addEventListener('beforeunload', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
