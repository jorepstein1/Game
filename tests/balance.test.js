'use strict';
// Slow balance check (several minutes): plays the bot and asserts the shape of the game.
//   - 4 game hours per strategy: starting over pays, and taking every minimum offer is not a trap;
//   - 12 hours of abdicating at every chance: reigns do not keep getting shorter and Crowns stay bounded;
//   - 2.5 hours without abdicating on five maps: the Palace is reachable, even for a careless buyer.
// No dependencies: node tests/balance.test.js
const assert = require('assert');
const { runAll, STRATEGIES } = require('./bot');
const SEEDS = [11, 33], TAPS = [0, 0.5], MAPS = [11, 22, 33, 44, 55];
const jobs = [];
for (const seed of SEEDS) for (const taps of TAPS) for (const [, policy] of STRATEGIES) jobs.push({ kind: '4h', seed, opts: { hours: 4, policy, taps } });
jobs.push({ kind: '12h', seed: 11, opts: { hours: 12, policy: 'castle', taps: 0 } }, { kind: '12h', seed: 33, opts: { hours: 12, policy: 'castle', taps: 0.5 } });
for (const seed of MAPS) for (const careless of [false, true]) jobs.push({ kind: 'palace', seed, careless, opts: { hours: 2.5, policy: 'none', taps: 0, noGlut: careless } });

runAll(jobs).then(out => {
  const rows = out.map((r, i) => Object.assign(r, jobs[i]));
  let failed = 0;
  const check = (name, fn) => { try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); } };
  const sci = x => x.toExponential(2);

  for (const r of rows.filter(r => r.kind === 'palace')) {
    const limit = r.careless ? 150 : 90, who = `map ${r.seed}, never abdicating, ${r.careless ? 'careless buyer (keeps upgrading materials it has plenty of)' : 'sensible buyer'}`;
    check(`${who}: Palace within ${limit} minutes without starving`, () => {
      assert.ok(r.palace !== null && r.palace <= limit, 'Castle at ' + r.castle + ' min, Palace at ' + r.palace + ' min');
      assert.ok(r.starvedMin <= 1, 'starved for ' + r.starvedMin.toFixed(1) + ' min'); });
  }

  for (const r of rows.filter(r => r.kind === '12h')) {
    const who = `seed ${r.seed}, ${r.taps} taps/s, 12h of abdicating at every chance`, lens = r.reigns.map(x => x.minutes), halls = r.reigns.map(x => x.hall);
    check(`${who}: no reign after the third is shorter than 25 minutes`, () => {
      assert.ok(Math.min(...lens.slice(3)) >= 25, 'reign lengths ' + lens.join(', ')); });
    check(`${who}: Crowns stay bounded (100 to 250)`, () => {
      assert.ok(r.crowns + r.pending <= 250 && r.crowns >= 100, r.crowns + '+' + r.pending + ' Crowns'); });
    check(`${who}: later reigns go deeper than the first`, () => {
      assert.ok(halls.slice(-3).every(h => h >= 6) && halls.slice(-3).every(h => h > halls[0]), 'hall levels ' + halls.join(', ')); });
    check(`${who}: the last three reigns are longer than the three before them`, () => {
      const avg = a => a.reduce((x, y) => x + y, 0) / a.length; assert.ok(avg(lens.slice(-3)) >= avg(lens.slice(-6, -3)), lens.join(', ')); });
  }

  for (const seed of SEEDS) for (const taps of TAPS) {
    const get = policy => rows.find(r => r.kind === '4h' && r.seed === seed && r.taps === taps && r.policy === policy);
    const never = get('none'), cycle = get('cycle:20:150'), always = get('castle'), who = `seed ${seed}, ${taps} taps/s`;
    check(`${who}: abdication opens at 40-65 minutes and 20 Crowns are on offer by 90`, () => {
      assert.ok(always.abdications[0] >= 40 && always.abdications[0] <= 65, 'opens at ' + always.abdications[0] + ' min');
      assert.ok(cycle.abdications[0] <= 90, '20 Crowns at ' + cycle.abdications[0] + ' min');
      assert.strictEqual(cycle.crowns, 40, 'two abdications of 20 Crowns in 2.5h'); });
    check(`${who}: abdicating twice at 20 Crowns then building beats never abdicating at 4h`, () => {
      assert.ok(cycle.goldRate >= 2 * never.goldRate, `gold/s ${sci(cycle.goldRate)} vs ${sci(never.goldRate)}`);
      assert.ok(cycle.lifetimeGold >= 1.5 * never.lifetimeGold, `lifetime gold ${sci(cycle.lifetimeGold)} vs ${sci(never.lifetimeGold)}`);
      assert.ok(cycle.crowns + cycle.pending >= 1.5 * never.pending, `Crowns ${cycle.crowns}+${cycle.pending} vs 0+${never.pending}`); });
    check(`${who}: the second reign is quicker than the first`, () => {
      const a = cycle.abdications; assert.ok(a[1] - a[0] < a[0], a.join(', ')); });
    check(`${who}: taking every minimum offer is not a trap, and does not run away`, () => {
      assert.ok(always.goldRate >= never.goldRate, `gold/s ${sci(always.goldRate)} vs ${sci(never.goldRate)}`);
      assert.ok(always.lifetimeGold >= 0.5 * never.lifetimeGold, `lifetime gold ${sci(always.lifetimeGold)} vs ${sci(never.lifetimeGold)}`);
      assert.ok(always.crowns > cycle.crowns && always.crowns <= 130, always.crowns + ' Crowns');
      assert.ok(cycle.lifetimeGold > always.lifetimeGold, 'waiting for 20 Crowns earns more gold than taking 15'); });
    check(`${who}: a single reign slows down late (under 8x per hour from 3h to 4h)`, () => {
      const g = s => { const m = /^([\d.]+)([KMBT]?)/.exec(s); return m[1] * { '': 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2]]; };
      const ratio = never.goldRate / g(never.stamps[180].gold); assert.ok(ratio < 8, ratio.toFixed(1) + 'x'); });
  }
  console.log(failed ? `\n${failed} failed` : '\nall passed'); process.exit(failed ? 1 : 0);
}).catch(e => { console.error(e); process.exit(1); });
