'use strict';
// Rules and save-format tests. No dependencies: node tests/sim.test.js
const assert = require('assert');
const { loadSim } = require('./harness');

let passed = 0, failed = 0;
function test(name, fn) {
  const sim = loadSim(); sim.startNewGame(0);
  try { fn(sim); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + String(e.message).split('\n').join('\n     ')); }
}
const plain = v => JSON.parse(JSON.stringify(v)); // objects from the vm context have foreign prototypes
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);
// A small working town on a known map. With `levels`, the hall and every kind standing are raised to that level.
function town(sim, levels) {
  const s = sim.newState(0); s.run = sim.newRun(12345); sim.setState(s);
  const run = sim.state.run; run.res = { gold: 1e9, food: 1e6, wood: 1e9, stone: 1e9, iron: 1e9 };
  const free = [];
  for (let x = 3; x <= 7; x++) for (let y = 3; y <= 7; y++) if (run.terrain[x][y] === 'plain' && !(x === 5 && y === 5)) free.push(x + ',' + y);
  for (const id of ['cottage', 'cottage', 'farm', 'lumber', 'quarry']) assert.ok(sim.build(free.shift(), id).ok, 'build ' + id);
  if (levels) for (let i = 1; i < levels; i++) { assert.ok(sim.upgrade(sim.HALL_KEY).ok); for (const id of ['cottage', 'farm', 'lumber', 'quarry']) assert.ok(sim.upgradeKind(id).ok, 'upgrade ' + id); }
  sim.setState(sim.state);
  return free;
}
// An empty all-plain map with a Palace and plenty of everything, for price tests.
function field(sim) {
  const s = sim.newState(0); s.run = sim.newRun(12345); sim.setState(s);
  const run = sim.state.run; run.terrain = run.terrain.map(col => col.map(() => 'plain')); run.exp = sim.EXPAND_COST.length;
  run.tiles[sim.HALL_KEY].level = 5; run.res = { gold: 1e15, food: 1e15, wood: 1e15, stone: 1e15, iron: 1e15 }; // small enough that every price shows in the stock
  const free = []; for (let x = 0; x < 11; x++) for (let y = 0; y < 11; y++) if (!(x === 5 && y === 5)) free.push(x + ',' + y);
  sim.setState(sim.state);
  return free;
}
const spend = (sim, fn) => { const before = plain(sim.state.run.res); assert.ok(fn().ok); const o = {}; for (const r in before) if (before[r] !== sim.state.run.res[r]) o[r] = before[r] - sim.state.run.res[r]; return o; };

test('crownsFor: log scale on the gold earned this reign, with a threshold that rises with Crowns held', sim => {
  assert.strictEqual(sim.crownsFor(0, 0), 0);
  assert.strictEqual(sim.crownsFor(-5, 0), 0);
  assert.strictEqual(sim.crownsFor(sim.CROWN_GOLD, 0), 0);
  assert.strictEqual(sim.crownsFor(sim.CROWN_GOLD * 10, 0), sim.CROWN_RATE, 'ten times the threshold');
  assert.strictEqual(sim.crownsFor(sim.goldForCrowns(sim.CROWN_MIN, 0) * 1.001, 0), sim.CROWN_MIN); assert.ok(sim.goldForCrowns(sim.CROWN_MIN, 0) > 1e7 && sim.goldForCrowns(sim.CROWN_MIN, 0) < 5e7, 'a first Palace (about 20M gold earned) offers just enough to abdicate');
  assert.strictEqual(sim.crownsFor(sim.goldForCrowns(sim.CROWN_MIN, 0) * 1001, 0), sim.CROWN_MIN + 3 * sim.CROWN_RATE, 'a thousand times the gold adds three times CROWN_RATE');
  { const G = sim.goldForCrowns(sim.CROWN_MIN, 0) * 1.001; assert.ok(sim.crownsFor(G, 30) <= sim.CROWN_MIN && sim.crownsFor(G, 60) < sim.crownsFor(G, 30), 'the same reign is worth less once many Crowns are held'); }
  for (const held of [0, 10, 40]) for (const n of [1, 5, 10, 20]) {
    const g = sim.goldForCrowns(n, held);
    assert.strictEqual(sim.crownsFor(g * 1.0001, held), n, `goldForCrowns(${n}, ${held})`); assert.strictEqual(sim.crownsFor(g * 0.999, held), n - 1);
  }
  assert.strictEqual(sim.crownMult(10), 1.5);
});

test('pendingCrowns and abdication: Crowns banked, Monuments counted, head start granted', sim => {
  sim.state.run.gold = sim.goldForCrowns(11, 0) * 1.01; sim.state.meta.stats.totalGold = 5e7;
  assert.strictEqual(sim.pendingCrowns(), 11);
  assert.strictEqual(sim.canPrestige(), false, 'needs a Castle');
  sim.state.run.tiles[sim.HALL_KEY].level = 4;
  assert.strictEqual(sim.canPrestige(), false, 'a Castle with a small offer is not enough');
  assert.strictEqual(sim.prestige().ok, false); assert.strictEqual(sim.hallLevel(), 4, 'a refused abdication changes nothing');
  sim.state.run.gold = sim.goldForCrowns(sim.CROWN_MIN - 1, 0) * 1.001; sim.state.run.repeatables.monument = 2;
  const n = sim.CROWN_MIN + 1;
  assert.strictEqual(sim.pendingCrowns(), n); assert.strictEqual(sim.canPrestige(), true, 'Monuments count towards the minimum offer');
  const r = sim.prestige();
  assert.ok(r.ok); assert.strictEqual(r.crowns, n);
  assert.strictEqual(sim.state.meta.crowns, n); assert.strictEqual(sim.state.meta.bonusCrowns, 2);
  assert.strictEqual(sim.pendingCrowns(), 0, 'a new reign starts from nothing on offer');
  assert.strictEqual(sim.hallLevel(), 1); assert.strictEqual(Object.keys(sim.state.run.tiles).length, 1);
  assert.strictEqual(sim.state.meta.stats.totalGold, 5e7, 'meta survives abdication');
  const S = sim.START_RES, H = sim.HEAD_START;
  assert.deepStrictEqual(plain(sim.state.run.res), { gold: S.gold + H.gold, food: S.food + H.food, wood: S.wood + H.wood, stone: H.stone, iron: 0 });
  assert.deepStrictEqual(plain(sim.newRun(1).res), plain(S), 'a first kingdom gets no head start');
  assert.deepStrictEqual(plain(sim.newRun(1, 500).res), plain(sim.newRun(1, 1).res), 'the head start is the same however many Crowns are held');
  assert.strictEqual(sim.newRun(1, 500).tiles[sim.HALL_KEY].level, 1, 'and every kingdom starts at a Village Hall');
  assert.ok(H.gold < sim.HALL_COST[0].gold && H.wood < sim.HALL_COST[0].wood, 'and it does not pay for a Manor');
  near(sim.crownThreshold(30) / sim.crownThreshold(0), Math.pow(2.5, sim.CROWN_STEEPEN), 1e-6, 'up to 30 Crowns the threshold follows the multiplier to the power CROWN_STEEPEN;');
  near(sim.crownThreshold(60) / sim.crownThreshold(30), Math.pow(4 / 2.5, sim.CROWN_STEEPEN + sim.CROWN_DEAR), 1e-6, 'past 30 Crowns it climbs much faster;');
});

test('the price rule: a build costs one step of worth at the kind level, an upgrade the rise in worth over every copy', sim => {
  const free = field(sim), B = sim.BUILDINGS;
  // worth(n, L) = cost × W(n) × U(L), written out apart from sim.js
  const step = (id, i) => { const d = B[id], g = d.growth; return !d.late || i < d.late.from ? g ** i : g ** (d.late.from - 1) * d.late.growth ** (i - d.late.from + 1); };
  const W = (id, n) => { let w = 0; for (let i = 0; i < n; i++) w += step(id, i); return w; };
  const U = (id, L) => L === 1 ? 1 : (B[id].lift || 1) * B[id].upgradeGrowth ** (L - 1);
  for (const id of sim.BUILD_ORDER) {
    const c0 = Object.keys(B[id].cost)[0], base = B[id].cost[c0];
    assert.strictEqual(sim.kindLevel(id), 1, id + ' starts at level 1');
    assert.strictEqual(sim.buildCost(id)[c0], Math.ceil(base), id + ': the first costs the base price');
    assert.strictEqual(sim.upgradeKind(id).ok, false, id + ': no upgrade before one stands');
    for (let n = 0; n < 7; n++) { assert.strictEqual(sim.buildCost(id)[c0], Math.ceil(base * step(id, n) * U(id, sim.kindLevel(id))), `${id} copy ${n + 1}`); assert.ok(sim.build(free.shift(), id).ok); if (n === 2) sim.upgradeKind(id); }
    assert.strictEqual(sim.kindUpgradeCost(id)[c0], Math.ceil(base * W(id, 7) * (U(id, 3) - U(id, 2))), id + ': an upgrade is the rise in worth of all seven');
  }
  field(sim); assert.ok(sim.build('0,0', 'lumber').ok);
  assert.deepStrictEqual(plain(sim.kindUpgradeCost('lumber')), { gold: 3580, wood: 895 }, 'the first Lumber Camp upgrade (a lift of 10)');
  sim.state.run.tiles['0,1'] = { kind: 'building', id: 'guild' }; sim.state.run.levels.guild = sim.MAX_LEVEL - 1;
  assert.ok(Object.values(sim.kindUpgradeCost('guild')).every(v => Number.isFinite(v) && v <= 1e300) && Object.values(sim.buildCost('guild')).every(Number.isFinite), 'the dearest prices are finite numbers');
});

test('the price rule is order-independent: build-then-upgrade and upgrade-then-build cost the same in all', sim => {
  // lumber and quarry have a level-2 lift and late copy steps, cottage and farm are linear with late steps, market neither
  for (const id of ['lumber', 'quarry', 'cottage', 'farm', 'market', 'church']) for (const [n, L] of [[2, 2], [6, 3], [8, 4]]) {
    const mixed = ['b']; for (let b = 1, u = 0; b < n || u < L - 1;) if (u < L - 1 && (mixed[mixed.length - 1] === 'b' || b >= n)) { mixed.push('u'); u++; } else { mixed.push('b'); b++; }
    const orders = { 'build first': 'b'.repeat(n) + 'u'.repeat(L - 1), 'upgrade first': 'b' + 'u'.repeat(L - 1) + 'b'.repeat(n - 1), 'alternating': mixed.join('') };
    const totals = {};
    for (const name in orders) {
      const ops = orders[name], free = field(sim), total = {};
      for (const c of ops) { const paid = spend(sim, () => c === 'b' ? sim.build(free.shift(), id) : sim.upgradeKind(id)); for (const r in paid) total[r] = (total[r] || 0) + paid[r]; }
      assert.strictEqual(sim.count(id), n); assert.strictEqual(sim.kindLevel(id), L);
      totals[name] = { total, ops: ops.length };
    }
    const ref = totals['build first'].total;
    for (const name in totals) for (const r in ref) near(totals[name].total[r], ref[r], totals[name].ops + totals['build first'].ops, `${id} ×${n} at level ${L}, ${name}, ${r}:`);
  }
});

test('a build and demolish loop always loses a quarter, at any count and level', sim => {
  for (const id of ['cottage', 'lumber', 'farm', 'quarry', 'market', 'smith']) for (const [n, L] of [[0, 1], [3, 2], [6, 3], [7, 1]]) {
    const free = field(sim);
    for (let i = 0; i < n; i++) assert.ok(sim.build(free.shift(), id).ok);
    if (n) for (let l = 1; l < L; l++) assert.ok(sim.upgradeKind(id).ok);
    const price = plain(sim.buildCost(id)), start = plain(sim.state.run.res);
    for (let loop = 0; loop < 3; loop++) {
      const key = free[0], paid = spend(sim, () => sim.build(key, id));
      assert.deepStrictEqual(paid, price, `${id}: the same price each time round`);
      const refund = plain(sim.demolishRefund(sim.state.run.tiles[key]));
      for (const r in price) assert.strictEqual(refund[r], Math.floor(price[r] * sim.REFUND_SHARE), `${id} ×${n + 1} at level ${L}: three quarters of ${r} back`);
      assert.ok(sim.demolish(key).ok); assert.strictEqual(sim.kindLevel(id), n ? L : 1, 'demolishing leaves the kind level as it was');
    }
    for (const r in price) assert.ok(start[r] - sim.state.run.res[r] >= 3 * 0.25 * price[r] - 3, `${id}: three loops lose at least three quarters of a price`);
  }
  assert.strictEqual(sim.REFUND_SHARE, 0.75);
  assert.strictEqual(sim.demolish(sim.HALL_KEY).ok, false, 'the hall cannot be demolished');
});

test('one kind upgrade changes the output, jobs and housing of every building of the kind', sim => {
  const free = field(sim), run = sim.state.run;
  for (const id of ['cottage', 'cottage', 'cottage', 'quarry', 'quarry', 'farm', 'farm', 'church']) assert.ok(sim.build(free.shift(), id).ok);
  for (let i = 0; i < 8; i++) sim.upgradeKind('cottage'); // housing to spare, so everything is staffed
  const look = () => { sim.setState(sim.state); run.pop = sim.calc.cap; sim.setState(sim.state); return { cap: sim.calc.cap, need: sim.calc.need, base: plain(sim.calc.base), staff: sim.calc.staff,
    lv: Object.fromEntries(Object.keys(run.tiles).filter(k => run.tiles[k].kind === 'building').map(k => [k, sim.calc.tiles[k].levelMult])) }; };
  const ids = k => run.tiles[k].id, of = id => Object.keys(run.tiles).filter(k => run.tiles[k].id === id);
  let a = look(); assert.strictEqual(a.staff, 1);
  assert.ok(sim.upgradeKind('quarry').ok); let b = look();
  for (const k of of('quarry')) near(b.lv[k], a.lv[k] * sim.OUT_GROWTH, 1e-9, 'each quarry ×3:');
  for (const k in a.lv) if (ids(k) !== 'quarry') assert.strictEqual(b.lv[k], a.lv[k], 'other kinds unchanged');
  near(b.base.stone, a.base.stone * sim.OUT_GROWTH, 1e-6, 'stone output ×3:'); assert.strictEqual(b.need - a.need, 2 * sim.BUILDINGS.quarry.work, 'jobs: one more level of work at both quarries');
  a = b; assert.ok(sim.upgradeKind('farm').ok); b = look();
  for (const k of of('farm')) assert.strictEqual(b.lv[k], 2, 'farms are linear: level 2 makes twice level 1'); assert.strictEqual(b.need - a.need, 2 * sim.BUILDINGS.farm.work);
  a = b; assert.ok(sim.upgradeKind('cottage').ok); b = look();
  assert.strictEqual(b.cap - a.cap, 3 * sim.BUILDINGS.cottage.house, 'housing: every cottage gains its level-1 amount');
  a = b; assert.ok(sim.upgradeKind('church').ok); b = look();
  near(b.base.stone / a.base.stone, (1 + 2 * sim.BUILDINGS.church.glob) / (1 + sim.BUILDINGS.church.glob), 1e-9, 'a church at level 2 inspires twice as much:');
  // A new building arrives at its kind's level, and an upgrade on a building's tile is the kind upgrade
  const key = free.shift(); assert.ok(sim.build(key, 'quarry').ok); b = look(); assert.strictEqual(b.lv[key], sim.OUT_GROWTH, 'a new quarry starts at level 2');
  assert.deepStrictEqual(plain(run.tiles[key]), { kind: 'building', id: 'quarry' }, 'a building tile keeps no level of its own');
  assert.ok(sim.upgrade(key).ok); assert.strictEqual(sim.kindLevel('quarry'), 3);
  for (const gone of ['routineUpgrades', 'routineReserve', 'ROUTINE_SECONDS', 'ROUTINE_RESERVE_SECONDS', 'UPGRADE_CREEP', 'UPGRADE_CREEP_FROM', 'kindWorth', 'BUILD_GROWTH', 'UPGRADE_GROWTH']) assert.strictEqual(sim[gone], undefined, gone + ' is gone');
  for (const id of sim.BUILD_ORDER) assert.ok(sim.BUILDINGS[id].growth > 1 && sim.BUILDINGS[id].upgradeGrowth > 1 && sim.BUILDINGS[id].outGrowth === undefined, id + ' sets its own growth and upgradeGrowth');
  // the decrees that ask for levels read kind levels
  const done = id => !!sim.DECREES.find(d => d.id === id).done();
  assert.strictEqual(done('builders'), true, 'cottages are well past level 3');
  run.levels.cottage = 1; run.levels.quarry = 2; run.levels.farm = 2; run.levels.church = 2; assert.strictEqual(done('builders'), false);
  run.levels.mine = 5; assert.strictEqual(done('veins'), false, 'a Mine level with no Mine standing does not count');
  sim.build(free.shift(), 'mine'); assert.strictEqual(done('veins'), true); run.levels.mine = 3; assert.strictEqual(done('veins'), false);
});

test('a save at the level cap keeps every cost, refund and stock finite', sim => {
  const s = sim.newState(0); s.run = sim.newRun(12345);
  s.run.tiles['4,5'] = { kind: 'building', id: 'lumber' }; s.run.tiles['6,5'] = { kind: 'building', id: 'guild' };
  s.run.levels.lumber = 1e9; s.run.levels.guild = 1e9; s.run.repeatables = { monument: 1e9 };
  const { state: clean } = sim.sanitizeSave(plain(s), 1000); sim.setState(clean);
  for (const k of ['4,5', '6,5']) {
    const t = sim.state.run.tiles[k]; assert.strictEqual(sim.kindLevel(t.id), sim.MAX_LEVEL);
    assert.strictEqual(sim.upgradeKind(t.id).ok, false, 'no upgrade past the cap');
    for (const c of [sim.kindUpgradeCost(t.id), sim.buildCost(t.id), sim.spentOn(t), sim.demolishRefund(t)]) for (const r in c) assert.ok(Number.isFinite(c[r]), `${t.id} ${r} is ${c[r]}`);
  }
  for (const r of sim.REPEATABLES) { const c = sim.repCost(r); for (const k in c) assert.ok(Number.isFinite(c[k]), r.id + ' cost is ' + c[k]); }
  assert.ok(sim.demolish('4,5').ok); assert.ok(sim.demolish('6,5').ok);
  for (const r in sim.state.run.res) assert.ok(Number.isFinite(sim.state.run.res[r]), r + ' is ' + sim.state.run.res[r]);
  const again = sim.sanitizeSave(JSON.parse(JSON.stringify(sim.state)), 1000).state;
  assert.strictEqual(again.run.res.gold, sim.state.run.res.gold, 'the refund survives a save and load');
});

test('creditAway: caps at 8h, 24h with Stewardship; reports the cap and the rested bonus', sim => {
  town(sim);
  let r = sim.creditAway(20 * 3600);
  assert.strictEqual(r.credited, 8 * 3600); assert.strictEqual(r.capped, true); assert.strictEqual(r.capHours, 8); assert.strictEqual(r.away, 20 * 3600);
  const rest = h => (sim.REST_BONUS * Math.max(0, h - sim.REST_AFTER_HOURS) + sim.REST_LONG_BONUS * Math.max(0, h - sim.REST_LONG_AFTER_HOURS)) * 3600;
  assert.strictEqual(r.rested, rest(8)); near(sim.state.run.clock, 8 * 3600 + rest(8), 1e-6, 'clock: the capped time plus the rested bonus on it');
  sim.state.run.away = 0; r = sim.creditAway(30);
  assert.strictEqual(r.credited, 30); assert.strictEqual(r.capped, false); assert.strictEqual(r.rested, 0, 'a short absence earns no bonus');
  { const c0 = sim.state.run.clock; sim.advance(7 * 3600); near(sim.state.run.clock - c0, 7 * 3600, 1e-6, 'an open game earns none'); }
  sim.state.run.research.steward = 1; sim.state.run.away = 0;
  r = sim.creditAway(30 * 3600);
  assert.strictEqual(r.credited, 24 * 3600); assert.strictEqual(r.capHours, 24); assert.strictEqual(r.rested, rest(24), 'the bonus is worked out on the capped time');
  for (const bad of [-5, NaN, Infinity, undefined]) assert.strictEqual(sim.creditAway(bad).credited, 0, 'bad gap ' + bad);
});

test('demolish refunds three quarters of the last copy\'s share at today\'s level', sim => {
  town(sim);
  const run = sim.state.run, key = Object.keys(run.tiles).find(k => run.tiles[k].id === 'quarry');
  for (let i = 0; i < 3; i++) assert.ok(sim.upgradeKind('quarry').ok);
  const share = plain(sim.spentOn(run.tiles[key])), before = plain(run.res), refund = plain(sim.demolishRefund(run.tiles[key]));
  assert.ok(share.gold > 100 * sim.BUILDINGS.quarry.cost.gold, 'the share carries the kind level');
  assert.deepStrictEqual(refund, { gold: Math.floor(share.gold * 0.75), wood: Math.floor(share.wood * 0.75) });
  assert.ok(sim.demolish(key).ok); assert.strictEqual(run.tiles[key], undefined);
  assert.strictEqual(run.res.gold, before.gold + refund.gold);
  assert.deepStrictEqual(plain(sim.buildCost('quarry')), share, 'building it again costs the full share');
  assert.strictEqual(sim.kindLevel('quarry'), 4, 'with none standing, the kind keeps its level');
  assert.strictEqual(sim.upgradeKind('quarry').ok, false, 'but cannot be upgraded until one stands');
});

test('sanitizeSave rejects things that are not saves', sim => {
  for (const bad of [null, 5, 'x', [], {}, { v: 2 }, { v: 2, meta: 5, run: [] }, { v: 99, meta: {}, run: {} }, { v: '<b>', meta: {}, run: {} }])
    assert.throws(() => sim.sanitizeSave(bad, 1000), undefined, JSON.stringify(bad));
  const before = sim.state;
  assert.throws(() => sim.adoptSave({ v: 99, meta: {}, run: {} }, 1000));
  assert.strictEqual(sim.state, before, 'a rejected save leaves the current game in place');
});

test('sanitizeSave coerces and clamps every field', sim => {
  const evil = { v: 2, last: '<img src=x onerror=alert(1)>', extra: '<script>',
    meta: { crowns: '<img src=x onerror=alert(1)>', bonusCrowns: 1e9, decree: '<script>', stats: { totalGold: '"><svg>', clicks: -4, built: 3.7, bogus: 1 } },
    run: { seed: 'x', exp: 9, pop: '<b>', cleared: 1e9, res: { gold: '<img>', food: -5, wood: Infinity, stone: NaN, iron: '12.5', plutonium: 9 }, terrain: [['<img>']],
      tiles: { '5,5': { kind: 'hall', id: 'hall', level: 1e9 }, '4,5': { kind: 'building', id: '<img src=x>', level: 2 }, '6,5': { kind: 'building', id: 'constructor', level: 2 },
        '"><img>': { kind: 'building', id: 'farm', level: 1 }, '5,4': { kind: 'building', id: 'farm', level: '<i>' }, '0,0': { kind: 'building', id: 'farm', level: -3 }, '99,99': { kind: 'building', id: 'farm', level: 1 }, '5,6': 7 },
      research: { axes: 1, '<img>': 1, tithes: 0 }, repeatables: { prod: '<img>', food: 1e9, bogus: 3 }, buffUntil: 1e99, clock: 5, starving: 'yes' } };
  const { state: s, notes } = sim.sanitizeSave(evil, 1000);
  assert.deepStrictEqual(Object.keys(s).sort(), ['last', 'meta', 'run', 'v']);
  assert.strictEqual(s.last, 1000);
  assert.strictEqual(s.meta.crowns, 0); assert.strictEqual(s.meta.bonusCrowns, 0); assert.strictEqual(s.meta.decree, 'coffers', 'an unknown decree: the old chain counts as finished, the newer decrees are open');
  assert.deepStrictEqual(plain(s.meta.stats), { clicks: 0, totalGold: 0, prestiges: 0, built: 3, upgrades: 0, started: 1000 });
  assert.strictEqual(s.run.exp, 3); assert.strictEqual(s.run.cleared, 121); assert.strictEqual(s.run.starving, false);
  assert.deepStrictEqual(plain(s.run.res), { gold: sim.START_RES.gold, food: 0, wood: sim.START_RES.wood, stone: 0, iron: 12.5 });
  assert.deepStrictEqual(Object.keys(s.run.tiles).sort(), ['0,0', '5,4', '5,5']);
  assert.strictEqual(s.run.tiles['5,5'].level, sim.HALL_MAX, 'a hall above the last is the last'); assert.strictEqual(s.run.tiles['5,5'].kind, 'hall');
  assert.deepStrictEqual(plain(s.run.tiles['5,4']), { kind: 'building', id: 'farm' }, 'a building tile keeps no level'); assert.strictEqual(s.run.levels.farm, 1, 'bad levels read as level 1');
  assert.deepStrictEqual(plain(s.run.research), { axes: 1 });
  assert.deepStrictEqual(plain(s.run.repeatables), { food: sim.MAX_REPEATABLE });
  assert.strictEqual(s.run.buffUntil, undefined, 'festival timers from older saves are dropped');
  assert.strictEqual(s.run.terrain.length, 11); assert.ok(s.run.terrain.every(col => col.length === 11 && col.every(c => c in sim.TERRAIN)));
  assert.strictEqual(s.run.terrain[5][4], 'plain', 'buildings always stand on open plots');
  assert.ok(notes.some(n => /5 buildings in this save were not recognised/.test(n)), notes.join('|'));
  assert.ok(!/[<>]/.test(JSON.stringify(s)), 'no markup survives');
  sim.setState(s); sim.advance(10);
  for (const r in sim.calc.rates) assert.ok(Number.isFinite(sim.calc.rates[r]) && Number.isFinite(sim.state.run.res[r]), r + ' stays finite');
  // version 4: kind levels are whole numbers from 1 to MAX_LEVEL, for known kinds only
  const v4 = { v: 4, meta: {}, run: { levels: { farm: '<b>', cottage: 1e9, lumber: -2, quarry: 2.7, market: '3', mine: null, bogus: 5, constructor: 4, __proto__: 7 },
    tiles: { '5,4': { kind: 'building', id: 'farm', level: 9 } } } };
  const got = sim.sanitizeSave(v4, 1000).state.run;
  assert.deepStrictEqual(Object.keys(got.levels), plain(sim.BUILD_ORDER));
  assert.deepStrictEqual(plain(got.levels), Object.assign(Object.fromEntries(sim.BUILD_ORDER.map(id => [id, 1])), { cottage: sim.MAX_LEVEL, quarry: 2, market: 3 }));
  assert.deepStrictEqual(plain(got.tiles['5,4']), { kind: 'building', id: 'farm' }, 'a version-4 tile level is ignored');
  assert.strictEqual(sim.sanitizeSave({ v: 4, meta: {}, run: { levels: 'x' } }, 1000).state.run.levels.farm, 1, 'levels that are not an object');
});

test('a save round-trips unchanged, including through export text', sim => {
  town(sim, 3); sim.advance(120); sim.state.last = 500;
  const json = sim.serialize(), back = sim.sanitizeSave(JSON.parse(json), 1000);
  assert.strictEqual(JSON.stringify(back.state), json); assert.strictEqual(back.notes.length, 0);
  assert.strictEqual(sim.decodeSave(sim.encodeSave(json)), json);
  const odd = JSON.stringify({ note: 'żółć ✓ 👑' });
  assert.strictEqual(sim.decodeSave(sim.encodeSave(odd)), odd, 'non-Latin-1 text');
  assert.strictEqual(sim.decodeSave(btoa('{"seed":1}')), '{"seed":1}', 'version-1 exports still decode');
});

test('version-1 saves migrate: tiles, decree by id, Crowns, terrain from the seed', sim => {
  const v1 = { seed: 12345, res: { gold: 5e6, food: 1e5, wood: 1000, stone: 1000, iron: 1000 }, pop: 400, exp: 2,
    tiles: { '5,5': { b: 'hall', l: 4 }, '5,4': { b: 'cottage', l: 8 }, '4,5': { b: 'farm', l: 6 }, '6,5': { b: 'smith', l: 3 }, '5,6': { b: 'nonsense', l: 2 } },
    research: { axes: 1, tithes: 1 }, starving: false, buffUntil: 1.7e12, quest: 19, crowns: 19, runGold: 3e6, last: 900,
    stats: { clicks: 10, totalGold: 1.02e7, merchants: 2, prestiges: 1, built: 40, started: 100 } };
  const { state: s, notes } = sim.sanitizeSave(v1, 1000);
  assert.strictEqual(s.v, sim.SAVE_VERSION); assert.strictEqual(s.last, 900);
  assert.strictEqual(s.meta.decree, 'coffers', 'the decrees added since come first'); assert.ok(!s.meta.decreesDone.dynasty && s.meta.decreesDone.castle, 'index 19 of the old order (A New Dynasty) is where the old chain had got to');
  { const at = sim.DECREES.findIndex(d => d.id === 'dynasty'); assert.deepStrictEqual(Object.keys(s.meta.decreesDone), plain(sim.DECREES.slice(0, at).map(d => d.id).filter(id => !sim.DECREES_NEW_IN_V3.includes(id))), 'every older decree before it counts as claimed'); }
  assert.strictEqual(s.meta.crowns, 19); assert.strictEqual(s.meta.bonusCrowns, 0);
  assert.deepStrictEqual(plain(s.run.tiles), { '5,5': { kind: 'hall', id: 'hall', level: 4 }, '5,4': { kind: 'building', id: 'cottage' },
    '4,5': { kind: 'building', id: 'farm' }, '6,5': { kind: 'building', id: 'smith' } });
  assert.deepStrictEqual([s.run.levels.cottage, s.run.levels.farm, s.run.levels.smith, s.run.levels.lumber], [8, 6, 3, 1], 'each kind takes its building\'s level');
  const fresh = plain(sim.genTerrainLegacy(12345)), got = plain(s.run.terrain); // the old generator: a v1 save keeps the map it had
  for (const k in s.run.tiles) { const [x, y] = k.split(',').map(Number); fresh[x][y] = 'plain'; }
  assert.deepStrictEqual(got, fresh);
  assert.strictEqual(s.run.buffUntil, undefined, 'festival times are dropped');
  assert.strictEqual(s.run.gold, 3e6); assert.deepStrictEqual(plain(s.run.research), { axes: 1, tithes: 1 });
  assert.ok(notes.some(n => /predates the rebalance/.test(n)) && notes.some(n => /1 building in this save was not recognised/.test(n)), notes.join('|'));
  sim.setState(s); assert.strictEqual(sim.pendingCrowns(), sim.crownsFor(3e6, 19));
  { const fin = sim.sanitizeSave({ seed: 1, res: {}, tiles: {}, quest: 24 }, 1000).state.meta; assert.strictEqual(fin.decree, 'coffers', 'a finished v1 chain is offered the decrees added since'); assert.strictEqual(Object.keys(fin.decreesDone).length, sim.DECREES.length - sim.DECREES_NEW_IN_V3.length); }
});

test('starvation is recoverable: villagers leave until the farms can feed the rest', sim => {
  town(sim, 4);
  const run = sim.state.run; run.res.food = 0;
  const farm = Object.keys(run.tiles).find(k => run.tiles[k].id === 'farm');
  run.levels.cottage = 60; // far more housing than food
  run.pop = 500; sim.setState(sim.state);
  assert.ok(sim.calc.rates.food < 0);
  sim.advance(5); assert.strictEqual(run.starving, true);
  sim.advance(1800);
  assert.strictEqual(run.starving, false, 'no longer starving');
  assert.ok(run.pop < 500 && run.pop > sim.START_POP, 'population settled at ' + run.pop.toFixed(1));
  near(sim.calc.rates.food, 0, 1, 'food income settles at break-even:');
  const settled = run.pop; sim.advance(600);
  near(run.pop, settled, 1, 'and stays there:');
  for (let i = 0; i < 3; i++) assert.ok(sim.upgrade(farm).ok, 'the farm tile upgrades every farm');
  sim.advance(600);
  assert.ok(run.pop > settled + 5, 'more food lets the town grow again: ' + run.pop.toFixed(1));
  assert.strictEqual(run.starving, false);
});

test('villagers do not move in beyond what the food income can carry', sim => {
  town(sim);
  const run = sim.state.run; run.res.food = 0;
  run.levels.cottage = 40;
  sim.advance(900);
  assert.strictEqual(run.starving, false);
  assert.ok(run.pop < sim.calc.cap - 10 && sim.calc.rates.food >= -1e-6, `pop ${run.pop.toFixed(1)} of ${sim.calc.cap}, food ${sim.calc.rates.food.toFixed(3)}/s`);
  assert.ok(sim.foodRateAt(sim.calc.cap) < 0, 'the full-housing preview shows the deficit');
});

test('linear buildings: flat gain per level and gentler upgrade prices', sim => {
  town(sim);
  const run = sim.state.run, cottage = Object.keys(run.tiles).find(k => run.tiles[k].id === 'cottage'), quarry = Object.keys(run.tiles).find(k => run.tiles[k].id === 'quarry');
  const cap0 = sim.calc.cap; sim.upgrade(cottage); sim.setState(sim.state); assert.strictEqual(sim.calc.cap - cap0, 2 * 5, 'two cottages, five more each');
  const c2 = sim.upgradeCost(run.tiles[cottage]).wood; sim.upgrade(cottage); const c3 = sim.upgradeCost(run.tiles[cottage]).wood;
  near(c3 / c2, sim.LINEAR_UPGRADE_GROWTH, 0.05, 'cottage step');
  sim.upgrade(quarry); const q2 = sim.upgradeCost(run.tiles[quarry]).gold; sim.upgrade(quarry); const q3 = sim.upgradeCost(run.tiles[quarry]).gold;
  near(q3 / q2, sim.BUILDINGS.quarry.upgradeGrowth, 0.05, 'quarry step past the lift');
  assert.ok(sim.LINEAR_UPGRADE_GROWTH < sim.BUILDINGS.quarry.upgradeGrowth, 'linear kinds have the gentler step');
});

test('hand collection stops at the Manor and after CLICK_LIMIT gold in a reign', sim => {
  assert.ok(sim.canCollect());
  let got = 0; for (let i = 0; i < sim.CLICK_LIMIT + 20; i++) got += sim.collectTaxes().gold;
  assert.strictEqual(got, sim.CLICK_LIMIT); assert.strictEqual(sim.state.run.collected, sim.CLICK_LIMIT);
  assert.ok(!sim.canCollect()); assert.deepStrictEqual(plain(sim.collectTaxes()), { ok: false, gold: 0 });
  const back = sim.sanitizeSave(JSON.parse(sim.serialize()), 1000).state; assert.strictEqual(back.run.collected, sim.CLICK_LIMIT, 'the limit survives a reload');
  const raw = JSON.parse(sim.serialize()); raw.run.collected = -5; assert.strictEqual(sim.sanitizeSave(raw, 1000).state.run.collected, 0);
  raw.run.collected = 1e9; assert.strictEqual(sim.sanitizeSave(raw, 1000).state.run.collected, sim.CLICK_LIMIT);
  sim.state.run.collected = 0; assert.ok(sim.canCollect());
  for (const r in sim.state.run.res) sim.state.run.res[r] = 1e9; assert.ok(sim.upgrade(sim.HALL_KEY).ok);
  assert.ok(!sim.canCollect(), 'not from the Manor on'); assert.strictEqual(sim.collectTaxes().gold, 0);
  assert.strictEqual(sim.newRun(1, 0).collected, 0, 'a new reign starts at zero');
});

test('hand collection is a flourish: it does not grow with income, and there is no merchant or festival', sim => {
  assert.strictEqual(sim.clickValue(), 1);
  town(sim, 3); sim.advance(60);
  assert.ok(sim.calc.base.gold > 1); assert.strictEqual(sim.clickValue(), sim.CLICK_GOLD, 'the same single coin, whatever the town earns');
  const gold = sim.state.run.res.gold; assert.strictEqual(sim.collectTaxes().gold, 0, 'from the Manor on there is none'); assert.strictEqual(sim.state.run.res.gold, gold);
  sim.state.meta.crowns = 20; assert.strictEqual(sim.clickValue(), 1, 'and whatever Crowns are held');
  for (const gone of ['merchantVisit', 'festivalOn', 'FESTIVAL_MULT', 'MERCHANT_SECONDS', 'CLICK_SHARE']) assert.strictEqual(sim[gone], undefined, gone);
  assert.deepStrictEqual(sim.calc.rates, sim.calc.base, 'nothing temporary multiplies production');
  assert.ok(!sim.RESEARCH.some(r => r.id === 'seal' || r.id === 'caravan' || /merchant|by hand/i.test(r.desc)));
});

test('a save holding research that no longer exists (Royal Seal, Caravan Routes) loads without it', sim => {
  sim.state.run.research = { axes: 1, seal: 1, caravan: 1 }; sim.state.run.buffUntil = 500; sim.state.meta.stats.merchants = 7;
  const { state: s, notes } = sim.sanitizeSave(JSON.parse(sim.serialize()), 1000);
  assert.deepStrictEqual(plain(s.run.research), { axes: 1 }); assert.strictEqual(notes.length, 0);
  assert.strictEqual(s.meta.stats.merchants, undefined); assert.strictEqual(s.run.buffUntil, undefined);
  sim.setState(s); sim.advance(10); assert.ok(Number.isFinite(sim.calc.base.gold));
  assert.strictEqual(sim.researchFx('offlineHours'), sim.OFFLINE_HOURS);
});

test('Royal Surveyors halve the price of clearing land', sim => {
  const before = sim.clearCost().gold; sim.state.run.tiles[sim.HALL_KEY].level = 2;
  sim.state.run.res.gold = 1e9; sim.state.run.res.wood = 1e9;
  assert.ok(sim.buyResearch('survey').ok); assert.strictEqual(sim.clearCost().gold, before / 2);
});

test('adjacency from a building grows with the square root of its kind level', sim => {
  const run = sim.state.run; run.terrain = run.terrain.map(col => col.map(() => 'plain'));
  run.tiles['4,4'] = { kind: 'building', id: 'cottage' }; run.tiles['4,3'] = { kind: 'building', id: 'tavern' };
  near(sim.adjBonus('cottage', 4, 4), 0.5, 1e-9, 'level 1');
  run.levels.tavern = 4; near(sim.adjBonus('cottage', 4, 4), 1, 1e-9, 'level 4 gives twice level 1, not four times');
  run.levels.tavern = 9; near(sim.adjBonus('cottage', 4, 4), 1.5, 1e-9, 'level 9');
  run.levels.cottage = 9; near(sim.adjBonus('cottage', 4, 4), 1.5, 1e-9, 'the receiver\'s own level does not matter');
});

test('Stewardship is kept when a new kingdom is founded; other research is not', sim => {
  sim.state.run.research = { steward: 1, axes: 1 }; sim.state.run.tiles[sim.HALL_KEY].level = 4; sim.state.run.gold = sim.goldForCrowns(sim.CROWN_MIN, 0) * 1.01;
  assert.ok(sim.prestige().ok);
  assert.deepStrictEqual(plain(sim.state.run.research), { steward: 1 }); assert.strictEqual(sim.researchFx('offlineHours'), 24);
});

test('rest counts time away since the last purchase, so looking in without buying costs nothing', sim => {
  const H = 3600, away = (...hours) => { town(sim, 2); const run = sim.state.run; run.research.steward = 1; run.pop = 30; run.res = { gold: 100, food: 1e6, wood: 100, stone: 100, iron: 0 }; sim.setState(sim.state);
    let rested = 0; for (const h of hours) rested += sim.creditAway(h * H).rested; return { rested, clock: run.clock, gold: run.res.gold, away: run.away }; };
  const one = away(12), two = away(6, 6), six = away(2, 2, 2, 2, 2, 2);
  assert.strictEqual(sim.REST_AFTER_HOURS, 1); assert.strictEqual(sim.REST_LONG_AFTER_HOURS, 8);
  assert.strictEqual(one.rested, (11 * sim.REST_BONUS + 4 * sim.REST_LONG_BONUS) * H); assert.strictEqual(two.rested, one.rested, '6h + 6h'); assert.strictEqual(six.rested, one.rested, 'six looks');
  // the two thresholds: nothing in the first hour, REST_BONUS per hour after it, REST_LONG_BONUS more per hour past eight
  const tier = h => away(h).rested / H;
  assert.strictEqual(tier(0.5), 0); assert.strictEqual(tier(1), 0); near(tier(2), sim.REST_BONUS, 1e-9, '2h:'); near(tier(4), 3 * sim.REST_BONUS, 1e-9, '4h:');
  near(tier(8), 7 * sim.REST_BONUS, 1e-9, '8h, a night:'); near(tier(9), 8 * sim.REST_BONUS + sim.REST_LONG_BONUS, 1e-9, '9h:');
  near(4 + tier(4), 8.5, 1e-9, 'a 4h absence counts as 8.5h:'); near(8 + tier(8), 18.5, 1e-9, 'a night as 18.5h:'); near(12 + tier(12), 36.5, 1e-9, '12h as 36.5h:');
  { town(sim); const run = sim.state.run, c0 = run.clock; sim.advance(12 * H); assert.strictEqual(run.away, 0, 'an open game earns no rest'); near(run.clock - c0, 12 * H, 1e-6, 'and no extra time:'); }
  near(two.clock, one.clock, 1e-6, 'the same simulated time'); near(two.gold, one.gold, one.gold * 0.01, 'and the same gold, to within the step size');
  near(away(8, 8, 8).rested, away(24).rested, 1e-6, 'three nights against one day'); assert.strictEqual(one.away, 12 * H);
  // a purchase ends the rest; looking at prices and a refused purchase do not
  away(5); const run = sim.state.run; run.res.gold = 1e9; run.res.wood = 1e9; run.res.stone = 1e9;
  sim.kindUpgradeCost('farm'); sim.buildCost('farm'); sim.hallWait(); assert.strictEqual(run.away, 5 * H, 'a look spends nothing');
  assert.strictEqual(sim.pay({ gold: 1e12 }), false); assert.strictEqual(run.away, 5 * H);
  const k = Object.keys(run.tiles).find(k => run.tiles[k].kind === 'building'); assert.ok(sim.upgrade(k).ok); assert.strictEqual(run.away, 0);
  assert.strictEqual(sim.creditAway(5 * H).rested, 4 * sim.REST_BONUS * H, 'after buying, the count starts again (not 10 h on)');
  const s2 = sim.sanitizeSave(JSON.parse(sim.serialize()), 1000).state; assert.strictEqual(s2.run.away, 5 * H, 'saved');
  { const raw = JSON.parse(sim.serialize()); raw.run.away = 1e200; assert.strictEqual(sim.sanitizeSave(raw, 1000).state.run.away, 1e9, 'clamped'); raw.run.away = -5; assert.strictEqual(sim.sanitizeSave(raw, 1000).state.run.away, 0); }
  run.tiles[sim.HALL_KEY].level = 4; run.gold = sim.goldForCrowns(sim.CROWN_MIN, 0) * 1.01; assert.ok(sim.prestige().ok); assert.strictEqual(sim.state.run.away, 0, 'a new kingdom starts unrested');
});

test('decrees: three are open at a time, any of them can be claimed, one is pursued, none expires', sim => {
  const ids = () => plain(sim.openDecrees().map(d => d.id));
  assert.strictEqual(sim.DECREE_CHOICES, 3); assert.deepStrictEqual(ids(), ['roof', 'timber', 'bread']);
  assert.strictEqual(sim.state.meta.decree, 'roof'); assert.strictEqual(sim.claimDecree().ok, false); assert.strictEqual(sim.decreeDone(), false);
  assert.strictEqual(sim.pursueDecree('bread').ok, true); assert.strictEqual(sim.currentDecree().id, 'bread'); assert.strictEqual(sim.pursueDecree('manor').ok, false, 'not open yet');
  town(sim); sim.state.meta.decree = 'bread';
  assert.strictEqual(sim.decreeDone(), true); assert.strictEqual(sim.decreeDone('timber'), true); assert.strictEqual(sim.claimDecree('hamlet').ok, false, 'not open');
  const gold = sim.state.run.res.gold;
  assert.ok(sim.claimDecree('timber').ok, 'out of order'); assert.strictEqual(sim.state.run.res.gold, gold + 40);
  assert.deepStrictEqual(ids(), ['roof', 'bread', 'hamlet']); assert.strictEqual(sim.state.meta.decree, 'bread', 'still pursuing the same one');
  assert.strictEqual(sim.claimDecree('timber').ok, false, 'once only');
  assert.ok(sim.claimDecree('bread').ok); assert.strictEqual(sim.state.meta.decree, 'roof', 'the pursuit moves to the earliest open decree');
  assert.ok(sim.claimDecree().ok, 'without an id: the first one that is ready'); assert.strictEqual(sim.decreesFulfilled(), 3);
  const { state: s } = sim.sanitizeSave(JSON.parse(sim.serialize()), 1000);
  assert.deepStrictEqual(Object.keys(s.meta.decreesDone).sort(), ['bread', 'roof', 'timber']); assert.strictEqual(s.meta.decree, sim.state.meta.decree);
  assert.strictEqual(sim.LEGACY_DECREE_ORDER.filter(id => !sim.DECREES.some(d => d.id === id)).length, 0, 'every v1 decree still exists');
  for (const d of sim.DECREES) sim.state.meta.decreesDone[d.id] = 1;
  assert.strictEqual(sim.currentDecree(), null); assert.strictEqual(sim.decreeDone(), false); assert.strictEqual(sim.claimDecree().ok, false);
});

test('version-2 saves (one decree at a time) migrate: everything before the current decree is claimed', sim => {
  const raw = JSON.parse(sim.serialize()); raw.v = 2; delete raw.meta.decreesDone; raw.meta.decree = 'keep';
  let s = sim.sanitizeSave(raw, 1000).state;
  assert.strictEqual(s.v, sim.SAVE_VERSION); assert.strictEqual(s.meta.decree, 'keep');
  assert.deepStrictEqual(Object.keys(s.meta.decreesDone), plain(sim.DECREES.slice(0, sim.DECREES.findIndex(d => d.id === 'keep')).map(d => d.id).filter(id => id !== 'coffers')));
  sim.setState(s); assert.deepStrictEqual(plain(sim.openDecrees().map(d => d.id)).slice(0, 2), ['coffers', 'keep'], 'a decree added since is still to be had');
  raw.meta.decree = null; s = sim.sanitizeSave(raw, 1000).state;
  assert.deepStrictEqual(plain(sim.DECREES.filter(d => !s.meta.decreesDone[d.id]).map(d => d.id)), plain(sim.DECREES_NEW_IN_V3), 'a finished chain keeps what it claimed and is offered the decrees added since');
  assert.strictEqual(s.meta.decree, 'coffers');
  raw.meta.decree = 'gone'; const out = sim.sanitizeSave(raw, 1000);
  assert.strictEqual(out.state.meta.decree, 'coffers'); assert.ok(out.notes.some(n => /no longer exists/.test(n)));
  raw.v = 3; raw.meta.decree = 'timber'; raw.meta.decreesDone = { roof: 1, nonsense: 1, bread: 0, '<b>': 1 };
  s = sim.sanitizeSave(raw, 1000).state; assert.deepStrictEqual(plain(s.meta.decreesDone), { roof: 1 }); assert.strictEqual(s.meta.decree, 'timber');
  raw.meta.decree = 'palace'; assert.strictEqual(sim.sanitizeSave(raw, 1000).state.meta.decree, 'timber', 'a pursuit that is not open falls back to the first open decree');
});

test('the next hall: hallWait, and the hall is raised by hand one level at a time', sim => {
  town(sim); sim.state.run.pop = 20; sim.advance(120);
  const run = sim.state.run, cost = sim.upgradeCost(run.tiles[sim.HALL_KEY]);
  for (const r in run.res) run.res[r] = 1e12; sim.setState(sim.state);
  assert.strictEqual(sim.hallWait(), 0, 'affordable now');
  for (const id of sim.BUILD_ORDER) if (sim.count(id)) sim.upgradeKind(id);
  assert.strictEqual(sim.hallLevel(), 1, 'no building upgrade touches the hall');
  sim.creditAway(8 * 3600); assert.strictEqual(sim.hallLevel(), 1, 'nor does time away');
  for (const r in cost) run.res[r] = 0; run.res.food = 1e6; sim.setState(sim.state);
  const w = sim.hallWait(); assert.ok(w > 60 && isFinite(w), 'far off: ' + w);
  near(w, Math.max(...Object.keys(cost).map(r => cost[r] / sim.calc.base[r])), 1, 'the slowest material sets the wait');
  for (const r in run.res) run.res[r] = 1e30; assert.ok(sim.upgrade(sim.HALL_KEY).ok); assert.strictEqual(sim.hallLevel(), 2, 'one level per purchase');
  run.tiles[sim.HALL_KEY].level = sim.HALL_MAX; assert.strictEqual(sim.hallWait(), null, 'no next hall: no wait at all');
});

test('past the Palace: two named halls that open with Crowns held, at HALL_GROWTH (4) times the last price each, and none after them', sim => {
  assert.strictEqual(sim.HALL_MAX, 7); assert.strictEqual(sim.HALL_GROWTH, 4); assert.deepStrictEqual(plain(sim.HALL_CROWNS), { 6: 30, 7: 75 });
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 7].map(sim.hallName), ['Village Hall', 'Manor', 'Keep', 'Castle', 'Palace', 'Royal Palace', 'Imperial Palace']);
  for (let l = 1; l <= sim.MAX_LEVEL; l++) assert.ok(!/\+/.test(sim.hallName(l)), 'no "+N" hall names: ' + sim.hallName(l));
  field(sim); const run = sim.state.run, hall = run.tiles[sim.HALL_KEY], meta = sim.state.meta;
  // the cost ladder: the Palace's price times 4, then times 4 again
  const at = l => { hall.level = l; return plain(sim.upgradeCost(hall)); };
  const castle = at(4), palace = at(5), royal = at(6);
  for (const r in castle) { assert.strictEqual(palace[r], castle[r] * 4, 'Royal Palace ' + r); assert.strictEqual(royal[r], castle[r] * 16, 'Imperial Palace ' + r); }
  // Crowns held open them, not Crowns on offer
  hall.level = 5; run.gold = sim.goldForCrowns(80, 0) * 2; meta.crowns = 29; sim.setState(sim.state);
  assert.ok(sim.pendingCrowns() >= 80, 'plenty on offer');
  assert.deepStrictEqual(plain(sim.hallLocked()), { level: 6, need: 30 }); assert.strictEqual(sim.nextHallOpen(), false);
  assert.strictEqual(sim.hallWait(), null, 'a locked hall is no next hall: no wait, no Infinity');
  const gold0 = run.res.gold, no = sim.upgrade(sim.HALL_KEY);
  assert.strictEqual(no.ok, false); assert.strictEqual(no.msg, 'A Royal Palace needs 30 Crowns held. You hold 29.'); assert.strictEqual(sim.hallLevel(), 5); assert.strictEqual(run.res.gold, gold0, 'and nothing is paid');
  meta.crowns = 30; sim.setState(sim.state);
  assert.strictEqual(sim.hallLocked(), null); assert.strictEqual(sim.hallWait(), 0);
  const yes = sim.upgrade(sim.HALL_KEY); assert.ok(yes.ok && sim.hallLevel() === 6 && yes.msg === 'Your seat is now a Royal Palace!', JSON.stringify(yes));
  assert.strictEqual(run.res.gold, gold0 - palace.gold, 'at the Royal Palace price');
  meta.crowns = 74; assert.deepStrictEqual(plain(sim.hallLocked()), { level: 7, need: 75 });
  assert.strictEqual(sim.upgrade(sim.HALL_KEY).msg, 'An Imperial Palace needs 75 Crowns held. You hold 74.'); assert.strictEqual(sim.hallLevel(), 6);
  meta.crowns = 75; assert.ok(sim.upgrade(sim.HALL_KEY).ok); assert.strictEqual(sim.hallLevel(), 7);
  // the cap
  meta.crowns = 1000; sim.setState(sim.state);
  assert.ok(sim.hallCapped() && sim.hallLocked() === null && !sim.nextHallOpen() && sim.hallWait() === null && sim.hallUnlockAhead() === null);
  const cap = sim.upgrade(sim.HALL_KEY); assert.ok(!cap.ok && cap.msg === 'The Imperial Palace is the grandest hall there is.' && sim.hallLevel() === 7, JSON.stringify(cap));
  // the halls give what a hall level gives, nothing else changes
  sim.setState(sim.state); assert.strictEqual(sim.calc.mult, (1 + sim.HALL_BONUS * 6) * sim.crownMult(1000));
  assert.strictEqual(sim.TILE_KINDS.hall.housing(hall), sim.HALL_HOUSING * 7); assert.strictEqual(sim.PRESTIGE_HALL, 4);
  // the first hall the Crowns held do not open, whatever the hall stands at
  for (const [c, want] of [[0, { level: 6, need: 30 }], [30, { level: 7, need: 75 }], [75, null]]) { meta.crowns = c; hall.level = 2; assert.deepStrictEqual(plain(sim.hallUnlockAhead()), want, c + ' Crowns held'); }
  // every reign still starts at a Village Hall
  meta.crowns = 100; assert.strictEqual(sim.newRun(5, 100).tiles[sim.HALL_KEY].level, 1);
});

test('saves: a hall is kept up to the last one, whatever the Crowns held, and clamped to the last above it', sim => {
  const load = (level, crowns) => { const s = sim.newState(0); s.run = sim.newRun(77); s.run.tiles[sim.HALL_KEY].level = level; s.meta.crowns = crowns; return sim.sanitizeSave(plain(s), 1000).state; };
  assert.strictEqual(load(6, 0).run.tiles['5,5'].level, 6, 'a Royal Palace with no Crowns held is not taken away');
  assert.strictEqual(load(7, 31).run.tiles['5,5'].level, 7, 'nor an Imperial Palace with too few');
  for (const lv of [8, 9, 60, 1e9]) assert.strictEqual(load(lv, 500).run.tiles['5,5'].level, 7, 'level ' + lv + ' becomes the Imperial Palace');
  assert.strictEqual(load(5, 0).run.tiles['5,5'].level, 5);
  const s = load(6, 0); sim.setState(s); assert.deepStrictEqual(plain(sim.hallLocked()), { level: 7, need: 75 }); assert.strictEqual(sim.hallWait(), null);
  assert.strictEqual(s.v, sim.SAVE_VERSION);
});

test('version-3 saves migrate: each kind takes the lowest level among its buildings, tiles lose theirs', sim => {
  const v3 = { v: 3, last: 900, meta: { crowns: 2, decree: 'roof', decreesDone: { timber: 1 } },
    run: { seed: 12345, gen: 2, exp: 1, res: { gold: 50, food: 5, wood: 5, stone: 5, iron: 0 }, pop: 10,
      tiles: { '5,5': { kind: 'hall', id: 'hall', level: 3 }, '5,4': { kind: 'building', id: 'farm', level: 2 }, '4,5': { kind: 'building', id: 'farm', level: 5 },
        '6,5': { kind: 'building', id: 'farm', level: 3 }, '5,6': { kind: 'building', id: 'quarry', level: 4 }, '4,4': { kind: 'building', id: 'cottage', level: 1 } } } };
  const { state: s, notes } = sim.sanitizeSave(v3, 1000);
  assert.strictEqual(s.v, sim.SAVE_VERSION); assert.strictEqual(s.run.tiles['5,5'].level, 3, 'the hall keeps its level');
  assert.deepStrictEqual(plain(s.run.levels), Object.assign(Object.fromEntries(sim.BUILD_ORDER.map(id => [id, 1])), { farm: 2, quarry: 4 }), 'farms at 2, 5 and 3 become farms at 2: nothing is upgraded for free');
  for (const k of ['5,4', '4,5', '6,5', '5,6', '4,4']) assert.strictEqual(s.run.tiles[k].level, undefined, k + ' has no level of its own');
  assert.ok(notes.some(n => /level of the lowest/.test(n)), 'farms at different levels: the player is told ' + notes.join('|'));
  const even = JSON.parse(JSON.stringify(v3)); even.run.tiles['5,4'].level = even.run.tiles['6,5'].level = 5;
  assert.strictEqual(sim.sanitizeSave(even, 1000).notes.length, 0, 'nothing to say when no level changed');
  sim.setState(s); assert.strictEqual(sim.count('farm'), 3); near(sim.calc.tiles['5,4'].levelMult, 2, 1e-9, 'every farm works at level 2:');
  const back = sim.sanitizeSave(JSON.parse(sim.serialize()), 1000); assert.strictEqual(JSON.stringify(back.state), sim.serialize(), 'and round-trips as the current version'); assert.strictEqual(back.notes.length, 0);
});

test('saves from before the trades had jobs say once what changed; new games never do', sim => {
  const v4 = { v: 4, last: 900, meta: { crowns: 0 }, run: { seed: 12345, gen: 2, exp: 1, res: { gold: 50, food: 5, wood: 5, stone: 5, iron: 0 }, pop: 10, levels: { guild: 2 },
    tiles: { '5,5': { kind: 'hall', id: 'hall', level: 4 }, '5,4': { kind: 'building', id: 'farm' }, '6,6': { kind: 'building', id: 'guild' } } } };
  const jobs = n => /Markets now sell spare food/.test(n) && /Blacksmiths work the iron your Mines make/.test(n) && /Guildhalls no longer make gold/.test(n) && /move a Guildhall or add Farms/.test(n);
  const out = sim.sanitizeSave(v4, 1000);
  assert.strictEqual(out.state.v, 5); assert.strictEqual(out.notes.filter(jobs).length, 1, 'a version-4 town with a Guildhall is told, once: ' + out.notes.join('|'));
  assert.strictEqual(out.state.run.levels.guild, 2, 'its levels are kept');
  for (const id of ['market', 'smith']) { const o = JSON.parse(JSON.stringify(v4)); o.run.tiles['6,6'].id = id; assert.ok(sim.sanitizeSave(o, 1000).notes.some(jobs), 'and one with a ' + id); }
  const noTrade = JSON.parse(JSON.stringify(v4)); delete noTrade.run.tiles['6,6'];
  assert.strictEqual(sim.sanitizeSave(noTrade, 1000).notes.length, 0, 'a town with no Market, Blacksmith or Guildhall has nothing to be told');
  sim.setState(out.state); const again = sim.sanitizeSave(JSON.parse(sim.serialize()), 1000);
  assert.strictEqual(again.notes.length, 0, 'saved again, it loads as version 5 without the note');
  sim.startNewGame(0); assert.strictEqual(sim.sanitizeSave(JSON.parse(sim.serialize()), 1000).notes.length, 0, 'a fresh game never shows it');
  const s = town(sim, 4); for (const id of ['market', 'guild']) assert.ok(sim.build(s.shift(), id).ok, 'build ' + id);
  assert.strictEqual(sim.sanitizeSave(JSON.parse(sim.serialize()), 1000).notes.length, 0, 'nor does a new town with a Market and a Guildhall');
});

// ── Terrain ──
// A direct count, written apart from sim.js: same-terrain neighbours of each open plot inside radius r.
function recount(g, r) {
  const M = 5, inR = (x, y) => Math.abs(x - M) <= r && Math.abs(y - M) <= r, o = { open: 0, k: {} };
  for (let x = M - r; x <= M + r; x++) for (let y = M - r; y <= M + r; y++) {
    if (g[x][y] !== 'plain' || (x === M && y === M)) continue;
    o.open++;
    for (const t of ['forest', 'hill', 'water']) o.k[x + ',' + y + ',' + t] = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].filter(([a, b]) => inR(a, b) && g[a][b] === t).length;
  }
  o.dbl = Object.values(o.k).filter(k => k >= 2).length; o.tri = Object.values(o.k).filter(k => k >= 3).length;
  return o;
}

// Every guarantee for one seed: returns the broken ones (empty when all hold), the grid and its site counts.
function terrainCheck(sim, seed) {
  const R = sim.MAP_RADIUS, g = sim.genTerrain(seed), attempts = sim.terrainAttempts, c = R.map(r => recount(g, r)), why = [];
  assert.ok(g.length === 11 && g.every(col => col.length === 11 && col.every(t => t in sim.TERRAIN)), 'the grid format is unchanged');
  for (const [x, y] of [[5, 5], [4, 5], [6, 5], [5, 4], [5, 6]]) if (g[x][y] !== 'plain') why.push('hall or a neighbour not open');
  for (const t in sim.BIOME_START) { let n = 0; for (let x = 3; x <= 7; x++) for (let y = 3; y <= 7; y++) if (g[x][y] === t) n++; if (n < sim.BIOME_START[t]) why.push(`start area has ${n} ${t}`); }
  if (!Object.keys(c[0].k).some(k => k.endsWith('forest') && c[0].k[k] >= 2)) why.push('no double forest site at the start');
  if (c[0].open < 12) why.push('start area has ' + c[0].open + ' plots');
  { const a = recount(g, sim.BIOME_ALL_DOUBLE); for (const t of ['forest', 'hill', 'water']) if (!Object.keys(a.k).some(k => k.endsWith(t) && a.k[k] >= 2)) why.push(`no double ${t} site within radius ${sim.BIOME_ALL_DOUBLE}`); }
  for (let e = 1; e < R.length; e++) {
    if (c[e].tri - c[e - 1].tri < 1) why.push(`expansion ${e} adds ${c[e].tri - c[e - 1].tri} triple sites`);
    if (c[e].dbl - c[e - 1].dbl < 3) why.push(`expansion ${e} adds ${c[e].dbl - c[e - 1].dbl} double sites`);
  }
  for (const t of ['forest', 'hill', 'water']) if (!Object.keys(c[3].k).some(k => k.endsWith(t) && c[3].k[k] >= 3)) why.push('no triple ' + t + ' site on the full map');
  // Water in orthogonal groups of two or more; a group in the start area counts only its tiles inside the start area.
  const start = (x, y) => Math.abs(x - 5) <= 2 && Math.abs(y - 5) <= 2;
  for (let x = 0; x < 11; x++) for (let y = 0; y < 11; y++) if (g[x][y] === 'water' &&
    ![[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].some(([a, b]) => a >= 0 && b >= 0 && a < 11 && b < 11 && g[a][b] === 'water' && (!start(x, y) || start(a, b)))) why.push(`water at ${x},${y} has no water beside it${start(x, y) ? ' in the start area' : ''}`);
  if (attempts > 8) why.push(attempts + ' maps drawn');
  return { why, g, c, attempts };
}

test('terrain comes in features with guaranteed sites, water in orthogonal groups, few redraws (seeds 1 to 300, negative and large seeds)', sim => {
  const R = sim.MAP_RADIUS, N = 300, open = R.map(() => 0), tiles = { forest: 0, hill: 0, water: 0 }, bad = []; let most = 0;
  for (let seed = 1; seed <= N; seed++) {
    const { why, g, c, attempts } = terrainCheck(sim, seed); most = Math.max(most, attempts);
    R.forEach((r, i) => { open[i] += c[i].open; });
    for (const col of g) for (const t of col) if (t !== 'plain') tiles[t]++;
    if (why.length) bad.push(seed + ': ' + why.join(', '));
  }
  for (const seed of [-1, -2, -77, -12345, -(2 ** 31), 2 ** 31 - 1, 2 ** 31 - 2, 2147000000, 1e9, 123456789]) { const { why, attempts } = terrainCheck(sim, seed); most = Math.max(most, attempts); if (why.length) bad.push(seed + ': ' + why.join(', ')); }
  assert.deepStrictEqual(bad, [], 'every seed meets every guarantee');
  assert.ok(most >= 1 && most <= 8, 'the repair pass fixes nearly every first draw: at most ' + most + ' maps drawn');
  [15, 32, 55, 83].forEach((was, i) => near(open[i] / N, was, was * 0.1, `open plots at radius ${R[i]} stay near the old average;`));
  const share = (tiles.forest + tiles.hill + tiles.water) / N / 121;
  assert.strictEqual(sim.BIOME_ALL_DOUBLE, 3, 'every terrain has a double site once the first expansion is open');
  assert.ok(share >= 0.25 && share <= 0.32, 'terrain share ' + share.toFixed(3)); assert.ok(tiles.forest > tiles.hill && tiles.hill > tiles.water, JSON.stringify(tiles));
});

test('terrain is deterministic per seed; version-1 saves keep the old generator', sim => {
  for (const seed of [1, 11, 12345, -7, 2 ** 31 - 1]) {
    assert.deepStrictEqual(plain(sim.genTerrain(seed)), plain(sim.genTerrain(seed)), 'seed ' + seed);
    assert.deepStrictEqual(plain(sim.newRun(seed).terrain), plain(sim.genTerrain(seed)));
  }
  assert.notDeepStrictEqual(plain(sim.genTerrain(1)), plain(sim.genTerrain(2)));
  // genTerrainLegacy is the generator of save versions 1 to 3 before biomes, byte for byte (its map for seed 12345)
  assert.strictEqual(sim.genTerrainLegacy(12345).map(c => c.map(t => t[0]).join('')).join('/'),
    'ppppppfpppp/ppppwpppppp/pppfphpfwfp/pphfppfpppf/pppppwwpppf/ppphfpppppf/pppppfphphp/pwpppphpppf/ppppppppppw/wpphfpwpwpp/pppphfpfppp');
  const s = sim.newState(0); s.run = sim.newRun(99); s.run.terrain[0][0] = 'water'; s.run.terrain[0][1] = 'plain';
  assert.deepStrictEqual(plain(sim.sanitizeSave(plain(s), 1000).state.run.terrain), plain(s.run.terrain), 'a saved grid is kept as it is, whichever generator made it');
});

test('a missing grid is regrown by the generator that made the map (run.gen)', sim => {
  const run = sim.newRun(4242); assert.strictEqual(run.gen, 2, 'new maps are marked as features (gen 2)'); assert.strictEqual(sim.SAVE_VERSION, 5);
  const s = sim.newState(0); s.run = run; const raw = plain(s); delete raw.run.terrain;
  let got = sim.sanitizeSave(raw, 1000).state.run; assert.strictEqual(got.gen, 2); assert.deepStrictEqual(plain(got.terrain), plain(sim.genTerrain(4242)), 'gen 2: genTerrain');
  raw.run.terrain = [['<img>']]; assert.deepStrictEqual(plain(sim.sanitizeSave(raw, 1000).state.run.terrain), plain(sim.genTerrain(4242)), 'an invalid grid too');
  for (const gen of [undefined, 1, 'x', -3]) { if (gen === undefined) delete raw.run.gen; else raw.run.gen = gen;
    got = sim.sanitizeSave(raw, 1000).state.run; assert.strictEqual(got.gen, 1, 'gen ' + gen + ' reads as the old generator'); assert.deepStrictEqual(plain(got.terrain), plain(sim.genTerrainLegacy(4242)), 'gen ' + gen + ': genTerrainLegacy'); }
  raw.run.gen = 99; assert.strictEqual(sim.sanitizeSave(raw, 1000).state.run.gen, 2, 'clamped to a known generator');
  const back = sim.sanitizeSave(JSON.parse(JSON.stringify(s)), 1000).state; assert.strictEqual(back.run.gen, 2, 'kept through a save');
});

// ── The trades: Markets sell spare food, Blacksmiths work iron, Guildhalls boost (see data.js, TRADES) ──
// A plain field with the given buildings at the given plots, enough people for every job, and a store of food.
function trades(sim, layout, food) {
  const free = field(sim), run = sim.state.run; run.res.food = food === undefined ? 1e15 : food; run.res.iron = 0;
  for (const [k, id] of layout) run.tiles[k] = { kind: 'building', id };
  sim.setState(sim.state); run.pop = sim.calc.need + 1; sim.setState(sim.state);
  return free;
}
const finite = c => ['gold', 'food', 'wood', 'stone', 'iron'].every(r => Number.isFinite(c.base[r]) && Number.isFinite(c.rates[r])) && [c.fill, c.smithRun, c.foodSold, c.ironUsed, c.surplus].every(Number.isFinite);

test('Markets: fill = food sold / food wanted, gold = full rate × (base + (1 - base) × fill), and sold food leaves the food income', sim => {
  trades(sim, [['0,0', 'market'], ['2,0', 'farm']]);
  let c = sim.calc; const k = '0,0', full = c.tiles[k].full, wanted = c.foodWanted;
  assert.ok(wanted > 0 && c.surplus > 0 && c.surplus < wanted, 'one Farm cannot supply a Market: surplus ' + c.surplus + ' of ' + wanted);
  near(c.fill, c.surplus / wanted, 1e-9, 'fill'); near(c.foodSold, c.surplus, 1e-9, 'all the spare food is sold');
  near(c.tiles[k].out.gold, full * (sim.MARKET_BASE + (1 - sim.MARKET_BASE) * c.fill), 1e-9, 'Market gold');
  near(c.base.food, c.foodMade - c.eaten - c.foodSold, 1e-9, 'food income is net of sales'); near(c.base.food, 0, 1e-9, 'so it is nil while the Market is short');
  // Plenty of farms: the Market is full and the rest piles up.
  for (let i = 0; i < 40; i++) sim.state.run.tiles[(i % 10) + ',' + (4 + Math.floor(i / 10))] = { kind: 'building', id: 'farm' };
  sim.state.run.pop = 1e4; sim.setState(sim.state); sim.state.run.pop = sim.calc.need; sim.setState(sim.state); c = sim.calc;
  if (c.surplus > c.foodWanted) { assert.strictEqual(c.fill, 1); near(c.tiles[k].out.gold, c.tiles[k].full, 1e-9); assert.ok(c.base.food > 0, 'food beyond the Markets is stored'); }
});

test('Markets sell only while the store holds MARKET_RESERVE_SECONDS of upkeep; below it they earn the base rate', sim => {
  trades(sim, [['0,0', 'market'], ['2,0', 'farm'], ['4,0', 'farm']], 0);
  let c = sim.calc; assert.ok(!c.stocked && c.foodSold === 0 && c.fill === 0, 'an empty store sells nothing');
  near(c.tiles['0,0'].out.gold, c.tiles['0,0'].full * sim.MARKET_BASE, 1e-9, 'base rate'); assert.ok(c.base.food > 0, 'the store fills first');
  sim.state.run.res.food = c.eaten * sim.MARKET_RESERVE_SECONDS * 1.01; sim.setState(sim.state); c = sim.calc;
  assert.ok(c.stocked && c.foodSold > 0, 'past the reserve the Market sells');
  assert.ok(sim.compute({ stocked: true }).foodSold > 0 && sim.MARKET_RESERVE_SECONDS >= sim.FOOD_RESERVE_SECONDS, 'the Market reserve is at least the one villagers move in on');
});

test('Markets never starve a town: random towns, long absences, the store never runs dry because of them', sim => {
  const rnd = sim.mulberry(7), ids = ['cottage', 'farm', 'market', 'market', 'mill', 'smith', 'mine', 'guild', 'tavern'];
  for (let n = 0; n < 25; n++) {
    const free = field(sim), run = sim.state.run; run.res = { gold: 0, food: 50 + rnd() * 5000, wood: 0, stone: 0, iron: 0 };
    for (let i = 0; i < 30; i++) run.tiles[free[(rnd() * free.length) | 0]] = { kind: 'building', id: ids[(rnd() * ids.length) | 0] };
    for (const id of sim.BUILD_ORDER) run.levels[id] = 1 + ((rnd() * 4) | 0);
    sim.setState(sim.state); run.pop = Math.min(sim.calc.cap, 5 + rnd() * 300); sim.setState(sim.state);
    const feeds = sim.calc.foodMade >= sim.calc.eaten; // the farms alone feed the town as it stands
    for (let h = 0; h < 6; h++) { sim.creditAway(4 * 3600 + rnd() * 20 * 3600); sim.setState(sim.state);
      assert.ok(finite(sim.calc), 'finite numbers'); assert.ok(sim.calc.foodSold <= Math.max(0, sim.calc.foodMade - sim.calc.eaten) + 1e-9, 'Markets sell only the surplus');
      if (feeds) assert.ok(!run.starving, 'town ' + n + ' starves'); }
  }
});

test('population grows exactly as it would without Markets (growth reads food made before they sell)', sim => {
  const grow = markets => { const free = trades(sim, [['0,0', 'farm'], ['2,0', 'farm'], ['4,0', 'mill'], ['6,0', 'farm']].concat(markets ? [['0,2', 'market'], ['2,2', 'market']] : []), 500);
    const run = sim.state.run; for (let i = 0; i < 8; i++) run.tiles[free[40 + i]] = { kind: 'building', id: 'cottage' }; run.levels.cottage = 3; run.pop = 5; sim.setState(sim.state);
    const pops = []; for (let i = 0; i < 12; i++) { sim.advance(600); pops.push(+run.pop.toFixed(6)); } sim.creditAway(10 * 3600); pops.push(+run.pop.toFixed(6)); return { pops, starving: run.starving }; };
  const a = grow(false), b = grow(true);
  assert.deepStrictEqual(b.pops, a.pops, 'population with Markets ' + b.pops.join(',') + ' against ' + a.pops.join(',')); assert.ok(!a.starving && !b.starving);
});

test('Blacksmiths: run = min(1, SMITH_SHARE × iron made / iron wanted), no base rate, iron income is net of the forges', sim => {
  trades(sim, [['0,0', 'smith'], ['3,0', 'mine']]);
  let c = sim.calc; const k = '0,0';
  near(c.smithRun, Math.min(1, sim.SMITH_SHARE * c.ironMade / c.ironWanted), 1e-9, 'run'); assert.ok(c.smithRun < 1, 'one Mine cannot run a Blacksmith at full');
  near(c.tiles[k].out.gold, c.tiles[k].full * c.smithRun, 1e-9, 'gold'); near(c.ironUsed, sim.SMITH_SHARE * c.ironMade, 1e-9, 'the forges take their share of the income');
  near(c.base.iron, c.ironMade - c.ironUsed, 1e-9, 'iron income is net'); assert.ok(c.base.iron >= (1 - sim.SMITH_SHARE) * c.ironMade - 1e-9);
  delete sim.state.run.tiles['3,0']; sim.setState(sim.state); c = sim.calc;
  assert.strictEqual(c.smithRun, 0); assert.strictEqual(c.tiles[k].out.gold, 0); assert.strictEqual(c.base.iron, 0, 'no Mine: no gold, and the forge never draws on the stock');
  for (let i = 0; i < 11; i++) sim.state.run.tiles[i + ',8'] = { kind: 'building', id: 'mine' };
  sim.state.run.pop = 1e4; sim.setState(sim.state); sim.state.run.pop = sim.calc.need; sim.setState(sim.state); c = sim.calc;
  assert.strictEqual(c.smithRun, 1, 'plenty of Mines: full run'); near(c.ironUsed, c.ironWanted, 1e-9);
});

test('the iron stock never falls because of the forges, open or away, even while starving', sim => {
  trades(sim, [['0,0', 'smith'], ['2,0', 'smith'], ['4,0', 'smith'], ['6,0', 'mine']], 0);
  const run = sim.state.run; run.res.iron = 1000;
  let last = run.res.iron;
  for (let i = 0; i < 40; i++) { sim.advance(30); assert.ok(run.res.iron >= last - 1e-9, 'iron fell'); last = run.res.iron; }
  run.starving = true; sim.setState(sim.state); assert.ok(sim.calc.rates.iron >= 0, 'starving: the live iron income is still not negative');
  sim.creditAway(20 * 3600); assert.ok(run.res.iron >= last, 'away');
});

test('the Guildhall makes nothing itself and boosts each Market and Blacksmith beside it by its adjacency × √level', sim => {
  assert.ok(!sim.BUILDINGS.guild.out, 'no output of its own');
  trades(sim, [['1,1', 'guild'], ['0,1', 'market'], ['1,0', 'smith'], ['3,1', 'market']]);
  const c = sim.calc; assert.strictEqual(c.tiles['1,1'].out.gold, undefined); assert.strictEqual(c.tiles['1,1'].mult, 0);
  near(c.tiles['0,1'].adj, sim.BUILDINGS.market.adj.building.guild, 1e-9, 'Market beside it'); near(c.tiles['1,0'].adj, sim.BUILDINGS.smith.adj.building.guild, 1e-9, 'Blacksmith beside it');
  assert.strictEqual(c.tiles['3,1'].adj, 0, 'a Market two plots away gets nothing');
  sim.state.run.levels.guild = 4; sim.setState(sim.state); near(sim.calc.tiles['0,1'].adj, 2 * sim.BUILDINGS.market.adj.building.guild, 1e-9, '√4 = 2');
  // The boost raises the price, not what the trade takes in: food wanted is the same with or without it.
  sim.state.run.pop = 1e6; sim.setState(sim.state); const w = sim.calc.foodWanted; delete sim.state.run.tiles['1,1']; sim.setState(sim.state); near(sim.calc.foodWanted, w, 1e-9, 'demand');
});

test('edge cases: no Markets, no Blacksmiths, no Mines, no Farms beyond need: finite numbers and the old rules', sim => {
  for (const layout of [[], [['0,0', 'farm']], [['0,0', 'market']], [['0,0', 'smith']], [['0,0', 'guild']], [['0,0', 'mine'], ['2,0', 'farm']]]) {
    for (const food of [0, 1e9]) { trades(sim, layout, food); const c = sim.calc;
      assert.ok(finite(c), JSON.stringify(layout) + ' food ' + food);
      if (!layout.some(l => l[1] === 'market')) { assert.strictEqual(c.foodSold, 0); near(c.base.food, c.foodMade - c.eaten, 1e-9); }
      if (!layout.some(l => l[1] === 'smith')) { assert.strictEqual(c.ironUsed, 0); near(c.base.iron, c.ironMade, 1e-9); }
      sim.advance(60); sim.creditAway(3600); assert.ok(finite(sim.compute()), 'after time passes'); }
  }
  // A town whose farms make exactly its upkeep: no surplus, the Market earns its base rate and nobody goes hungry for it.
  trades(sim, [['0,0', 'market'], ['2,0', 'farm']]); const run = sim.state.run; run.pop = sim.sustainablePop(1, 1e4, sim.calc.foodMade); sim.setState(sim.state);
  assert.ok(sim.calc.foodSold <= 1e-6 && !run.starving);
});

test('previews: afterBuild of a Farm next to a short Market shows gold, and leaves the town as it was', sim => {
  trades(sim, [['0,0', 'market'], ['2,0', 'farm']]);
  const before = JSON.stringify(plain(sim.state.run.tiles)), c0 = sim.compute({ stocked: true }), after = sim.afterBuild('farm');
  assert.ok(after.base.gold > c0.base.gold, 'a Farm brings gold through the Market'); assert.strictEqual(JSON.stringify(plain(sim.state.run.tiles)), before);
  const smith = sim.afterBuild('smith'); assert.ok(smith.base.gold === c0.base.gold || smith.smithRun === 0, 'a Blacksmith with no Mine adds no gold');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
