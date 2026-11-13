'use strict';
// Slow balance check (a few minutes): runs the bot for 4 game hours per strategy and asserts that starting over
// pays, then for 12 hours of abdicating at every chance and asserts that reigns do not keep getting shorter.
// No dependencies: node tests/balance.test.js
const assert = require('assert');
const { compare, runAll } = require('./bot');
const LONG = [{ seed: 11, opts: { hours: 12, policy: 'crowns:10', taps: 0 } }, { seed: 33, opts: { hours: 12, policy: 'crowns:10', taps: 0.5 } }];

Promise.all([compare(4, [11, 33], [0, 0.5], 2), runAll(LONG, 2)]).then(([rows, long]) => {
  let failed = 0;
  const check = (name, fn) => { try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); } };
  for (const r of long) {
    const who = `seed ${r.seed}, ${r.taps} taps/s, 12h of abdicating at 10 Crowns`, lens = r.reigns.map(x => x.minutes), halls = r.reigns.map(x => x.hall);
    check(`${who}: no reign after the third is shorter than 30 minutes`, () => {
      assert.ok(Math.min(...lens.slice(3)) >= 30, 'reign lengths ' + lens.join(', ')); });
    check(`${who}: Crowns stay bounded (at most 200)`, () => {
      assert.ok(r.crowns + r.pending <= 200 && r.crowns >= 100, r.crowns + '+' + r.pending + ' Crowns'); });
    check(`${who}: later reigns go deeper than the Castle`, () => {
      assert.ok(halls.slice(0, 3).every(h => h === 4) && halls.slice(-3).every(h => h >= 6) && halls.filter(h => h >= 5).length >= halls.length / 2, 'hall levels ' + halls.join(', ')); });
    check(`${who}: the last three reigns are no shorter than the three before them`, () => {
      const avg = a => a.reduce((x, y) => x + y, 0) / a.length; assert.ok(avg(lens.slice(-3)) >= avg(lens.slice(-6, -3)), lens.join(', ')); });
  }
  for (const seed of [11, 33]) for (const taps of [0, 0.5]) {
    const get = policy => rows.find(r => r.seed === seed && r.taps === taps && r.policy === policy);
    const never = get('none'), cycle = get('cycle:10:150'), always = get('crowns:10'), who = `seed ${seed}, ${taps} taps/s`;
    check(`${who}: first abdication comes at 40-65 minutes for 10 Crowns`, () => {
      assert.ok(cycle.abdications[0] >= 40 && cycle.abdications[0] <= 65, 'first at ' + cycle.abdications[0] + ' min');
      assert.strictEqual(cycle.crowns, 30, 'three abdications of 10 Crowns'); });
    check(`${who}: abdicating three times then building beats never abdicating at 4h`, () => {
      assert.ok(cycle.goldRate >= 2 * never.goldRate, `gold/s ${cycle.goldRate.toExponential(2)} vs ${never.goldRate.toExponential(2)}`);
      assert.ok(cycle.lifetimeGold >= 0.9 * never.lifetimeGold, `lifetime gold ${cycle.lifetimeGold.toExponential(2)} vs ${never.lifetimeGold.toExponential(2)}`);
      assert.ok(cycle.crowns + cycle.pending >= 1.5 * never.pending, `Crowns ${cycle.crowns}+${cycle.pending} vs 0+${never.pending}`); });
    check(`${who}: later reigns are quicker than the first`, () => {
      const a = cycle.abdications; assert.ok(a[1] - a[0] < a[0] && a[2] - a[1] < a[1] - a[0], a.join(', ')); });
    check(`${who}: abdicating at every chance ends with the biggest Crown multiplier, but does not run away`, () => {
      assert.ok(always.crowns > cycle.crowns && always.crowns <= 100, always.crowns + ' Crowns'); });
    check(`${who}: a single reign slows down late (under 8x per hour from 3h to 4h)`, () => {
      const g = s => { const m = /^([\d.]+)([KMBT]?)/.exec(s); return m[1] * { '': 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2]]; };
      const ratio = never.goldRate / g(never.stamps[180].gold); assert.ok(ratio < 8, ratio.toFixed(1) + 'x'); });
  }
  console.log(failed ? `\n${failed} failed` : '\nall passed'); process.exit(failed ? 1 : 0);
}).catch(e => { console.error(e); process.exit(1); });
