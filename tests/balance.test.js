'use strict';
// Slow balance check (several minutes on four cores): plays the check-in bot and holds the game to its pacing
// design. The reference player checks in five times a day: an opening session of 25 minutes, then four 4-hour
// gaps and an 8-hour night, three minutes each time. Upgrades are by kind (one purchase raises every building of
// a kind), so a town at the Palace is a few dozen buildings bought a few at a time.
//   - first reign, five check-ins a day, six maps: hall times, Crown timing, the opening session, every kind built
//     and the size of the town when the Palace is raised (counted at that moment, before the rest of the check-in), nobody starving;
//   - a week abdicating at 20 Crowns at two, five and 49 check-ins a day and with the game never closed: what
//     checking in more often (or never leaving) is worth;
//   - a player who taps whenever the button shows, and one who buys at one check-in a day only and rests through the others;
//   - reigns started with 30 and with 75 Crowns held (the Royal and the Imperial Palace open): when that hall is
//     affordable against 20 Crowns on offer.
// PASS/FAIL lines are requirements. GAP lines are targets the game does not meet yet: they print the measured
// value and do not fail the run.
// No dependencies: node tests/balance.test.js
const assert = require('assert');
const { runAll, median } = require('./bot');
const MAPS = [11, 22, 33, 44, 55, 66];
const jobs = [];
for (const seed of MAPS) jobs.push({ kind: 'first', seed, opts: { hours: 72, checkins: 5 } });
for (const checkins of [2, 5, 49, 0]) for (const seed of MAPS) jobs.push({ kind: 'week', seed, checkins, opts: { hours: 168, checkins, policy: 'crowns:20', tick: checkins ? 0.5 : 5 } });
for (const seed of [11, 33]) jobs.push({ kind: 'onebuy', seed, opts: { hours: 168, checkins: 5, policy: 'crowns:20', buyEvery: 5 } });
for (const seed of MAPS) for (const taps of [0, 3]) jobs.push({ kind: 'taps', seed, taps, opts: { hours: 24, checkins: 5, taps } });
for (const seed of [11, 33]) jobs.push({ kind: 'simple', seed, opts: { hours: 72, checkins: 5, buyer: 'simple' } });
for (const seed of MAPS) jobs.push({ kind: 'royal', seed, opts: { hours: 72, checkins: 5, crowns: 30 } });
for (const seed of MAPS) jobs.push({ kind: 'imperial', seed, opts: { hours: 72, checkins: 5, crowns: 75 } });

runAll(jobs).then(out => {
  const rows = out.map((r, i) => Object.assign(r, jobs[i]));
  let failed = 0, gaps = 0;
  const check = (name, fn) => { try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); } };
  const gap = (name, fn) => { try { fn(); console.log('PASS ' + name); } catch (e) { gaps++; console.log('GAP  ' + name + '\n     ' + e.message); } };
  const within = (x, lo, hi, what) => assert.ok(x !== null && x >= lo && x <= hi, `${what}: ${x === null ? 'never' : +x.toFixed(1)} (wanted ${lo} to ${hi})`);
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const hrs = a => a.map(x => x === null ? '-' : x.toFixed(1)).join(', ');
  const q = (a, p) => { a = a.filter(x => x !== null && isFinite(x)).sort((x, y) => x - y); return a.length ? a[Math.floor(p * (a.length - 1))] : null; };

  // ── First reign, five check-ins a day ──
  const first = rows.filter(r => r.kind === 'first');
  console.log('     map   Manor   Keep  Castle  Palace  15 Crowns  20 Crowns  buildings at Palace raised  kinds  expansions (h)            opening');
  for (const r of first) console.log(`     ${String(r.seed).padStart(3)}  ${(r.manorMin.toFixed(1) + 'm').padStart(6)} ${hrs([r.keep]).padStart(6)} ${hrs([r.castle]).padStart(7)} ${hrs([r.palace]).padStart(7)} ${hrs([r.crowns15]).padStart(10)} ${hrs([r.crowns20]).padStart(10)} ${String(r.buildingsAt.Palace || '-').padStart(27)} ${String(r.palaceKinds).padStart(6)}  ${hrs(r.expansions).padEnd(24)}  ${r.opening.bought} purchases`);
  for (const r of first) {
    const who = `map ${r.seed}, first reign, five check-ins a day`;
    check(`${who}: Keep at 3-5h, Castle at 10-14h, Palace at 34-42h`, () => { within(r.keep, 3, 5, 'Keep (h)'); within(r.castle, 10, 14, 'Castle (h)'); within(r.palace, 34, 42, 'Palace (h)'); });
    check(`${who}: 15 Crowns on offer about when the Palace stands (within a check-in), 20 within 16 hours after it`, () => {
      within(r.crowns15, r.palace - 4.5, r.palace + 4.5, '15 Crowns (h)'); within(r.crowns20, r.palace, r.palace + 16, '20 Crowns (h)'); });
    check(`${who}: the opening session makes 10-20 purchases and raises the Manor at 15-25 minutes`, () => { within(r.opening.bought, 10, 20, 'opening purchases'); within(r.manorMin, 15, 25, 'Manor (minutes)'); });
    check(`${who}: all 11 kinds of building and 25-45 buildings (a sanity floor) stand when the Palace is raised`, () => { within(r.palaceKinds, 11, 11, 'kinds built'); within(r.buildingsAt.Palace || null, 25, 45, 'buildings standing'); });
    check(`${who}: nobody starves`, () => assert.ok(r.starvedHours <= 0.25 && r.lostPop < 1, `starving ${r.starvedHours.toFixed(1)}h, ${r.lostPop.toFixed(0)} villagers lost`));
  }
  check('first reign, median map: 20 Crowns about half a day after the Palace (6-16 hours)', () => within(median(first.map(r => r.crowns20 - r.palace)), 6, 16, 'hours from the Palace to 20 Crowns, maps ' + hrs(first.map(r => r.crowns20 - r.palace))));
  // Purchases per check-in: the first reign up to 60 hours, every map pooled (check-ins with an abdication left out).
  const visits = first.flatMap(r => r.visits.filter(v => v.reign === 0 && !v.abdicated && v.hour <= 60.5)), bought = visits.map(v => v.bought);
  const nights = visits.filter(v => v.away === 8).map(v => v.bought), firstVisit = first.map(r => r.visits[0].bought);
  const felt = first.flatMap(r => r.felt.filter(f => f.reign === 0 && f.t > 1800)), payback = q(felt.map(f => f.payback), 0.5);
  console.log(`     purchases per check-in (first reign to 60h, ${visits.length} check-ins): median ${median(bought)}, most ${Math.max(...bought)}, none ${Math.round(100 * bought.filter(x => !x).length / bought.length)}%; first check-in ${firstVisit.join(', ')}; after a night median ${median(nights)}, most ${Math.max(...nights)}`);
  console.log(`     every build or kind upgrade after the opening: payback median ${payback.toFixed(1)}h (10th pct ${q(felt.map(f => f.payback), 0.1).toFixed(1)}h, 90th ${q(felt.map(f => f.payback), 0.9).toFixed(1)}h); kind upgrades ${Math.round(100 * felt.filter(f => f.k === 'up').length / felt.length)}% of them`);
  gap('target: a check-in is a few purchases (median 3-4)', () => within(median(bought), 3, 4, 'median purchases per check-in'));
  gap('target: no check-in has more than 6 purchases', () => assert.ok(Math.max(...bought) <= 6, 'most ' + Math.max(...bought) + '; check-ins over 6: ' + bought.filter(x => x > 6).length + ' of ' + bought.length));
  gap('target: the first check-in after the opening has at most 5 purchases', () => assert.ok(Math.max(...firstVisit) <= 5, 'per map: ' + firstVisit.join(', ')));
  gap('target: a check-in after the night has at most 6 purchases', () => assert.ok(Math.max(...nights) <= 6, 'most ' + Math.max(...nights) + ' (per night: ' + nights.join(', ') + ')'));
  gap('target: a build or kind upgrade pays for itself in 6 hours or more (median)', () => assert.ok(payback >= 6, 'median payback ' + payback.toFixed(1) + 'h'));
  gap('target: 35-45 buildings stand when the Palace is raised, on every map (the design target; the requirement above is a floor of 25)', () => assert.ok(first.every(r => r.buildingsAt.Palace >= 35 && r.buildingsAt.Palace <= 45),
    'buildings standing when the Palace is raised, per map: ' + first.map(r => r.seed + ': ' + (r.buildingsAt.Palace || '-')).join(', ')));
  gap('target: the third expansion within a day of the Palace', () => { const late = first.map(r => r.expansions[2] === null ? Infinity : r.expansions[2] - r.palace);
    assert.ok(late.every(x => x <= 24), 'hours from the Palace to the third expansion, per map: ' + late.map(x => isFinite(x) ? x.toFixed(1) : 'not in 72h').join(', ')); });

  // ── The jobs of the buildings (see data.js, TRADES): gold by kind, food and iron at the Palace and at 20 Crowns ──
  const pc = x => x === null || x === undefined ? '-' : Math.round(100 * x) + '%', share = (e, k) => (e && e.shares[k]) || 0;
  const shares = e => e ? Object.entries(e.shares).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + pc(v)).join(' ') : '-';
  const midFill = r => { const v = r.visits.filter(v => v.reign === 0 && v.markets > 0 && v.hour <= r.palace + 0.1); return v.length ? mean(v.map(v => v.fill)) : null; };
  console.log('     map  gold by kind at the Palace / at 20 Crowns on offer; Markets supplied (mean to the Palace); forge run at the Palace; food store / upkeep (s) at the Palace and 20 Crowns; iron made / used / stock at the Palace; trades each Guildhall touches');
  for (const r of first) { const e = r.econPalace || {}, f = r.econ20 || {};
    console.log(`     ${String(r.seed).padStart(3)}  ${shares(r.econPalace)} / ${shares(r.econ20)}; ${pc(midFill(r))}; ${pc(e.run)}; ${Math.round(e.store)} / ${Math.round(f.store)}; ${(e.ironMade || 0).toFixed(1)} / ${(e.ironUsed || 0).toFixed(1)} / ${Math.round(e.ironStock || 0)}; ${(f.guilds || e.guilds || []).join(', ') || '-'}`); }
  // A map short of food leans on its forges and one short of iron on its Markets, by design; neither trade may vanish.
  const roles = (e, lo, hi) => { assert.ok(e, 'not reached'); const top = Object.entries(e.shares).sort((a, b) => b[1] - a[1])[0];
    assert.ok(top[1] <= hi && share(e, 'market') >= lo && share(e, 'smith') >= lo, shares(e)); };
  for (const r of first) for (const [when, e] of [['the Palace', r.econPalace], ['20 Crowns on offer', r.econ20]])
    check(`map ${r.seed}: at ${when} Markets and Blacksmiths each make at least 10% of the gold and no kind more than 65%`, () => roles(e, 0.1, 0.65));
  gap('target: at the Palace and at 20 Crowns on offer, on every map, Markets and Blacksmiths each make at least 20% of the gold and no kind more than half', () => {
    const bad = first.flatMap(r => [['Palace', r.econPalace], ['20 Crowns', r.econ20]].filter(([, e]) => { try { roles(e, 0.2, 0.5); return false; } catch (x) { return true; } }).map(([w, e]) => `${r.seed} at ${w}: ${shares(e)}`));
    assert.ok(!bad.length, bad.join('; ')); });
  gap('target: Markets are 50-90% supplied on average through the mid game, on every map', () => assert.ok(first.every(r => midFill(r) >= 0.5 && midFill(r) <= 0.9), first.map(r => r.seed + ': ' + pc(midFill(r))).join(', ')));
  gap('target: Farms, Mills or food research are bought for the gold they bring, on every map', () => assert.ok(first.every(r => r.foodBuys.gold > 0), first.map(r => `${r.seed}: ${r.foodBuys.gold} for gold, ${r.foodBuys.hunger} for hunger`).join('; ')));
  gap('target: the food store stops growing once the Markets are short (no more at 20 Crowns than at the Palace, or under an hour of upkeep)', () => assert.ok(first.every(r => r.econ20 && r.econPalace && (r.econ20.store <= r.econPalace.store * 1.05 || r.econ20.store < 3600)),
    first.map(r => `${r.seed}: ${r.econPalace ? Math.round(r.econPalace.store) : '-'}s to ${r.econ20 ? Math.round(r.econ20.store) : '-'}s`).join(', ')));
  gap('target: the forges run below full for part of the reign, on every map', () => assert.ok(first.every(r => r.visits.some(v => v.reign === 0 && v.smiths > 0 && v.run < 0.999)), first.map(r => r.seed + ': ' + r.visits.filter(v => v.reign === 0 && v.smiths > 0 && v.run < 0.999).length + ' check-ins').join(', ')));
  gap('target: a hall that needs iron waits longest for iron at no more than one check-in', () => { const n = r => r.visits.filter(v => v.reign === 0 && v.waits && v.waits.iron > 0 && Object.values(v.waits).every(x => (x === null ? Infinity : x) <= (v.waits.iron === null ? Infinity : v.waits.iron))).length;
    assert.ok(first.every(r => n(r) <= 1), first.map(r => r.seed + ': ' + n(r)).join(', ')); });
  gap('target: on every map a Guildhall touches at least two trades', () => assert.ok(first.every(r => Math.max(0, ...((r.econ20 || r.econPalace || {}).guilds || [])) >= 2), first.map(r => r.seed + ': ' + ((r.econ20 || r.econPalace || {}).guilds || []).join(',')).join('; ')));
  gap('target: a second Guildhall is bought on some maps', () => assert.ok(first.some(r => ((r.econ20 || r.econPalace || {}).guilds || []).length >= 2), 'Guildhalls per map: ' + first.map(r => r.seed + ': ' + ((r.econ20 || r.econPalace || {}).guilds || []).length).join(', ')));

  // ── Later reigns: the halls past the Palace come about when 20 Crowns are on offer, so a reign that ends there raises them ──
  // A reign begun with 30 Crowns held opens the Royal Palace (level 6); one begun with 75 the Imperial Palace (level 7).
  for (const [kind, held, name, key] of [['royal', 30, 'Royal Palace', 'royalAffordable'], ['imperial', 75, 'Imperial Palace', 'imperialAffordable']]) {
    const rs = rows.filter(r => r.kind === kind), lead = r => r[key] === null || r.crowns20 === null ? null : r[key] - r.crowns20;
    const per = () => rs.map(r => `${r.seed}: ${lead(r) === null ? (r[key] === null ? 'not in 72h' : 'no 20 Crowns') : (lead(r) >= 0 ? '+' : '') + lead(r).toFixed(1)}`).join(', ');
    console.log(`     reign started with ${held} Crowns held, map: Palace / 20 Crowns on offer / ${name} affordable (h): ` + rs.map(r => `${r.seed}: ${hrs([r.palace, r.crowns20, r[key]]).replace(/, /g, ' / ')}`).join('; '));
    check(`a reign started with ${held} Crowns held: the ${name} is affordable no later than 8 hours after 20 Crowns are on offer, on every map`, () =>
      assert.ok(rs.every(r => lead(r) !== null && lead(r) <= 8), `hours from 20 Crowns on offer to the ${name} affordable, per map: ` + per()));
    gap(`target: a reign started with ${held} Crowns held: the ${name} is affordable within 6 hours either side of 20 Crowns on offer, on every map`, () =>
      assert.ok(rs.every(r => lead(r) !== null && Math.abs(lead(r)) <= 6), 'per map: ' + per()));
  }

  // ── What checking in more often is worth: a week abdicating at 20 Crowns ──
  const week = n => rows.filter(r => r.kind === 'week' && r.checkins === n), crowns = r => r.weekCrowns === null ? r.crowns + r.pending : r.weekCrowns;
  const wk = n => mean(week(n).map(crowns)), five = wk(5);
  for (const n of [2, 5, 49, 0]) console.log(`     ${(n ? n + ' a day' : 'never closed').padEnd(13)} Crowns at 7 days ${week(n).map(crowns).join(', ')}; mean ${wk(n).toFixed(1)}, ${Math.round(100 * wk(n) / five)}% of five a day | Palace ${hrs(week(n).map(r => r.palace))}h`);
  check('two check-ins a day end the week with at least 75% of the Crowns of five a day (mean of six maps)', () => assert.ok(wk(2) >= 0.75 * five, `${Math.round(100 * wk(2) / five)}%`));
  check('49 check-ins a day end the week with at most 115% of the Crowns of five a day', () => assert.ok(wk(49) <= 1.15 * five, `${Math.round(100 * wk(49) / five)}%`));
  check('a game that is never closed ends the week with at most 105% of the Crowns of five a day', () => assert.ok(wk(0) <= 1.05 * five, `${Math.round(100 * wk(0) / five)}%`));
  check('nobody starves in a week at any frequency', () => { const bad = rows.filter(r => r.kind === 'week' && (r.starvedHours > 0.25 || r.lostPop >= 1)); assert.ok(!bad.length, bad.map(r => `map ${r.seed} at ${r.checkins} a day: ${r.starvedHours.toFixed(1)}h`).join('; ')); });

  // ── Nothing rewards keeping the game open or holding purchases back ──
  { const one = rows.filter(r => r.kind === 'onebuy'), base = week(5).filter(r => one.some(o => o.seed === r.seed));
    const a = mean(one.map(crowns)), b = mean(base.map(crowns));
    console.log(`     five check-ins a day, buying at one of them only: Crowns at 7 days ${one.map(crowns).join(', ')} against ${base.map(crowns).join(', ')}`);
    check('buying at one check-in a day and resting through the others is not the better way to play', () => assert.ok(a <= b, `${a.toFixed(1)} Crowns against ${b.toFixed(1)}`)); }
  for (const seed of MAPS) { const [idle, tapper] = [0, 3].map(t => rows.find(r => r.kind === 'taps' && r.seed === seed && r.taps === t));
    // The bot taps whenever the game shows the button (sim.canCollect), three times a second.
    const notSooner = (a, b) => b == null || (a != null && a >= b);
    check(`map ${seed}: tapping whenever the button shows brings no hall sooner (the Manor at most 2 minutes) and at most 30% more gold in a day`, () => {
      const msg = `Manor ${tapper.manorMin} v ${idle.manorMin} min, Keep ${tapper.keep} v ${idle.keep} h, Castle ${tapper.castle} v ${idle.castle} h, gold ${Math.round(100 * tapper.lifetimeGold / idle.lifetimeGold - 100)}% more`;
      console.log(`     map ${seed}, tapping against not: ${msg}`);
      assert.ok(tapper.manorMin >= idle.manorMin - 2, msg);
      assert.ok(notSooner(tapper.keep, idle.keep) && notSooner(tapper.castle, idle.castle), msg);
      assert.ok(tapper.lifetimeGold <= 1.3 * idle.lifetimeGold, msg);
    }); }
  { const simple = rows.filter(r => r.kind === 'simple'); // informational: a buyer that just takes the cheapest thing under a tenth of the hall
    console.log(`     simple buyer (cheapest first), maps ${simple.map(r => r.seed).join(', ')}: Manor ${simple.map(r => r.manorMin === null ? '-' : r.manorMin.toFixed(0) + 'm').join(', ')} | Keep ${hrs(simple.map(r => r.keep))}h | Castle ${hrs(simple.map(r => r.castle))}h | Palace ${hrs(simple.map(r => r.palace))}h`); }

  console.log(`\n${failed ? failed + ' failed' : 'all requirements passed'}${gaps ? `; ${gaps} target${gaps > 1 ? 's' : ''} not met yet (GAP lines above)` : ''}`); process.exit(failed ? 1 : 0);
}).catch(e => { console.error(e); process.exit(1); });
