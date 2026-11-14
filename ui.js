'use strict';
/* Hearthold — browser UI: rendering, input, timers and localStorage.
   All game rules live in sim.js; this file only reads `state`/`calc` and calls sim actions. */

const SAVE_KEY = 'hearthold-save-v1';          // storage slot (the name predates save versions; the version is the `v` field)
const BACKUP_KEY = SAVE_KEY + '-unreadable';    // copy of a save that failed to load
const TAB_KEY = SAVE_KEY + '-tab';              // id of the tab that currently owns the save
const TAB_ID = Date.now().toString(36) + Math.random().toString(36).slice(2);

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let lastTick = Date.now(); // wall-clock time the simulation has been advanced to

const BAR_SETTLE_MS = 350; // a second tap on the bottom bar is ignored this long after a tap that swapped its buttons

// UI-only state: nothing here is saved.
const ui = {
  screen: 'city',
  sel: {},               // { build: id } or { tile: 'x,y' }
  tab: 'build',
  sheet: false,          // phones: whether the tab's panel is open as a sheet over the map
  popKey: null,          // tile to play the placement animation on
  mapN: 0,               // map size last drawn; 0 forces a recentre on the hall
  mapPans: false,
  barMode: '',           // what the bottom bar is showing: 'build', 'tile' or 'terrain'
  barTapAt: -Infinity,   // when, and in which mode, the bar was last tapped
  barTapMode: '', barTapX: 0, barTapY: 0,
  warnedStarve: false,
  paused: false,         // another tab took over the save
  saveFailed: false,
  askedPersist: false,
};

// ───────────────────────── DOM patching ─────────────────────────
// Regions are described as HTML strings, then synced into the live DOM node by node. Unchanged output
// is skipped entirely, and changed output keeps existing elements, so focus, scroll position and a
// press in progress all survive a re-render.
const lastHTML = new WeakMap();
function patch(el, html) {
  if (lastHTML.get(el) === html) return;
  lastHTML.set(el, html);
  const tpl = document.createElement('template'); tpl.innerHTML = html;
  syncChildren(el, tpl.content);
}
function syncChildren(dst, src) {
  let d = dst.firstChild, s = src.firstChild;
  while (s) {
    const nextS = s.nextSibling;
    if (!d) dst.appendChild(s);
    else if (d.nodeType !== s.nodeType || d.nodeName !== s.nodeName) { dst.replaceChild(s, d); d = s.nextSibling; }
    else {
      if (d.nodeType === 1) {
        for (const a of [...d.attributes]) if (!s.hasAttribute(a.name)) d.removeAttribute(a.name);
        for (const a of s.attributes) if (d.getAttribute(a.name) !== a.value) d.setAttribute(a.name, a.value);
        syncChildren(d, s);
      } else if (d.nodeValue !== s.nodeValue) d.nodeValue = s.nodeValue;
      d = d.nextSibling;
    }
    s = nextS;
  }
  while (d) { const next = d.nextSibling; dst.removeChild(d); d = next; }
}

// ───────────────────────── Rendering: city screen ─────────────────────────
const costHTML = (cost, plain) => '<span class="cost">' + Object.keys(cost).map(r =>
  `<span class="${!plain && state.run.res[r] < cost[r] ? 'lack' : ''}">${RESOURCES[r].icon} ${fmt(cost[r])}</span>`).join('') + '</span>';
const tileAt = key => state.run.tiles[key];
// What a purchase would add each second at today's multipliers, for its card: "+4.0 💰/s".
const addsHTML = adds => { const ks = Object.keys(adds).filter(r => adds[r] > 0); return ks.length ? '<span class="adds">adds ' + ks.map(r => `<b>${fmtRate(adds[r])}</b> ${RESOURCES[r].icon}`).join(' ') + '</span>' : ''; };
function buildAdds(id) { const d = BUILDINGS[id], a = {};
  if (d.glob) for (const r in calc.base) { if (calc.base[r] > 0) a[r] = calc.base[r] * d.glob; }
  else for (const r in d.out || {}) a[r] = d.out[r] * calc.mult * researchMult(id) * (d.out.food ? repBonus('food') : 1);
  return a; }
function researchAdds(r) { const a = {}; if (!r.mult) return a;
  for (const k in calc.tiles) { const t = state.run.tiles[k], o = BUILDINGS[t.id] && BUILDINGS[t.id].out; if (o && r.mult[t.id]) for (const res in o) a[res] = (a[res] || 0) + o[res] * calc.tiles[k].mult * (r.mult[t.id] - 1); }
  return a; }
// One line on the rested bonus: what it is doing now, or how far off it is.
function restLine() { const left = REST_AFTER_HOURS * 3600 - state.run.away;
  return left <= 0 ? '😴 Rested: time away counts double until you next buy.' : `😴 Rest begins after ${fmtDuration(left)} more away without a purchase; from then time away counts double.`; }
// Says so when abdication is open, wherever the player might be wondering what to do next.
const abdicateLine = () => canPrestige() ? `👑 <b>You can abdicate: ${fmt(pendingCrowns())} Crowns on offer</b>${pendingCrowns() >= CROWN_GOAL ? ', a good offer' : `; ${CROWN_GOAL} or more pays best`}. See the Realm tab.` : '';
// While the next hall is within HALL_NEAR_HOURS of income: what buying this would do to the wait for it.
const HALL_NEAR_HOURS = 12;
function hallDelay(cost, adds) {
  const hall = tileAt(HALL_KEY), w = hallWait(); if (hall.level >= MAX_LEVEL || !isFinite(w) || w > HALL_NEAR_HOURS * 3600 || !canAfford(cost)) return '';
  const hc = upgradeCost(hall); let after = 0;
  for (const r in hc) { const need = hc[r] - state.run.res[r] + (cost[r] || 0), rate = calc.base[r] + ((adds && adds[r]) || 0); if (need > 0) after = Math.max(after, rate > 0 ? need / rate : Infinity); }
  const d = after - w, name = hallName(hall.level + 1);
  return d > 60 ? `<span class="delay">delays the ${name} by about ${isFinite(d) ? fmtDuration(d) : 'a long while'}</span>` : d < -60 ? `<span class="adds">brings the ${name} about ${fmtDuration(-d)} closer</span>` : '';
}
// The next hall: its price and how long the town needs to afford it at today's income. Shown at the top of Build.
function hallHint() {
  const hall = tileAt(HALL_KEY); if (hall.level >= MAX_LEVEL) return '';
  const c = upgradeCost(hall), w = hallWait(), name = hallName(hall.level + 1);
  const when = w === 0 ? '<b class="ready">Ready to raise: tap here.</b>' : isFinite(w) ? `At this rate: ${name} in about <b>${fmtDuration(w)}</b>.` : 'Not all of this is being produced yet.';
  return `<button class="card hallhint${w === 0 ? ' glowcard' : ''}" data-act="hall"><div class="ic">${tileKind(hall).icon(hall)}</div><div class="bd"><div class="nm">Next: ${name}</div>${costHTML(c)}<div class="muted when">${when} Purchases that add income bring it closer; anything else puts it off.</div>${abdicateLine() ? `<div class="when">${abdicateLine()}</div>` : ''}<div class="muted when">${restLine()}</div></div></button>`;
}

// The routine-upgrades preview walks every building, so it is worked out at most once per action or every two seconds.
function routinePreview() {
  const now = performance.now();
  if (!ui.routine || now - ui.routine.at > 2000) { ui.routine = routineUpgrades(true); ui.routine.at = now; }
  return ui.routine;
}
function renderResources() {
  const run = state.run, res = run.res;
  let h = '';
  for (const r in RESOURCES) {
    if (r === 'iron' && hallLevel() < 3 && !res.iron) continue;
    if (r === 'stone' && !res.stone && !count('quarry')) continue;
    const bad = r === 'food' && run.starving;
    h += `<div class="chip${bad ? ' bad' : ''}" title="${RESOURCES[r].name}"><span>${RESOURCES[r].icon}<b>${fmt(res[r])}</b></span><small class="${calc.rates[r] < 0 ? 'neg' : ''}">${fmtRate(calc.rates[r]).replace('/s', '<i>/s</i>')}</small></div>`;
  }
  const full = foodRateAt(calc.cap), hungry = run.pop < calc.cap - 0.5 && full < 0 && !run.starving;
  h += `<div class="chip${calc.staff < 1 ? ' bad' : ''}" title="Population of housing${hungry ? ' (short of food, so no one is moving in)' : ''}. Jobs to fill: ${fmt(calc.need)}${calc.staff < 1 ? ' (understaffed)' : ''}. Food upkeep: ${foodPerPop(run.pop).toFixed(2)} per villager per second. At full housing: food ${fmtRate(full)}"><span>👥<b>${fmt(run.pop)}</b></span><small class="${calc.staff < 1 || hungry ? 'neg' : ''}">of ${fmt(calc.cap)}</small></div>`;
  if (state.meta.crowns) h += `<div class="chip crown timed" title="Crowns: ${pct(CROWN_BONUS)} production each"><span>👑</span><small><b>${fmt(state.meta.crowns)}</b></small></div>`;
  patch($('res'), h);
  const bar = $('res'); bar.classList.toggle('more', bar.scrollWidth > bar.clientWidth + 1 && bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 1);
  patch($('clickval'), '+' + fmt(clickValue()));
  $('clicker').hidden = hallLevel() >= 2; // a flourish for the first minutes: from the Manor on the strip belongs to the inspector
  patch($('subtitle'), esc(hallName(hallLevel()) + ' of ' + Math.floor(run.pop) + ' souls'));
}

function tileLabel(key, t, tr) {
  if (t) return tileKind(t).name(t) + ', level ' + t.level;
  return TERRAIN[tr].name + (tr === 'plain' && ui.sel.build ? ', build ' + BUILDINGS[ui.sel.build].name + ' here' : '');
}
function renderMap() {
  const run = state.run, half = mapRadius(), n = half * 2 + 1, m = $('map');
  m.style.setProperty('--n', n); $('mapwrap').style.setProperty('--n', n); // the frame's size depends on it too
  let h = '';
  for (let y = MAP_MID - half; y <= MAP_MID + half; y++) for (let x = MAP_MID - half; x <= MAP_MID + half; x++) {
    const k = x + ',' + y, t = run.tiles[k], tr = run.terrain[x][y];
    let cls = 'tile ' + tr, inner = TERRAIN[tr].icon;
    if (t) {
      cls += ' built' + (t.kind === 'hall' ? ' hall' : '');
      inner = tileKind(t).icon(t) + (t.level > 1 ? `<span class="lv">${t.level}</span>` : '');
      if (calc.tiles[k] && calc.tiles[k].adj > 0) inner += `<span class="bn">${pct(calc.tiles[k].adj)}</span>`;
    } else if (tr === 'plain' && ui.sel.build) {
      cls += ' can';
      const a = adjBonus(ui.sel.build, x, y), gv = givesTo(ui.sel.build, x, y);
      if (a > 0) inner = `<span class="pv">${pct(a)}</span>`; else if (gv) inner = `<span class="pv">▲${gv}</span>`;
    }
    if (ui.sel.tile === k) cls += ' sel';
    if (ui.popKey === k) cls += ' pop';
    h += `<button class="${cls}" data-act="tile" data-id="${k}" aria-label="${esc(tileLabel(k, t, tr))}">${inner}</button>`;
  }
  patch(m, h); ui.popKey = null;
  const sc = $('mapscroll');
  // Only a map too big for its frame becomes a scroll container. The room is the frame's shorter inner side:
  // on desktop the frame is square; on phones CSS sizes the grid to the shorter side, down to 40px tiles.
  const cs = getComputedStyle(sc), room = Math.min(sc.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), sc.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
  const pans = n * 40 + (n - 1) * 3 + 4 > room + 1;
  sc.classList.toggle('pans', pans);
  // Recentre on the hall only when the map changes size or first becomes pannable, never on a plain re-render
  // or resize (mobile browsers fire resize whenever the address bar shows or hides).
  if (n !== ui.mapN || (pans && !ui.mapPans)) { ui.mapN = n; sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) / 2; sc.scrollTop = (sc.scrollHeight - sc.clientHeight) / 2; }
  ui.mapPans = pans;
  $('maphint').hidden = !pans;
}

// What one more level of a building adds per second (the same sum the Upgrade button shows).
function upgradeAdds(k, t) { const d = BUILDINGS[t.id], info = calc.tiles[k], a = {}; if (!d.out || !info) return a;
  for (const r in d.out) a[r] = d.linear ? d.out[r] * info.mult / info.levelMult : d.out[r] * info.mult; return a; }
function buildingStats(id) {
  const d = BUILDINGS[id]; let h = '';
  if (d.house) h += `<p class="stat">🏠 Houses <b>${d.house}</b> villagers per level</p>`;
  if (d.out) h += `<p class="stat">Produces ` + Object.keys(d.out).map(r => `<b>${d.out[r]} ${RESOURCES[r].icon}/s</b>`).join(' ') + (d.linear ? ' per level' : '') + (d.work ? ` · needs ${d.work} 👥` : '') + '</p>';
  if (d.glob) h += `<p class="stat">All production <b>${pct(d.glob)}</b> · needs ${d.work} 👥</p>`;
  const adj = d.adj || {};
  for (const a in adj.terrain || {}) h += `<p class="stat"><b>${pct(adj.terrain[a])}</b> per adjacent ${TERRAIN[a].name} ${TERRAIN[a].icon}</p>`;
  for (const a in adj.building || {}) h += `<p class="stat"><b>${pct(adj.building[a])}</b> per adjacent ${BUILDINGS[a].name} ${BUILDINGS[a].icon} (per level)</p>`;
  for (const o of BUILD_ORDER) if (boosts(o, id)) h += `<p class="stat">Boosts adjacent ${BUILDINGS[o].name}s ${BUILDINGS[o].icon} by <b>${pct(BUILDINGS[o].adj.building[id])}</b> per level</p>`;
  return h;
}
// What one more level gives, for the Upgrade button: "×2", or the flat amount for linear buildings.
function upgradeGain(k, t) {
  const d = BUILDINGS[t.id], info = calc.tiles[k];
  if (!d.linear) return '×2';
  if (d.house) return '+' + fmt(d.house * repBonus('housing')) + ' 🏠';
  return Object.keys(d.out).map(r => '+' + (d.out[r] * info.mult / info.levelMult).toFixed(1) + ' ' + RESOURCES[r].icon + '/s').join(' ');
}
// Shown before buying housing the farms cannot feed: villagers only move in while there is food for them.
function housingWarning(extra) {
  const rate = foodRateAt(calc.cap + extra);
  return rate < 0 ? `<p class="warn small">⚠ Not enough food to fill it: at full housing food would be ${fmtRate(rate)}. Villagers only move in while they can be fed.</p>` : '';
}
function renderInspector() {
  const sel = ui.sel; let h;
  if (sel.build) {
    const d = BUILDINGS[sel.build];
    // The lead line is all a phone shows while placing (the bottom bar already has the cost); the rest is desktop detail.
    h = `<p class="lead"><b>${d.icon} ${d.name}</b> — ${d.desc}</p><div class="more">${buildingStats(sel.build)}<p class="muted">Tap an open plot to build. Badges on the map show the bonus each plot would give. Tap the building again (or press Esc) to cancel.</p></div>`;
  } else if (sel.tile && tileAt(sel.tile)) {
    const k = sel.tile, t = tileAt(k), kind = tileKind(t), c = upgradeCost(t), ok = canAfford(c) && t.level < MAX_LEVEL;
    if (t.kind === 'hall') {
      const next = BUILD_ORDER.filter(b => BUILDINGS[b].hall === t.level + 1).map(b => BUILDINGS[b].icon + ' ' + BUILDINGS[b].name);
      h = `<h3>${kind.icon(t)} ${kind.name(t)}</h3><p>The heart of your realm. Its household forages a little food, and each level adds ${pct(HALL_BONUS)} to all production.</p>
        <p class="stat">Realm bonus: <b>×${calc.mult.toFixed(2)}</b></p>
        <p class="stat">Food upkeep: <b>${foodPerPop(state.run.pop).toFixed(2)} 🍞/s</b> per villager. Bigger towns eat more per head.</p>
        ${next.length ? `<p class="stat">Next level unlocks: <b>${next.join(', ')}</b></p>` : ''}
        ${t.level === PRESTIGE_HALL - 1 ? '<p class="stat">A Castle lets you found a new kingdom for 👑 Crowns.</p>' : ''}
        <div class="row"><button class="btn${ok ? '' : ' cant'}" data-act="up" data-id="${k}">Raise a ${hallName(t.level + 1)} ${costHTML(c)}</button></div>`;
    } else {
      const d = BUILDINGS[t.id], info = calc.tiles[k] || { adj: 0, mult: 0, levelMult: 1 };
      h = `<h3>${d.icon} ${d.name} <span class="muted">level ${t.level}</span></h3>`;
      if (d.house) h += `<p class="stat">🏠 Houses <b>${fmt(kind.housing(t))}</b></p>`;
      if (d.out) h += '<p class="stat">Making ' + Object.keys(d.out).map(r => `<b>${fmtRate(d.out[r] * info.mult)} ${RESOURCES[r].icon}</b>`).join(' ') + '</p>';
      if (d.glob) h += `<p class="stat">All production <b>${pct(d.glob * t.level * calc.staff)}</b></p>`;
      if (d.adj) h += `<p class="stat">Adjacency bonus: <b>${pct(info.adj)}</b></p>`;
      if (d.work) h += `<p class="stat">Workers: ${kind.jobs(t)} 👥${calc.staff < 1 ? ` <span class="warn">(${Math.round(calc.staff * 100)}% staffed — build cottages)</span>` : ''}</p>`;
      h += `<div class="row"><button class="btn${ok ? '' : ' cant'}" data-act="up" data-id="${k}">Upgrade ${upgradeGain(k, t)} ${costHTML(c)}</button>${hallDelay(c, upgradeAdds(k, t))}
        <button class="btn alt" data-act="demolish" data-id="${k}">Demolish <span class="cost">refunds</span> ${costHTML(demolishRefund(t), true)}</button></div>`;
      if (d.house) h += housingWarning(d.house * repBonus('housing'));
    }
  } else if (sel.tile) {
    const [x, y] = xy(sel.tile), tr = state.run.terrain[x][y];
    if (tr === 'plain') h = '<h3>Open plot</h3><p>Good, level ground. Pick something from the Build list to raise here.</p>';
    else {
      const fans = BUILD_ORDER.filter(b => BUILDINGS[b].adj && BUILDINGS[b].adj.terrain && BUILDINGS[b].adj.terrain[tr]).map(b => BUILDINGS[b].icon + ' ' + BUILDINGS[b].name + 's');
      const c = clearCost();
      h = `<h3>${TERRAIN[tr].icon} ${TERRAIN[tr].name}</h3><p>Nothing can be built here, but ${fans.join(' and ')} beside it work 50% harder.</p>
        <p class="muted">Short of room? Clearing it makes an open plot, but the neighbours lose its bonus. Each clearing costs more than the last.</p>
        <div class="row"><button class="btn${canAfford(c) ? '' : ' cant'}" data-act="clear" data-id="${sel.tile}">Clear land ${costHTML(c)}</button></div>`;
    }
  } else {
    // Phones show the current decree here instead of the welcome line (CSS), since the Decrees tab is a tap away.
    const d = currentDecree(), prog = d && d.progress ? d.progress() : null;
    h = (d ? `<p class="goal">🎯 <b>${d.title}</b>${decreeDone(d.id) ? ' — <b>done!</b> Claim it in Decrees.' : ' — ' + d.desc}${prog && !decreeDone(d.id) ? ` <span class="muted">(${fmt(prog[0])} / ${fmt(prog[1])})</span>` : ''}</p>` : '')
      + '<p class="lead welcome"><b>Welcome, my liege.</b> Pick a building, then tap a plot: neighbours and terrain give bonuses.</p><p class="muted more">Tap any building to upgrade it. The Decrees tab says what to do next.</p>';
  }
  patch($('inspector'), h);
}

// One line on whether abdicating now is worth it.
function offerNote(n) {
  const gain = Math.round((crownMult(state.meta.crowns + n) / crownMult(state.meta.crowns) - 1) * 100);
  if (n < CROWN_MIN) return `Not yet: abdication opens at ${CROWN_MIN} Crowns on offer (at ${fmt(goldForCrowns(CROWN_MIN - repLevel('monument'), state.meta.crowns))} gold this reign).`;
  if (n < CROWN_GOAL) return `Small offer (+${gain}% production). Waiting for ${CROWN_GOAL} or more pays better.`;
  return `Good offer (+${gain}% production): a fine time to start over.`;
}

const TABS = { build: '🔨 Build', research: '📜 Research', decrees: '🎯 Decrees', realm: '👑 Realm' };
function renderTabs() {
  const dots = { decrees: decreeDone(), research: RESEARCH.some(r => !hasResearch(r.id) && r.hall <= hallLevel() && canAfford(r.cost)),
    realm: canPrestige() && pendingCrowns() >= CROWN_GOAL };
  patch($('tabs'), Object.keys(TABS).map(t =>
    `<button class="${t === ui.tab ? 'on' : ''}" data-act="tab" data-id="${t}">${TABS[t]}${dots[t] ? '<i class="dot"></i>' : ''}</button>`).join(''));
  $('side').classList.toggle('open', ui.sheet); // only styled on phones, where the panel is a sheet
}
function renderPanel() {
  const run = state.run, meta = state.meta, hall = hallLevel();
  let h = `<div class="sheethead"><span>${TABS[ui.tab]}</span><button data-act="closeSheet" aria-label="Close">✕</button></div>`; // phones only
  if (ui.tab === 'build') {
    const routine = routinePreview(), span = ROUTINE_SECONDS >= 3600 ? ROUTINE_SECONDS / 3600 + ' hours' : Math.round(ROUTINE_SECONDS / 60) + ' minutes';
    // A new player is sent to the Cottage first: the next hall leads the tab only once the first decrees are done.
    const hallFirst = hall > 1 || meta.crowns > 0 || !!meta.decreesDone.learned;
    if (hallFirst) h += hallHint();
    if (routine.count || routine.saving)     h += `<button class="card routine${routine.count ? '' : ' cant'}" data-act="routine"><div class="ic">⬆️</div><div class="bd"><div class="nm">Routine upgrades <span>×${routine.count}</span></div>
      <div class="muted">Makes every upgrade costing under ${span} of income, cheapest first.${routine.saving ? ' <b>Holding back the price of the ' + hallName(hall + 1) + ', which is under an hour away.</b>' : ''}</div>${routine.count ? costHTML(routine.spent) : ''}</div></button><hr>`;
    for (const id of BUILD_ORDER) {
      const d = BUILDINGS[id];
      if (d.hall > hall) { if (d.hall === hall + 1) h += `<div class="card locked"><div class="ic">🔒</div><div class="bd">${d.name} — requires a ${hallName(d.hall)}</div></div>`; continue; }
      const c = buildCost(id);
      h += `<button class="card${ui.sel.build === id ? ' on' : ''}${canAfford(c) ? '' : ' cant'}" data-act="pick" data-id="${id}">
        <div class="ic">${d.icon}</div><div class="bd"><div class="nm">${d.name} <span>×${count(id)}</span></div><div class="muted">${d.desc}</div>${costHTML(c)}${addsHTML(buildAdds(id))}${hallDelay(c, buildAdds(id))}${d.house ? housingWarning(d.house * repBonus('housing')) : ''}</div></button>`;
    }
    if (!hallFirst) h += '<hr>' + hallHint();
    if (run.exp < EXPAND_COST.length) { const c = EXPAND_COST[run.exp], n = MAP_RADIUS[run.exp + 1] * 2 + 1;
      h += `<hr><button class="card${canAfford(c) ? '' : ' cant'}" data-act="expand"><div class="ic">🗺️</div><div class="bd"><div class="nm">Expand borders</div><div class="muted">Claim the surrounding land (${n}×${n}).</div>${costHTML(c)}</div></button>`; }
    else h += '<hr><p class="muted">Your borders are as wide as they go. Tap forest, hills or water to clear it for more room.</p>';
  } else if (ui.tab === 'research') {
    const avail = RESEARCH.filter(r => !hasResearch(r.id) && r.hall <= hall), owned = RESEARCH.filter(r => hasResearch(r.id));
    for (const r of avail) h += `<button class="card${canAfford(r.cost) ? '' : ' cant'}" data-act="research" data-id="${r.id}">
      <div class="ic">📜</div><div class="bd"><div class="nm">${r.name}</div><div class="muted">${r.desc}</div>${costHTML(r.cost)}${addsHTML(researchAdds(r))}</div></button>`;
    if (!avail.length) h += '<p class="muted">Your scholars have nothing new to offer for now.</p>';
    if (RESEARCH.some(r => r.hall > hall)) h += `<p class="muted">More to discover once you raise a ${hallName(hall + 1)}.</p>`;
    const reps = REPEATABLES.filter(r => r.hall <= hall);
    if (reps.length) h += '<hr><h3>Repeatable upgrades</h3><p class="muted">Each level costs more than the last. Levels reset when you found a new kingdom.</p>';
    for (const r of reps) { const c = repCost(r);
      h += `<button class="card${canAfford(c) ? '' : ' cant'}" data-act="rep" data-id="${r.id}">
      <div class="ic">🔁</div><div class="bd"><div class="nm">${r.name} <span>level ${repLevel(r.id)}</span></div><div class="muted">${r.desc}</div>${costHTML(c)}${r.id === 'housing' ? housingWarning(Math.floor(calc.rawCap * (repBonus('housing') + r.per)) - calc.cap) : ''}</div></button>`; }
    if (owned.length) h += '<hr><p class="muted">Known: ' + owned.map(r => r.name).join(', ') + '</p>';
  } else if (ui.tab === 'decrees') {
    const open = openDecrees(), cur = currentDecree();
    if (open.length) h += `<p class="muted">${open.length > 1 ? 'Work on whichever you like: none of them expires, and claiming one brings the next.' : 'The last of them.'}</p>`;
    for (const d of open) {
      const done = decreeDone(d.id), on = cur && d.id === cur.id;
      h += `<div class="decree${on ? ' on' : ''}"><h3>${d.title}${on && open.length > 1 ? ' <span class="muted">· pursuing</span>' : ''}</h3><p>${d.desc}</p>`;
      if (d.progress) { const [a, b] = d.progress(); h += `<div class="bar"><i style="width:${Math.max(0, Math.min(100, a / b * 100)) || 0}%"></i></div><p class="muted">${fmt(a)} / ${fmt(b)}</p>`; }
      h += `<p>Reward: ${costHTML(d.reward, true)}</p>
        <div class="row"><button class="btn ${done ? 'glow' : 'cant'}" data-act="claim" data-id="${d.id}">${done ? 'Claim reward' : 'In progress…'}</button>${on || done || open.length < 2 ? '' : `<button class="btn alt" data-act="pursue" data-id="${d.id}">Pursue this</button>`}</div></div>`;
    }
    if (!open.length) h += '<h3>All decrees fulfilled</h3><p>The bards will sing of your reign. Now see how far the numbers go.</p>';
    h += `<hr><p class="muted">Decrees fulfilled: ${decreesFulfilled()} / ${DECREES.length}</p>`;
  } else {
    const n = pendingCrowns(), ok = canPrestige();
    h += `<h3>👑 Dynasty</h3><p>Once you hold a Castle you may abdicate and found a new kingdom. You start over, but earn Crowns that boost all production by ${Math.round(CROWN_BONUS * 100)}% each, forever.</p>
      <p class="muted">Crowns on offer come from the gold earned this reign, and each further one takes more gold. Abdication opens at ${CROWN_MIN} on offer, about when a first Palace stands; ${CROWN_GOAL} or more pays best. Past ${CROWN_DEAR_FROM} Crowns held each one takes far more gold, so later reigns have to grow further. A new kingdom also begins with a few extra supplies, enough to skip the first steps.</p>
      <p class="stat">Crowns held: <b>${fmt(meta.crowns)}</b> (production ×${crownMult(meta.crowns).toFixed(2)}) · on abdication: <b>+${fmt(n)}</b>${n ? ` (production ×${crownMult(meta.crowns + n).toFixed(2)})` : ''}</p>
      <p class="stat">Gold this reign: <b>${fmt(run.gold)}</b> · next Crown at <b>${fmt(goldForCrowns(n - repLevel('monument') + 1, meta.crowns))}</b></p>
      ${ok ? `<p class="stat ready">${abdicateLine().replace(' See the Realm tab.', '')}</p>` : ''}<p class="stat">${offerNote(n)}</p>
      <div class="row"><button class="btn${ok ? '' : ' cant'}" data-act="prestige">${hall < PRESTIGE_HALL ? 'Requires a Castle' : n < CROWN_MIN ? `Needs ${CROWN_MIN} Crowns on offer` : `Found a new kingdom (+${fmt(n)} 👑)`}</button></div>
      <hr><h3>Chronicle</h3>
      <p class="stat">Gold earned, all time: <b>${fmt(meta.stats.totalGold)}</b></p>
      <p class="stat">Buildings raised: <b>${fmt(meta.stats.built)}</b> · Taxes collected by hand: <b>${fmt(meta.stats.clicks)}</b></p>
      <p class="stat">Kingdoms founded: <b>${fmt(meta.stats.prestiges + 1)}</b></p>
      <hr><div class="row"><button class="btn alt" data-act="save">Save now</button><button class="btn alt" data-act="export">Export</button>
      <button class="btn alt" data-act="import">Import</button><button class="btn" data-act="wipe">Hard reset</button></div>
      <p class="muted">The game saves itself in this browser every 10 seconds and keeps working while you are away. Browsers can clear that storage, so export a copy now and then.</p>`;
  }
  patch($('panel'), h);
  if (ui.panelTab !== ui.tab) { ui.panelTab = ui.tab; $('panel').scrollTop = 0; } // a newly opened tab starts at its top
}
// Bottom bar on narrow screens (hidden by CSS on desktop): pick a building without scrolling away from the map.
function renderBuildBar() {
  let h = '';
  const k = ui.sel.tile, t = k && tileAt(k), tr = k && !t ? state.run.terrain[xy(k)[0]][xy(k)[1]] : null;
  const close = '<button class="bb act close" data-act="deselect" aria-label="Close"><span class="ic">✕</span><small>Close</small></button>';
  // The bar's buttons change meaning by position when it switches mode; the click handler uses this to
  // drop the second tap of a double tap (Close must not fall through to the Farm button that replaces it).
  ui.barMode = t ? 'tile' : tr && tr !== 'plain' ? 'terrain' : 'build';
  if (t) { // a selected building: its actions sit in the bar, in reach without scrolling
    const kind = tileKind(t), c = upgradeCost(t), ok = canAfford(c) && t.level < MAX_LEVEL;
    h = `<button class="bb act wide${ok ? '' : ' cant'}" data-act="up" data-id="${k}"><b>${t.kind === 'hall' ? 'Raise a ' + hallName(t.level + 1) : 'Upgrade ' + upgradeGain(k, t)}</b>${costHTML(c)}</button>`;
    if (kind.removable) h += `<button class="bb act" data-act="demolish" data-id="${k}"><span class="ic">🧨</span><small>Demolish</small></button>`;
    patch($('bbrow'), h + close);
    patch($('bbinfo'), `<b>${kind.icon(t)} ${kind.name(t)}</b> level ${t.level}`);
    return;
  }
  if (tr && tr !== 'plain') {
    const c = clearCost();
    patch($('bbrow'), `<button class="bb act wide${canAfford(c) ? '' : ' cant'}" data-act="clear" data-id="${k}"><b>Clear land</b>${costHTML(c)}</button>` + close);
    patch($('bbinfo'), `<b>${TERRAIN[tr].icon} ${TERRAIN[tr].name}</b> <span class="hint">nothing can be built here</span>`);
    return;
  }
  for (const id of BUILD_ORDER) {
    const d = BUILDINGS[id]; if (d.hall > hallLevel()) continue;
    h += `<button class="bb${ui.sel.build === id ? ' on' : ''}${canAfford(buildCost(id)) ? '' : ' cant'}" data-act="pick" data-id="${id}" title="${d.name}"><span class="ic">${d.icon}</span><small>${d.name}</small></button>`;
  }
  patch($('bbrow'), h);
  patch($('bbinfo'), ui.sel.build ? `<b>${BUILDINGS[ui.sel.build].icon} ${BUILDINGS[ui.sel.build].name}</b> ${costHTML(buildCost(ui.sel.build))}<span class="hint">tap a plot</span>`
    : '<span class="hint">Tap a building, then an open plot on the map</span>');
}
function renderCity() {
  calc = compute();
  renderResources(); renderMap(); renderInspector(); renderTabs(); renderPanel(); renderBuildBar();
}

// ───────────────────────── Feedback: toasts, floating text, dialog ─────────────────────────
function toast(msg) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
  const box = $('toasts'); while (box.children.length >= 4) box.firstChild.remove();
  box.appendChild(el); setTimeout(() => el.remove(), 4000);
}
const say = result => { if (result && result.msg) toast(result.msg); return result; };
function floatText(x, y, text) {
  const el = document.createElement('div'); el.className = 'fx'; el.textContent = text;
  el.style.left = x + 'px'; el.style.top = y + 'px'; document.body.appendChild(el); setTimeout(() => el.remove(), 900);
}

// One dialog at a time. Focus moves into it and returns to where it was; Esc or a tap on the backdrop cancels
// (unless `locked`). All dialog HTML is built from constants and numbers, never from raw save text.
const dialog = { yes: null, locked: false, returnFocus: null };
function openModal(html, opts) {
  opts = opts || {};
  if ($('modal').hidden) dialog.returnFocus = document.activeElement;
  dialog.yes = opts.yes || null; dialog.locked = !!opts.locked;
  $('modalbox').innerHTML = html; $('modal').hidden = false;
  const first = $('modalbox').querySelector('[data-focus]') || $('modalbox').querySelector('button, textarea');
  if (first) first.focus();
}
function closeModal() {
  if ($('modal').hidden) return;
  $('modal').hidden = true; dialog.yes = null; dialog.locked = false;
  const back = dialog.returnFocus; dialog.returnFocus = null;
  if (back && document.contains(back) && back.focus) back.focus();
}
function confirmBox(title, body, yes, label) {
  openModal(`<h2 id="modaltitle">${title}</h2><p>${body}</p><div class="row"><button class="btn" data-act="yes">${label || 'Yes'}</button><button class="btn alt" data-act="close" data-focus>Cancel</button></div>`, { yes });
}
function copyText(text, field) {
  const fallback = () => { let ok = false; try { field.focus(); field.select(); ok = document.execCommand('copy'); } catch (e) { /* not supported */ }
    toast(ok ? '📋 Save copied.' : 'Could not copy automatically: the text is selected, copy it by hand.'); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => toast('📋 Save copied.'), fallback);
  else fallback();
}
const MODAL_ACTIONS = {
  yes() { const f = dialog.yes; closeModal(); if (f) f(); },
  close() { closeModal(); },
  copy() { const f = $('exp'); copyText(f.value, f); },
  doimport() {
    try {
      const notes = adoptSave(JSON.parse(decodeSave($('imp').value)), Date.now());
      lastTick = Date.now(); ui.sel = {}; ui.mapN = 0;
      closeModal(); save(); toast('Kingdom restored.'); notes.forEach(toast);
    } catch (e) { toast('That save could not be read.'); }
  },
  takeover() { location.reload(); },
};

// ───────────────────────── Persistence ─────────────────────────
// Returns true if the game was written. Failures are reported (once per streak, or always when asked by hand).
function save(manual) {
  if (ui.paused) return false;
  state.last = lastTick; // the moment the simulation has reached, so time not yet simulated is credited on the next load
  try {
    localStorage.setItem(SAVE_KEY, serialize());
    ui.saveFailed = false; return true;
  } catch (e) {
    if (manual || !ui.saveFailed) toast('⚠️ Saving failed: this browser is not storing data. Use Realm → Export to keep a copy.');
    ui.saveFailed = true; return false;
  }
}
// Ask the browser not to evict our storage (Safari clears script-written storage after a week unused).
function requestPersistence() {
  if (ui.askedPersist) return; ui.askedPersist = true;
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* unsupported */ }
}
const fmtDuration = sec => { const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60); return (h ? h + 'h ' : '') + m + 'm'; };
// Every stretch of missed time goes through here: page load, or the loop noticing the tab was asleep.
function catchUp(sec) {
  const r = creditAway(sec);
  if (r.away <= OFFLINE_REPORT_SECONDS) return;
  const gains = Object.keys(r.gains).map(k => `<p class="stat">${RESOURCES[k].icon} ${RESOURCES[k].name}: <b>+${fmt(r.gains[k])}</b></p>`).join('');
  openModal(`<h2 id="modaltitle">Welcome back, my liege</h2><p>Your villagers kept working for ${fmtDuration(r.credited)} while you were away.</p>
    ${r.rested >= 60 ? `<p class="stat">😴 Rested: the town did <b>${fmtDuration(r.rested)}</b> of extra work. Time away counts double until you next buy.</p>` : `<p class="muted">${restLine()}</p>`}
    ${abdicateLine() ? `<p class="stat">${abdicateLine()}</p>` : ''}
    ${r.capped ? `<p class="muted">You were gone for ${fmtDuration(r.away)}, but offline progress is capped at ${r.capHours} hours${r.capHours < 24 ? ' (24 with Stewardship research)' : ''}.</p>` : ''}
    ${hallLevel() < MAX_LEVEL ? `<p class="stat">${hallWait() === 0 ? `🏰 You can now raise a <b>${hallName(hallLevel() + 1)}</b>.` : isFinite(hallWait()) ? `🏰 ${hallName(hallLevel() + 1)} in about <b>${fmtDuration(hallWait())}</b> at this rate.` : ''}</p>` : ''}
    ${gains || '<p class="muted">Sadly the stores did not grow. Check on your food supply.</p>'}<div class="row"><button class="btn" data-act="close">Splendid</button></div>`);
}
function loadGame() {
  const now = Date.now(); let raw = null, notes = [];
  try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { /* storage unavailable */ }
  if (raw) {
    try { notes = adoptSave(JSON.parse(raw), now); render(); } // a save that cannot be computed or drawn counts as unreadable
    catch (e) {
      try { localStorage.setItem(BACKUP_KEY, raw); } catch (e2) { /* storage unavailable */ }
      startNewGame(now);
      notes = ['Your saved kingdom could not be read, so a new one was started. A copy of the old data was kept in this browser.'];
    }
  } else startNewGame(now);
  render();
  lastTick = now;
  catchUp((now - state.last) / 1000);
  notes.forEach(toast);
}
// Two tabs would overwrite each other's saves. The newest tab owns the save; older ones pause until told to take over.
function claimTab() {
  try { localStorage.setItem(TAB_KEY, TAB_ID); } catch (e) { /* storage unavailable */ }
  window.addEventListener('storage', e => {
    if (e.key !== TAB_KEY || !e.newValue || e.newValue === TAB_ID || ui.paused) return;
    ui.paused = true;
    openModal(`<h2 id="modaltitle">Open in another tab</h2><p>Hearthold was opened in another tab or window. This one is paused so the two do not overwrite each other's saves.</p>
      <div class="row"><button class="btn" data-act="takeover">Play here instead</button></div>`, { locked: true });
  });
}

// ───────────────────────── Input ─────────────────────────
const calmMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
// Phones: put the map back in view by closing the sheet. Desktop: scroll to it if a long panel pushed it away.
function showMap() { ui.sheet = false; $('mapwrap').scrollIntoView({ block: 'nearest', behavior: calmMotion && calmMotion.matches ? 'auto' : 'smooth' }); }
// The inspector lives beside the tabs on desktop and under the map on phones (see the max-width block in style.css).
const phoneLayout = window.matchMedia ? window.matchMedia('(max-width: 800px), (max-height: 500px)') : { matches: false };
function placeInspector() {
  const host = phoneLayout.matches ? $('strip') : $('side'), el = $('inspector');
  if (el.parentNode !== host) host.insertBefore(el, host.firstChild);
}
// Actions for the city screen, keyed by data-act. Each gets (data-id, event, element).
const CITY_ACTIONS = {
  tile(k) {
    const [x, y] = xy(k), sel = ui.sel; ui.sheet = false;
    if (!tileAt(k) && state.run.terrain[x][y] === 'plain' && sel.build) { if (say(build(k, sel.build)).ok) ui.popKey = k; }
    else ui.sel = sel.tile === k ? {} : { tile: k };
  },
  pick(id) {
    ui.sel = ui.sel.build === id ? {} : { build: id };
    if (ui.sel.build) showMap(); // bring the map back if a card was picked further down the page
  },
  // On phones a tab opens its panel as a sheet; tapping the open tab again closes it.
  tab(id) { if (!TABS[id]) return; ui.sheet = !(ui.sheet && ui.tab === id); ui.tab = id; },
  closeSheet() { ui.sheet = false; },
  deselect() { ui.sel = {}; },
  up(k) { if (say(upgrade(k)).ok) ui.popKey = k; },
  demolish(k) {
    const t = tileAt(k); if (!t || !tileKind(t).removable) return;
    const go = () => { if (demolish(k).ok) { ui.sel = {}; render(); } };
    if (t.level > 1) confirmBox('Demolish this building?', `The level ${t.level} ${BUILDINGS[t.id].name} and its upgrades will be gone. You get back ${costHTML(demolishRefund(t), true)} (${Math.round(REFUND_SHARE * 100)}% of what it cost).`, go, 'Demolish');
    else go();
  },
  research(id) { say(buyResearch(id)); },
  rep(id) { buyRepeatable(id); },
  expand() { say(expand()); },
  routine() { say(routineUpgrades()); },
  clear(k) { say(clearLand(k)); },
  claim(id) { say(claimDecree(id || undefined)); },
  pursue(id) { pursueDecree(id); },
  hall() { ui.sel = { tile: HALL_KEY }; ui.sheet = false; },
  prestige() {
    if (!canPrestige()) return;
    const n = pendingCrowns();
    confirmBox('Found a new kingdom?', `You abdicate and start over on fresh land. Buildings, resources and research are lost, but you keep
      <b>${fmt(n)} 👑 Crown${n > 1 ? 's' : ''}</b>, each worth ${pct(CROWN_BONUS)} to all production forever (×${crownMult(state.meta.crowns).toFixed(2)} → ×${crownMult(state.meta.crowns + n).toFixed(2)}).
      The new kingdom starts with ${costHTML(HEAD_START, true)} extra.
      ${n < CROWN_GOAL ? `<br><br><b>This is a small offer.</b> Reigns that wait for ${CROWN_GOAL} Crowns or more pay better.` : ''}`, () => {
      if (!say(prestige()).ok) return;
      ui.sel = {}; ui.mapN = 0; save(); render();
    });
  },
  collect(id, e, el) {
    const g = collectTaxes().gold, r = el.getBoundingClientRect();
    floatText((e.clientX || r.left + r.width / 2) - 10 + (Math.random() * 30 - 15), (e.clientY || r.top) - 20, '+' + fmt(g));
  },
  save() { if (save(true)) toast('💾 Saved.'); },
  export() {
    openModal(`<h2 id="modaltitle">Export save</h2><p class="muted">Keep this text somewhere safe. Paste it into Import to restore your kingdom.</p>
      <textarea id="exp" readonly aria-label="Exported save">${esc(encodeSave(serialize()))}</textarea>
      <div class="row"><button class="btn" data-act="copy" data-focus>Copy</button><button class="btn alt" data-act="close">Done</button></div>`);
  },
  import() {
    openModal(`<h2 id="modaltitle">Import save</h2><p class="muted">Paste an exported save. This replaces your current kingdom.</p>
      <textarea id="imp" aria-label="Save to import" data-focus></textarea>
      <div class="row"><button class="btn" data-act="doimport">Import</button><button class="btn alt" data-act="close">Cancel</button></div>`);
  },
  wipe() {
    confirmBox('Burn it all down?', 'This erases everything, Crowns included. There is no undo.', () => {
      startNewGame(Date.now()); ui.sel = {}; ui.mapN = 0; save(); render();
    }, 'Erase everything');
  },
};

// Screens: each owns a container, a render function and its own action table. Only the city exists today;
// another mode adds an entry here and a <section class="screen"> in index.html.
const SCREENS = {
  city: { render: renderCity, actions: CITY_ACTIONS },
};
function render() { SCREENS[ui.screen].render(); }
function showScreen(name) {
  if (!SCREENS[name]) return;
  ui.screen = name;
  for (const el of document.querySelectorAll('.screen')) el.hidden = el.dataset.screen !== name;
  render();
}

function bindInput() {
  $('app').addEventListener('click', e => {
    requestPersistence();
    const el = e.target.closest('[data-act]');
    if (!el || ui.paused || el.classList.contains('locked')) return;
    ui.routine = null; // anything tapped may change what counts as routine
    if (el.closest('#buildbar')) {
      const now = performance.now();
      const near = Math.hypot(e.clientX - ui.barTapX, e.clientY - ui.barTapY) < 40;
      if (now - ui.barTapAt < BAR_SETTLE_MS && ui.barTapMode !== ui.barMode && near) return; // the bar changed under a double tap
      ui.barTapAt = now; ui.barTapMode = ui.barMode; ui.barTapX = e.clientX; ui.barTapY = e.clientY;
    }
    const fn = SCREENS[ui.screen].actions[el.dataset.act];
    if (!hasOwn(SCREENS[ui.screen].actions, el.dataset.act)) return;
    fn(el.dataset.id, e, el); render();
  });
  $('modal').addEventListener('click', e => {
    if (e.target === $('modal')) { if (!dialog.locked) closeModal(); return; } // tap on the backdrop
    const el = e.target.closest('[data-act]');
    if (el && hasOwn(MODAL_ACTIONS, el.dataset.act)) { MODAL_ACTIONS[el.dataset.act](); if (!ui.paused) render(); }
  });
  document.addEventListener('keydown', e => {
    // A held key must not act as an auto-clicker.
    if (e.repeat && (e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('button')) { e.preventDefault(); return; }
    if (e.key === 'Escape') {
      if (!$('modal').hidden) { if (!dialog.locked) closeModal(); }
      else if (ui.sheet && phoneLayout.matches) { ui.sheet = false; render(); }
      else if (ui.sel.build || ui.sel.tile) { ui.sel = {}; render(); }
    } else if (e.key === 'Tab' && !$('modal').hidden) { // keep focus inside the dialog
      const f = [...$('modalbox').querySelectorAll('button, textarea')]; if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (!$('modalbox').contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  $('res').addEventListener('scroll', renderResources, { passive: true });
  window.addEventListener('beforeunload', () => save());
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); else { simTick(); if (!ui.paused) render(); } });
  const moved = () => { placeInspector(); if (!ui.paused) render(); };
  if (phoneLayout.addEventListener) phoneLayout.addEventListener('change', moved); else if (phoneLayout.addListener) phoneLayout.addListener(moved);
  window.addEventListener('resize', () => { if (!ui.paused) render(); }); // re-checks whether the map needs to pan; keeps its position
}

// ───────────────────────── Timers ─────────────────────────
// Three independent timers: the simulation step, drawing, and autosave.
// A hidden tab does not step at all: browsers wake its timers about once a minute, which would turn one long
// absence into many small uncapped gaps. The whole hidden span arrives as a single gap when the tab is shown.
function simTick() {
  if (document.hidden) return;
  const now = Date.now(), dt = Math.max(0, (now - lastTick) / 1000); lastTick = now;
  if (ui.paused) return;
  if (dt > OFFLINE_REPORT_SECONDS) { catchUp(dt); render(); } // the tab was asleep: same capped path as a page load
  else advance(dt);
  if (state.run.starving && !ui.warnedStarve) { toast('🍞 Your villagers are starving! Work slows to half — build more farms.'); ui.warnedStarve = true; }
  if (!state.run.starving) ui.warnedStarve = false;
}
let drawCount = 0;
function drawTick() {
  if (ui.paused || document.hidden) return;
  if (++drawCount % 4 === 0) render(); else renderResources();
}

placeInspector();
bindInput();
claimTab();
loadGame();
showScreen('city');
setInterval(simTick, 100);
setInterval(drawTick, 250);
setInterval(() => save(), 10000);
