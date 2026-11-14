'use strict';
// Browser checks (layout at phone and desktop sizes, input, saves). Needs Playwright with Chromium:
//   node tests/ui.test.js            (set SHOTS=<dir> to also write screenshots there)
// Every page starts from a fixed map seed with merchant visits and smooth scrolling off, so runs are repeatable.
const path = require('path'), { pathToFileURL } = require('url');
const { chromium, devices } = require('playwright');
const URL = pathToFileURL(path.join(__dirname, '..', 'index.html')).href, OUT = process.env.SHOTS;
const shot = (page, name) => OUT ? page.screenshot({ path: path.join(OUT, name) }) : null;
// A known starting position: same terrain every run, no merchant wandering in mid-test.
const fresh = page => page.evaluate(() => { startNewGame(Date.now()); state.run = newRun(12345); calc = compute(); ui.sel = {}; ui.tab = 'build'; ui.mapN = 0; ui.merchant.next = 1e9; ui.merchant.left = 0; closeModal(); render(); scrollTo(0, 0); });
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
async function drag(cdp, x, y, dx, dy) { // a real touch drag, as a finger would do it
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 10, y: y + dy * i / 10 }] });
  for (let i = 0; i < 4; i++) { await new Promise(r => setTimeout(r, 40)); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy }] }); } // rest before lifting: no fling
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const watch = (page, errs) => { page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', e => errs.push(String(e))); page.on('dialog', d => { errs.push('dialog: ' + d.message()); d.dismiss(); }); };
(async () => {
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const page = await ctx.newPage(); const errs = []; watch(page, errs);
  await page.goto(URL); await page.waitForFunction(() => typeof state === 'object' && document.querySelector('.tile')); await fresh(page);
  const resInfo = () => page.evaluate(() => { const r = document.getElementById('res'), cs = [...r.children].map(c => Math.round(c.getBoundingClientRect().top));
    return { h: r.getBoundingClientRect().height, rows: new Set(cs).size, n: cs.length, sw: r.scrollWidth, cw: r.clientWidth }; });
  let ri = await resInfo(); ok(ri.rows === 1 && ri.h <= 48, 'fresh: resource bar single row, h=' + ri.h.toFixed(1) + ' chips=' + ri.n);
  await shot(page, 'shot-390-fresh.png');

  // --- early game: pick from bottom bar, place on map, page does not scroll
  const bar = await page.evaluate(() => { const b = document.getElementById('buildbar').getBoundingClientRect(), t = document.getElementById('tabs').getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, tabsTop: t.top, tabsBottom: t.bottom, disp: getComputedStyle(document.getElementById('buildbar')).display, docH: document.documentElement.scrollHeight }; });
  ok(bar.disp !== 'none' && Math.abs(bar.tabsBottom - 844) < 1 && Math.abs(bar.bottom - bar.tabsTop) < 1 && bar.docH <= 845, 'build bar sits on the tab row at the bottom and the page does not scroll (bar top=' + Math.round(bar.top) + ', doc height ' + bar.docH + ')');
  await page.tap('#bbrow .bb[data-id="cottage"]'); await settle(page);
  let st = await page.evaluate(() => { const m = document.getElementById('mapwrap').getBoundingClientRect(), b = document.getElementById('buildbar').getBoundingClientRect();
    return { y: scrollY, mt: m.top, mb: m.bottom, bt: b.top, sel: ui.sel.build, can: document.querySelectorAll('.tile.can').length }; });
  ok(st.sel === 'cottage' && st.y === 0 && st.mt >= 0 && st.mb <= st.bt, 'after picking in bar: map fully visible above bar ' + JSON.stringify(st));
  await page.tap('.tile.can'); await settle(page);
  ok(await page.evaluate(() => count('cottage')) === 1, 'tapping a plot places the cottage');

  // --- DOM patching keeps elements (focus / press survive re-render)
  const kept = await page.evaluate(() => { const b = document.querySelector('#bbrow .bb[data-id="farm"]'); b.focus(); state.run.res.gold += 1000; render(); render();
    return document.activeElement === b && document.querySelector('#bbrow .bb[data-id="farm"]') === b; });
  ok(kept, 're-render keeps the same button element and its focus');

  // --- picking a card in the Build sheet closes the sheet and leaves the map in view
  await page.evaluate(() => { ui.sel = {}; render(); });
  await page.tap('#tabs [data-id="build"]'); await settle(page);
  const sheetUp = await page.evaluate(() => { const c = document.querySelector('#panel .card[data-id="lumber"]').getBoundingClientRect(), t = document.getElementById('tabs').getBoundingClientRect(); return { open: ui.sheet, cardTop: Math.round(c.top), cardBottom: Math.round(c.bottom), tabsTop: Math.round(t.top), y: scrollY }; });
  ok(sheetUp.open && sheetUp.cardTop > 0 && sheetUp.cardBottom <= sheetUp.tabsTop && sheetUp.y === 0, 'the Build tab opens a sheet with its cards on screen ' + JSON.stringify(sheetUp));
  await page.tap('#panel .card[data-id="lumber"]'); await settle(page);
  st = await page.evaluate(() => { const m = document.getElementById('mapwrap').getBoundingClientRect(), b = document.getElementById('buildbar').getBoundingClientRect(), r = document.getElementById('res').getBoundingClientRect();
    return { y: scrollY, sel: ui.sel.build, sheet: ui.sheet, panel: getComputedStyle(document.getElementById('panel')).display, mt: Math.round(m.top), mb: Math.round(m.bottom), bt: Math.round(b.top), rb: Math.round(r.bottom) }; });
  ok(st.sel === 'lumber' && !st.sheet && st.panel === 'none' && st.y === 0 && st.mt >= st.rb - 1 && st.mb <= st.bt + 1, 'picking a card closes the sheet: map visible between res bar and build bar ' + JSON.stringify(st));

  // --- late game state: 11x11 map, all resources, crowns, festival, merchant
  await page.evaluate(() => { const run = state.run; run.exp = 3; run.tiles[HALL_KEY].level = 5; state.meta.crowns = 12; run.buffUntil = run.clock + 60; ui.merchant.left = 18; ui.merchant.x = 40; ui.merchant.y = 40;
    run.res = { gold: 123456789, food: 2345678, wood: 98765432, stone: 7654321, iron: 345678 }; run.pop = 1234;
    for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) if (run.terrain[i][j] === 'plain') run.tiles[i + ',' + j] = { kind: 'building', id: ['cottage', 'smith', 'lumber', 'quarry', 'mine', 'farm'][(i + j) % 6], level: 12 };
    ui.sel = {}; render(); scrollTo(0, 0); });
  await settle(page);
  ri = await resInfo(); ok(ri.rows === 1 && ri.h <= 48 && ri.n === 9 && ri.sw <= ri.cw, 'late: all 9 chips (merchant, festival, 5 resources, population, Crowns) fit one row without scrolling, h=' + ri.h.toFixed(1) + ' scrollW/clientW=' + ri.sw + '/' + ri.cw);
  const order = await page.evaluate(() => [...document.getElementById('res').children].slice(0, 2).map(c => c.className));
  ok(/merchant/.test(order[0]) && /buff/.test(order[1]), 'timed chips lead the resource bar');
  const mp = await page.evaluate(() => { const t = document.querySelector('.tile').getBoundingClientRect(), sc = document.getElementById('mapscroll');
    return { n: document.querySelectorAll('.tile').length, w: t.width, h: t.height, sw: sc.scrollWidth, cw: sc.clientWidth, sh: sc.scrollHeight, ch: sc.clientHeight, sl: sc.scrollLeft, st: sc.scrollTop, hint: !document.getElementById('maphint').hidden, docW: document.documentElement.scrollWidth }; });
  ok(mp.n === 121 && mp.w >= 40 && mp.h >= 40, '11x11 tiles are ' + mp.w.toFixed(1) + 'x' + mp.h.toFixed(1) + 'px');
  ok(mp.sw > mp.cw && Math.abs(mp.sl - (mp.sw - mp.cw) / 2) <= 1 && Math.abs(mp.st - (mp.sh - mp.ch) / 2) <= 1 && mp.hint, 'map pans inside its frame, centred on hall ' + JSON.stringify(mp));
  ok(mp.docW <= 390, 'no horizontal page overflow (doc width ' + mp.docW + ')');
  const badge = await page.evaluate(() => { let worst = 0, n = 0; for (const b of document.querySelectorAll('.tile .bn')) { n++; const r = b.getBoundingClientRect(), t = b.parentElement.getBoundingClientRect(); worst = Math.max(worst, r.right - t.right, t.left - r.left); } return { n, worst }; });
  await page.evaluate(() => { const k = Object.keys(state.run.tiles).find(k => state.run.tiles[k].id === 'farm'); calc.tiles[k].adj = 2.7; });
  ok(badge.worst <= 0, 'bonus badges stay inside their tile (' + badge.n + ' badges, overflow ' + badge.worst.toFixed(1) + 'px)');
  const wide = await page.evaluate(() => { const b = document.querySelector('.tile .bn') || document.querySelector('.tile').appendChild(Object.assign(document.createElement('span'), { className: 'bn' })); b.textContent = '+270%'; const r = b.getBoundingClientRect(), t = b.parentElement.getBoundingClientRect(); const o = r.right - t.right; lastHTML.delete(document.getElementById('map')); render(); return o; });
  ok(wide <= 0, 'a "+270%" badge fits a 40px tile (overflow ' + wide.toFixed(1) + 'px)');
  await page.tap('#bbrow .bb[data-id="farm"]'); await settle(page);
  st = await page.evaluate(() => { const m = document.getElementById('mapwrap').getBoundingClientRect(), b = document.getElementById('buildbar').getBoundingClientRect(); return { y: scrollY, mt: m.top, mb: m.bottom, bt: b.top }; });
  ok(st.y === 0 && st.mt >= 0 && st.mb <= st.bt, 'late: map fully visible with build selected ' + JSON.stringify(st));
  const pt = await page.evaluate(() => { const s = document.getElementById('mapscroll').getBoundingClientRect(), m = document.getElementById('merchant').getBoundingClientRect();
    for (const t of document.querySelectorAll('.tile.can')) { const r = t.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (r.left >= s.left && r.right <= s.right && r.top >= s.top && r.bottom <= s.bottom && !(x > m.left && x < m.right && y > m.top && y < m.bottom)) return { x, y }; } });
  const f0 = await page.evaluate(() => count('farm'));
  await page.touchscreen.tap(pt.x, pt.y); await settle(page);
  ok(await page.evaluate(() => count('farm')) === f0 + 1, 'late: tapping a 40px+ tile places the farm');
  await page.evaluate(() => { document.getElementById('mapscroll').scrollLeft = 0; render(); });
  ok(await page.evaluate(() => document.getElementById('mapscroll').scrollLeft) === 0, 'map pan position survives re-render');
  await page.evaluate(() => { const sc = document.getElementById('mapscroll'); sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) / 2; });
  await shot(page, 'shot-390-late.png');

  // --- merchant cue in the sticky bar, and the merchant itself
  ok(await page.evaluate(() => !!document.querySelector('#res .chip.merchant') && !document.getElementById('merchant').hidden), 'merchant shows a chip in the resource bar');
  const m0 = await page.evaluate(() => state.meta.stats.merchants);
  await page.evaluate(() => document.getElementById('merchant').click());
  ok(await page.evaluate(() => state.meta.stats.merchants) === m0 + 1 && await page.evaluate(() => document.getElementById('merchant').hidden && !document.querySelector('#res .chip.merchant')), 'tapping the merchant pays out and removes the cue');

  // --- tapping: small share of base income; key repeat ignored
  const tap = await page.evaluate(() => { state.run.buffUntil = 0; calc = compute(); const a = clickValue(); state.run.buffUntil = state.run.clock + 60; calc = compute(); return { v: a, fest: clickValue(), base: calc.base.gold, live: calc.rates.gold }; });
  ok(tap.v === tap.fest && tap.v / tap.base < 0.021 && tap.live > tap.base * 2.9, 'tap is ' + (100 * tap.v / tap.base).toFixed(2) + '% of base gold/s and ignores the festival');
  const c0 = await page.evaluate(() => state.meta.stats.clicks);
  await page.focus('#clicker'); await page.keyboard.down('Enter'); for (let i = 0; i < 10; i++) await page.keyboard.down('Enter'); await page.keyboard.up('Enter');
  ok(await page.evaluate(() => state.meta.stats.clicks) === c0 + 1, 'holding Enter collects once, not per key repeat');

  // --- demolish: confirmation above level 1, refund counts upgrades
  const dk = await page.evaluate(() => Object.keys(state.run.tiles).find(k => state.run.tiles[k].id === 'smith'));
  const dinfo = await page.evaluate(k => { ui.sel = { tile: k }; render(); const t = state.run.tiles[k]; return { refund: demolishRefund(t), spent: spentOn(t), gold: state.run.res.gold }; }, dk);
  await page.evaluate(() => document.querySelector('#inspector [data-act="demolish"]').click());
  ok(await page.evaluate(k => !document.getElementById('modal').hidden && !!state.run.tiles[k] && document.activeElement.dataset.act === 'close', dk), 'demolishing a level 12 building asks first (focus on Cancel)');
  await page.keyboard.press('Escape');
  ok(await page.evaluate(k => document.getElementById('modal').hidden && !!state.run.tiles[k], dk), 'Esc cancels the dialog');
  await page.evaluate(() => document.querySelector('#inspector [data-act="demolish"]').click());
  await page.evaluate(() => document.getElementById('modal').click());
  ok(await page.evaluate(k => document.getElementById('modal').hidden && !!state.run.tiles[k], dk), 'tapping the backdrop cancels the dialog');
  await page.evaluate(() => document.querySelector('#inspector [data-act="demolish"]').click());
  await page.evaluate(() => document.querySelector('#modal [data-act="yes"]').click());
  const dafter = await page.evaluate(k => ({ gone: !state.run.tiles[k], gold: state.run.res.gold }), dk);
  ok(dafter.gone && dinfo.refund.gold === Math.floor(dinfo.spent.gold / 2) && dinfo.refund.gold > 1e8 && dafter.gold - dinfo.gold >= dinfo.refund.gold * 0.999, 'confirmed demolish refunds half of build+upgrade costs (' + dinfo.refund.gold + ' gold of ' + dinfo.spent.gold + ' spent)');

  // --- clearing terrain
  const ck = await page.evaluate(() => { for (let x = 0; x < MAP_SIZE; x++) for (let y = 0; y < MAP_SIZE; y++) if (state.run.terrain[x][y] !== 'plain') return x + ',' + y; });
  await page.evaluate(k => { ui.sel = { tile: k }; render(); document.querySelector('#inspector [data-act="clear"]').click(); }, ck);
  ok(await page.evaluate(k => { const [x, y] = xy(k); return state.run.terrain[x][y] === 'plain' && state.run.cleared === 1 && clearCost().gold === 1000; }, ck), 'terrain can be cleared for gold; next clearing costs double');

  // --- research tab with repeatable upgrades
  await page.evaluate(() => { ui.tab = 'research'; ui.sheet = true; render(); });
  const lv0 = await page.evaluate(() => repLevel('prod'));
  await page.evaluate(() => document.querySelector('#panel .card[data-act="rep"][data-id="prod"]').click());
  ok(await page.evaluate(() => repLevel('prod')) === lv0 + 1, 'repeatable upgrade can be bought');
  await page.evaluate(() => [...document.querySelectorAll('#panel h3')].find(h => /Repeatable/.test(h.textContent)).scrollIntoView({ block: 'start' }));
  await settle(page); await shot(page, 'shot-390-research.png');

  // --- export / import round trip (UTF-8 safe), copy button present
  await page.evaluate(() => { ui.tab = 'realm'; render(); window.__json = serialize(); document.querySelector('#panel [data-act="export"]').click(); });
  const exp = await page.evaluate(() => ({ text: document.getElementById('exp').value, copy: !!document.querySelector('#modal [data-act="copy"]'), fs: getComputedStyle(document.getElementById('exp')).fontSize }));
  ok(exp.copy && exp.fs === '16px' && exp.text.length > 100, 'export dialog has a Copy button and a 16px field');
  const rt = await page.evaluate(text => { const before = window.__json; const utf = encodeSave(JSON.stringify({ note: 'żółć ✓ 👑' })); return { same: decodeSave(text) === before, utf: JSON.parse(decodeSave(utf)).note }; }, exp.text);
  ok(rt.same && rt.utf === 'żółć ✓ 👑', 'export encodes UTF-8 and decodes back exactly');
  await page.evaluate(() => document.querySelector('#modal [data-act="close"]').click());

  // --- abdication offers: none below the minimum, a warning below the goal, the Realm dot only at the goal
  const offer = async n => { await page.evaluate(n => { state.run.repeatables = {}; state.run.gold = goldForCrowns(n, state.meta.crowns) * 1.001; closeModal(); ui.tab = 'realm'; render(); }, n);
    const before = await page.evaluate(() => ({ n: pendingCrowns(), btn: document.querySelector('#panel [data-act="prestige"]').textContent.trim(), cant: document.querySelector('#panel [data-act="prestige"]').classList.contains('cant'),
      note: [...document.querySelectorAll('#panel .stat')].map(p => p.textContent).find(x => /offer|Not yet/.test(x) && !/Crowns held/.test(x)) || '', dot: !!document.querySelector('#tabs [data-id="realm"] .dot') }));
    await page.evaluate(() => document.querySelector('#panel [data-act="prestige"]').click());
    const modal = await page.evaluate(() => { const m = document.getElementById('modal'), open = !!document.querySelector('#modal [data-act="yes"]'), text = open ? m.textContent : ''; closeModal(); return { open, text }; });
    return Object.assign(before, { modal: modal.open, warns: /small offer/i.test(modal.text) }); };
  const CROWN = await page.evaluate(() => ({ MIN: CROWN_MIN, GOAL: CROWN_GOAL }));
  const hallWas = await page.evaluate(() => { const l = hallLevel(); state.run.tiles[HALL_KEY].level = 4; return l; });
  const low = await offer(CROWN.MIN - 1), mid = await offer(CROWN.MIN), high = await offer(CROWN.GOAL);
  ok(low.n === CROWN.MIN - 1 && low.cant && /Needs \d+ Crowns/.test(low.btn) && /Not yet/.test(low.note) && !low.dot && !low.modal, 'below the minimum offer the Realm tab says so and abdication stays shut ' + JSON.stringify(low));
  ok(mid.n === CROWN.MIN && !mid.cant && /Small offer/.test(mid.note) && !mid.dot && mid.modal && mid.warns, 'a small offer can be taken but the tab and the dialog warn, and no dot shows ' + JSON.stringify(mid));
  ok(high.n === CROWN.GOAL && !high.cant && /Good offer/.test(high.note) && high.dot && high.modal && !high.warns, 'at the goal the Realm dot lights and the dialog has no warning ' + JSON.stringify(high));
  await page.evaluate(l => { state.run.tiles[HALL_KEY].level = l; render(); }, hallWas);
  // --- prestige round trip: meta kept, run replaced
  await page.evaluate(() => { state.meta.stats.totalGold = 5e7; state.run.gold = 5e8; state.run.repeatables.monument = 2; render(); });
  const pend = await page.evaluate(() => pendingCrowns());
  await page.evaluate(() => { document.querySelector('#panel [data-act="prestige"]').click(); document.querySelector('#modal [data-act="yes"]').click(); });
  const after = await page.evaluate(() => ({ c: state.meta.crowns, b: state.meta.bonusCrowns, p: pendingCrowns(), rep: state.run.repeatables, hall: hallLevel(), tiles: Object.keys(state.run.tiles).length, tg: state.meta.stats.totalGold, gold: state.run.res.gold }));
  ok(pend > 2 && after.c === 12 + pend && after.b === 2 && after.p === 0 && after.hall === 1 && after.tiles === 1 && after.tg >= 5e7 && after.tg < 5.1e7 && after.gold >= 50 + 100 * after.c, 'prestige: pending ' + pend + ' -> ' + JSON.stringify(after));

  // --- hostile import: markup in fields, out-of-range values (review M3)
  const evil = { v: 2, last: '<img src=x onerror=alert(1)>', meta: { crowns: '<img src=x onerror="window.__xss=1">', bonusCrowns: {}, decree: '<script>window.__xss=1</script>', stats: { totalGold: '"><svg onload=window.__xss=1>', clicks: null } },
    run: { seed: 'x', exp: 9, pop: '<b>', res: { gold: '<img src=x onerror=window.__xss=1>', food: -5, wood: 1e999, stone: NaN }, terrain: [['<img>']],
      tiles: { '5,5': { kind: 'hall', id: 'hall', level: 1e9 }, '4,5': { kind: 'building', id: '<img src=x onerror=window.__xss=1>', level: 2 }, '6,5': { kind: 'building', id: 'constructor', level: 2 }, '"><img src=x onerror=window.__xss=1>': { kind: 'building', id: 'farm', level: 1 }, '5,4': { kind: 'building', id: 'farm', level: '<i>' }, '0,0': { kind: 'building', id: 'farm', level: -3 } },
      research: { axes: 1, '<img onerror=window.__xss=1 src=x>': 1 }, repeatables: { prod: '<img>', food: 1e9 }, buffUntil: 1e99, clock: 5 } };
  await page.evaluate(e => { ui.tab = 'realm'; render(); document.querySelector('#panel [data-act="import"]').click(); document.getElementById('imp').value = encodeSave(JSON.stringify(e)); document.querySelector('#modal [data-act="doimport"]').click(); }, evil);
  const ev = await page.evaluate(() => { for (const t of ['build', 'research', 'decrees', 'realm']) { ui.tab = t; render(); } ui.sel = { tile: HALL_KEY }; render();
    return { xss: window.__xss, img: document.querySelectorAll('#app img, #app script, #toasts img').length + [...document.querySelectorAll('#app svg, #toasts svg')].filter(v => !(v.children.length === 1 && v.firstElementChild.localName === 'use' && /^#sp-\w+$/.test(v.firstElementChild.getAttribute('href')) && [...v.attributes].every(a => !/^on/i.test(a.name)))).length, exp: state.run.exp, crowns: state.meta.crowns, gold: state.run.res.gold, wood: state.run.res.wood, hall: hallLevel(), tiles: Object.keys(state.run.tiles).sort(), farm: state.run.tiles['5,4'], decree: state.meta.decree, rep: state.run.repeatables, tilesShown: document.querySelectorAll('.tile').length, buff: festivalLeft(), ok: isFinite(calc.rates.gold) }; });
  ok(!ev.xss && ev.img === 0 && ev.exp === 3 && ev.crowns === 0 && ev.gold === 50 && ev.hall === 60 && ev.tiles.join(' ') === '0,0 5,4 5,5' && ev.farm.level === 1 && ev.decree === null && ev.tilesShown === 121 && ev.buff <= 60 && ev.ok && ev.rep.food === 500 && !ev.rep.prod,
    'hostile import is coerced/clamped, renders, runs no script ' + JSON.stringify(ev));
  await page.evaluate(() => { document.querySelector('#panel [data-act="import"]') || (ui.tab = 'realm', render()); document.querySelector('#panel [data-act="import"]').click(); document.getElementById('imp').value = 'not a save'; document.querySelector('#modal [data-act="doimport"]').click(); });
  ok(await page.evaluate(() => state.run.exp === 3 && !document.getElementById('modal').hidden), 'unreadable import is rejected and the current game is kept');
  await page.evaluate(() => closeModal());

  // --- H1: a long loop gap goes through the capped offline path
  await fresh(page);
  const gap = await page.evaluate(() => { const c0 = state.run.clock; lastTick = Date.now() - 20 * 3600 * 1000; simTick(); return { clock: state.run.clock - c0, modal: document.getElementById('modalbox').textContent }; });
  ok(Math.abs(gap.clock - 8 * 3600) < 1 && /capped at 8 hours/.test(gap.modal) && /20h 0m/.test(gap.modal), 'resuming after 20h credits exactly 8h and says so (' + (gap.clock / 3600).toFixed(3) + 'h)');

  // --- R3: a hidden tab does not step; its timers waking every ~61s must not dodge the cap or stack dialogs
  await fresh(page);
  const hid = await page.evaluate(() => {
    let hidden = true, dialogs = 0; const realOpen = openModal; window.openModal = (...a) => { dialogs++; return realOpen(...a); };
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    const c0 = state.run.clock;
    for (let i = 0; i < 600; i++) { lastTick -= 61000; simTick(); }           // 10.17h of throttled wake-ups
    const whileHidden = { stepped: state.run.clock - c0, dialogs }; save();
    const savedLag = Date.now() - JSON.parse(localStorage.getItem(SAVE_KEY)).last;
    hidden = false; document.dispatchEvent(new Event('visibilitychange'));
    const out = { whileHidden, savedLagH: savedLag / 3600000, credited: (state.run.clock - c0) / 3600, dialogs, modal: document.getElementById('modalbox').textContent };
    delete document.hidden; window.openModal = realOpen; return out; });
  ok(hid.whileHidden.stepped === 0 && hid.whileHidden.dialogs === 0, 'hidden tab: 600 timer wake-ups step nothing and open no dialog');
  ok(Math.abs(hid.savedLagH - 10.1667) < 0.01, 'a save made while hidden records the time the simulation reached (' + hid.savedLagH.toFixed(2) + 'h ago), not now');
  ok(Math.abs(hid.credited - 8) < 0.001 && hid.dialogs === 1 && /capped at 8 hours/.test(hid.modal) && /10h 10m/.test(hid.modal), 'on return the whole 10.17h arrives as one capped gap: ' + hid.credited.toFixed(3) + 'h credited, ' + hid.dialogs + ' dialog');
  await page.evaluate(() => closeModal());

  // --- old (v1) save tolerated and migrated; short gap credited (L1)
  await page.evaluate(() => { const old = { seed: 12345, res: { gold: 5e6, food: 100000, wood: 1000, stone: 1000, iron: 1000 }, pop: 400, exp: 2,
      tiles: { '5,5': { b: 'hall', l: 4 }, '5,4': { b: 'cottage', l: 8 }, '4,5': { b: 'farm', l: 6 }, '6,5': { b: 'smith', l: 3 }, '5,6': { b: 'nonsense', l: 2 } },
      research: { axes: 1, tithes: 1 }, starving: false, buffUntil: Date.now() + 1e6, quest: 19, crowns: 19, runGold: 3e6, last: Date.now() - 30000,
      stats: { clicks: 10, totalGold: 1.02e7, merchants: 2, prestiges: 1, built: 40, started: Date.now() - 1e7 } };
    ui.paused = true; localStorage.setItem(SAVE_KEY, JSON.stringify(old)); });
  await page.reload(); await page.waitForFunction(() => typeof state === 'object' && document.querySelector('.tile'));
  const mig = await page.evaluate(() => ({ v: state.v, decree: state.meta.decree, crowns: state.meta.crowns, bonus: state.meta.bonusCrowns, pend: pendingCrowns(), cap: calc.cap, tiles: Object.keys(state.run.tiles).length, pop: state.run.pop, clock: Math.round(state.run.clock), fest: festivalOn(), terrain: (() => { const g = genTerrain(12345); for (let x = 0; x < 11; x++) for (let y = 0; y < 11; y++) if (!state.run.tiles[x + ',' + y] && g[x][y] !== state.run.terrain[x][y]) return false; return true; })(), modal: !document.getElementById('modal').hidden, toast: document.getElementById('toasts').textContent }));
  ok(mig.v === 2 && mig.decree === 'dynasty' && mig.crowns === 19 && mig.bonus === 0 && mig.pend >= 0 && mig.tiles === 4 && mig.terrain && !mig.fest && /1 building in this save was not recognised/.test(mig.toast) && /predates the rebalance/.test(mig.toast), 'v1 save migrated ' + JSON.stringify(mig));
  ok(mig.clock >= 29 && mig.clock <= 33 && !mig.modal, 'a 30s reload gap is credited silently (' + mig.clock + 's)');
  const stored = await page.evaluate(() => { ui.merchant.next = 1e9; save(); const s = JSON.parse(localStorage.getItem(SAVE_KEY)); return { v: s.v, grid: Array.isArray(s.run.terrain) && s.run.terrain.length === 11, decree: s.meta.decree, keys: Object.keys(s).sort().join() }; });
  ok(stored.v === 2 && stored.grid && stored.decree === 'dynasty' && stored.keys === 'last,meta,run,v', 'new saves carry a version, the terrain grid and the decree id ' + JSON.stringify(stored));
  ok(errs.length === 0, 'mobile: no console errors ' + JSON.stringify(errs));

  // --- corrupt / hostile stored saves fall back to a fresh game and keep a copy
  for (const [name, raw] of [['truncated JSON', '{"tiles":5,"res":'], ['wrong shape', '{"v":2,"meta":5,"run":[]}'], ['newer version', '{"v":99,"meta":{},"run":{}}'], ['legacy exp:9', JSON.stringify({ seed: 1, exp: 9, res: {}, tiles: {} })]]) {
    await page.evaluate(raw => { ui.paused = true; localStorage.setItem(SAVE_KEY, raw); }, raw);
    await page.reload(); await page.waitForFunction(() => typeof state === 'object' && document.querySelector('.tile'));
    const r = await page.evaluate(() => ({ hall: hallLevel(), tiles: document.querySelectorAll('.tile').length, backup: localStorage.getItem(BACKUP_KEY), exp: state.run.exp }));
    ok(r.hall === 1 && r.tiles >= 25 && errs.length === 0 && (name === 'legacy exp:9' ? r.exp === 3 && r.tiles === 121 : r.backup === raw), name + ': game still playable ' + JSON.stringify({ tiles: r.tiles, exp: r.exp, backedUp: r.backup === raw }));
  }
  // --- failed writes are reported, "Saved." only on success
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; ui.tab = 'realm'; render(); document.getElementById('toasts').innerHTML = ''; document.querySelector('#panel [data-act="save"]').click(); });
  const tt = await page.evaluate(() => document.getElementById('toasts').textContent);
  ok(/Saving failed/.test(tt) && !/💾 Saved/.test(tt), 'failed save is reported and not announced as saved');

  // --- two tabs: the older one pauses
  const ctx2 = await br.newContext({ viewport: { width: 390, height: 844 } });
  const a = await ctx2.newPage(), b = await ctx2.newPage(); const e3 = []; watch(a, e3); watch(b, e3);
  await a.goto(URL); await a.waitForFunction(() => typeof state === 'object'); await b.goto(URL); await a.waitForFunction(() => ui.paused);
  const two = { a: await a.evaluate(() => ({ paused: ui.paused, modal: document.getElementById('modalbox').textContent })), b: await b.evaluate(() => ui.paused) };
  ok(two.a.paused && !two.b && /another tab/.test(two.a.modal) && e3.length === 0, 'opening a second tab pauses the first: ' + JSON.stringify(two.a.paused));
  await a.keyboard.press('Escape'); ok(await a.evaluate(() => !document.getElementById('modal').hidden), 'the paused-tab dialog cannot be dismissed');
  await ctx2.close(); await ctx.close();

  // --- a real phone viewport: iPhone 13 shows 390x664 once Safari's bars are counted (review R1, R2)
  const ph = await br.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' }); const p3 = await ph.newPage(); const e4 = []; watch(p3, e4);
  await p3.goto(URL); await p3.waitForFunction(() => typeof state === 'object' && document.querySelector('.tile')); await fresh(p3);
  const cdp = await ph.newCDPSession(p3);
  const vp = await p3.evaluate(() => ({ w: innerWidth, h: innerHeight })); ok(vp.w === 390 && vp.h === 664, 'phone viewport is ' + vp.w + 'x' + vp.h);
  // The phone shell: nothing scrolls the page, and the map, Collect Taxes, the bar and the tab row are all on screen.
  const reach = sel => p3.evaluate(sel => { const b = document.querySelector(sel); if (!b) return null; const r = b.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height), inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, hit: !!top && b.contains(top), text: b.textContent.trim().replace(/\s+/g, ' ') }; }, sel);
  const still = () => p3.evaluate(() => { scrollTo(0, 500); const y = scrollY; scrollTo(0, 0); return { docH: document.documentElement.scrollHeight, bodyH: document.body.scrollHeight, vh: innerHeight, y, w: document.documentElement.scrollWidth }; });
  const noScroll = d => d.docH <= d.vh + 1 && d.bodyH <= d.vh + 1 && d.y === 0 && d.w <= 390;
  let doc = await still();
  ok(noScroll(doc), 'on load the document cannot scroll ' + JSON.stringify(doc));
  const onLoad = { map: await reach('#mapscroll'), tax: await reach('#clicker'), bar: await reach('#bbrow .bb[data-id="cottage"]'), tabs: {} };
  for (const t of ['build', 'research', 'decrees', 'realm']) onLoad.tabs[t] = await reach('#tabs [data-id="' + t + '"]');
  ok(onLoad.map.inView && onLoad.map.w === onLoad.map.h && onLoad.tax.inView && onLoad.tax.hit && onLoad.tax.h >= 44 && onLoad.bar.inView && onLoad.bar.hit, 'on load the whole square map, Collect Taxes and the build list are on screen ' + JSON.stringify({ map: onLoad.map, tax: onLoad.tax, bar: onLoad.bar }));
  ok(Object.values(onLoad.tabs).every(t => t && t.inView && t.hit && t.h >= 44) && onLoad.tabs.realm.bottom === 664, 'the four tabs form a row along the bottom, each at least 44px tall ' + JSON.stringify(onLoad.tabs.realm));
  ok(await p3.evaluate(() => getComputedStyle(document.getElementById('panel')).display === 'none' && document.getElementById('inspector').parentNode.id === 'strip'), 'the panel starts closed and the inspector sits under the map');
  const goal = await p3.evaluate(() => { const g = document.querySelector('#inspector .goal'), w = document.querySelector('#inspector .welcome'); return { text: g && g.textContent, shown: g && getComputedStyle(g).display !== 'none', welcome: getComputedStyle(w).display }; });
  ok(goal.shown && /A Roof Overhead/.test(goal.text) && goal.welcome === 'none', 'with nothing selected the inspector shows the current decree: "' + goal.text + '"');
  await shot(p3, 'shot-390x664-fresh-closed.png');
  const c1 = await p3.evaluate(() => state.meta.stats.clicks); await p3.tap('#clicker'); await settle(p3);
  ok(await p3.evaluate(() => state.meta.stats.clicks) === c1 + 1, 'Collect Taxes works with one tap from the map');
  // every tab: one tap opens its sheet over the map, content on screen, the page still does not scroll
  const wanted = { build: '.card[data-id="cottage"]', research: '.card[data-act="research"]', decrees: '[data-act="claim"]', realm: '[data-act="prestige"]' };
  for (const t of ['build', 'research', 'decrees', 'realm']) {
    await p3.tap('#tabs [data-id="' + t + '"]'); await settle(p3);
    const sh = await p3.evaluate(sel => { const p = document.getElementById('panel'), r = p.getBoundingClientRect(), tabs = document.getElementById('tabs').getBoundingClientRect(), res = document.getElementById('res').getBoundingClientRect(), el = p.querySelector(sel);
      el.scrollIntoView({ block: 'nearest' }); const e = el.getBoundingClientRect(), hit = document.elementFromPoint(e.left + e.width / 2, e.top + e.height / 2);
      return { open: ui.sheet, on: document.querySelector('#tabs .on').dataset.id, top: Math.round(r.top), bottom: Math.round(r.bottom), tabsTop: Math.round(tabs.top), resBottom: Math.round(res.bottom), head: p.querySelector('.sheethead').textContent.trim(), scrolls: p.scrollHeight > p.clientHeight, panelY: p.scrollTop,
        elTop: Math.round(e.top), elBottom: Math.round(e.bottom), hit: !!hit && el.contains(hit), mapShowing: Math.round(r.top - document.getElementById('mapscroll').getBoundingClientRect().top) }; }, '#panel ' + wanted[t]);
    doc = await still();
    ok(sh.open && sh.on === t && sh.bottom === sh.tabsTop && sh.top >= sh.resBottom + 80 && sh.mapShowing >= 80 && sh.elTop >= sh.top && sh.elBottom <= sh.bottom && sh.hit && noScroll(doc), t + ' tab: the sheet opens above the tab row, its main control is reachable inside it, part of the map stays in view, the page does not scroll ' + JSON.stringify(sh));
    if (t === 'realm') { ok(sh.scrolls, 'the Realm panel is longer than the sheet and scrolls inside it'); await shot(p3, 'shot-390x664-fresh-sheet.png'); }
  }
  await p3.tap('#tabs [data-id="realm"]'); await settle(p3);
  ok(await p3.evaluate(() => !ui.sheet && getComputedStyle(document.getElementById('panel')).display === 'none'), 'tapping the open tab again closes the sheet');
  await p3.tap('#tabs [data-id="research"]'); await settle(p3); await p3.tap('#panel [data-act="closeSheet"]'); await settle(p3);
  ok(await p3.evaluate(() => !ui.sheet), 'the sheet has its own close button');
  await p3.tap('#tabs [data-id="decrees"]'); await settle(p3); await p3.keyboard.press('Escape'); await settle(p3);
  ok(await p3.evaluate(() => !ui.sheet), 'Esc closes the sheet');
  await p3.tap('#tabs [data-id="decrees"]'); await settle(p3);
  const seen = await p3.evaluate(() => { const top = document.getElementById('panel').getBoundingClientRect().top; return [...document.querySelectorAll('.tile')].map(t => t.getBoundingClientRect()).filter(r => r.bottom <= top - 4).map(r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 }))[0]; });
  await p3.touchscreen.tap(seen.x, seen.y); await settle(p3);
  ok(await p3.evaluate(() => !ui.sheet && !!ui.sel.tile), 'tapping a tile above the sheet selects it and closes the sheet');
  await p3.evaluate(() => { ui.sel = {}; render(); ui.barTapAt = -Infinity; });
  await p3.tap('#bbrow .bb[data-id="farm"]'); await settle(p3);
  const picked = await p3.evaluate(() => { const i = document.getElementById('inspector').getBoundingClientRect(), c = document.getElementById('clicker').getBoundingClientRect(), b = document.getElementById('buildbar').getBoundingClientRect();
    return { lead: document.querySelector('#inspector .lead').textContent, bottom: Math.round(i.bottom), clickerBottom: Math.round(c.bottom), bar: Math.round(b.top), info: document.getElementById('bbinfo').textContent }; });
  ok(/Farm/.test(picked.lead) && /Farm/.test(picked.info) && picked.bottom <= picked.bar && picked.clickerBottom <= picked.bar, 'with a building picked the inspector describes it, wholly above the bar, as is Collect Taxes ' + JSON.stringify(picked));
  await p3.evaluate(() => { ui.sel = {}; render(); ui.barTapAt = -Infinity; }); // forget the Farm tap: the next bar tap is not a double tap
  // R1: tile actions are reachable without scrolling
  await p3.evaluate(() => { state.run.res = { gold: 5000, food: 500, wood: 5000, stone: 5000, iron: 0 }; render(); });
  await p3.tap('.tile.hall'); await settle(p3);
  let up = await reach('#buildbar [data-act="up"]');
  ok(up && up.inView && up.hit && up.h >= 44 && /Raise a Manor/.test(up.text) && await p3.evaluate(() => scrollY) === 0, 'tap the hall: "Raise a Manor" is on screen in the bottom bar, unobscured, no scrolling ' + JSON.stringify(up));
  await p3.tap('#buildbar [data-act="up"]'); await settle(p3);
  ok(await p3.evaluate(() => hallLevel()) === 2, 'tapping it upgrades the hall');
  await p3.tap('#buildbar [data-act="deselect"]'); await settle(p3);
  ok(await p3.evaluate(() => !ui.sel.tile && !!document.querySelector('#bbrow .bb[data-act="pick"]')), 'Close returns the bar to the build list');
  await p3.evaluate(() => { const run = state.run; run.exp = 3; run.tiles[HALL_KEY].level = 5; run.res = { gold: 1e9, food: 1e6, wood: 1e9, stone: 1e9, iron: 1e9 }; run.tiles['6,5'] = { kind: 'building', id: 'smith', level: 4 }; run.terrain[6][5] = 'plain'; ui.mapN = 0; render(); });
  await settle(p3); await p3.tap('.tile[data-id="6,5"]'); await settle(p3);
  up = await reach('#buildbar [data-act="up"]'); const dem = await reach('#buildbar [data-act="demolish"]');
  ok(up && up.inView && up.hit && /Upgrade ×2/.test(up.text) && dem && dem.inView && dem.hit && await p3.evaluate(() => scrollY) === 0, 'tap a Blacksmith on the 11x11 map: Upgrade and Demolish are on screen in the bar ' + JSON.stringify({ up, dem }));
  await p3.tap('#buildbar [data-act="up"]'); await settle(p3);
  ok(await p3.evaluate(() => state.run.tiles['6,5'].level) === 5, 'tapping Upgrade in the bar upgrades the Blacksmith');
  await p3.evaluate(() => { state.run.tiles['6,6'] = { kind: 'building', id: 'cottage', level: 2 }; state.run.terrain[6][6] = 'plain'; ui.sel = { tile: '6,6' }; render(); });
  up = await reach('#buildbar [data-act="up"]');
  ok(up && up.inView && /Upgrade \+5/.test(up.text) && await p3.evaluate(() => !!document.querySelector('#bbrow [data-act="up"] svg[aria-label="housing"]')), 'a Cottage upgrade says what the level adds: "' + (up && up.text) + '"');
  await shot(p3, 'shot-390x664-tile.png');
  // a double tap on Close must not fall through to the build button that takes its place
  const dbl = await p3.evaluate(() => { ui.sel = { tile: '6,6' }; render();
    const c = document.querySelector('#buildbar [data-act="deselect"]'), r = c.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    c.click(); const under = document.elementFromPoint(x, y).closest('[data-act]'); under.click();
    return { x, y, act: under.dataset.act, id: under.dataset.id, tile: ui.sel.tile, build: ui.sel.build }; });
  ok(dbl.act === 'pick' && !dbl.tile && !dbl.build, 'second tap of a double tap on Close lands on "' + dbl.id + '" and is ignored');
  await p3.waitForTimeout(400); await p3.touchscreen.tap(dbl.x, dbl.y); await settle(p3);
  ok(await p3.evaluate(() => ui.sel.build) === dbl.id, 'the same button works once the bar has settled');
  await p3.evaluate(() => { ui.sel = {}; render(); });
  // R2, adapted to the shell: a drag never scrolls the page; the map pans only when it is bigger than its frame
  for (const [exp, n] of [[0, 5], [1, 7]]) {
    await fresh(p3); await p3.evaluate(exp => { state.run.exp = exp; ui.mapN = 0; render(); }, exp); await settle(p3);
    const m = await p3.evaluate(() => { const sc = document.getElementById('mapscroll'), r = sc.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.7, pans: sc.classList.contains('pans'), tiles: document.querySelectorAll('.tile').length, fits: sc.scrollWidth <= sc.clientWidth + 1 && sc.scrollHeight <= sc.clientHeight + 1 }; });
    await drag(cdp, m.x, m.y, 0, -250); await p3.waitForTimeout(200);
    const after = await p3.evaluate(() => ({ y: scrollY, top: document.getElementById('mapscroll').scrollTop, sel: Object.keys(ui.sel).length }));
    ok(!m.pans && m.fits && m.tiles === n * n && after.y === 0 && after.top === 0 && after.sel === 0, n + 'x' + n + ' map fits its frame: a 250px upward drag on it moves nothing and selects nothing ' + JSON.stringify(after));
  }
  await fresh(p3); await p3.evaluate(() => { state.run.exp = 3; state.run.tiles[HALL_KEY].level = 5; state.meta.crowns = 20; state.run.res = { gold: 1e8, food: 1e6, wood: 1e7, stone: 1e6, iron: 1e5 }; ui.mapN = 0; render(); }); await settle(p3);
  doc = await still();
  const lateLoad = { tax: await reach('#clicker'), realm: await reach('#tabs [data-id="realm"]'), bar: await reach('#bbrow .bb[data-id="cottage"]') };
  ok(noScroll(doc) && lateLoad.tax.inView && lateLoad.tax.hit && lateLoad.realm.inView && lateLoad.realm.hit && lateLoad.bar.inView, 'late game (11x11, Palace): the page still cannot scroll and Collect Taxes, the bar and the tabs are on screen ' + JSON.stringify(doc));
  await shot(p3, 'shot-390x664-late-closed.png');
  await p3.tap('#tabs [data-id="research"]'); await settle(p3);
  const lateSheet = await p3.evaluate(() => { const p = document.getElementById('panel'); p.scrollTop = p.scrollHeight; const last = p.querySelector('.card[data-act="rep"][data-id="monument"]').getBoundingClientRect(), r = p.getBoundingClientRect();
    return { scrollable: p.scrollHeight > p.clientHeight + 100, scrolled: p.scrollTop > 100, lastIn: last.top >= r.top && last.bottom <= r.bottom, y: scrollY }; });
  ok(lateSheet.scrollable && lateSheet.scrolled && lateSheet.lastIn && lateSheet.y === 0, 'late Research: the long list scrolls inside the sheet down to the last repeatable upgrade ' + JSON.stringify(lateSheet));
  await p3.evaluate(() => { document.getElementById('panel').scrollTop = 0; }); await shot(p3, 'shot-390x664-late-sheet.png');
  await p3.evaluate(() => { ui.merchant.left = 15; ui.merchant.x = 40; ui.merchant.y = 70; render(); }); await settle(p3);
  const hidden = await reach('#merchant'); await p3.tap('#res .chip.merchant'); await settle(p3); const shown = await reach('#merchant');
  ok(hidden && !hidden.hit && shown.inView && shown.hit && await p3.evaluate(() => !ui.sheet), 'a merchant behind the sheet: tapping its chip in the resource bar closes the sheet and the merchant is tappable ' + JSON.stringify(shown));
  await p3.evaluate(() => { ui.merchant.left = 0; ui.sel = {}; render(); });
  const big = await p3.evaluate(() => { const sc = document.getElementById('mapscroll'), r = sc.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, pans: sc.classList.contains('pans'), left: sc.scrollLeft }; });
  await drag(cdp, big.x, big.y, -60, 0); await p3.waitForFunction(() => { const sc = document.getElementById('mapscroll'), v = sc.scrollLeft; return new Promise(r => setTimeout(() => r(sc.scrollLeft === v), 150)); });
  const panned = await p3.evaluate(() => ({ left: document.getElementById('mapscroll').scrollLeft, y: scrollY }));
  ok(big.pans && panned.left > big.left + 30 && panned.y === 0, '11x11 map: a sideways drag pans the map (' + big.left + ' -> ' + panned.left + ') and not the page');
  await p3.evaluate(() => { const sc = document.getElementById('mapscroll'); sc.scrollTop = sc.scrollHeight; }); await settle(p3);
  await drag(cdp, big.x, big.y, 0, -250); await p3.waitForTimeout(250);
  const chained = await p3.evaluate(() => scrollY);
  ok(chained === 0, '11x11 map at its bottom edge: an upward drag does not move the page (' + chained + 'px)');
  // a very short screen (keyboard up, split view): the map frame gets shorter and pans; everything else stays put
  await fresh(p3); await p3.setViewportSize({ width: 390, height: 480 }); await settle(p3);
  const short = await p3.evaluate(() => { const sc = document.getElementById('mapscroll'), c = document.getElementById('clicker').getBoundingClientRect(), t = document.getElementById('tabs').getBoundingClientRect();
    return { docH: document.documentElement.scrollHeight, vh: innerHeight, frameW: sc.clientWidth, frameH: sc.clientHeight, pans: sc.classList.contains('pans'), canPan: sc.scrollHeight > sc.clientHeight, tile: Math.round(document.querySelector('.tile').getBoundingClientRect().height), taxIn: c.top >= 0 && c.bottom <= innerHeight, tabsBottom: Math.round(t.bottom) }; });
  ok(short.docH <= short.vh + 1 && short.frameH < short.frameW && short.frameH >= 120 && short.pans && short.canPan && short.tile >= 40 && short.taxIn && short.tabsBottom === 480, 'at 390x480 the map frame shrinks and pans, tiles keep their size, Collect Taxes and the tabs stay on screen ' + JSON.stringify(short));
  // U1: the grid is sized to the frame's shorter side, so a small map is whole on short and sideways phones too
  const mapFit = () => p3.evaluate(() => { const sc = document.getElementById('mapscroll'), f = sc.getBoundingClientRect(), g = document.getElementById('map').getBoundingClientRect(), ts = [...document.querySelectorAll('.tile')].map(t => t.getBoundingClientRect());
    const R = id => { const r = document.getElementById(id).getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height) }; };
    const goal = document.querySelector('#inspector .goal'), gr = goal && goal.getBoundingClientRect(), lh = goal && parseFloat(getComputedStyle(goal).lineHeight), ins = document.getElementById('inspector');
    return { docH: document.documentElement.scrollHeight, docW: document.documentElement.scrollWidth, vw: innerWidth, vh: innerHeight, pans: sc.classList.contains('pans'), frame: [Math.round(f.width), Math.round(f.height)], grid: [Math.round(g.width), Math.round(g.height)],
      tile: [Math.round(ts[0].width), Math.round(ts[0].height)], font: parseFloat(getComputedStyle(document.querySelector('.tile')).fontSize), inside: ts.every(r => r.left >= f.left - .5 && r.right <= f.right + .5 && r.top >= f.top - .5 && r.bottom <= f.bottom + .5),
      strip: R('strip'), tax: R('clicker'), bar: R('buildbar'), tabs: R('tabs'), map: R('mapscroll'),
      goalLines: goal ? +(gr.height / lh).toFixed(2) : null, goalCut: goal ? goal.scrollHeight > goal.clientHeight + 1 : null, goalInside: goal ? gr.bottom <= ins.getBoundingClientRect().bottom - 2 && ins.scrollHeight <= ins.clientHeight + 1 : null }; });
  const wholeLines = f => f.goalInside && Math.abs(f.goalLines - Math.round(f.goalLines)) < 0.05;
  const onScreen = f => f.docH <= f.vh + 1 && f.docW <= f.vw && f.tax.top >= 0 && f.tax.bottom <= f.vh && f.tax.right <= f.vw && f.tabs.bottom === f.vh && f.bar.bottom <= f.tabs.top + 1;
  for (const [w, h] of [[375, 553], [360, 560]]) {
    await p3.setViewportSize({ width: w, height: h }); await fresh(p3); await settle(p3);
    const f = await mapFit();
    ok(!f.pans && f.inside && f.grid[0] === f.grid[1] && f.tile[0] >= 40 && f.tile[0] === f.tile[1] && f.map.bottom <= f.strip.top && onScreen(f), w + 'x' + h + ', new game: the whole 5x5 map is in its frame without panning, square tiles, controls on screen ' + JSON.stringify({ frame: f.frame, grid: f.grid, tile: f.tile, strip: f.strip.h }));
    ok(wholeLines(f) && f.goalLines <= 2 && f.goalCut, w + 'x' + h + ': the decree line under the map is clamped to ' + f.goalLines + ' whole lines with an ellipsis, not cut mid-line');
  }
  await p3.setViewportSize({ width: 664, height: 340 }); await fresh(p3); await settle(p3);
  let land = await mapFit();
  ok(!land.pans && land.inside && land.grid[0] === land.grid[1] && land.tile[0] >= 40 && land.tile[0] === land.tile[1] && land.font < land.tile[0] * 0.7, '664x340 (phone on its side), new game: the whole map is in its frame, square tiles with icons that fit ' + JSON.stringify({ frame: land.frame, grid: land.grid, tile: land.tile, font: land.font }));
  ok(onScreen(land) && land.strip.left >= land.map.right && land.bar.left >= land.map.right && land.tabs.left >= land.map.right && wholeLines(land), '664x340: the strip, bar and tabs stack to the right of the map, nothing scrolls ' + JSON.stringify({ map: land.map, strip: land.strip, bar: land.bar, tabs: land.tabs }));
  await p3.tap('#tabs [data-id="realm"]'); await settle(p3);
  const landSheet = await p3.evaluate(() => { const p = document.getElementById('panel'), b = p.querySelector('[data-act="prestige"]'); b.scrollIntoView({ block: 'nearest' }); const r = p.getBoundingClientRect(), e = b.getBoundingClientRect(), hit = document.elementFromPoint(e.left + e.width / 2, e.top + e.height / 2);
    return { top: Math.round(r.top), left: Math.round(r.left), resBottom: Math.round(document.getElementById('res').getBoundingClientRect().bottom), mapRight: Math.round(document.getElementById('mapscroll').getBoundingClientRect().right), hit: !!hit && b.contains(hit), docH: document.documentElement.scrollHeight }; });
  ok(landSheet.top >= landSheet.resBottom && landSheet.left >= landSheet.mapRight && landSheet.hit && landSheet.docH <= 341, '664x340: a sheet opens beside the map, under the resource bar, with its button reachable ' + JSON.stringify(landSheet));
  await p3.evaluate(() => { ui.sheet = false; state.run.exp = 3; ui.mapN = 0; render(); }); await settle(p3);
  land = await mapFit();
  ok(land.pans && land.tile[0] === 40 && land.tile[1] === 40 && onScreen(land), '664x340, 11x11 map: tiles stay 40px square and the map pans ' + JSON.stringify({ frame: land.frame, grid: land.grid }));
  // the strip under the map has one height whatever is selected, so the map never jumps; a tall phone gives the rest to the map
  await p3.setViewportSize({ width: 390, height: 844 }); await fresh(p3); await settle(p3);
  const idle = await mapFit(); await p3.evaluate(() => { ui.barTapAt = -Infinity; }); await p3.tap('#bbrow .bb[data-id="farm"]'); await settle(p3);
  const pick = await mapFit(); await p3.tap('.tile.hall'); await settle(p3);
  const tsel = await mapFit();
  ok(idle.strip.h <= 100 && pick.strip.h === idle.strip.h && tsel.strip.h === idle.strip.h && pick.map.top === idle.map.top && tsel.map.top === idle.map.top && tsel.frame[0] === idle.frame[0] && !idle.pans && onScreen(tsel),
    '390x844: the strip is ' + idle.strip.h + 'px idle, with a building picked and with a tile selected, and the map does not move ' + JSON.stringify({ map: idle.map, strip: idle.strip }));
  await p3.evaluate(() => { ui.sel = {}; state.run.exp = 3; ui.mapN = 0; render(); }); await settle(p3);
  const tall = await mapFit();
  ok(tall.frame[1] >= 480 && tall.frame[1] > tall.frame[0] && tall.grid[1] <= tall.frame[1] && onScreen(tall), '390x844, 11x11 map: the frame is taller than wide (' + tall.frame.join('x') + ') and shows every row; only sideways panning is left');
  await p3.setViewportSize({ width: 390, height: 664 }); await settle(p3);
  await fresh(p3); await p3.evaluate(() => { state.run.exp = 3; ui.mapN = 0; render(); }); await settle(p3);
  // S1: a resize (address bar showing or hiding) must not recentre a panned map
  const keptPan = await p3.evaluate(() => { const sc = document.getElementById('mapscroll'); sc.scrollLeft = 0; sc.scrollTop = 0;
    window.dispatchEvent(new Event('resize')); render(); return { left: sc.scrollLeft, top: sc.scrollTop, pans: sc.classList.contains('pans') }; });
  ok(keptPan.pans && keptPan.left === 0 && keptPan.top === 0, "resize keeps the map where it was panned to " + JSON.stringify(keptPan));
  await p3.setViewportSize({ width: 390, height: 720 }); await settle(p3);
  const kept2 = await p3.evaluate(() => { const sc = document.getElementById('mapscroll'); return { left: sc.scrollLeft, top: sc.scrollTop }; });
  ok(kept2.left === 0 && kept2.top === 0, 'a real viewport height change (664 -> 720) keeps it too ' + JSON.stringify(kept2));
  await p3.setViewportSize({ width: 390, height: 664 });
  const grown = await p3.evaluate(() => { state.run.exp = 2; render(); const sc = document.getElementById('mapscroll'); return { left: sc.scrollLeft, max: sc.scrollWidth - sc.clientWidth }; });
  ok(grown.max > 0 && Math.abs(grown.left - grown.max / 2) <= 1, 'a change of map size still recentres on the hall ' + JSON.stringify(grown));
  ok(e4.length === 0, 'phone: no console errors ' + JSON.stringify(e4));
  await ph.close();

  // --- desktop
  const d = await br.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' }); const p2 = await d.newPage(); const e2 = []; watch(p2, e2);
  await p2.goto(URL); await p2.waitForFunction(() => typeof state === 'object' && document.querySelector('.tile')); await fresh(p2);
  await p2.evaluate(() => { state.run.exp = 3; state.run.tiles[HALL_KEY].level = 5; state.run.res = { gold: 1e8, food: 1e6, wood: 1e7, stone: 1e6, iron: 1e5 }; render(); });
  const dd = await p2.evaluate(() => { const t = document.querySelector('.tile').getBoundingClientRect(), sc = document.getElementById('mapscroll');
    return { bar: getComputedStyle(document.getElementById('buildbar')).display, tw: t.width, scroll: sc.scrollWidth > sc.clientWidth || sc.scrollHeight > sc.clientHeight, hint: !document.getElementById('maphint').hidden, label: document.querySelector('.tile.hall').getAttribute('aria-label') }; });
  ok(dd.bar === 'none' && dd.tw > 45 && !dd.scroll && !dd.hint && dd.label === 'Palace, level 5', 'desktop: no build bar, full map fits without scrolling, tiles labelled ' + JSON.stringify(dd));
  await p2.hover('.tile'); await settle(p2);
  ok(!(await p2.evaluate(() => { const sc = document.getElementById('mapscroll'); return sc.scrollWidth > sc.clientWidth || sc.scrollHeight > sc.clientHeight; })), 'desktop: hovering a corner tile adds no scrollbars');
  const place = () => p2.evaluate(() => ({ host: document.getElementById('inspector').parentNode.id, panel: getComputedStyle(document.getElementById('panel')).display, head: getComputedStyle(document.querySelector('.sheethead')).display, header: getComputedStyle(document.querySelector('header')).display, on: !!document.querySelector('#tabs .on'), canScroll: document.documentElement.scrollHeight > innerHeight }));
  const wideL = await place(); await p2.setViewportSize({ width: 700, height: 900 }); await settle(p2); const narrowL = await place();
  await p2.setViewportSize({ width: 1280, height: 900 }); await settle(p2); const backL = await place();
  ok(wideL.host === 'side' && wideL.panel === 'block' && wideL.head === 'none' && wideL.header !== 'none' && wideL.on && narrowL.host === 'strip' && narrowL.panel === 'none' && !narrowL.canScroll && backL.host === 'side' && backL.panel === 'block',
    'desktop keeps the side panel open with the inspector above it; narrowing the window switches to the phone shell and back ' + JSON.stringify({ wideL, narrowL, backL }));
  ok(e2.length === 0, 'desktop: no console errors ' + JSON.stringify(e2));
  await shot(p2, 'shot-1280.png');

  // --- sprites: every icon is a drawing that exists, and no emoji is left anywhere on screen
  const art = await p2.evaluate(() => {
    const missing = [], emoji = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}️]/u, seen = new Set(), text = [];
    const need = [...Object.keys(RESOURCES), ...Object.keys(BUILDINGS), ...Object.keys(TERRAIN).filter(t => t !== 'plain'), ...HALL_TIERS.map((_, i) => 'hall' + (i + 1))];
    for (const id of need) if (!SPRITES[id]) missing.push(id);
    const tables = [RESOURCES, BUILDINGS, HALL_TIERS, TERRAIN].flatMap(t => Object.values(t)).filter(d => d.icon && !d.icon.startsWith('<svg')).map(d => d.name);
    const scan = () => { for (const u of document.querySelectorAll('use')) { const id = u.getAttribute('href'); seen.add(id); if (!document.querySelector(id)) missing.push(id); }
      const t = document.body.innerText; if (emoji.test(t)) text.push(t.match(emoji)[0]); };
    state.run.res = { gold: 1e9, food: 1e9, wood: 1e9, stone: 1e9, iron: 1e9 }; state.meta.crowns = 3; state.run.tiles[HALL_KEY].level = 5; state.run.exp = 3; ui.mapN = 0;
    let i = 0; for (const id of BUILD_ORDER) { for (let x = 0; x < MAP_SIZE && i >= 0; x++) for (let y = 0; y < MAP_SIZE; y++) if (state.run.terrain[x][y] === 'plain' && !state.run.tiles[x + ',' + y]) { state.run.tiles[x + ',' + y] = { kind: 'building', id, level: 2 }; x = MAP_SIZE; break; } }
    calc = compute(); ui.merchant.left = 20; ui.merchant.x = ui.merchant.y = 50;
    for (const lv of [1, 2, 3, 4, 5]) { state.run.tiles[HALL_KEY].level = lv; calc = compute();
      for (const t of ['build', 'research', 'decrees', 'realm']) { ui.tab = t; ui.sel = {}; render(); scan(); }
      ui.sel = { tile: HALL_KEY }; render(); scan(); }
    const k = Object.keys(state.run.tiles).find(k => state.run.tiles[k].id === 'cottage'); ui.sel = { tile: k }; render(); scan();
    ui.sel = { build: 'farm' }; render(); scan();
    for (const r of [upgrade(HALL_KEY), claimDecree(), expand()]) say(r); toast('x', 'warn'); scan();
    const sp = document.querySelector('.tile.built > .sp').getBoundingClientRect(), tl = document.querySelector('.tile.built').getBoundingClientRect();
    return { missing, tables, text, kinds: seen.size, fit: sp.width > tl.width * 0.6 && sp.width <= tl.width && sp.height <= tl.height };
  });
  ok(!art.missing.length && !art.tables.length && !art.text.length && art.kinds >= 30 && art.fit, 'every resource, terrain, hall level and building has a sprite that resolves, tiles show them at size, and no emoji is on screen ' + JSON.stringify(art));
  ok(e2.length === 0, 'sprites: no console errors ' + JSON.stringify(e2));
  await br.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
