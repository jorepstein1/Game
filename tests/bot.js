'use strict';
// Balance bot: plays the simulation headlessly and prints a progression report.
//   node tests/bot.js [hours=72] [policy=none] [seeds=11,22,33] [check-ins per day=5]
//   node tests/bot.js compare [hours=168] [seeds=11,22,33]    two against five check-ins a day, abdicating at 20 Crowns
// Deterministic: the map comes from the seed and the bot makes no random choices, so the same
// arguments always print the same numbers. No dependencies.
//
// Check-in play (the default). The bot plays an opening session with the game open (25 minutes), then goes away
// and comes back a set number of times a day: N-1 even gaps across a 16-hour day and an 8-hour night (2 a day =
// every 12 hours). Time away is credited through creditAway, exactly as the game does on load, so the offline
// cap applies and long runs are quick to simulate. Each check-in is three minutes with the game open.
// With 0 check-ins a day the bot never closes the game and acts every second, as it always used to.
//
// The bot is a careful player who wants the next hall. Whenever it acts it:
//   1. claims a finished decree;
//   2. if food income is under 10% of upkeep, or the farms could not feed a full town, buys only food;
//   3. else if housing is within 5% of jobs, buys only housing; and waits while villagers are still moving in;
//   4. else buys the hall if it can. Otherwise it works out which material the hall will wait longest for, and
//      for how long, and makes only purchases that leave the hall no later: ones that cost none of that material,
//      ones that add enough of it to pay for themselves within the wait (best payback first), and small change
//      (land and a first building of each kind may cost up to a quarter of the wait, anything else 3%).
//      It never lets a purchase run another hall material short, and it skips producers of a material it
//      already holds far more of than anything it wants costs (noGlut: true turns that off: a careless buyer).
// Policy: none = never abdicate; castle = as soon as the game allows; crowns:N = whenever N Crowns are on offer;
// once:N = the first time only; cycle:N:M = at N Crowns until minute M, then build up; pct:P = when the Crown
// multiplier would rise by P percent. Taps (option taps): hand collections per second while the game is open.
//
// It reports, per check-in, how many purchases it made and how many of those were not routine upgrades (the
// game's one-tap "Routine upgrades" would have covered the rest), and the payback time of what it bought: the
// time the town needs to earn the price divided by the share of gold income the purchase adds, as the
// spend-weighted median per hall level.
const { loadSim } = require('./harness');
const sum = c => Object.values(c).reduce((a, b) => a + b, 0);

function play(seed, opts) {
  opts = opts || {};
  const { hours: HOURS = 4, policy: POLICY = 'none', taps: TAPS = 0, patch } = opts;
  const STAMPS = ((opts && opts.stamps) || [10, 60, 180, 240, 360, 480]).filter(m => m <= HOURS * 60), NEED = POLICY.startsWith('crowns:') ? +POLICY.slice(7) : Infinity;
  const CYCLE = POLICY.startsWith('cycle:') ? POLICY.slice(6).split(':').map(Number) : null; // cycle:N:M = abdicate at N Crowns until minute M, then build up
  const GLUT = !(opts && opts.noGlut);
  // Check-in play: an opening session played second by second, then the bot is away between check-ins. Time away is
  // credited through creditAway, as the game does on load, and each check-in buys what the policy allows at once.
  const CHECKINS = (opts && opts.checkins) || 0, SESSION = (opts && opts.session) || 25, VISIT = (opts && opts.visit) || 3;
  const GAPS = !CHECKINS ? [] : CHECKINS === 1 ? [24] : CHECKINS === 2 ? [12, 12] : Array(CHECKINS - 1).fill(16 / (CHECKINS - 1)).concat(8); // hours; the last is the night
  const sim = loadSim(patch);
  const s = sim.newState(0); s.run = sim.newRun(seed);
  if (opts && opts.crowns) s.meta.crowns = s.meta.bonusCrowns = opts.crowns; // what-if: start with Crowns already held
  sim.setState(s);
  const B = sim.BUILDINGS, out = { seed, marks: {}, stamps: {}, prestiges: [], visits: [], paybacks: [], firsts: [], buys: 0, routine: 0, starve: 0, peakGold: 0, spent: { build: 0, up: 0, research: 0, hall: 0, expand: 0, rep: 0, clear: 0 } };
  const run = () => sim.state.run;
  const plots = () => { const r = sim.mapRadius(), o = [];
    for (let x = sim.MAP_MID - r; x <= sim.MAP_MID + r; x++) for (let y = sim.MAP_MID - r; y <= sim.MAP_MID + r; y++) if (!run().tiles[x + ',' + y] && run().terrain[x][y] === 'plain') o.push([x, y]);
    return o; };
  const bestPlot = (id, ps) => { let best = null, bs = -1; for (const [x, y] of ps) { const v = sim.adjBonus(id, x, y) + 0.3 * sim.givesTo(id, x, y); if (v > bs) { bs = v; best = x + ',' + y; } } return best; };
  function candidates() {
    const c = [], ps = plots(), hl = sim.hallLevel();
    if (ps.length) for (const id of sim.BUILD_ORDER) if (B[id].hall <= hl) c.push({ k: 'build', id, cost: sim.buildCost(id), food: !!(B[id].out && B[id].out.food), house: !!B[id].house, go: () => sim.build(bestPlot(id, ps), id) });
    for (const key in run().tiles) { const t = run().tiles[key], d = t.kind === 'building' ? B[t.id] : null;
      c.push({ k: d ? 'up' : 'hall', id: t.id, key, cost: sim.upgradeCost(t), food: !!(d && d.out && d.out.food), house: !!(d && d.house), go: () => sim.upgrade(key) }); }
    for (const r of sim.RESEARCH) if (!sim.hasResearch(r.id) && r.hall <= hl) c.push({ k: 'research', id: r.id, mult: r.mult, cost: r.cost, food: !!(r.mult && (r.mult.farm || r.mult.mill)), go: () => sim.buyResearch(r.id) });
    if (!ps.length && sim.BUILD_ORDER.some(id => B[id].hall <= hl && sim.count(id) === 0)) { // map full and a new building type is waiting: clear one tile for it
      const r = sim.mapRadius(); let spot = null;
      for (let x = sim.MAP_MID - r; x <= sim.MAP_MID + r && !spot; x++) for (let y = sim.MAP_MID - r; y <= sim.MAP_MID + r; y++) if (!run().tiles[x + ',' + y] && run().terrain[x][y] !== 'plain') { spot = x + ',' + y; break; }
      if (spot) c.push({ k: 'clear', cost: sim.clearCost(), go: () => sim.clearLand(spot) });
    }
    if (run().exp < sim.EXPAND_COST.length) c.push({ k: 'expand', cost: sim.EXPAND_COST[run().exp], go: () => sim.expand() });
    for (const r of sim.REPEATABLES) if (r.hall <= hl) c.push({ k: 'rep', id: r.id, cost: sim.repCost(r), food: r.id === 'food', house: r.id === 'housing', go: () => sim.buyRepeatable(r.id) });
    return c;
  }
  let reignStart = 0, now = 0; const seen = {};
  function act() {
    let bought = 0;
    for (let i = 0; i < 20; i++) {
      sim.setState(sim.state); const C = sim.calc;
      while (sim.decreeDone()) sim.claimDecree();
      let c = candidates();
      const hungry = C.rates.food < 0.1 * C.eaten && !(C.rates.food > 0 && run().res.food > C.eaten * 600);
      const cramped = C.cap < C.need * 1.05 + 3;
      // Food-bound: the farms could not feed the town if every home were full. Then food comes first, if any is affordable.
      const foodBound = !hungry && C.base.food + C.eaten < sim.upkeep(C.cap) * 1.05 && c.some(a => a.food && sim.canAfford(a.cost));
      if (hungry || foodBound) c = c.filter(a => a.food);
      else if (cramped) c = c.filter(a => a.house);
      else {
        if (C.staff < 1) return bought; // housing is there: wait for villagers to move in
        const nt = Object.keys(run().tiles).length, nf = sim.count('farm') + sim.count('mill'), roomy = C.cap >= C.need * 1.25 + 10, few = plots().length <= 3;
        // No point raising output of a material already piled up far beyond anything on the shopping list.
        const lim = 0.2 * sum(sim.upgradeCost(run().tiles[sim.HALL_KEY])), want = {};
        for (const a of c) if (a.k === 'hall' || a.k === 'expand' || a.k === 'research' || sum(a.cost) <= lim) for (const r in a.cost) want[r] = Math.max(want[r] || 0, a.cost[r]);
        const glut = a => GLUT && (a.k === 'up' || a.k === 'build') && B[a.id] && B[a.id].out && sim.count(a.id) > 0 && Object.keys(B[a.id].out).every(r => r !== 'gold' && r !== 'food' && run().res[r] > 5 * (want[r] || 0) + 1000);
        c = c.filter(a => !glut(a));
        c = c.filter(a => (a.food ? a.k === 'build' && nf < 0.22 * nt : true) && !(a.house && roomy) && !(a.k === 'build' && sim.count(a.id) > 0 && few));
      }
      c = c.filter(a => sim.canAfford(a.cost)).sort((a, b) => sum(a.cost) - sum(b.cost));
      if (!c.length) return bought;
      let pick = c[0];
      if (!hungry && !foodBound && !cramped) {
        // The hall is the goal. L is the material it will wait longest for and eta that wait at today's rates.
        const hcost = sim.upgradeCost(run().tiles[sim.HALL_KEY]), res = run().res;
        let L = 'gold', eta = 0;
        for (const r in hcost) if (res[r] < hcost[r]) { const w = C.base[r] > 0 ? (hcost[r] - res[r]) / C.base[r] : Infinity; if (w >= eta) { eta = w; L = r; } }
        const steward = c.find(a => a.k === 'research' && a.id === 'steward'); // a full day away counts: the first thing a player who sleeps buys
        if (steward) pick = steward;
        else if (!eta) pick = c.find(a => a.k === 'hall');
        else {
          // A purchase is worth making if the hall then comes sooner: after paying for it and counting what it adds
          // (estimated from what the town makes now), the longest wait for any hall material is shorter than before.
          // Things that add nothing the hall needs (land, a first building of a kind) may cost a little of the wait.
          const gain = (a, r) => {
            const def = B[a.id], tiles = run().tiles;
            if (a.k === 'up' && def) return def.glob ? def.glob * C.base[r] / (1 + def.glob * tiles[a.key].level) : def.out && def.out[r] ? def.out[r] * C.tiles[a.key].mult / (def.linear ? tiles[a.key].level : 1) : 0;
            if (a.k === 'build') return def.glob ? def.glob * C.base[r] : def.out && def.out[r] ? def.out[r] * C.mult * sim.researchMult(a.id) : 0;
            if (a.k === 'research' && a.mult) { let d = 0; for (const key in C.tiles) { const t = tiles[key], o = B[t.id].out; if (a.mult[t.id] && o && o[r]) d += o[r] * C.tiles[key].mult * (a.mult[t.id] - 1); } return d; }
            if (a.k === 'rep' && a.id === 'prod') return C.base[r] * 0.05 / sim.repBonus('prod');
            return 0;
          };
          const waitAfter = a => { let w = 0;
            for (const r in hcost) { const need = hcost[r] - res[r] + (a.cost[r] || 0); if (need > 0) { const rate = C.base[r] + gain(a, r); w = Math.max(w, rate > 0 ? need / rate : 1 / 0); } }
            return w; };
          let best = 1 / 0; pick = null;
          for (const a of c) { // c is cheapest first, so ties go to the cheapest
            if (a.k === 'hall') continue;
            const w = waitAfter(a), fresh = a.k === 'build' && sim.count(a.id) === 0, slack = a.k === 'expand' || a.k === 'clear' || fresh ? 1.25 : 1.03;
            let score = w < eta ? w / eta : w === eta || (eta === 1 / 0) || w <= eta * slack ? 1 + 1e-12 * sum(a.cost) : 1 / 0;
            if (fresh && score < 1 / 0) score = -1;
            if (score < best) { best = score; pick = a; }
          }
        }
        if (!pick) return bought;
      }
      out.spent[pick.k] += pick.cost.gold || 0;
      if (pick.k === 'up' && Object.keys(pick.cost).every(r => pick.cost[r] <= Math.max(0, C.base[r] + (r === 'food' ? C.eaten : 0)) * sim.ROUTINE_SECONDS)) out.routine++; // what the game's one-tap "routine upgrades" would have covered
      out.buys++; const what = pick.k === 'build' ? pick.id : pick.k === 'research' ? 'research' : pick.k === 'hall' ? 'hall' + (sim.hallLevel() + 1) : null;
      if (what && !seen[what]) { seen[what] = 1; out.firsts.push({ what, t: now < 3600 ? Math.round(now) + 's' : (now / 3600).toFixed(1) + 'h' }); }
      // Payback: the time the town needs to earn the price, divided by the share of gold income the purchase adds.
      const g0 = C.base.gold, earn = Object.keys(pick.cost).reduce((t, r) => t + (C.base[r] > 0 ? pick.cost[r] / C.base[r] : Infinity), 0);
      pick.go(); bought++; sim.setState(sim.state);
      const dg = sim.calc.base.gold - g0;
      if (pick.k !== 'hall' && g0 > 0 && dg > 1e-9 * g0 && isFinite(earn)) out.paybacks.push({ hall: sim.hallLevel(), reign: out.prestiges.length, hours: earn / (dg / g0) / 3600, weight: earn, kind: pick.k });
    }
    return bought;
  }

  const snap = () => { sim.setState(sim.state); const C = sim.calc, lv = id => { const a = Object.values(run().tiles).filter(t => id(t)); return a.length + '×' + (a.reduce((p, t) => p + t.level, 0) / (a.length || 1)).toFixed(1); };
    return { hall: sim.hallName(sim.hallLevel()), pop: Math.floor(run().pop), housing: C.cap, jobs: C.need, gold: sim.fmt(C.base.gold) + '/s', food: sim.fmt(C.base.food) + '/s', upkeep: sim.fmt(C.eaten) + '/s',
      farms: lv(t => t.id === 'farm' || t.id === 'mill'), cottages: lv(t => t.id === 'cottage'), other: lv(t => t.kind === 'building' && !['farm', 'mill', 'cottage'].includes(t.id)),
      pending: sim.pendingCrowns(), repeatables: JSON.stringify(run().repeatables),
      stone: sim.fmt(C.base.stone) + '/s', iron: sim.fmt(C.base.iron) + '/s', stock: Object.keys(run().res).map(r => r + ' ' + sim.fmt(run().res[r])).join(', '), plots: plots().length }; };
  let t = 0, si = 0, hall = 1, runStart = 0, tapDebt = 0;
  // After any stretch of time: note new hall levels, abdicate if the policy says so, take the periodic snapshots.
  function afterStep() {
    if (sim.hallLevel() > hall) { hall = sim.hallLevel(); const name = sim.hallName(hall);
      if (out.prestiges.length === 0 && !out.marks[name]) out.marks[name] = { min: +(t / 60).toFixed(1), pending: sim.pendingCrowns(), lifetimeGold: sim.fmt(sim.state.meta.stats.totalGold), goldRate: sim.calc.base.gold }; }
    if (out.prestiges.length === 0) for (const n of [15, 20]) if (!out.marks['crowns' + n] && sim.pendingCrowns() >= n) out.marks['crowns' + n] = { min: +(t / 60).toFixed(1) };
    for (const n of [100]) if (!out.marks['held' + n] && sim.state.meta.crowns >= n) out.marks['held' + n] = { min: +(t / 60).toFixed(1) };
    if (sim.canPrestige()) {
      const cur = 1 + sim.CROWN_BONUS * sim.state.meta.crowns, next = 1 + sim.CROWN_BONUS * (sim.state.meta.crowns + sim.pendingCrowns());
      if (POLICY === 'castle' || (POLICY.startsWith('pct:') && next / cur >= 1 + POLICY.slice(4) / 100) || sim.pendingCrowns() >= NEED || (CYCLE && t < CYCLE[1] * 60 && sim.pendingCrowns() >= CYCLE[0]) || (POLICY.startsWith('once:') && !out.prestiges.length && sim.pendingCrowns() >= +POLICY.slice(5))) {
        const n = sim.pendingCrowns(); out.prestiges.push({ min: +(t / 60).toFixed(1), runMin: +((t - runStart) / 60).toFixed(1), hall, crowns: n, total: sim.state.meta.crowns + n, boost: '+' + Math.round((next / cur - 1) * 100) + '%' });
        sim.prestige(); sim.state.run = sim.newRun(seed, sim.state.meta.crowns); sim.setState(sim.state); hall = 1; runStart = t; reignStart = t; // same map every reign: strategies differ only in timing
        return true;
      }
    }
    while (si < STAMPS.length && t >= STAMPS[si] * 60) out.stamps[STAMPS[si++]] = snap();
    return false;
  }
  const liveUntil = end => { // played second by second, as with the game open
    while (t < end) {
      sim.advance(0.5); t += 0.5; now = t;
      if (run().starving) out.starve += 0.5;
      if (t % 1 === 0) { tapDebt += TAPS; while (tapDebt >= 1) { sim.collectTaxes(); tapDebt--; } act(); out.peakGold = Math.max(out.peakGold, sim.calc.base.gold); }
      afterStep();
    }
  };
  if (!CHECKINS) liveUntil(HOURS * 3600);
  else {
    liveUntil(Math.min(HOURS * 3600, SESSION * 60));
    for (let i = 0; t < HOURS * 3600; i++) {
      const gap = GAPS[i % GAPS.length] * 3600, pop0 = run().pop, g0 = sim.calc.base.gold;
      const r = sim.creditAway(gap); t += gap; now = t; sim.setState(sim.state);
      const visit = { hour: +(t / 3600).toFixed(1), reign: out.prestiges.length, away: gap / 3600, credited: r.credited / 3600, hall, starving: run().starving, lostPop: Math.max(0, pop0 - run().pop), bought: 0, goldRate: 0,
        hallShare: 0, limit: '' };
      { const hc = sim.upgradeCost(run().tiles[sim.HALL_KEY]); // how many such absences the next hall costs, and the material that sets it
        for (const k in hc) { const n = r.gains[k] ? hc[k] / r.gains[k] : Infinity; if (n > visit.hallShare) { visit.hallShare = n; visit.limit = k; } } }
      if (run().starving) out.starve += r.credited;
      const b0 = out.buys, r0 = out.routine; liveUntil(t + VISIT * 60); visit.bought = out.buys - b0; visit.decisions = visit.bought - (out.routine - r0); // a check-in is a few minutes with the game open
      sim.setState(sim.state); visit.goldRate = sim.calc.base.gold; visit.rates = Object.assign({}, sim.calc.base); visit.runGold = run().gold; visit.pending = sim.pendingCrowns(); visit.crowns = sim.state.meta.crowns; visit.hallAfter = sim.hallLevel();
      out.visits.push(visit); out.peakGold = Math.max(out.peakGold, visit.goldRate);
    }
  }
  sim.setState(sim.state);
  out.totalGold = sim.state.meta.stats.totalGold; out.goldRate = sim.calc.base.gold; out.crowns = sim.state.meta.crowns; out.pending = sim.pendingCrowns();
  out.hall = sim.hallName(sim.hallLevel()); out.fmt = sim.fmt;
  return out;
}

// Spend-weighted median payback (hours) of the purchases made at one hall level in the first reign.
function payback(r, hall) {
  const ps = r.paybacks.filter(p => p.reign === 0 && p.hall === hall).sort((a, b) => a.hours - b.hours), total = ps.reduce((t, p) => t + p.weight, 0);
  let acc = 0; for (const p of ps) { acc += p.weight; if (acc >= total / 2) return p.hours; }
  return null;
}
// What a run came to: the numbers the balance test and the reports below read.
function summary(seed, opts) {
  const r = play(seed, opts), at = name => r.marks[name] ? r.marks[name].min / 60 : null;
  const week = r.visits.filter(v => v.hour <= 168.5).pop();
  return { seed, taps: opts.taps || 0, policy: opts.policy || 'none', checkins: opts.checkins || 0, lifetimeGold: r.totalGold, goldRate: r.goldRate, crowns: r.crowns, pending: r.pending, hall: r.hall,
    manorMin: r.marks.Manor ? r.marks.Manor.min : null, keep: at('Keep'), castle: at('Castle'), palace: at('Palace'), crowns15: at('crowns15'), crowns20: at('crowns20'), legend: at('held100'),
    starvedHours: r.starve / 3600, lostPop: r.visits.reduce((a, v) => a + v.lostPop, 0),
    reigns: r.prestiges.map(p => ({ hours: p.runMin / 60, hall: p.hall, crowns: p.crowns })), weekCrowns: week ? week.crowns + week.pending : null,
    payback: [1, 2, 3, 4, 5].map(h => payback(r, h)), firsts: r.firsts,
    visits: r.visits.map(v => ({ hour: v.hour, away: v.away, credited: v.credited, hall: v.hall, hallAfter: v.hallAfter, reign: v.reign, bought: v.bought, decisions: v.decisions, hallShare: v.hallShare, limit: v.limit, goldRate: v.goldRate, runGold: v.runGold, pending: v.pending, starving: v.starving })) };
}
// Runs a list of { seed, opts } in parallel child processes; resolves to their summaries in the same order.
function runAll(todo, jobs) {
  const { execFile } = require('child_process'), os = require('os');
  const rows = [];
  let next = 0;
  const worker = () => new Promise((resolve, reject) => {
    const i = next++; if (i >= todo.length) return resolve();
    execFile(process.execPath, [__filename, '--one', String(todo[i].seed), JSON.stringify(todo[i].opts)], { maxBuffer: 1 << 26 }, (err, out) => {
      if (err) return reject(err);
      rows[i] = Object.assign(JSON.parse(out), { label: todo[i].label }); worker().then(resolve, reject);
    });
  });
  return Promise.all(Array.from({ length: Math.min(jobs || os.cpus().length, todo.length) }, worker)).then(() => rows);
}
const median = a => { a = a.filter(x => x !== null && x === x).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };
module.exports = { play, summary, runAll, payback, median };

if (require.main === module) {
  if (process.argv[2] === '--one') { console.log(JSON.stringify(summary(+process.argv[3], JSON.parse(process.argv[4])))); return; }
  const h = x => x === null ? '   -  ' : (x.toFixed(1) + 'h').padStart(6), pb = x => x === null ? '-' : x < 1 ? Math.round(x * 60) + 'm' : x.toFixed(1) + 'h', fmt = loadSim().fmt;
  if (process.argv[2] === 'compare') {
    const hours = +(process.argv[3] || 168), seeds = (process.argv[4] || '11,22,33').split(',').map(Number), todo = [];
    for (const checkins of [5, 2]) for (const seed of seeds) todo.push({ seed, opts: { hours, policy: 'crowns:20', checkins } });
    console.log(`Hearthold check-in comparison: ${hours}h, abdicating at 20 Crowns, seeds ${seeds.join(', ')}\n`);
    console.log('check-ins  seed   Keep  Castle  Palace  20 Crowns  Legend  Crowns at 7 days  reign lengths (h)');
    runAll(todo).then(rows => { for (const r of rows)
      console.log(`${String(r.checkins).padStart(9)} ${String(r.seed).padStart(5)} ${h(r.keep)} ${h(r.castle)}  ${h(r.palace)}     ${h(r.crowns20)}  ${h(r.legend)}  ${String(r.weekCrowns).padStart(16)}  ${r.reigns.map(x => x.hours.toFixed(0)).join(', ')}`); });
    return;
  }
  const HOURS = +(process.argv[2] || 72), POLICY = process.argv[3] || 'none', SEEDS = (process.argv[4] || '11,22,33').split(',').map(Number), CHECKINS = process.argv[5] === undefined ? 5 : +process.argv[5];
  console.log(`Hearthold balance bot: ${HOURS}h, policy "${POLICY}", ${CHECKINS ? CHECKINS + ' check-ins a day' : 'game always open'}, seeds ${SEEDS.join(', ')}\n`);
  runAll(SEEDS.map(seed => ({ seed, opts: { hours: HOURS, policy: POLICY, checkins: CHECKINS } }))).then(rows => { for (const r of rows) {
    const first = r.visits.filter(v => v.reign === 0);
    console.log(`seed ${r.seed}: Manor ${r.manorMin === null ? '-' : r.manorMin + ' min'}, Keep ${h(r.keep)}, Castle ${h(r.castle)}, Palace ${h(r.palace)}, 15 Crowns on offer ${h(r.crowns15)}, 20 Crowns ${h(r.crowns20)}, 100 Crowns held ${h(r.legend)}`);
    console.log(`  first of each: ${r.firsts.map(f => f.what + ' ' + f.t).join(', ')}`);
    console.log(`  payback (spend-weighted median) by hall level 1 to 5: ${r.payback.map(pb).join(', ')}`);
    if (first.length) console.log(`  purchases per check-in, first reign: median ${median(first.map(v => v.bought))}, most ${Math.max(...first.map(v => v.bought))}; not routine: median ${median(first.map(v => v.decisions))}, most ${Math.max(...first.map(v => v.decisions))}`);
    for (const v of first) console.log(`    ${String(v.hour).padStart(6)}h  away ${v.away}h (credited ${v.credited.toFixed(1)})  ${String(v.bought).padStart(3)} bought, ${String(v.decisions).padStart(2)} not routine  hall level ${v.hallAfter}  gold ${fmt(v.goldRate)}/s  the next hall was ${v.hallShare === Infinity ? 'out of reach' : v.hallShare.toFixed(1) + ' such absences away (' + v.limit + ')'}  Crowns on offer ${v.pending}${v.starving ? '  STARVING' : ''}`);
    if (r.reigns.length) console.log('  reigns (hours, hall level, Crowns): ' + r.reigns.map(x => `${x.hours.toFixed(1)} L${x.hall} +${x.crowns}`).join(', '));
    console.log(`  after ${HOURS}h: ${r.crowns} Crowns held, ${r.pending} on offer, ${fmt(r.goldRate)} gold/s; starving ${r.starvedHours.toFixed(1)}h${r.weekCrowns !== null && HOURS >= 168 ? '; Crowns at 7 days ' + r.weekCrowns : ''}\n`);
  } });
}
