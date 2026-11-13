'use strict';
// Balance bot: plays the simulation headlessly and prints a progression report.
//   node tests/bot.js [hours=4] [policy] [seeds=11,22,33,44] [taps per second=0]
//   node tests/bot.js compare [hours=4] [seeds=11,33]     never abdicating vs abdicating, with and without tapping
// Deterministic: the map comes from the seed and the bot makes no random choices, so the same
// arguments always print the same numbers. No dependencies.
//
// The bot is a cautious player. It never taps (unless told to) and never meets a merchant. Once a second it:
//   1. claims a finished decree;
//   2. if food income is under 10% of upkeep, buys only food (farms, mills, their research, Granaries);
//   3. else if housing is within 5% of jobs, buys only housing (cottages, Town Planning);
//   4. else builds any building type it has none of (clearing one tile for it if the map is full), then buys
//      hall upgrades, expansions and research as soon as they are affordable, then the cheapest other purchase
//      costing at most 20% of the next hall upgrade (repeatable upgrades are also allowed up to half the gold
//      in hand). It skips producers of a material it already holds far more of than anything it wants costs
//      (option noGlut: true turns that off, which models a careless buyer), and when it has the gold for
//      the hall but lacks a material, it upgrades that material's producer (noBottleneck: true turns that off).
// Policy: none = never abdicate; castle = as soon as the game allows; crowns:N = whenever N Crowns are on offer;
// once:N = the first time only; cycle:N:M = at N Crowns until minute M, then build up; pct:P = when the Crown
// multiplier would rise by P percent. Taps: hand collections per second (0 = none).
const { loadSim } = require('./harness');
const sum = c => Object.values(c).reduce((a, b) => a + b, 0);

function play(seed, opts) {
  const { hours: HOURS = 4, policy: POLICY = 'none', taps: TAPS = 0, patch } = opts || {};
  const STAMPS = ((opts && opts.stamps) || [10, 60, 180, 240, 360, 480]).filter(m => m <= HOURS * 60), NEED = POLICY.startsWith('crowns:') ? +POLICY.slice(7) : Infinity;
  const CYCLE = POLICY.startsWith('cycle:') ? POLICY.slice(6).split(':').map(Number) : null; // cycle:N:M = abdicate at N Crowns until minute M, then build up
  const BOTTLENECK = !(opts && opts.noBottleneck), GLUT = !(opts && opts.noGlut);
  const sim = loadSim(patch);
  const s = sim.newState(0); s.run = sim.newRun(seed);
  if (opts && opts.crowns) s.meta.crowns = s.meta.bonusCrowns = opts.crowns; // what-if: start with Crowns already held
  sim.setState(s);
  const B = sim.BUILDINGS, out = { seed, marks: {}, stamps: {}, prestiges: [], starve: 0, peakGold: 0, spent: { build: 0, up: 0, research: 0, hall: 0, expand: 0, rep: 0, clear: 0 } };
  const run = () => sim.state.run;
  const plots = () => { const r = sim.mapRadius(), o = [];
    for (let x = sim.MAP_MID - r; x <= sim.MAP_MID + r; x++) for (let y = sim.MAP_MID - r; y <= sim.MAP_MID + r; y++) if (!run().tiles[x + ',' + y] && run().terrain[x][y] === 'plain') o.push([x, y]);
    return o; };
  const bestPlot = (id, ps) => { let best = null, bs = -1; for (const [x, y] of ps) { const v = sim.adjBonus(id, x, y) + 0.3 * sim.givesTo(id, x, y); if (v > bs) { bs = v; best = x + ',' + y; } } return best; };
  function candidates() {
    const c = [], ps = plots(), hl = sim.hallLevel();
    if (ps.length) for (const id of sim.BUILD_ORDER) if (B[id].hall <= hl) c.push({ k: 'build', id, cost: sim.buildCost(id), food: !!(B[id].out && B[id].out.food), house: !!B[id].house, go: () => sim.build(bestPlot(id, ps), id) });
    for (const key in run().tiles) { const t = run().tiles[key], d = t.kind === 'building' ? B[t.id] : null;
      c.push({ k: d ? 'up' : 'hall', id: t.id, cost: sim.upgradeCost(t), food: !!(d && d.out && d.out.food), house: !!(d && d.house), go: () => sim.upgrade(key) }); }
    for (const r of sim.RESEARCH) if (!sim.hasResearch(r.id) && r.hall <= hl) c.push({ k: 'research', id: r.id, cost: r.cost, food: !!(r.mult && (r.mult.farm || r.mult.mill)), go: () => sim.buyResearch(r.id) });
    if (!ps.length && sim.BUILD_ORDER.some(id => B[id].hall <= hl && sim.count(id) === 0)) { // map full and a new building type is waiting: clear one tile for it
      const r = sim.mapRadius(); let spot = null;
      for (let x = sim.MAP_MID - r; x <= sim.MAP_MID + r && !spot; x++) for (let y = sim.MAP_MID - r; y <= sim.MAP_MID + r; y++) if (!run().tiles[x + ',' + y] && run().terrain[x][y] !== 'plain') { spot = x + ',' + y; break; }
      if (spot) c.push({ k: 'clear', cost: sim.clearCost(), go: () => sim.clearLand(spot) });
    }
    if (run().exp < sim.EXPAND_COST.length) c.push({ k: 'expand', cost: sim.EXPAND_COST[run().exp], go: () => sim.expand() });
    for (const r of sim.REPEATABLES) if (r.hall <= hl) c.push({ k: 'rep', id: r.id, cost: sim.repCost(r), food: r.id === 'food', house: r.id === 'housing', go: () => sim.buyRepeatable(r.id) });
    return c;
  }
  function act() {
    for (let i = 0; i < 20; i++) {
      sim.setState(sim.state); const C = sim.calc;
      while (sim.decreeDone()) sim.claimDecree();
      let c = candidates();
      const hungry = C.rates.food < 0.1 * C.eaten && !(C.rates.food > 0 && run().res.food > C.eaten * 600);
      const cramped = C.cap < C.need * 1.05 + 3;
      if (hungry) c = c.filter(a => a.food);
      else if (cramped) c = c.filter(a => a.house);
      else {
        if (C.staff < 1) return; // housing is there: wait for villagers to move in
        const nt = Object.keys(run().tiles).length, nf = sim.count('farm') + sim.count('mill'), roomy = C.cap >= C.need * 1.25 + 10, few = plots().length <= 3;
        // No point raising output of a material already piled up far beyond anything on the shopping list.
        const lim = 0.2 * sum(sim.upgradeCost(run().tiles[sim.HALL_KEY])), want = {};
        for (const a of c) if (a.k === 'hall' || a.k === 'expand' || a.k === 'research' || sum(a.cost) <= lim) for (const r in a.cost) want[r] = Math.max(want[r] || 0, a.cost[r]);
        const glut = a => GLUT && (a.k === 'up' || a.k === 'build') && B[a.id] && B[a.id].out && sim.count(a.id) > 0 && Object.keys(B[a.id].out).every(r => r !== 'gold' && r !== 'food' && run().res[r] > 5 * (want[r] || 0) + 1000);
        c = c.filter(a => !glut(a));
        c = c.filter(a => (a.food ? a.k === 'build' && nf < 0.22 * nt : true) && !(a.house && roomy) && !(a.k === 'build' && sim.count(a.id) > 0 && few));
      }
      c = c.filter(a => sim.canAfford(a.cost)).sort((a, b) => sum(a.cost) - sum(b.cost));
      if (!c.length) return;
      let pick = c[0];
      if (!hungry && !cramped) {
        const cap = 0.2 * sum(sim.upgradeCost(run().tiles[sim.HALL_KEY]));
        pick = c.find(a => a.k === 'build' && sim.count(a.id) === 0) || c.find(a => a.k === 'clear') || c.find(a => a.k === 'hall' || a.k === 'expand' || a.k === 'research')
          || c.find(a => a.k !== 'hall' && (sum(a.cost) <= cap || (a.k === 'rep' && sum(a.cost) <= 0.5 * run().res.gold)));
        if (!pick) { // saving for the hall with gold to spare: put it into whatever the hall is short of (a mine, a quarry)
          const hc = sim.upgradeCost(run().tiles[sim.HALL_KEY]), short = Object.keys(hc).filter(r => r !== 'gold' && run().res[r] < hc[r]);
          if (BOTTLENECK && short.length && run().res.gold >= (hc.gold || 0)) pick = c.find(a => (a.k === 'up' || a.k === 'build') && B[a.id] && B[a.id].out && short.some(r => B[a.id].out[r]) && !short.some(r => a.cost[r]) && run().res.gold - (a.cost.gold || 0) >= (hc.gold || 0));
        }
        if (!pick) return;
      }
      out.spent[pick.k] += pick.cost.gold || 0; pick.go();
    }
  }
  const snap = () => { sim.setState(sim.state); const C = sim.calc, lv = id => { const a = Object.values(run().tiles).filter(t => id(t)); return a.length + '×' + (a.reduce((p, t) => p + t.level, 0) / (a.length || 1)).toFixed(1); };
    return { hall: sim.hallName(sim.hallLevel()), pop: Math.floor(run().pop), housing: C.cap, jobs: C.need, gold: sim.fmt(C.base.gold) + '/s', food: sim.fmt(C.base.food) + '/s', upkeep: sim.fmt(C.eaten) + '/s',
      farms: lv(t => t.id === 'farm' || t.id === 'mill'), cottages: lv(t => t.id === 'cottage'), other: lv(t => t.kind === 'building' && !['farm', 'mill', 'cottage'].includes(t.id)),
      pending: sim.pendingCrowns(), repeatables: JSON.stringify(run().repeatables),
      stone: sim.fmt(C.base.stone) + '/s', iron: sim.fmt(C.base.iron) + '/s', stock: Object.keys(run().res).map(r => r + ' ' + sim.fmt(run().res[r])).join(', '), plots: plots().length }; };
  let t = 0, si = 0, hall = 1, runStart = 0, tapDebt = 0;
  while (t < HOURS * 3600) {
    sim.advance(0.5); t += 0.5;
    if (run().starving) out.starve += 0.5;
    if (t % 1 === 0) { tapDebt += TAPS; while (tapDebt >= 1) { sim.collectTaxes(); tapDebt--; } act(); out.peakGold = Math.max(out.peakGold, sim.calc.base.gold); }
    if (sim.hallLevel() > hall) { hall = sim.hallLevel(); const name = sim.hallName(hall);
      if (out.prestiges.length === 0 && !out.marks[name]) out.marks[name] = { min: +(t / 60).toFixed(1), pending: sim.pendingCrowns(), lifetimeGold: sim.fmt(sim.state.meta.stats.totalGold) }; }
    if (sim.canPrestige()) {
      const cur = 1 + sim.CROWN_BONUS * sim.state.meta.crowns, next = 1 + sim.CROWN_BONUS * (sim.state.meta.crowns + sim.pendingCrowns());
      if (POLICY === 'castle' || (POLICY.startsWith('pct:') && next / cur >= 1 + POLICY.slice(4) / 100) || sim.pendingCrowns() >= NEED || (CYCLE && t < CYCLE[1] * 60 && sim.pendingCrowns() >= CYCLE[0]) || (POLICY.startsWith('once:') && !out.prestiges.length && sim.pendingCrowns() >= +POLICY.slice(5))) {
        const n = sim.pendingCrowns(); out.prestiges.push({ min: +(t / 60).toFixed(1), runMin: +((t - runStart) / 60).toFixed(1), hall, crowns: n, total: sim.state.meta.crowns + n, boost: '+' + Math.round((next / cur - 1) * 100) + '%' });
        sim.prestige(); sim.state.run = sim.newRun(seed, sim.state.meta.crowns); sim.setState(sim.state); hall = 1; runStart = t; // same map every reign: strategies differ only in timing
      }
    }
    if (si < STAMPS.length && t >= STAMPS[si] * 60) out.stamps[STAMPS[si++]] = snap();
  }
  sim.setState(sim.state);
  out.totalGold = sim.state.meta.stats.totalGold; out.goldRate = sim.calc.base.gold; out.crowns = sim.state.meta.crowns; out.pending = sim.pendingCrowns();
  out.hall = sim.hallName(sim.hallLevel()); out.fmt = sim.fmt;
  return out;
}

// Strategy comparison: the same seeds played without abdicating and with it, each with and without tapping.
// Every reign uses the same map, so the strategies differ only in when they start over. Runs go in parallel.
const STRATEGIES = [
  ['never abdicate', 'none'],
  ['at 20 Crowns until 2.5h, then build', 'cycle:20:150'],
  ['at every chance (15 Crowns)', 'castle'],
];
function summary(seed, opts) {
  const r = play(seed, opts);
  return { seed, taps: opts.taps || 0, policy: opts.policy, lifetimeGold: r.totalGold, goldRate: r.goldRate, peakGold: r.peakGold, crowns: r.crowns, pending: r.pending, hall: r.hall,
    starvedMin: r.starve / 60, abdications: r.prestiges.map(p => p.min), reigns: r.prestiges.map(p => ({ minutes: p.runMin, hall: p.hall })), castle: r.marks.Castle ? r.marks.Castle.min : null, palace: r.marks.Palace ? r.marks.Palace.min : null, stamps: r.stamps };
}
function compare(hours, seeds, tapRates, jobs) {
  const todo = [];
  for (const seed of seeds) for (const taps of tapRates) for (const [label, policy] of STRATEGIES) todo.push({ seed, label, opts: { hours, policy, taps } });
  return runAll(todo, jobs);
}
// Runs a list of { seed, label, opts } in parallel child processes; resolves to their summaries in the same order.
function runAll(todo, jobs) {
  const { execFile } = require('child_process'), os = require('os');
  const rows = [];
  let next = 0;
  const worker = () => new Promise((resolve, reject) => {
    const i = next++; if (i >= todo.length) return resolve();
    execFile(process.execPath, [__filename, '--one', String(todo[i].seed), JSON.stringify(todo[i].opts)], { maxBuffer: 1 << 24 }, (err, out) => {
      if (err) return reject(err);
      rows[i] = Object.assign(JSON.parse(out), { label: todo[i].label }); worker().then(resolve, reject);
    });
  });
  return Promise.all(Array.from({ length: Math.min(jobs || os.cpus().length, todo.length) }, worker)).then(() => rows);
}
module.exports = { play, summary, compare, runAll, STRATEGIES };

if (require.main === module) {
  if (process.argv[2] === '--one') { console.log(JSON.stringify(summary(+process.argv[3], JSON.parse(process.argv[4])))); return; }
  if (process.argv[2] === 'compare') {
    const hours = +(process.argv[3] || 4), seeds = (process.argv[4] || '11,33').split(',').map(Number), fmt = loadSim().fmt;
    console.log(`Hearthold strategy comparison — ${hours}h, seeds ${seeds.join(', ')}\n`);
    console.log('seed taps/s  abdication strategy                   lifetime gold   gold/s at end  Crowns held+offered  abdications at (min)');
    compare(hours, seeds, [0, 0.5]).then(rows => { for (const r of rows)
      console.log(`${String(r.seed).padStart(4)} ${String(r.taps).padStart(6)}  ${r.label.padEnd(36)} ${fmt(r.lifetimeGold).padStart(14)} ${fmt(r.goldRate).padStart(15)}  ${(r.crowns + '+' + r.pending).padStart(19)}  ${r.abdications.join(', ') || '-'}`); });
    return;
  }
  const HOURS = +(process.argv[2] || 4), POLICY = process.argv[3] || 'none', SEEDS = (process.argv[4] || '11,22,33,44').split(',').map(Number), TAPS = +(process.argv[5] || 0);
  console.log(`Hearthold balance bot — ${HOURS}h, policy "${POLICY}", seeds ${SEEDS.join(', ')}${TAPS ? ', ' + TAPS + ' taps/s' : ''}\n`);
  for (const seed of SEEDS) {
    const r = play(seed, { hours: HOURS, policy: POLICY, taps: TAPS });
    console.log(`seed ${seed}`);
    for (const name in r.marks) console.log(`  ${name.padEnd(10)} at ${String(r.marks[name].min).padStart(6)} min   Crowns on offer ${String(r.marks[name].pending).padStart(3)}   lifetime gold ${r.marks[name].lifetimeGold}`);
    for (const m in r.stamps) { const s = r.stamps[m];
      console.log(`  ${String(m).padStart(3)} min: ${s.hall}, pop ${s.pop}/${s.housing} (jobs ${s.jobs}), gold ${s.gold}, food ${s.food} after upkeep ${s.upkeep}, farms+mills ${s.farms}, cottages ${s.cottages}, other ${s.other}, Crowns on offer ${s.pending}, repeatables ${s.repeatables}`); }
    if (r.prestiges.length) console.log('  abdications: ' + r.prestiges.map(p => `${p.min} min (+${p.crowns} → ${p.total}, ${p.boost})`).join('; ')
      + '\n  reign lengths (min, hall level reached): ' + r.prestiges.map(p => `${p.runMin} L${p.hall}`).join(', '));
    const total = Object.values(r.spent).reduce((a, b) => a + b, 0) || 1;
    console.log(`  starving ${(r.starve / 60).toFixed(1)} min of ${HOURS * 60}; gold spent: ` + Object.keys(r.spent).map(k => `${k} ${Math.round(100 * r.spent[k] / total)}%`).join(', ') + '\n');
  }
}
