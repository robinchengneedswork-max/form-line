'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  HEADLESS — the rules, checked without a browser.
//    node test/headless.js
//  §1 loading · §2 the musket · §3 ground · §4 orders & the drum
//  §5 morale & colours · §6 battles end · §7 campaign · §8 the page loads
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const fs = require('fs'), path = require('path'), vm = require('vm');
const { load, SIM_FILES } = require('./load');
const { X } = load();
const { knowsDrill, SETPIECE_POOL, Command, dist, Battle, CFG, Campaign, makeRng, Field, Orders, Combat, Morale, Unit, SCENARIOS, BATTLE_POOL, T, MAP_ROWS, EVENTS, TUNES, CADENCES, DRUM_CALLS, noteFreq } = X;

let pass = 0, fail = 0;
const chk = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + extra : '')); }
};
const run = (B, secs) => { const n = Math.round(secs / CFG.STEP); for (let i = 0; i < n && !B.over; i++) { Battle.step(B, CFG.STEP); B.events.length = 0; } };
const fresh = (scenario = 'plain', seed = 11, extra = {}) => Battle.create(Object.assign({ scenario, seed, level: 0.3, company: Campaign.defaultCompany(makeRng(seed)) }, extra));

console.log('§1 loading');
chk('every scenario builds and deploys', BATTLE_POOL.concat('finale').every(k => { const B = fresh(k); return B.units.length >= 2 && B.player.formed > 0; }));
chk('every deployment starts on passable ground', BATTLE_POOL.concat('finale').every(k => { const B = fresh(k); return B.units.every(u => u.men.filter(m => Field.passable(B.field, m.x, m.y)).length >= u.men.length * 0.9); }));
{
  const a = fresh('plain', 99), b = fresh('plain', 99);
  run(a, 200); run(b, 200);
  chk('same seed, same battle (determinism)', a.units.map(u => u.formed + ':' + u.morale.toFixed(3)).join() === b.units.map(u => u.formed + ':' + u.morale.toFixed(3)).join());
}

console.log('§2 the musket');
{
  const B = fresh(), u = B.player, rs = [];
  for (const m of u.men) if (m.role === 'line') rs.push(Combat.reloadTime(B, m, u));
  const avg = rs.reduce((a, b) => a + b, 0) / rs.length;
  chk('average company reloads in about a minute (the anchor)', avg > 50 && avg < 70, avg.toFixed(1) + ' s');
  const vet = Object.assign({}, u, { drill: 0.9 });
  const vavg = u.men.filter(m => m.role === 'line').reduce((a, m) => a + Combat.reloadTime(B, m, vet), 0) / rs.length;
  chk('drilled veterans load faster', vavg < avg - 10, vavg.toFixed(1));
  chk('hit chance falls with range: ~12% at 70 m, ~3% at 150 m', Math.abs(CFG.HIT_P0 * Math.exp(-70 / CFG.HIT_FALLOFF) - 0.12) < 0.02 && CFG.HIT_P0 * Math.exp(-150 / CFG.HIT_FALLOFF) < 0.04);
  // men only fire when halted, in slot, and in the front two ranks
  const fr = fresh('plain', 5); const fu = fr.units[1];
  chk('a French company is three deep', fu.ranks === 3);
  const third = fu.men.find(m => m.role === 'line' && m.rank === 2);
  chk('…and its third rank cannot fire', third && !Combat.canFire(fu, third));
  fu.order = 'advance';
  chk('nobody fires on the march', !fu.men.some(m => m.role === 'line' && Combat.canFire(fu, m)));
}
{
  // make ready holds fire; FIRE lets it go
  const B = fresh('plain', 7);
  const u = B.player;
  Orders.apply(B, u, 'ready', {});
  run(B, 6);
  const pres = u.men.filter(m => m.m === 'present').length;
  chk('"Make ready" brings the front ranks to the present', pres >= u.formed * 0.8, pres);
  chk('…and they hold their fire', u.stats.shots === 0);
  Orders.apply(B, u, 'fire', {});
  run(B, 1);
  chk('"Fire!" lets go a volley', u.stats.shots >= pres * 0.8, u.stats.shots);
  chk('…which leaves smoke on the field', B.smoke.length >= u.stats.shots);
  chk('…and empties the muskets for a minute', u.men.filter(m => m.m === 'reloading').length >= pres * 0.8);
}

console.log('§3 ground');
{
  const B = fresh('ridge', 3), f = B.field;
  const crest = (() => { let best = 0, by = 0; for (let y = 200; y < 460; y += 4) { const h = Field.heightAt(f, 360, y); if (h > best) { best = h; by = y; } } return by; })();
  chk('the ridge has a crest', crest > 250 && crest < 420, crest);
  chk('a man behind the crest cannot be seen from the far slope', !Field.los(f, 360, crest - 110, 360, crest + 40));
  chk('…but can from the crest itself', Field.los(f, 360, crest - 5, 360, crest + 25));
  const F = fresh('farm', 3).field;
  chk('a wall covers the man behind it', Field.coverFor(F, 340, 234, 340, 150) < 0.5);
  chk('…but not the man in front of it', Field.coverFor(F, 340, 222, 340, 150) === 1);
  chk('woods hide what is deep inside them', (() => { const W = fresh('woods', 3).field; let blocked = 0, n = 0; for (let x = 200; x < 520; x += 20) { if (Field.typeAt(W, x, 190) !== T.WOODS) continue; n++; if (!Field.los(W, x, 330, x, 150)) blocked++; } return n === 0 || blocked / n > 0.6; })());
  const R = fresh('ford', 3);
  chk('the river is impassable and the ford is not', !Field.passable(R.field, 400, 260 + Math.sin(400 / 90) * 18) && Field.passable(R.field, 190, 262));
  chk('the AI routes a column across the river by a crossing', X.AI.route(R, 220, 80, 230, 450).length === 4);
  chk('uphill is slower than downhill', Field.speedAt(B.field, 360, crest + 30, 0, -1) < Field.speedAt(B.field, 360, crest - 5, 0, 1));
}

console.log('§4 orders & the drum');
{
  const B = fresh('plain', 8);
  B.cmd.x = B.player.cx; B.cmd.y = B.player.cy + 120;
  chk('beyond shouting range, the drummer carries the order', Orders.shout(B, 'ready') === true && B.pending[0].at - B.t === CFG.DRUM_DELAY);
  for (const m of B.player.men) if (m.role === 'drummer') m.state = 'down';
  B.pending.length = 0;
  chk('without a drummer, nobody out there hears you', Orders.shout(B, 'ready') === false && B.pending.length === 0);
  B.cmd.x = B.player.cx; B.cmd.y = B.player.cy + 8;
  chk('…until you walk over and say it to their faces', Orders.shout(B, 'ready') === true && B.pending[0].at - B.t === CFG.VOICE_DELAY);
}
{
  const B = fresh('plain', 9);
  B.cmd.aim = 0; Orders.apply(B, B.player, 'line', { x: 300, y: 400, facing: 0 });
  run(B, 60);
  chk('"Form line" re-forms the company where you said, facing where you looked', dist(B.player.cx, B.player.cy, 300 - 0.85, 400) < 4 && B.player.inSlot > 0.8, `${B.player.cx.toFixed(0)},${B.player.cy.toFixed(0)} inSlot ${B.player.inSlot.toFixed(2)}`);
  Orders.apply(B, B.player, 'follow', {});
  B.cmd.dest = { x: 300, y: 300 };
  run(B, 80);
  const lead = B.player.slotOrder[0];
  chk('"Follow me" brings a column along behind you', B.player.form.kind === 'column' && dist(lead.x, lead.y, B.cmd.x, B.cmd.y) < 12, dist(lead.x, lead.y, B.cmd.x, B.cmd.y).toFixed(1));
}

console.log('§5 morale & colours');
{
  const B = fresh('plain', 12), u = B.player;
  const m0 = u.morale;
  const men = u.men.filter(m => m.role === 'line').slice(0, 3);
  for (const m of men) Combat.hit(B, m, null);
  const volleyLoss = m0 - u.morale;
  const B2 = fresh('plain', 12), u2 = B2.player, m2 = u2.morale;
  const men2 = u2.men.filter(m => m.role === 'line').slice(0, 3);
  for (const m of men2) { Combat.hit(B2, m, null); B2.t += 5; }
  chk('three men falling together hurt more than three over time', volleyLoss > (m2 - u2.morale) + 2, `${volleyLoss.toFixed(1)} vs ${(m2 - u2.morale).toFixed(1)}`);
  const ens = u.men.find(m => m.role === 'ensign');
  Combat.hit(B, ens, null);
  chk('when the ensign falls, the colours go down', B.dropped.length === 1);
  run(B, 4);
  chk('…and a sergeant takes them up again', B.dropped.length === 0 && Unit.hasRole(u, 'ensign'));
  u.morale = 5; Morale.step(B, CFG.STEP);
  chk('a company with its nerve gone routs', u.routed && !u.men.some(m => m.state === 'formed'));
  // the commander can rally them
  B.t += 30; u.morale = CFG.RALLY_AT; u.lastHit = -99;
  B.cmd.x = u.cx; B.cmd.y = u.cy;
  for (const m of u.men) if (m.state === 'fleeing') { m.x = B.cmd.x + 3; m.y = B.cmd.y + 3; }
  Unit.survey(u);
  chk('"Rally!" in person brings a routed company back', Morale.rally(B) && !u.routed && u.formed > 5);
}
{
  const B = fresh('plain', 13), E = B.units[1];
  const ens = E.men.find(m => m.role === 'ensign');
  B.cmd.x = ens.x + 1; B.cmd.y = ens.y;
  Combat.hit(B, ens, null);
  for (const m of E.men) if (m.state === 'formed' && dist(m.x, m.y, ens.x, ens.y) < 7) m.state = 'fleeing';
  run(B, 2.5);
  chk('walk over the enemy colours and they are yours', B.stats.coloursTaken === 1 && E.coloursLost);
}

console.log('§6 battles end');
{
  const B = fresh('plain', 21, { autoPlayer: true, playerDoctrine: 'attack' });
  run(B, CFG.NIGHTFALL + 10);
  chk('an open-field battle reaches a result', B.over && ['won', 'lost', 'fell'].includes(B.result.how), B.result && B.result.how);
  chk('…in a deliberate few minutes, not seconds or half an hour', B.t > 120 && B.t < 900, (B.t / 60).toFixed(1) + ' min');
  const B2 = fresh('plain', 22); B2.cmd.hp = 1; Combat.hit(B2, B2.cmd, null); run(B2, 1.5);
  chk('if you fall, the battle is over', B2.over && B2.result.how === 'fell');
}

console.log('§7 campaign');
{
  const r = Campaign.newRun(1234);
  chk(`the route has ${MAP_ROWS} stages ending in the great battle`, r.map.length === MAP_ROWS && r.map[MAP_ROWS - 1][0].type === 'finale');
  const reach = new Set(r.map[0].map(n => n.id));
  for (const row of r.map) for (const n of row) if (reach.has(n.id)) n.edges.forEach(e => reach.add(e));
  chk('every stage can be reached', r.map.every(row => row.every(n => reach.has(n.id))));
  const json = JSON.parse(JSON.stringify(r));
  chk('a run survives a save/load round trip', json.map.length === MAP_ROWS && json.company.soldiers.length === 24);
  // fight a battle through the campaign bookkeeping
  const node = r.map[0][0]; Campaign.go(r, node.id);
  const B = Battle.create(Object.assign(Campaign.battleOpts(r, node), { autoPlayer: true, playerDoctrine: 'attack' }));
  run(B, CFG.NIGHTFALL + 10);
  const before = r.company.soldiers.length;
  const rep = Campaign.afterBattle(r, node, B.result);
  chk('after a battle the dead leave the roll and the rest gain experience', r.company.soldiers.length === before - rep.dead.length && r.company.soldiers.some(s => s.battles === 1));
  chk('renown earned is never less than renown to spend', r.total >= r.renown);
  r.renown = 100;
  const cap = Campaign.capacity(r);
  chk('the quartermaster sells recruits up to your rank\'s strength', (() => { let n = 0; while (Campaign.buy(r, 'recruit') && n < 60) n++; return r.company.soldiers.length <= cap; })());
  chk('rank follows renown earned', Campaign.rank({ total: 0 }).title === 'Lieutenant' && Campaign.rank({ total: 999 }).title === 'Lieutenant-Colonel');
  chk('every road event resolves to text', EVENTS.every(ev => ev.options.every(([, fn]) => typeof fn(JSON.parse(JSON.stringify(r)), makeRng(5)) === 'string')));
}

console.log('§9 drill & the company');
{
  // fire by rank: one rank's volley, then the next
  const B = fresh('plain', 41), u = B.player;
  for (const m of u.men) { m.x = m.sx; m.y = m.sy; }
  Orders.apply(B, u, 'byrank', {});
  const E = B.units[1]; for (const m of E.men) { m.y += 250; m.sy = m.y; } Unit.survey(E);
  run(B, 4.5);
  const fired = r => u.men.filter(m => m.role === 'line' && m.rank === r && m.m === 'reloading').length;
  chk('fire by rank: the front rank fires first…', fired(0) > 3 && fired(1) === 0, fired(0) + '/' + fired(1));
  run(B, CFG.BYRANK_GAP + 1);
  chk('…then the rank behind it', fired(1) > 3, fired(1));
}
{
  const B = fresh('plain', 42), u = B.player;
  Orders.apply(B, u, 'attackcol', { x: u.cx, y: u.cy, facing: -Math.PI / 2 });
  Unit.layout(u);
  const g = Unit.grid(u, u.formed);
  chk('a column of attack is narrow and deep', u.form.kind === 'attack' && g.files === CFG.ATTACK_FILES && g.ranks >= 4, g.files + 'x' + g.ranks);
  Orders.apply(B, u, 'advance', { facing: -Math.PI / 2 });
  chk('…advances as a column, not a line', u.form.kind === 'attack' && u.order === 'advance');
  Orders.apply(B, u, 'charge', {});
  chk('…and remembers it charged from column (for the shock)', u.chargeFrom === 'attack');
}
{
  const r = Campaign.newRun(77);
  const B = Battle.create(Object.assign(Campaign.battleOpts(r, r.map[0][0]), { scenario: 'plain' }));
  chk('a new company has not learned fire by rank', Orders.shout(B, 'byrank') === false && B.pending.length === 0);
  r.company.drills.push('byrank');
  const B2 = Battle.create(Object.assign(Campaign.battleOpts(r, r.map[0][0]), { scenario: 'plain' }));
  chk('…until it drills it in camp', Orders.shout(B2, 'byrank') === true);
  chk('camp can teach a drill', Campaign.camp(r, 'learn:attackcol').includes('column of attack') && r.company.drills.includes('attackcol'));
  chk('quick battles know every drill', knowsDrill(fresh('plain', 3, { company: undefined }).player, 'attackcol'));
}
{
  const r = Campaign.newRun(78); r.renown = 100; r.total = 100;
  const s = r.company.soldiers[0]; s.xp = 2;
  chk('a private needs experience to be made corporal', !Campaign.promote(r, s.id));
  s.xp = 7;
  chk('…and with it, he is', Campaign.promote(r, s.id) && s.rank === 'cpl' && r.renown === 95);
  chk('…and then sergeant', Campaign.promote(r, s.id) && s.rank === 'sgt');
  const B = Battle.create(Object.assign(Campaign.battleOpts(r, r.map[0][0]), { scenario: 'plain' }));
  chk('sergeants steady the company (baseline morale)', Morale.ncos(B.player) >= 2);
  chk('rifles: the quartermaster sells one and the best shot carries it', Campaign.buy(r, 'rifle') && r.company.soldiers.filter(x => x.weapon === 'rifle').length === 1 &&
    r.company.soldiers.find(x => x.weapon === 'rifle').aim === Math.max(...r.company.soldiers.map(x => x.aim)));
  const B3 = Battle.create(Object.assign(Campaign.battleOpts(r, r.map[0][0]), { scenario: 'plain' }));
  const rm = B3.player.men.find(m => m.weapon === 'rifle'), mm = B3.player.men.find(m => m.role === 'line' && m.weapon !== 'rifle');
  chk('…a rifle reaches further and loads slower', Combat.range(rm, false) > Combat.range(mm, false) && Combat.reloadTime(B3, rm, B3.player) > Combat.reloadTime(B3, mm, B3.player) * 1.3);
  chk('a Lieutenant cannot choose the company type yet', !Campaign.chooseType(Object.assign(Campaign.newRun(5), { total: 0 }), 'light'));
  chk('a Captain can; Light companies learn skirmish order at once', Campaign.chooseType(r, 'light') && r.company.drills.includes('skirmish'));
  const B4 = Battle.create(Object.assign(Campaign.battleOpts(r, r.map[0][0]), { scenario: 'plain' }));
  chk('…and fight as light infantry', B4.player.ctype === 'light');
  const old = JSON.parse(JSON.stringify(Campaign.newRun(9))); delete old.company.drills; delete old.company.rifles; old.company.soldiers.forEach(x => { delete x.rank; delete x.weapon; });
  chk('a save from before the company sheet still loads', Campaign.migrate(old).company.drills.length === 0 && old.company.soldiers[0].rank === 'pte');
}

console.log('§10 set pieces');
{
  const B = fresh('sp_ridge', 51, { autoPlayer: true });
  chk('a set piece is a bigger field', B.field.w > 900);
  chk('…with a headquarters and a dispatch for you', !!B.hq && B.dispatch && /ridge/i.test(B.dispatch.text));
  chk('…and every company has a task', B.units.every(u => u.task));
  const waves = B.units.filter(u => u.team === 1 && u.task.kind === 'reserve' && u.task.wave);
  run(B, Math.max(...waves.map(w => w.task.wave)) + 4);
  chk('enemy waves go in when their hour comes', waves.every(w => w.routed || w.task.kind === 'attack'));
  chk('the colonel tracks whether you obeyed', B.orders.total > 20 && B.orders.good / B.orders.total > 0.5, B.orders.good + '/' + B.orders.total);
}
{
  const B = fresh('sp_village', 52);
  const g = B.units.find(u => u.team === 0 && !u.isPlayer && u.task.kind === 'hold');
  g.routed = true; B.player.cx = 470; B.player.cy = 600;
  Command.think(B, 0, B.hq[0]);
  chk('when a post is lost, the nearest reserve is sent to retake it', B.units.some(u => u.task && u.task.kind === 'attack' && dist(u.task.x, u.task.y, g.task.x, g.task.y) < 1));
  chk('…and if that is you, a galloper brings the order', B.player.task.kind === 'attack' && /Retake/.test(B.dispatch.text));
}
{
  const r = Campaign.newRun(4321);
  chk('the campaign route has set pieces along it', r.map.some(row => row.some(n => n.type === 'setpiece' && SETPIECE_POOL.includes(n.scenario))) && r.map[MAP_ROWS - 1][0].scenario === 'finale');
  chk('the great battle is a set piece', !!SCENARIOS.finale.setpiece);
}

console.log('§8 music & the page');
chk('every tune note is a real pitch', Object.values(TUNES).every(t => t.melody.every(([n]) => n === 'R' || noteFreq(n) > 200)));
chk('every order has a drum call', ['follow', 'line', 'advance', 'halt', 'ready', 'fire', 'atwill', 'cease', 'charge', 'fallback', 'skirmish', 'rally'].every(k => DRUM_CALLS[k]));
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="src\/([^"]+)"/g)].map(m => m[1]);
  chk('index.html loads the sim in the same order as the tests', SIM_FILES.every((f, i) => scripts[i] === f), scripts.join(','));
  // load the whole page's scripts with a stubbed DOM
  const ctx2d = new Proxy({}, { get(t, k) { if (k in t) return t[k]; if (k === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(4) }); if (k === 'measureText') return () => ({ width: 40 }); return () => {}; }, set(t, k, v) { t[k] = v; return true; } });
  const el = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, querySelectorAll: () => [], appendChild() {}, getContext: () => ctx2d, clientWidth: 1200, clientHeight: 700, innerHTML: '', textContent: '', set onclick(v) {} });
  const els = {};
  let onload = null;
  const sb = { window: null, document: { getElementById: id => els[id] || (els[id] = el()), querySelectorAll: () => [], createElement: el, querySelector: () => el(), body: el() },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, requestAnimationFrame: () => 0, devicePixelRatio: 1, setTimeout: () => 0 };
  sb.window = { addEventListener: (ev, fn) => { if (ev === 'load') onload = fn; }, devicePixelRatio: 1 };
  const timers = [];
  sb.setTimeout = (fn) => { timers.push(fn); return timers.length; };
  sb.clearTimeout = (i) => { if (i) timers[i - 1] = null; };
  sb.navigator = {};
  sb.performance = { now: () => sb.__now || 0 };
  sb.window.matchMedia = () => ({ matches: true });
  const { ctx } = load(['render.js', 'audio.js', 'input.js', 'touch.js', 'ui.js', 'main.js'], sb);
  let ok = true;
  try { onload(); vm.runInContext("App.quickBattle('farm'); document.getElementById('btn-go').onclick && 0; Render.draw(Battle.create({scenario:'farm', seed: 3}), {ghost:true}); UI.hud(Battle.create({scenario:'plain', seed: 3}));", ctx); } catch (e) { ok = false; console.log(e.stack); }
  chk('the whole page boots, draws a battle and fills the HUD (stubbed DOM)', ok && !!onload);
  // a finger on the glass
  const T = vm.runInContext(`App.B = Battle.create({scenario:'plain', seed: 4}); App.mode = 'battle'; App.paused = false; Render.W = 1000; Render.H = 700; Render.cam.x = App.B.cmd.x; Render.cam.y = App.B.cmd.y; ({ Touch, App, Render })`, ctx);
  const ev = (id, x, y) => ({ pointerType: 'touch', pointerId: id, offsetX: x, offsetY: y, preventDefault() {} });
  T.Touch.down(ev(1, 500, 300)); sb.__now = 500; timers.splice(0).forEach(f => f && f());
  chk('touch and hold opens the order wheel', !!T.Touch.wheel);
  chk('…and holding sets where you look (north of you here)', Math.abs(T.App.B.cmd.aim + Math.PI / 2) < 0.3, T.App.B.cmd.aim.toFixed(2));
  const W = () => T.Touch.wheel;
  T.Touch.move(ev(1, 500, 255));
  chk('…the inner ring offers categories: up is Fire', W() && W().group === 0 && W().opt === -1);
  T.Touch.move(ev(1, 455, 300));
  chk('…left is Move', W().group === 3);
  T.Touch.move(ev(1, 500 - 110 * Math.cos(0.72), 300 - 110 * Math.sin(0.72)));
  chk('…and sliding on outward picks within it: left-then-up is Advance', W().group === 3 && W().opt === 0, W().group + '/' + W().opt);
  T.Touch.move(ev(1, 545, 300)); T.Touch.move(ev(1, 610, 300));
  chk('…right-then-right is Charge', W().group === 1 && W().opt === 0);
  T.Touch.move(ev(1, 500, 255)); T.Touch.move(ev(1, 500, 190));
  chk('…up-then-up is FIRE', W().group === 0 && W().opt === 1);
  T.Touch.up(ev(1, 500, 190));
  chk('…and lifting shouts it', !T.Touch.wheel && T.App.B.fx.some(f => f.kind === 'say' && /FIRE/.test(f.text)));
  T.Touch.down(ev(3, 500, 300)); sb.__now = 2000; timers.splice(0).forEach(f => f && f());
  T.Touch.move(ev(3, 500, 255)); const nfx = T.App.B.fx.length; T.Touch.up(ev(3, 500, 255));
  chk('lifting on a category alone shouts nothing', T.App.B.fx.length === nfx);
  sb.__now = 1000; T.Touch.down(ev(2, 700, 500)); sb.__now = 1100; T.Touch.up(ev(2, 702, 501));
  chk('a quick tap walks you there', !!T.App.B.cmd.dest && T.App.B.cmd.dest.x > T.App.B.cmd.x);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
