'use strict';
// Balance bot: plays the simulation headlessly and prints a progression report.
//   node tests/bot.js [hours=4] [policy=none|castle|pct] [seeds=11,22,33,44]
// Deterministic: the map comes from the seed and the bot makes no random choices, so the same
// arguments always print the same numbers. No dependencies.
//
// The bot is a cautious player. It never taps and never meets a merchant. Once a second it:
//   1. claims a finished decree;
//   2. if food income is under 10% of upkeep, buys only food (farms, mills, their research, Granaries);
//   3. else if housing is within 5% of jobs, buys only housing (cottages, Town Planning);
//   4. else builds any building type it has none of, then buys hall upgrades, expansions and research
//      as soon as they are affordable, then the cheapest other purchase costing at most 20% of the next
//      hall upgrade (repeatable upgrades are also allowed up to half the gold in hand).
// Policy: none = never abdicate; castle = abdicate as soon as allowed; pct = abdicate when it adds 25%.
const { loadSim } = require('./harness');
const HOURS = +(process.argv[2] || 4), POLICY = process.argv[3] || 'none';
const SEEDS = (process.argv[4] || '11,22,33,44').split(',').map(Number);
const STAMPS = [10, 60, 180, 240, 360, 480].filter(m => m <= HOURS * 60);
const sum = c => Object.values(c).reduce((a, b) => a + b, 0);

function play(seed) {
  const sim = loadSim();
  const s = sim.newState(0); s.run = sim.newRun(seed); sim.setState(s);
  const B = sim.BUILDINGS, out = { seed, marks: {}, stamps: {}, prestiges: [], starve: 0, spent: { build: 0, up: 0, research: 0, hall: 0, expand: 0, rep: 0 } };
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
        c = c.filter(a => (a.food ? a.k === 'build' && nf < 0.22 * nt : true) && !(a.house && roomy) && !(a.k === 'build' && sim.count(a.id) > 0 && few));
      }
      c = c.filter(a => sim.canAfford(a.cost)).sort((a, b) => sum(a.cost) - sum(b.cost));
      if (!c.length) return;
      let pick = c[0];
      if (!hungry && !cramped) {
        const cap = 0.2 * sum(sim.upgradeCost(run().tiles[sim.HALL_KEY]));
        pick = c.find(a => a.k === 'build' && sim.count(a.id) === 0) || c.find(a => a.k === 'hall' || a.k === 'expand' || a.k === 'research')
          || c.find(a => a.k !== 'hall' && (sum(a.cost) <= cap || (a.k === 'rep' && sum(a.cost) <= 0.5 * run().res.gold)));
        if (!pick) return;
      }
      out.spent[pick.k] += pick.cost.gold || 0; pick.go();
    }
  }
  const snap = () => { sim.setState(sim.state); const C = sim.calc, lv = id => { const a = Object.values(run().tiles).filter(t => id(t)); return a.length + '×' + (a.reduce((p, t) => p + t.level, 0) / (a.length || 1)).toFixed(1); };
    return { hall: sim.hallName(sim.hallLevel()), pop: Math.floor(run().pop), housing: C.cap, jobs: C.need, gold: sim.fmt(C.base.gold) + '/s', food: sim.fmt(C.base.food) + '/s', upkeep: sim.fmt(C.eaten) + '/s',
      farms: lv(t => t.id === 'farm' || t.id === 'mill'), cottages: lv(t => t.id === 'cottage'), other: lv(t => t.kind === 'building' && !['farm', 'mill', 'cottage'].includes(t.id)),
      pending: sim.pendingCrowns(), repeatables: JSON.stringify(run().repeatables) }; };
  let t = 0, si = 0, hall = 1, runStart = 0;
  while (t < HOURS * 3600) {
    sim.advance(0.5); t += 0.5;
    if (run().starving) out.starve += 0.5;
    if (t % 1 === 0) act();
    if (sim.hallLevel() > hall) { hall = sim.hallLevel(); const name = sim.hallName(hall);
      if (out.prestiges.length === 0 && !out.marks[name]) out.marks[name] = { min: +(t / 60).toFixed(1), pending: sim.pendingCrowns(), lifetimeGold: sim.fmt(sim.state.meta.stats.totalGold) }; }
    if (sim.canPrestige()) {
      const cur = 1 + sim.CROWN_BONUS * sim.state.meta.crowns, next = 1 + sim.CROWN_BONUS * (sim.state.meta.crowns + sim.pendingCrowns());
      if (POLICY === 'castle' || (POLICY === 'pct' && next / cur >= 1.25)) {
        const n = sim.pendingCrowns(); out.prestiges.push({ min: +(t / 60).toFixed(1), runMin: +((t - runStart) / 60).toFixed(1), crowns: n, total: sim.state.meta.crowns + n, boost: '+' + Math.round((next / cur - 1) * 100) + '%' });
        sim.prestige(); hall = 1; runStart = t;
      }
    }
    if (si < STAMPS.length && t >= STAMPS[si] * 60) out.stamps[STAMPS[si++]] = snap();
  }
  out.totalGold = sim.state.meta.stats.totalGold;
  return out;
}

console.log(`Hearthold balance bot — ${HOURS}h, policy "${POLICY}", seeds ${SEEDS.join(', ')}\n`);
for (const seed of SEEDS) {
  const r = play(seed);
  console.log(`seed ${seed}`);
  for (const name in r.marks) console.log(`  ${name.padEnd(10)} at ${String(r.marks[name].min).padStart(6)} min   Crowns on offer ${String(r.marks[name].pending).padStart(3)}   lifetime gold ${r.marks[name].lifetimeGold}`);
  for (const m in r.stamps) { const s = r.stamps[m];
    console.log(`  ${String(m).padStart(3)} min: ${s.hall}, pop ${s.pop}/${s.housing} (jobs ${s.jobs}), gold ${s.gold}, food ${s.food} after upkeep ${s.upkeep}, farms+mills ${s.farms}, cottages ${s.cottages}, other ${s.other}, Crowns on offer ${s.pending}, repeatables ${s.repeatables}`); }
  if (r.prestiges.length) console.log('  abdications: ' + r.prestiges.map(p => `${p.min} min (+${p.crowns} → ${p.total}, ${p.boost})`).join('; '));
  const total = Object.values(r.spent).reduce((a, b) => a + b, 0) || 1;
  console.log(`  starving ${(r.starve / 60).toFixed(1)} min of ${HOURS * 60}; gold spent: ` + Object.keys(r.spent).map(k => `${k} ${Math.round(100 * r.spent[k] / total)}%`).join(', ') + '\n');
}
