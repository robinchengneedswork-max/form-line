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
const { TEAM_PLAYER, TEAM_ENEMY, angDiff, knowsDrill, SETPIECE_POOL, Command, dist, Battle, CFG, Campaign, makeRng, Field, Orders, Combat, Morale, Unit, SCENARIOS, BATTLE_POOL, T, MAP_ROWS, EVENTS, TUNES, CADENCES, DRUM_CALLS, noteFreq } = X;

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

console.log('§11 the charge, wind & the road');
{
  // put the enemy N metres north of us, halted in line, and hold everyone still
  const facing = (B, gap) => {
    const u = B.player, E = B.units.find(e => e.team === TEAM_ENEMY);
    for (const e of B.units) if (e !== u && e !== E) { e.men.forEach(m => { m.state = 'gone'; }); }
    const dy = (u.cy - gap) - E.cy;
    for (const m of E.men) { m.x += u.cx - E.cx; m.y += dy; }
    Unit.setForm(E, 'line', u.cx, u.cy - gap, Math.PI / 2); E.order = 'hold'; E.doctrine = 'hold'; E.delay = 1e9;
    for (const m of E.men) { m.sx = m.x; m.sy = m.y; }
    Unit.survey(E);
    for (const m of u.men) { m.x = m.sx; m.y = m.sy; }
    return E;
  };
  let B = fresh('plain', 61), u = B.player;
  facing(B, 130);
  const y0 = u.cy;
  Orders.apply(B, u, 'charge', {});
  run(B, 6);
  chk('a charge from 130 m goes in at quick time, not a sprint', y0 - u.cy < 6 * CFG.QUICK + 2 && u.wind > 0.9, (y0 - u.cy).toFixed(1) + ' m, wind ' + u.wind.toFixed(2));

  B = fresh('plain', 62); u = B.player;
  const E = facing(B, 34);
  E.fire = 'hold'; for (const m of E.men) m.m = 'loaded';
  Orders.apply(B, u, 'charge', {});
  run(B, 1.5);
  chk('…inside the last 40 m they rush it, and that costs wind', u.rushing > 3 || u.wind < 0.97, 'wind ' + u.wind.toFixed(2));

  B = fresh('plain', 63); u = B.player; facing(B, 200);
  Orders.apply(B, u, 'charge', {}); u.wind = 0.02; run(B, 0.5);
  chk('blown men cannot keep a charge going', u.order === 'hold');

  // the point-blank volley: a presented line fires on its own at 30 m
  B = fresh('plain', 64); u = B.player;
  const E2 = facing(B, 34);
  E2.fire = 'ready'; for (const m of E2.men) if (m.role === 'line' && m.rank < CFG.FIRING_RANKS) m.m = 'present';
  Orders.apply(B, u, 'charge', {});
  let fired = false;
  for (let i = 0; i < 30 * 8 && !fired; i++) { Battle.step(B, CFG.STEP); fired = E2.men.some(m => m.m === 'reloading'); }
  chk('a line still presented gives a charge a volley in the face, unordered', fired);

  // the nerve test: a steady loaded line usually stops a charge; a shaken empty one usually breaks
  let falter = 0, broke = 0;
  for (let k = 0; k < 60; k++) {
    let b = fresh('plain', 400 + k), c = b.player, d = b.units.find(e => e.team === TEAM_ENEMY);
    c.morale = 60; d.morale = 70; for (const m of d.men) if (m.role === 'line') m.m = 'present';
    Orders.apply(b, c, 'charge', {}); Combat.nerve(b, c, d, 1);
    if (c.order !== 'charge') falter++;
    b = fresh('plain', 500 + k); c = b.player; d = b.units.find(e => e.team === TEAM_ENEMY);
    c.morale = 60; d.morale = 35; for (const m of d.men) m.m = 'reloading';
    Orders.apply(b, c, 'charge', {}); const m0 = d.morale; Combat.nerve(b, c, d, 1.4);
    if (d.morale < m0) broke++;
  }
  chk('…a steady, loaded line stops most charges', falter > 36, falter + '/60');
  chk('…a shaken line with empty muskets usually gives way', broke > 42, broke + '/60');

  // momentum: the same charge, down a slope and up it
  {
    const b = fresh('plain', 70), c = b.player, d = b.units.find(e => e.team === TEAM_ENEMY), fl = b.field;
    c.impetus = 1;
    const tilt = k => { for (let i = 0; i < fl.height.length; i++) fl.height[i] = Math.floor(i / fl.cols) * CFG.CELL * k; };
    tilt(0.03); const down = Combat.momentum(b, c, d);      // the south (you) is higher: you charge downhill
    tilt(-0.03); const up = Combat.momentum(b, c, d);
    chk('momentum: charging down onto a line pushes harder than charging up into it', down > up * 1.4, down.toFixed(2) + ' vs ' + up.toFixed(2));
    c.impetus = 0.5; tilt(0);
    const slow = Combat.momentum(b, c, d); c.impetus = 1;
    chk('…and men arriving at a walk push far less than men at a run', slow < Combat.momentum(b, c, d) * 0.75);
  }
  // Re-form: off the chase, back into line on the colours, facing the enemy
  {
    const b = fresh('plain', 71), u2 = b.player, E3 = b.units.find(e => e.team === TEAM_ENEMY);
    b.seen[TEAM_PLAYER].add(E3.id);
    Orders.apply(b, u2, 'charge', {});
    for (const m of u2.men) m.foe = E3.men[0];
    Orders.apply(b, u2, 'reform', {});
    const toE3 = Math.atan2(E3.cy - u2.form.y, E3.cx - u2.form.x);
    chk('Re-form calls off a charge and closes them up in line, facing the enemy', u2.order === 'hold' && u2.form.kind === 'line' && u2.men.every(m => !m.foe) && Math.abs(angDiff(u2.form.facing, toE3)) < 0.01);
  }

  // the establishment: surgeon's mates and a recruiting party
  {
    const r = Campaign.newRun(93); r.renown = 500; r.total = 0;
    const live0 = Campaign.woundedLive(r.company);
    chk('the quartermaster offers surgeon’s mates and a recruiting party', ['surgeons', 'recruiters'].every(k => Campaign.shopItems(r).some(i => i.key === k && i.ok)));
    for (let i = 0; i < 3; i++) Campaign.buy(r, 'surgeons');
    chk('…three levels of surgeon’s mates save more of the wounded, then no more', Campaign.woundedLive(r.company) > live0 + 0.25 && !Campaign.buy(r, 'surgeons'), Campaign.woundedLive(r.company));
    Campaign.buy(r, 'recruiters'); Campaign.buy(r, 'recruiters');
    r.company.soldiers.splice(0, 6);
    const b = Battle.create(Object.assign(Campaign.battleOpts(r, r.map[0][0]), { scenario: 'plain' }));
    Battle.finish(b, 'nightfall');
    const before = b.player.men.filter(m => m.src).length, rep = Campaign.afterBattle(r, r.map[0][0], b.result);
    chk('…and a recruiting party brings up men after every battle, while there is room', rep.recruits === 2 && r.company.soldiers.length === before + 2, rep.recruits);
    const old = JSON.parse(JSON.stringify(Campaign.newRun(94))); delete old.company.surgeons; delete old.company.recruiters;
    chk('…old saves start with none', Campaign.migrate(old).company.surgeons === 0 && old.company.recruiters === 0);
  }

  // you: sprint, and get blown
  B = fresh('plain', 65); const c = B.cmd;
  c.run = true; c.mvx = 1; c.mvy = 0; const x0 = c.x;
  run(B, 2);
  chk('sprinting, you outrun a charge', (c.x - x0) / 2 > CFG.CHARGE, ((c.x - x0) / 2).toFixed(2) + ' m/s');
  run(B, 16); const x1 = c.x; run(B, 2);
  chk('…for a while — then you are blown and walking', c.wind < 0.05 && (c.x - x1) / 2 < CFG.CMD_WALK + 0.3, 'wind ' + c.wind.toFixed(2));
  c.run = false; c.mvx = 0; run(B, 20);
  chk('…and you get your breath back standing still', c.wind > 0.5);

  // the road: retire, men leave the field, you follow them off
  B = fresh('plain', 66); u = B.player;
  chk('every battle has a line of retreat on your side of the field', BATTLE_POOL.concat(SETPIECE_POOL, 'finale').every(k => { const b = fresh(k); return b.retreat && b.retreat.y > b.field.h * 0.7 && Field.passable(b.field, b.retreat.x, b.retreat.y); }));
  for (const e of B.units) if (e.team === TEAM_ENEMY) e.delay = 1e9;
  B.cmd.dest = { x: B.retreat.x, y: B.retreat.y };
  Orders.apply(B, u, 'retire', {});
  chk('Retire: they turn for the road and will not fire', u.order === 'retire' && !Combat.canFire(u, u.men.find(m => m.role === 'line')));
  run(B, 150);
  chk('…and the men who reach it leave the field, safe', u.saved > u.startSize * 0.8, u.saved + '/' + u.startSize);
  chk('…when you are on the road with them, the battle ends in a withdrawal', B.over && B.result.how === 'withdrew' && B.result.saved > u.startSize * 0.8 && B.result.captured === 0, B.result && B.result.how);
  const r = Campaign.newRun(91);
  const rep = Campaign.afterBattle(r, r.map[0][0], B.result);
  chk('…a company brought off in good order earns a little renown', rep.lines.some(l => /good order/.test(l[0])) && r.company.soldiers.length >= u.startSize * 0.8);

  // abandoning the field with the enemy close: men left behind are taken
  B = fresh('plain', 67); u = B.player; facing(B, 60);
  Battle.withdraw(B);
  chk('abandoning the field with the enemy close: the men left behind are taken prisoner', B.result.captured > u.startSize * 0.8, B.result.captured);
  const r2 = Campaign.newRun(92), n0 = r2.company.soldiers.length;
  const rep2 = Campaign.afterBattle(r2, r2.map[0][0], Object.assign(B.result, {}));
  chk('…and they are gone from the company', rep2.captured === u.men.filter(m => m.captured && m.src).length && !u.men.some(m => m.captured && r2.company.soldiers.includes(m.src)), rep2.captured);
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

  // drag to place the line
  const P = vm.runInContext(`App.B = Battle.create({scenario:'plain', seed: 6}); Render.cam.x = App.B.cmd.x; Render.cam.y = App.B.cmd.y; Render.cam.zoom = 5; ({ Place, Input, B: App.B })`, ctx);
  const B = P.B, c = B.cmd;
  sb.__now = 5000; T.Touch.down(ev(4, 500, 300)); timers.splice(0).forEach(f => f && f());
  T.Touch.move(ev(4, 500, 345)); T.Touch.move(ev(4, 500, 410));
  const np = B.pending.length; T.Touch.up(ev(4, 500, 410));
  chk('down-then-down (Form → Line) waits for a stroke instead of shouting', P.Place.armed && P.Place.armed.cmd === 'line' && B.pending.length === np);
  T.Touch.down(ev(5, 300, 200)); T.Touch.move(ev(5, 500, 200)); T.Touch.move(ev(5, 700, 200));
  chk('…a drag sketches the company where it will stand', P.Place.cur && P.Place.isStroke(P.Place.cur));
  T.Touch.up(ev(5, 700, 200));
  const po = B.pending.find(p => p.cmd === 'line');
  chk('…and lifting forms them along it, facing away from you (no enemy in sight)', po && Math.abs(po.opts.y - (c.y - 30)) < 1.5 && Math.abs(po.opts.x - c.x) < 1.5 && Math.abs(angDiff(po.opts.facing, -Math.PI / 2)) < 0.05,
    po && `${(po.opts.x - c.x).toFixed(1)},${(po.opts.y - c.y).toFixed(1)} @${po.opts.facing.toFixed(2)}`);
  chk('…and the wheel is not left armed', !P.Place.armed && !P.Place.cur);
  // either way you draw it, they face the enemy you can see
  const E = B.units.find(u => u.team === TEAM_ENEMY); B.seen[TEAM_PLAYER].add(E.id);
  const u = B.player, yN = Math.min(u.cy, E.cy) + 10;
  const f1 = P.Place.plan(B, 'line', u.cx - 20, u.cy - 10, u.cx + 20, u.cy - 10).facing, f2 = P.Place.plan(B, 'line', u.cx + 20, u.cy - 10, u.cx - 20, u.cy - 10).facing;
  const toE = Math.atan2(E.cy - u.cy, E.cx - u.cx);
  chk('a stroke drawn either way faces the enemy you can see', Math.abs(angDiff(f1, f2)) < 0.01 && Math.abs(angDiff(f1, toE)) < Math.PI / 2, f1.toFixed(2) + ' ' + f2.toFixed(2));
  const far = P.Place.plan(B, 'line', u.cx - 300, u.cy + 300, u.cx - 260, u.cy + 300);
  chk('…and the men will not re-form further than PLACE_RANGE away', far.clamped && dist(far.x, far.y, u.cx, u.cy) <= CFG.PLACE_RANGE + 0.01);
  chk('…the sketch has a place for every man', far.slots.length === u.men.filter(m => m.role === 'line' && m.state === 'formed').length);
  // armed, then a tap: form on the spot
  T.Touch.down(ev(6, 500, 300)); timers.splice(0).forEach(f => f && f());
  T.Touch.move(ev(6, 500, 345)); T.Touch.move(ev(6, 500 + 110 * Math.cos(Math.PI / 2 + 0.72), 300 + 110 * Math.sin(Math.PI / 2 + 0.72))); T.Touch.up(ev(6, 0, 0));
  chk('Form → Skirmish waits too (a Light drill, known in a quick battle)', P.Place.armed && P.Place.armed.cmd === 'skirmish', P.Place.armed && P.Place.armed.cmd);
  const n2 = B.pending.length; T.Touch.down(ev(7, 600, 600)); T.Touch.up(ev(7, 601, 600));
  chk('…and a tap forms them on the spot instead', B.pending.length === n2 + 1 && B.pending[n2].cmd === 'skirmish' && !P.Place.armed);
  // the mouse: left-drag
  B.pending.length = 0;
  P.Input.click({ button: 0, offsetX: 400, offsetY: 250 });
  [P.Place.cur.bx, P.Place.cur.by] = vm.runInContext('Render.toWorld(600, 250)', ctx);
  P.Input.release({ button: 0 });
  chk('mouse: a left-drag places the company too', B.pending.length === 1 && B.pending[0].cmd === 'line' && B.pending[0].opts.facing != null);
  run(B, 2);
  chk('…and they take it up', u.form.kind === 'line' && !B.pending.length && Math.abs(angDiff(u.form.facing, toE)) < Math.PI / 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
