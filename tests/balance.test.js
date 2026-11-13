'use strict';
// Slow balance check (about a minute): runs the bot for 4 game hours per strategy and asserts that starting over
// pays. No dependencies: node tests/balance.test.js
const assert = require('assert');
const { compare } = require('./bot');

compare(4, [11, 33], [0, 0.5]).then(rows => {
  let failed = 0;
  const check = (name, fn) => { try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); } };
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
