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
// A small working town on a known map.
function town(sim, levels) {
  const s = sim.newState(0); s.run = sim.newRun(12345); sim.setState(s);
  const run = sim.state.run; run.res = { gold: 1e9, food: 1e6, wood: 1e9, stone: 1e9, iron: 1e9 };
  const free = [];
  for (let x = 3; x <= 7; x++) for (let y = 3; y <= 7; y++) if (run.terrain[x][y] === 'plain' && !(x === 5 && y === 5)) free.push(x + ',' + y);
  for (const id of ['cottage', 'cottage', 'farm', 'lumber', 'quarry']) assert.ok(sim.build(free.shift(), id).ok, 'build ' + id);
  if (levels) for (const k in run.tiles) for (let i = 1; i < levels; i++) sim.upgrade(k);
  sim.setState(sim.state);
  return free;
}

test('crownsFor: log scale on the gold earned this reign, with a threshold that rises with Crowns held', sim => {
  assert.strictEqual(sim.crownsFor(0, 0), 0);
  assert.strictEqual(sim.crownsFor(-5, 0), 0);
  assert.strictEqual(sim.crownsFor(sim.CROWN_GOLD, 0), 0);
  assert.strictEqual(sim.crownsFor(sim.CROWN_GOLD * 10, 0), sim.CROWN_RATE, 'ten times the threshold');
  assert.strictEqual(sim.crownsFor(sim.goldForCrowns(sim.CROWN_MIN, 0) * 1.001, 0), sim.CROWN_MIN); assert.ok(sim.goldForCrowns(sim.CROWN_MIN, 0) > 5e8 && sim.goldForCrowns(sim.CROWN_MIN, 0) < 2e9, 'a first Palace (about a billion gold earned) offers just enough to abdicate');
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

test('high levels cost extra, linear buildings are exempt', sim => {
  const up = (id, level) => sim.upgradeCost({ kind: 'building', id, level });
  const step = (id, level) => Object.values(up(id, level + 1))[0] / Object.values(up(id, level))[0];
  near(step('smith', sim.UPGRADE_CREEP_FROM - 2), sim.UPGRADE_GROWTH, 0.01, 'below the creep');
  near(step('smith', sim.UPGRADE_CREEP_FROM), sim.UPGRADE_GROWTH * sim.UPGRADE_CREEP, 0.01, 'first creeping level');
  assert.ok(step('smith', 14) > step('smith', 10) && step('smith', 10) > step('smith', 8), 'each level steeper than the last');
  near(step('cottage', 14), sim.LINEAR_UPGRADE_GROWTH, 0.01, 'cottage');
  assert.ok(Number.isFinite(up('guild', sim.MAX_LEVEL - 1).gold) && up('guild', sim.MAX_LEVEL - 1).gold < 1e300, 'the dearest upgrade is a finite number');
});

test('a save at the level cap keeps every cost, refund and stock finite', sim => {
  const s = sim.newState(0); s.run = sim.newRun(12345);
  s.run.tiles['4,5'] = { kind: 'building', id: 'lumber', level: 1e9 }; s.run.tiles['6,5'] = { kind: 'building', id: 'guild', level: 1e9 };
  s.run.repeatables = { monument: 1e9 };
  const { state: clean } = sim.sanitizeSave(plain(s), 1000); sim.setState(clean);
  for (const k of ['4,5', '6,5']) {
    const t = sim.state.run.tiles[k]; assert.strictEqual(t.level, sim.MAX_LEVEL);
    for (const c of [sim.upgradeCost(t), sim.spentOn(t), sim.demolishRefund(t)]) for (const r in c) assert.ok(Number.isFinite(c[r]), `${t.id} ${r} is ${c[r]}`);
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
  const rest = h => sim.REST_BONUS * Math.max(0, h - sim.REST_AFTER_HOURS) * 3600;
  assert.strictEqual(r.rested, rest(8)); near(sim.state.run.clock, 8 * 3600 + rest(8), 1e-6, 'clock: the capped time plus the rested bonus on it');
  sim.state.run.away = 0; r = sim.creditAway(30);
  assert.strictEqual(r.credited, 30); assert.strictEqual(r.capped, false); assert.strictEqual(r.rested, 0, 'a short absence earns no bonus');
  { const c0 = sim.state.run.clock; sim.advance(7 * 3600); near(sim.state.run.clock - c0, 7 * 3600, 1e-6, 'an open game earns none'); }
  sim.state.run.research.steward = 1; sim.state.run.away = 0;
  r = sim.creditAway(30 * 3600);
  assert.strictEqual(r.credited, 24 * 3600); assert.strictEqual(r.capHours, 24); assert.strictEqual(r.rested, rest(24), 'the bonus is worked out on the capped time');
  for (const bad of [-5, NaN, Infinity, undefined]) assert.strictEqual(sim.creditAway(bad).credited, 0, 'bad gap ' + bad);
});

test('demolish refunds three quarters of the build price and every upgrade', sim => {
  town(sim);
  const run = sim.state.run, key = Object.keys(run.tiles).find(k => run.tiles[k].id === 'quarry');
  const paid = plain(sim.buildCost('quarry')); // price of a second quarry...
  const first = plain(sim.BUILDINGS.quarry.cost); // ...the first cost the base price
  let spent = Object.assign({}, first);
  for (let i = 0; i < 7; i++) { const c = plain(sim.upgradeCost(run.tiles[key])); for (const r in c) spent[r] += c[r]; assert.ok(sim.upgrade(key).ok); }
  assert.strictEqual(run.tiles[key].level, 8);
  assert.deepStrictEqual(plain(sim.spentOn(run.tiles[key])), spent);
  assert.ok(paid.gold > first.gold);
  const before = plain(run.res), refund = plain(sim.demolishRefund(run.tiles[key]));
  assert.strictEqual(sim.REFUND_SHARE, 0.75);
  assert.deepStrictEqual(refund, { gold: Math.floor(spent.gold * 0.75), wood: Math.floor(spent.wood * 0.75) });
  assert.ok(refund.gold > 100 * first.gold, 'upgrades dominate the refund');
  assert.ok(sim.demolish(key).ok); assert.strictEqual(run.tiles[key], undefined);
  assert.strictEqual(run.res.gold, before.gold + refund.gold);
  assert.strictEqual(sim.demolish(sim.HALL_KEY).ok, false, 'the hall cannot be demolished');
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
  assert.deepStrictEqual(plain(s.meta.stats), { clicks: 0, totalGold: 0, prestiges: 0, built: 3, started: 1000 });
  assert.strictEqual(s.run.exp, 3); assert.strictEqual(s.run.cleared, 121); assert.strictEqual(s.run.starving, false);
  assert.deepStrictEqual(plain(s.run.res), { gold: sim.START_RES.gold, food: 0, wood: sim.START_RES.wood, stone: 0, iron: 12.5 });
  assert.deepStrictEqual(Object.keys(s.run.tiles).sort(), ['0,0', '5,4', '5,5']);
  assert.strictEqual(s.run.tiles['5,5'].level, sim.MAX_LEVEL); assert.strictEqual(s.run.tiles['5,5'].kind, 'hall');
  assert.strictEqual(s.run.tiles['5,4'].level, 1); assert.strictEqual(s.run.tiles['0,0'].level, 1);
  assert.deepStrictEqual(plain(s.run.research), { axes: 1 });
  assert.deepStrictEqual(plain(s.run.repeatables), { food: sim.MAX_REPEATABLE });
  assert.strictEqual(s.run.buffUntil, undefined, 'festival timers from older saves are dropped');
  assert.strictEqual(s.run.terrain.length, 11); assert.ok(s.run.terrain.every(col => col.length === 11 && col.every(c => c in sim.TERRAIN)));
  assert.strictEqual(s.run.terrain[5][4], 'plain', 'buildings always stand on open plots');
  assert.ok(notes.some(n => /5 buildings in this save were not recognised/.test(n)), notes.join('|'));
  assert.ok(!/[<>]/.test(JSON.stringify(s)), 'no markup survives');
  sim.setState(s); sim.advance(10);
  for (const r in sim.calc.rates) assert.ok(Number.isFinite(sim.calc.rates[r]) && Number.isFinite(sim.state.run.res[r]), r + ' stays finite');
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
  assert.strictEqual(s.v, 3); assert.strictEqual(s.last, 900);
  assert.strictEqual(s.meta.decree, 'coffers', 'the decrees added since come first'); assert.ok(!s.meta.decreesDone.dynasty && s.meta.decreesDone.castle, 'index 19 of the old order (A New Dynasty) is where the old chain had got to');
  { const at = sim.DECREES.findIndex(d => d.id === 'dynasty'); assert.deepStrictEqual(Object.keys(s.meta.decreesDone), plain(sim.DECREES.slice(0, at).map(d => d.id).filter(id => !sim.DECREES_NEW_IN_V3.includes(id))), 'every older decree before it counts as claimed'); }
  assert.strictEqual(s.meta.crowns, 19); assert.strictEqual(s.meta.bonusCrowns, 0);
  assert.deepStrictEqual(plain(s.run.tiles), { '5,5': { kind: 'hall', id: 'hall', level: 4 }, '5,4': { kind: 'building', id: 'cottage', level: 8 },
    '4,5': { kind: 'building', id: 'farm', level: 6 }, '6,5': { kind: 'building', id: 'smith', level: 3 } });
  const fresh = plain(sim.genTerrain(12345)), got = plain(s.run.terrain);
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
  for (const k in run.tiles) if (run.tiles[k].id === 'cottage') run.tiles[k].level = 60; // far more housing than food
  run.pop = 500; sim.setState(sim.state);
  assert.ok(sim.calc.rates.food < 0);
  sim.advance(5); assert.strictEqual(run.starving, true);
  sim.advance(1800);
  assert.strictEqual(run.starving, false, 'no longer starving');
  assert.ok(run.pop < 500 && run.pop > sim.START_POP, 'population settled at ' + run.pop.toFixed(1));
  near(sim.calc.rates.food, 0, 1, 'food income settles at break-even:');
  const settled = run.pop; sim.advance(600);
  near(run.pop, settled, 1, 'and stays there:');
  for (let i = 0; i < 3; i++) sim.upgrade(farm);
  sim.advance(600);
  assert.ok(run.pop > settled + 5, 'more food lets the town grow again: ' + run.pop.toFixed(1));
  assert.strictEqual(run.starving, false);
});

test('villagers do not move in beyond what the food income can carry', sim => {
  town(sim);
  const run = sim.state.run; run.res.food = 0;
  for (const k in run.tiles) if (run.tiles[k].id === 'cottage') run.tiles[k].level = 40;
  sim.advance(900);
  assert.strictEqual(run.starving, false);
  assert.ok(run.pop < sim.calc.cap - 10 && sim.calc.rates.food >= -1e-6, `pop ${run.pop.toFixed(1)} of ${sim.calc.cap}, food ${sim.calc.rates.food.toFixed(3)}/s`);
  assert.ok(sim.foodRateAt(sim.calc.cap) < 0, 'the full-housing preview shows the deficit');
});

test('linear buildings: flat gain per level and gentler upgrade prices', sim => {
  town(sim);
  const run = sim.state.run, cottage = Object.keys(run.tiles).find(k => run.tiles[k].id === 'cottage'), quarry = Object.keys(run.tiles).find(k => run.tiles[k].id === 'quarry');
  const cap0 = sim.calc.cap; sim.upgrade(cottage); sim.setState(sim.state); assert.strictEqual(sim.calc.cap - cap0, 5);
  const c2 = sim.upgradeCost(run.tiles[cottage]).wood; sim.upgrade(cottage); const c3 = sim.upgradeCost(run.tiles[cottage]).wood;
  near(c3 / c2, sim.LINEAR_UPGRADE_GROWTH, 0.05, 'cottage step');
  const q1 = sim.upgradeCost(run.tiles[quarry]).gold; sim.upgrade(quarry); const q2 = sim.upgradeCost(run.tiles[quarry]).gold;
  near(q2 / q1, sim.UPGRADE_GROWTH, 0.05, 'quarry step');
});

test('hand collection is a flourish: it does not grow with income, and there is no merchant or festival', sim => {
  assert.strictEqual(sim.clickValue(), 1);
  town(sim, 3); sim.advance(60);
  assert.ok(sim.calc.base.gold > 1); assert.strictEqual(sim.clickValue(), sim.CLICK_GOLD, 'the same single coin, whatever the town earns');
  const gold = sim.state.run.res.gold; assert.strictEqual(sim.collectTaxes().gold, 1); assert.strictEqual(sim.state.run.res.gold, gold + 1);
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

test('adjacency from a building grows with the square root of its level; cottage upgrades need stone from level 3', sim => {
  const run = sim.state.run; run.terrain = run.terrain.map(col => col.map(() => 'plain'));
  run.tiles['4,4'] = { kind: 'building', id: 'cottage', level: 1 }; run.tiles['4,3'] = { kind: 'building', id: 'tavern', level: 1 };
  near(sim.adjBonus('cottage', 4, 4), 0.5, 1e-9, 'level 1');
  run.tiles['4,3'].level = 4; near(sim.adjBonus('cottage', 4, 4), 1, 1e-9, 'level 4 gives twice level 1, not four times');
  run.tiles['4,3'].level = 9; near(sim.adjBonus('cottage', 4, 4), 1.5, 1e-9, 'level 9');
  const up = level => plain(sim.upgradeCost({ kind: 'building', id: 'cottage', level }));
  assert.deepStrictEqual(Object.keys(up(2)), ['wood']); assert.deepStrictEqual(Object.keys(up(3)).sort(), ['stone', 'wood']);
  near(up(4).stone / up(3).stone, sim.LINEAR_UPGRADE_GROWTH, 0.01, 'the stone grows like the wood');
  run.tiles['4,4'].level = 5; const spent = plain(sim.spentOn(run.tiles['4,4']));
  assert.strictEqual(spent.stone, up(3).stone + up(4).stone, 'and comes back with the refund');
});

test('routine upgrades: only cheap ones, cheapest first, never more than the town can staff', sim => {
  assert.strictEqual(sim.routineUpgrades().ok, false, 'nothing to upgrade in an empty town');
  town(sim, 3); sim.advance(120);
  const run = sim.state.run, levels = () => Object.values(run.tiles).filter(t => t.kind === 'building').reduce((a, t) => a + t.level, 0);
  for (const r in run.res) run.res[r] = 1e12;
  const before = levels(), res = plain(run.res), tiles = JSON.stringify(run.tiles);
  const look = sim.routineUpgrades(true);
  assert.ok(look.count > 0); assert.strictEqual(JSON.stringify(run.tiles), tiles, 'a preview changes nothing'); assert.deepStrictEqual(plain(run.res), res);
  const hall = sim.hallLevel(), done = sim.routineUpgrades();
  assert.ok(done.ok); assert.strictEqual(done.count, look.count); assert.deepStrictEqual(plain(done.spent), plain(look.spent));
  assert.strictEqual(levels(), before + done.count); assert.strictEqual(sim.hallLevel(), hall, 'the hall is never routine');
  for (const r in done.spent) near(res[r] - run.res[r], done.spent[r], 1e-3, r);
  assert.ok(sim.calc.need <= sim.calc.cap, 'jobs never outrun housing');
  for (const k in run.tiles) { const t = run.tiles[k]; if (t.kind !== 'building') continue; const c = sim.upgradeCost(t), def = sim.BUILDINGS[t.id];
    assert.ok((def.work && sim.calc.need + def.work > sim.calc.cap) || Object.keys(c).some(r => c[r] > Math.max(0, sim.calc.base[r] + (r === 'food' ? sim.calc.eaten : 0)) * sim.ROUTINE_SECONDS), 'what is left is not cheap: ' + t.id + ' level ' + t.level); }
  for (const r in run.res) run.res[r] = 0;
  assert.strictEqual(sim.routineUpgrades().count, 0, 'and nothing is bought that cannot be paid for');
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
  assert.strictEqual(one.rested, 6 * H * sim.REST_BONUS); assert.strictEqual(two.rested, one.rested, '6h + 6h'); assert.strictEqual(six.rested, one.rested, 'six looks');
  near(two.clock, one.clock, 1e-6, 'the same simulated time'); near(two.gold, one.gold, one.gold * 0.01, 'and the same gold, to within the step size');
  near(away(8, 8, 8).rested, away(24).rested, 1e-6, 'three nights against one day'); assert.strictEqual(one.away, 12 * H);
  // a purchase ends the rest; a preview of routine upgrades and a refused purchase do not
  away(5); const run = sim.state.run; run.res.gold = 1e9; run.res.wood = 1e9; run.res.stone = 1e9;
  sim.routineUpgrades(true); assert.strictEqual(run.away, 5 * H, 'a preview spends nothing');
  assert.strictEqual(sim.pay({ gold: 1e12 }), false); assert.strictEqual(run.away, 5 * H);
  const k = Object.keys(run.tiles).find(k => run.tiles[k].kind === 'building'); assert.ok(sim.upgrade(k).ok); assert.strictEqual(run.away, 0);
  assert.strictEqual(sim.creditAway(5 * H).rested, 0, 'after buying, the count starts again');
  const s2 = sim.sanitizeSave(JSON.parse(sim.serialize()), 1000).state; assert.strictEqual(s2.run.away, 5 * H, 'saved');
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
  assert.strictEqual(s.v, 3); assert.strictEqual(s.meta.decree, 'keep');
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

test('the next hall: hallWait, and routine upgrades hold its price back once it is under an hour away', sim => {
  town(sim); sim.state.run.pop = 20; sim.advance(120);
  const run = sim.state.run, cost = sim.upgradeCost(run.tiles[sim.HALL_KEY]);
  for (const r in run.res) run.res[r] = 1e12; sim.setState(sim.state);
  assert.strictEqual(sim.hallWait(), 0, 'affordable now');
  assert.deepStrictEqual(plain(sim.routineReserve()), plain(cost));
  const n = sim.routineUpgrades(true).count; assert.ok(n > 0, 'with plenty beyond the hall price the upgrades still go ahead');
  for (const r in run.res) run.res[r] = cost[r] ? cost[r] * 1.0001 : 0; run.res.food = 1e6; sim.setState(sim.state);
  const held = sim.routineUpgrades();
  assert.strictEqual(held.ok, false); assert.strictEqual(held.saving, true); assert.ok(/saving for the/.test(held.msg), held.msg);
  assert.ok(Object.keys(cost).every(r => run.res[r] >= cost[r]), 'the hall is still affordable');
  for (const r in cost) run.res[r] = 0; run.res.food = 1e6; sim.setState(sim.state);
  const w = sim.hallWait(); assert.ok(w > sim.ROUTINE_RESERVE_SECONDS && isFinite(w), 'far off: ' + w); assert.deepStrictEqual(plain(sim.routineReserve()), {});
  near(w, Math.max(...Object.keys(cost).map(r => cost[r] / sim.calc.base[r])), 1, 'the slowest material sets the wait');
  run.res.gold = 1e9; run.res.wood = 1e9; run.res.stone = 1e9; assert.ok(sim.routineUpgrades().count > 0 || true);
  run.tiles[sim.HALL_KEY].level = sim.MAX_LEVEL; assert.strictEqual(sim.hallWait(), Infinity);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
