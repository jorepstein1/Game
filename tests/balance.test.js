'use strict';
// Slow balance check (about ten minutes): plays the check-in bot and holds the game to the pacing targets in the
// pacing design doc. The reference player checks in five times a day (four 4-hour gaps and an 8-hour night).
//   - first reign, five check-ins a day, four maps: Manor, Keep, Castle, Palace and 20 Crowns arrive on time,
//     a night is worth about a third of the next hall, no check-in skips a tier, payback grows by stage;
//   - the same four maps played by a second, much simpler buyer: the early milestones must not depend on the
//     bot's buying rule;
//   - ten days of abdicating at 20 Crowns, five and two check-ins a day: reign lengths, Crowns after a week,
//     the Legend decree;
//   - how much the number of check-ins is worth: two, five and seventeen a day and a game that is never closed;
//   - abdicating at every chance, a careless buyer, and a player who taps all session.
// What the number of check-ins is worth: halls are raised by hand, so playing more often is faster. The target is
// that two check-ins a day end a week with 75% of the Crowns of five a day (a GAP line; the rested bonus on long
// absences and Monuments to buy at the Palace bring it to about two thirds; 60% is a requirement). Seventeen a day and a game never closed are printed for information, with a
// loose guard rail.
// PASS/FAIL lines are requirements. GAP lines are targets from the doc that the game does not meet yet: they are
// printed with the measured value and do not fail the run, and each has a guard-rail check beside it that does.
// No dependencies: node tests/balance.test.js
const assert = require('assert');
const { runAll, median } = require('./bot');
const MAPS = [11, 22, 33, 44], LONG = [11, 22, 33], WEEK = [11, 22, 33, 44, 55, 66]; // WEEK: the two-against-five comparison, a mean over six maps
const STEP = 4.1; // the reference player's gap between daytime check-ins, in hours
const jobs = [];
for (const seed of MAPS) jobs.push({ kind: 'first', seed, opts: { hours: 60, checkins: 5 } });
for (const checkins of [5, 2]) for (const seed of WEEK) jobs.push({ kind: 'days', seed, checkins, opts: { hours: 240, checkins, policy: 'crowns:20' } });
for (const seed of MAPS) jobs.push({ kind: 'simple', seed, opts: { hours: 96, checkins: 5, buyer: 'simple' } });
for (const seed of LONG) jobs.push({ kind: 'greedy', seed, opts: { hours: 110, checkins: 5, buyer: 'greedy' } });
for (const seed of LONG) jobs.push({ kind: 'days', seed, checkins: 17, opts: { hours: 170, checkins: 17, policy: 'crowns:20' } });
for (const seed of LONG) jobs.push({ kind: 'onebuy', seed, opts: { hours: 170, checkins: 5, policy: 'crowns:20', buyEvery: 5 } });
for (const seed of [11, 33]) jobs.push({ kind: 'open', seed, opts: { hours: 170, checkins: 0, policy: 'crowns:20' } });
for (const seed of [11, 33]) jobs.push({ kind: 'eager', seed, opts: { hours: 240, checkins: 5, policy: 'castle' } });
for (const seed of [11, 33]) jobs.push({ kind: 'careless', seed, opts: { hours: 60, checkins: 5, noGlut: true } });
for (const taps of [0, 3]) jobs.push({ kind: 'taps', seed: 11, taps, opts: { hours: 24, checkins: 5, taps } });

runAll(jobs).then(out => {
  const rows = out.map((r, i) => Object.assign(r, jobs[i]));
  let failed = 0, gaps = 0;
  const check = (name, fn) => { try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); } };
  const gap = (name, fn) => { try { fn(); console.log('PASS ' + name); } catch (e) { gaps++; console.log('GAP  ' + name + '\n     ' + e.message); } };
  const within = (x, lo, hi, what) => assert.ok(x !== null && x >= lo && x <= hi, `${what}: ${x === null ? 'never' : +x.toFixed(1)} (wanted ${lo} to ${hi})`);
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const hrs = a => a.map(x => x === null ? '-' : x.toFixed(1)).join(', ');

  // ── First reign, five check-ins a day ──
  const first = rows.filter(r => r.kind === 'first');
  for (const r of first) {
    const who = `map ${r.seed}, first reign, five check-ins a day`;
    check(`${who}: Manor in 15-25 minutes, Keep in 2.5-5.5h, Castle and Palace within one check-in of 10-14h and 34-42h`, () => {
      within(r.manorMin, 15, 25, 'Manor (minutes)'); within(r.keep, 2.5, 5.5, 'Keep (h)'); within(r.castle, 10 - STEP, 14 + STEP, 'Castle (h)'); within(r.palace, 34 - STEP, 42 + STEP, 'Palace (h)'); });
    check(`${who}: 15 Crowns come on offer about when the Palace stands, 20 within a day of it`, () => {
      within(r.crowns15, r.palace - 4.5, r.palace + 8.5, '15 Crowns (h)'); within(r.crowns20, 40, 60, '20 Crowns (h)'); });
    check(`${who}: no check-in skips a hall tier, and nobody starves while the player is away`, () => {
      const jump = r.visits.find(v => v.hallAfter - v.hall > 1); assert.ok(!jump, jump && `two tiers at ${jump.hour}h`);
      assert.ok(r.starvedHours <= 0.25 && r.lostPop < 1, `starving ${r.starvedHours.toFixed(1)}h, ${r.lostPop.toFixed(0)} villagers lost`); });
    check(`${who}: the first night is worth 10-45% of the next hall`, () => {
      const night = r.visits.find(v => v.away === 8); within(100 / night.hallShare, 10, 45, `night ending at ${night.hour}h, % of the next hall (${night.limit})`); });
    check(`${who}: payback grows from minutes in the first session to most of a day at the Castle`, () => {
      const [village, , , castle, palace] = r.payback;
      assert.ok(village <= 5 / 60, 'first session ' + (village * 60).toFixed(1) + ' min'); within(castle, 8, 32, 'Castle (h)'); assert.ok(palace >= 8, 'Palace ' + palace.toFixed(1) + 'h'); });
    check(`${who}: the buildings of a tier do not all arrive at once`, () => {
      const t = id => r.firsts.findIndex(f => f.what === id), when = id => r.firsts[t(id)].t;
      assert.ok(when('market') !== when('tavern'), `Market ${when('market')}, Tavern ${when('tavern')}`); assert.ok(when('mine') !== when('smith'), `Mine ${when('mine')}, Blacksmith ${when('smith')}`); });
    check(`${who}: after the first session a check-in has at most sixteen purchases that are not routine upgrades (median)`, () => {
      const d = median(r.visits.map(v => v.decisions)); assert.ok(d <= 16, 'median ' + d); });
  }
  check('first reign, five check-ins a day, median map: Keep at 3-5h, Castle at 10-14h, Palace at 34-42h', () => {
    within(median(first.map(r => r.keep)), 3, 5, 'Keep (h), maps ' + hrs(first.map(r => r.keep)));
    within(median(first.map(r => r.castle)), 10, 14, 'Castle (h), maps ' + hrs(first.map(r => r.castle))); within(median(first.map(r => r.palace)), 34, 42, 'Palace (h), maps ' + hrs(first.map(r => r.palace))); });
  gap('doc target: a night is worth 25-35% of the next hall (median map)', () => within(median(first.map(r => 100 / r.visits.find(v => v.away === 8).hallShare)), 25, 35, 'first night, % of the next hall'));
  check('first reign, five check-ins a day: 20 Crowns are on offer at 44-56h on the median map', () => within(median(first.map(r => r.crowns20)), 44, 56, '20 Crowns (h), maps ' + hrs(first.map(r => r.crowns20))));
  gap('doc target: payback of 2-6 hours in the Manor era', () => within(median(first.map(r => r.payback[1])), 2, 6, 'Manor-era payback (h)'));
  check('guard rail: Manor-era payback is at least a minute and no more than 6 hours (median map)', () => within(median(first.map(r => r.payback[1])) * 60, 1, 360, 'Manor-era payback (minutes), maps ' + first.map(r => (r.payback[1] * 60).toFixed(0)).join(', ')));
  gap('doc target: payback of 8-16 hours in the Keep era', () => within(median(first.map(r => r.payback[2])), 8, 16, 'Keep-era payback (h), maps ' + hrs(first.map(r => r.payback[2]))));
  check('guard rail: Keep-era payback is hours, not minutes, and under two days (median map)', () => within(median(first.map(r => r.payback[2])), 2, 48, 'Keep-era payback (h), maps ' + hrs(first.map(r => r.payback[2]))));
  check('guard rail: a mid-game check-in has at most sixteen purchases that are not routine upgrades, and at most a third of check-ins have nothing to buy', () => {
    const d = median(first.map(r => median(r.visits.map(v => v.decisions)))), empty = Math.max(...first.map(r => r.visits.filter(v => !v.bought).length / r.visits.length));
    assert.ok(d <= 16, 'median decisions ' + d); assert.ok(empty <= 1 / 3, 'share of empty check-ins on the worst map: ' + empty.toFixed(2)); });
  check('guard rail: a night is worth 10-50% of the next hall on the median map', () => within(median(first.map(r => 100 / r.visits.find(v => v.away === 8).hallShare)), 10, 50, 'first night, % of the next hall'));

  // ── The same maps with the simple buyer: do the milestones belong to the game or to the bot's buying rule? ──
  const simple = rows.filter(r => r.kind === 'simple'), both = k => `careful buyer ${hrs(first.map(r => r[k]))}; simple buyer ${hrs(simple.map(r => r[k]))}`;
  const ratio = k => median(simple.map(r => r[k] === null ? Infinity : r[k])) / median(first.map(r => r[k]));
  const med = (rs, k) => median(rs.map(r => r[k] === null ? Infinity : r[k]));
  check('cross-check: a buyer that just takes the cheapest thing reaches the Manor within 30% of the careful buyer, and the Keep and the Castle within one check-in (median map)', () => {
    const m = med(simple, 'manorMin') / med(first, 'manorMin'); assert.ok(m >= 0.7 && m <= 1.3, both('manorMin'));
    for (const k of ['keep', 'castle']) assert.ok(Math.abs(med(simple, k) - med(first, k)) <= STEP, k + ': ' + both(k)); });
  gap('cross-check: the Palace does not depend on how well the player buys (simple buyer within 30% of the careful one)', () => assert.ok(med(simple, 'palace') <= 1.3 * med(first, 'palace'), 'Palace (h): ' + both('palace') + ' (the cheapest purchase at a Castle is rarely a good one, so the Palace date is as much the buyer as the constants)'));
  check('guard rail: the simple buyer has its Castle within a check-in of 14h on every map, and its Palace within four days and 2.6 times the careful buyer on the median map', () => {
    assert.ok(simple.every(r => r.castle !== null && r.castle <= 14 + STEP), 'Castle (h): ' + hrs(simple.map(r => r.castle))); assert.ok(med(simple, 'palace') <= 96 && med(simple, 'palace') <= 2.6 * med(first, 'palace'), 'Palace (h): ' + both('palace')); });
  // ── A greedy buyer: always the cheapest thing it can pay for, never saving for a hall on purpose ──
  const greedy = rows.filter(r => r.kind === 'greedy'), gboth = k => `careful buyer ${hrs(first.map(r => r[k]))}; greedy buyer ${hrs(greedy.map(r => r[k]))}`;
  console.log('     greedy buyer, five check-ins a day: Manor ' + greedy.map(r => r.manorMin === null ? 'with the Keep' : r.manorMin.toFixed(0) + ' min').join(', ') + ` | Keep ${hrs(greedy.map(r => r.keep))}h | Castle ${hrs(greedy.map(r => r.castle))}h | Palace ${hrs(greedy.map(r => r.palace))}h | 20 Crowns ${hrs(greedy.map(r => r.crowns20))}h`);
  check('guard rail: the greedy buyer has its Keep by the second check-in and its Castle within a check-in of 14h on every map, and its Palace within 2.7 times the careful buyer (median map)', () => {
    assert.ok(greedy.every(r => r.keep !== null && r.keep <= 9 && r.castle !== null && r.castle <= 14 + STEP), gboth('keep') + ' | ' + gboth('castle')); assert.ok(med(greedy, 'palace') <= 2.7 * med(first, 'palace'), 'Palace (h): ' + gboth('palace')); });
  gap('doc target: cheap purchases are not a trap: the greedy buyer has its Manor in the first session', () => assert.ok(greedy.every(r => r.manorMin !== null && r.manorMin <= 30), 'Manor (minutes): ' + greedy.map(r => r.manorMin === null ? 'with the Keep' : r.manorMin.toFixed(0)).join(', ') + ' (it spends the first session on small upgrades; the hall card, the Full Treasury decree and the routine reserve are there for a person, not for this bot)'));
  gap('doc target: the greedy buyer reaches the Palace within 30% of the careful one', () => assert.ok(med(greedy, 'palace') <= 1.3 * med(first, 'palace'), 'Palace (h): ' + gboth('palace')));
  check('guard rail: a mid-game check-in of the careful buyer brings something new (a first building, research, land or a hall) at least one time in four', () => {
    const share = Math.min(...first.map(r => r.visits.filter(v => v.fresh > 0).length / r.visits.length)); assert.ok(share >= 0.25, 'share of check-ins with something new, worst map: ' + share.toFixed(2)); });
  gap('doc target: every check-in brings something new', () => { const share = Math.min(...first.map(r => r.visits.filter(v => v.fresh > 0).length / r.visits.length)); assert.ok(share >= 0.9, `${Math.round(100 * share)}% of check-ins on the worst map had a first building, research, land or a hall`); });
  gap('doc target: one or two real decisions per mid-game check-in', () => { const d = median(first.map(r => median(r.visits.map(v => v.decisions)))); assert.ok(d <= 2, 'median purchases that are not routine upgrades: ' + d); });
  gap('doc target: every check-in has something to buy', () => { const empty = first.map(r => r.visits.filter(v => !v.bought).length); assert.ok(Math.max(...empty) === 0, 'check-ins with nothing bought (saving for the hall), per map: ' + empty.join(', ')); });

  // ── Ten days, abdicating at 20 Crowns ──
  const days = n => rows.filter(r => r.kind === 'days' && r.checkins === n);
  for (const r of days(5)) {
    const who = `map ${r.seed}, ten days at five check-ins a day, abdicating at 20 Crowns`, lens = r.reigns.map(x => x.hours);
    check(`${who}: the second reign is shorter than the first, and no reign is under 16 hours or over 60`, () => {
      assert.ok(lens[1] < lens[0], 'reigns ' + hrs(lens)); assert.ok(Math.min(...lens) >= 16 && Math.max(...lens) <= 60, 'reigns ' + hrs(lens)); });
    check(`${who}: 60-105 Crowns after a week, and the Legend decree (100 Crowns) in 6.4-10 days`, () => {
      within(r.weekCrowns, 60, 105, 'Crowns held and on offer at 7 days'); within(r.legend / 24, 6.4, 10, 'Legend (days)'); });
    gap(`doc target, ${who}: the second reign takes 40-60% of the first`, () => within(100 * lens[1] / lens[0], 40, 60, `second reign as % of the first (${hrs(lens.slice(0, 2))}h)`));
  }
  check('ten days at five check-ins a day, median map: 60-100 Crowns after a week and the Legend decree in 7-10 days', () => {
    within(median(days(5).map(r => r.weekCrowns)), 60, 100, 'Crowns at 7 days'); within(median(days(5).map(r => r.legend)) / 24, 7, 10, 'Legend (days)'); });
  for (const r of days(2)) {
    const who = `map ${r.seed}, two check-ins a day`;
    check(`${who}: time away counts in full from the first absence (Stewardship is within reach in the first session)`, () => {
      const cut = r.visits.find(v => v.credited < v.away - 1e-6); assert.ok(!cut, cut && `only ${cut.credited}h of ${cut.away}h credited at ${cut.hour}h`); });
    check(`${who}: Palace within 62h, 20 Crowns within 88h, nobody starves over a 12-hour absence`, () => {
      within(r.palace, 34, 62, 'Palace (h)'); within(r.reigns[0].hours, 44, 88, 'first abdication (h)');
      assert.ok(r.starvedHours <= 0.25 && r.lostPop < 1, `starving ${r.starvedHours.toFixed(1)}h, ${r.lostPop.toFixed(0)} villagers lost`); });
  }
  // ── What checking in more often is worth (the doc's first principle: it must not be the faster way to play) ──
  const open = rows.filter(r => r.kind === 'open'), wk = rs => mean(rs.map(r => r.weekCrowns)), list = rs => rs.map(r => r.weekCrowns).join(', ');
  const week5 = wk(days(5)), week2 = wk(days(2)), week17 = wk(days(17)), weekOpen = wk(open);
  const table = `Crowns held and on offer after 7 days (per map; mean): two a day ${list(days(2))}; ${week2.toFixed(0)} | five ${list(days(5))}; ${week5.toFixed(0)} | seventeen ${list(days(17))}; ${week17.toFixed(0)} | never closed ${list(open)}; ${weekOpen.toFixed(0)}`;
  console.log('     ' + table);
  for (const [who, rs] of [['two a day', days(2)], ['five a day', days(5)], ['seventeen a day', days(17)], ['never closed', open]])
    console.log(`     ${who.padEnd(16)} Keep ${hrs(rs.map(r => r.keep))}h | Castle ${hrs(rs.map(r => r.castle))}h | Palace ${hrs(rs.map(r => r.palace))}h | first abdication ${hrs(rs.map(r => r.reigns[0] ? r.reigns[0].hours : null))}h | Crowns at 7 days ${list(rs)} | Legend ${hrs(rs.map(r => r.legend))}h`);
  { const one = rows.filter(r => r.kind === 'onebuy'); // informational: the rested bonus is not a reason to hold purchases back
    console.log(`     five check-ins a day, buying at one of them only: Crowns at 7 days ${list(one)}; ${(100 * wk(one) / week5).toFixed(0)}% of buying at every check-in | Castle ${hrs(one.map(r => r.castle))}h | Palace ${hrs(one.map(r => r.palace))}h`);
    check('guard rail: buying at one check-in a day and resting through the others is not the better way to play', () => assert.ok(wk(one) <= week5, `${wk(one).toFixed(0)} Crowns against ${week5.toFixed(0)}`)); }
  // After the Palace: is there something to buy while the Crowns build up?
  { const share = days(5).map(r => { const v = r.visits.filter(v => v.reign === 0 && v.hall >= 5); return v.length ? v.filter(x => x.bought > 0).length / v.length : 1; });
    console.log('     first reign, check-ins with a Palace standing at which something was bought, per map: ' + share.map(x => Math.round(100 * x) + '%').join(', '));
    check('after the Palace most check-ins still have something to buy (at least 60% on every map)', () => assert.ok(Math.min(...share) >= 0.6, share.map(x => Math.round(100 * x) + '%').join(', '))); }
  // Seventeen a day and never closed are informational: only something absurd fails.
  const week5L = wk(days(5).filter(r => LONG.includes(r.seed))); // seventeen a day and never closed ran on the LONG maps only: compare like with like
  console.log(`     against five a day: two a day ${(100 * week2 / week5).toFixed(0)}% (six maps), seventeen a day ${(100 * week17 / week5L).toFixed(0)}%, never closed ${(100 * weekOpen / week5L).toFixed(0)}% (same maps)`);
  check('two check-ins a day end the week with at least 60% of the Crowns of five a day (mean of six maps)', () => assert.ok(week2 >= 0.6 * week5, table));
  gap('target: two check-ins a day end the week with 75% of the Crowns of five a day (60% is the requirement above)', () => assert.ok(week2 >= 0.75 * week5, `${(100 * week2 / week5).toFixed(0)}% (a reign is four gates raised by hand, Keep, Castle, Palace and the abdication, so it cannot take under four visits: 48 to 60 hours at two a day against 33 to 53 at five; the rested bonus adds income, not visits)`));
  check('guard rail: seventeen check-ins a day, or never closing the game, end the week with at most twice the Crowns of five a day', () => assert.ok(week17 <= 2 * week5L && weekOpen <= 2 * week5L, table));
  const castle5 = median(first.map(r => r.castle)), castleOpen = median(open.map(r => r.castle)), castle17 = median(days(17).map(r => r.castle));
  check('guard rail: no amount of attention brings the first Castle before the third hour', () => assert.ok(castleOpen >= 3 && castle17 >= 3, `Castle (h): never closed ${hrs(open.map(r => r.castle))}, seventeen a day ${hrs(days(17).map(r => r.castle))}`));
  check('guard rail: the first Palace is not a matter of attention: never closed and seventeen a day are within a day of five a day', () => {
    const p5 = median(first.map(r => r.palace)); for (const [who, rs] of [['never closed', open], ['seventeen a day', days(17)]]) { const p = median(rs.map(r => r.palace === null ? Infinity : r.palace)); assert.ok(p >= p5 - 24, `Palace ${who} ${hrs(rs.map(r => r.palace))} against ${p5.toFixed(1)}h`); } });

  // ── Other players ──
  for (const r of rows.filter(r => r.kind === 'eager')) {
    const patient = days(5).find(x => x.seed === r.seed), who = `map ${r.seed}, abdicating at every chance (15 Crowns)`, lens = r.reigns.map(x => x.hours);
    check(`${who}: not a trap and not a shortcut: within 25% of the Crowns of waiting for 20, and no reign under 16 hours`, () => {
      const a = r.crowns + r.pending, b = patient.crowns + patient.pending;
      assert.ok(a >= 0.75 * b && a <= 1.25 * b, `${a} Crowns after ten days against ${b}`); assert.ok(Math.min(...lens) >= 16, 'reigns ' + hrs(lens)); });
  }
  for (const r of rows.filter(r => r.kind === 'careless'))
    check(`map ${r.seed}, careless buyer (keeps upgrading materials it has plenty of): Palace within 60h without starving`, () => {
      within(r.palace, 30, 60, 'Palace (h)'); assert.ok(r.starvedHours <= 0.25, 'starving ' + r.starvedHours.toFixed(1) + 'h'); });
  check('tapping three times a second whenever the game is open reaches no hall a check-in sooner, and earns no more in a day than map-to-map variation (30%)', () => {
    const [idle, tapper] = [0, 3].map(t => rows.find(r => r.kind === 'taps' && r.taps === t));
    assert.ok(tapper.lifetimeGold <= 1.3 * idle.lifetimeGold, `${tapper.lifetimeGold.toExponential(2)} against ${idle.lifetimeGold.toExponential(2)}`);
    assert.ok(tapper.keep === idle.keep && tapper.castle === idle.castle, `Keep ${tapper.keep} v ${idle.keep}, Castle ${tapper.castle} v ${idle.castle}`); });

  console.log(`\n${failed ? failed + ' failed' : 'all requirements passed'}${gaps ? `; ${gaps} doc target${gaps > 1 ? 's' : ''} not met yet (GAP lines above)` : ''}`); process.exit(failed ? 1 : 0);
}).catch(e => { console.error(e); process.exit(1); });
