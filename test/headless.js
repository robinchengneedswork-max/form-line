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
const { Artillery, CAV_TYPES, makeUnit, AI, TEAM_PLAYER, TEAM_ENEMY, angDiff, knowsDrill, SETPIECE_POOL, Command, dist, Battle, CFG, Campaign, makeRng, Field, Orders, Combat, Morale, Unit, SCENARIOS, BATTLE_POOL, T, MAP_ROWS, EVENTS, TUNES, CADENCES, DRUM_CALLS, noteFreq } = X;

let pass = 0, fail = 0;
const chk = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + extra : '')); }
};
const run = (B, secs) => { const n = Math.round(secs / CFG.STEP); for (let i = 0; i < n && !B.over; i++) { Battle.step(B, CFG.STEP); B.events.length = 0; } };
const fresh = (scenario = 'plain', seed = 11, extra = {}) => Battle.create(Object.assign({ scenario, seed, level: 0.3, company: Campaign.defaultCompany(makeRng(seed)) }, extra));

console.log('§1 loading');
chk('every scenario builds and deploys', BATTLE_POOL.concat('finale').every(k => { const B = fresh(k); return B.units.length >= 2 && B.player.formed > 0; }));
chk('every deployment starts on open ground — men and their places in the line, big battles too (village garrisons once spawned in houses)', BATTLE_POOL.concat(SETPIECE_POOL, 'finale').every(k => [1, 2, 3, 4, 5].every(sd => { const B = fresh(k, sd); return B.units.every(u => u.men.every(m => Field.passable(B.field, m.x, m.y)) && u.men.filter(m => m.role === 'line' && !Field.passable(B.field, m.sx, m.sy)).length <= 1); })));
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
  {
    // every leg walkable, and the river crossed by a ford or the bridge; houses are walked round
    const legs = (B, a, r) => [a].concat(r).every((q, i, all) => i === 0 || X.Path.clear(B.field, all[i - 1].x, all[i - 1].y, q.x, q.y));
    const r = X.AI.route(R, 220, 80, 230, 450);
    chk('the AI routes a column across the river by a crossing', r.length > 1 && legs(R, { x: 220, y: 80 }, r) && [{ x: 220, y: 80 }].concat(r).some((q, i, all) => i > 0 && X.AI.crossingOn(R.field, all[i - 1].x, all[i - 1].y, q.x, q.y) !== null || [T.FORD, T.BRIDGE].includes(Field.typeAt(R.field, q.x, q.y))));
    const V = fresh('sp_village', 3);
    let hx = null, hy = null;
    for (let y = 300; y < 420 && hx == null; y += 4) for (let x = 420; x < 600; x += 4) if (Field.typeAt(V.field, x, y) === T.BUILDING) { hx = x; hy = y; break; }
    const rv = X.AI.route(V, hx, hy - 40, hx + 2, hy + 60);
    chk('…and round a house rather than into it', hx != null && rv.length > 1 && legs(V, { x: hx, y: hy - 40 }, rv));
  }
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
  chk(`each act's route has ${MAP_ROWS} stages ending in the act's great battle`, r.map.length === MAP_ROWS && r.map[MAP_ROWS - 1][0].type === 'finale' && r.map[MAP_ROWS - 1][0].scenario === X.ACTS[0].boss);
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
  chk('after a battle the dead leave the roll and the rest gain experience', r.company.soldiers.length === before - rep.dead.length + rep.recruits && r.company.soldiers.some(s => s.battles === 1));
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
  // the muster: no cap, a rising price; take a rifle into the store and hand it to whom you like
  const rr = Campaign.newRun(77); rr.renown = 999;
  const c1 = Campaign.rifleCost(rr.company); Campaign.buy(rr, 'rifle'); const c2 = Campaign.rifleCost(rr.company);
  for (let i = 0; i < 6; i++) Campaign.buy(rr, 'rifle');
  chk('rifles: no cap — each costs more than the last', c2 > c1 && rr.company.rifles === 7 && rr.company.soldiers.filter(x => x.weapon === 'rifle').length === 7);
  const rc = rr.company, top = rc.soldiers.find(x => x.weapon === 'rifle'), plain = rc.soldiers.find(x => x.weapon !== 'rifle');
  Campaign.toggleRifle(rr, top.id);
  chk('…tap a rifleman: his rifle goes into the store', top.weapon === 'musket' && rc.riflesStored === 1);
  Campaign.armRifles(rc);
  chk('…and stays there (it is not handed straight back to a best shot)', rc.riflesStored === 1 && rc.soldiers.filter(x => x.weapon === 'rifle').length === 6 && top.weapon === 'musket');
  Campaign.toggleRifle(rr, plain.id);
  chk('…tap another man: he gets it from the store', plain.weapon === 'rifle' && rc.riflesStored === 0);
  Campaign.issueRifles(rr);
  chk('…and "to the best shots" hands every rifle to the best shots again', rc.riflesStored === 0 && rc.soldiers.filter(x => x.weapon === 'rifle').every(x => rc.soldiers.filter(y => y.weapon !== 'rifle').every(y => y.aim <= x.aim)));
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
  chk('…and every company of foot has a task (horse and guns find their own)', B.units.every(u => u.task || u.arm !== 'foot'));
  const waves = B.units.filter(u => u.team === 1 && u.task && u.task.kind === 'reserve' && u.task.wave);
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
  chk('the campaign route has set pieces along it', r.map.some(row => row.some(n => n.type === 'setpiece' && SETPIECE_POOL.includes(n.scenario))) && r.map[MAP_ROWS - 1][0].scenario === X.ACTS[0].boss);
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
  // a charge ordered from close in still gets its run-up before the nerve test (it used to falter at once)
  {
    let early = 0;
    for (let k = 0; k < 12; k++) {
      const b = fresh('plain', 800 + k), c = b.player; facing(b, 15);
      Orders.apply(b, c, 'charge', {});
      let tested = null;
      for (let i = 0; i < 30 * 6 && !tested; i++) { Battle.step(b, CFG.STEP); if (c.lastNerve) tested = { t: c.chargeT, imp: c.lastNerve.imp }; }
      if (!tested || tested.t < CFG.CHARGE_TEST_AFTER - 0.05 || tested.imp < 0.5) early++;
    }
    chk('a charge from 15 m is tested only once the men are running at them', early === 0, early + '/12 early');
  }
  // rally: a broken company stays on the field to be rallied, and you among them bring it back
  {
    const b = fresh('plain', 72), u2 = b.player, c = b.cmd;
    for (const e of b.units) if (e.team === TEAM_ENEMY) { e.delay = 1e9; e.ai.next = 1e9; }
    run(b, 2);
    u2.morale = 5; u2.lastHit = b.t; run(b, 0.2);
    const broke = u2.routed;
    let back = false;
    for (let i = 0; i < 30 * 30 && !b.over && !back; i++) {
      const fl = u2.men.filter(m => m.state === 'fleeing');
      if (fl.length) { c.x = fl.reduce((a, m) => a + m.x, 0) / fl.length; c.y = fl.reduce((a, m) => a + m.y, 0) / fl.length; }
      if (i % 90 === 0) Morale.rally(b);
      Battle.step(b, CFG.STEP);
      back = !u2.routed;
    }
    chk('a broken company can be rallied in person, and the battle waits for you to try', broke && back && !b.over && u2.formed > u2.startSize * 0.5, 'formed ' + u2.formed);
    const b2 = fresh('plain', 73), u3 = b2.player;
    for (const e of b2.units) if (e.team === TEAM_ENEMY) { e.delay = 1e9; e.ai.next = 1e9; }
    b2.cmd.x = 50; b2.cmd.y = 50;
    u3.morale = 5; u3.lastHit = b2.t;
    run(b2, CFG.RALLY_WINDOW + 10);
    chk('…but left alone it does not wait forever', b2.over && b2.result.how === 'lost', b2.over && b2.result.how);
  }
  // an officer alone among the enemy is everybody's target (the captain-slap exploit)
  {
    let died = 0;
    for (let k = 0; k < 16; k++) {
      const b = fresh('plain', 900 + k), E4 = facing(b, 120), L = E4.leader, c = b.cmd;
      for (let i = 0; i < 30 * 30; i++) {
        if (L.state === 'formed') { const d = Math.hypot(L.x - c.x, L.y - c.y); if (d > 0.9) { c.x += (L.x - c.x) / d * 1.5; c.y += (L.y - c.y) / d * 1.5; } }
        Battle.step(b, CFG.STEP);
        if (L.state !== 'formed' || c.state !== 'formed') break;
      }
      if (c.state !== 'formed') died++;
    }
    chk('running alone at the enemy captain usually gets you killed', died >= 6, died + '/16');
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
    chk('…the depot sends a draft after every battle, and a recruiting party adds to it, while there is room', rep.recruits === 4 && r.company.soldiers.length === before + 4, rep.recruits);
    const old = JSON.parse(JSON.stringify(Campaign.newRun(94))); delete old.company.surgeons; delete old.company.recruiters;
    chk('…old saves start with none', Campaign.migrate(old).company.surgeons === 0 && old.company.recruiters === 0);
  }

  // the crest: holding companies step up to shoot instead of hiding behind it
  {
    const b = fresh('sp_ridge', 72), E4 = b.units.find(e => e.team === TEAM_ENEMY);
    const a = b.units.find(o => o.team === 0 && !o.isPlayer && o.task.kind === 'hold' && !AI.inCover(b, o) &&
      !Field.los(b.field, o.form.x, o.form.y, o.form.x, o.form.y - 150));
    if (a) {
      for (const m of E4.men) { m.x += a.form.x - E4.cx; m.y += a.form.y - 150 - E4.cy; }
      Unit.survey(E4); b.seen[0].add(E4.id);
      const y0 = a.form.y; b.pending.length = 0;
      AI.stepUp(b, a, E4, -Math.PI / 2);
      const o = b.pending.find(p => p.unit === a && p.cmd === 'line');
      chk('a company holding behind a crest steps up to it when the enemy is in range', o && o.opts.y < y0 - 5 && dist(o.opts.x, o.opts.y, a.task.x, a.task.y) <= CFG.CREST_STEP, o && (y0 - o.opts.y).toFixed(0) + ' m');
    } else chk('a company holding behind a crest steps up to it (no company behind a crest in this seed)', false);
  }
  {
    const r = Campaign.newRun(95);
    chk("a big battle every other stage (three an act, then the act's own)", r.map.filter(row => row.some(n => n.type === 'setpiece')).length >= 3);
    chk('…and a quartermaster on every other stage', r.map.filter(row => row.some(n => n.type === 'quartermaster')).length >= 5);
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

console.log('§12 cavalry & the square');
{
  // a squadron of horse 'at' a place, frozen until we let it go
  const squadron = (B, x, y, facing, type = 'chasseurs', size = 24) => {
    const C = makeUnit({ team: TEAM_ENEMY, faction: 'french', arm: 'cav', cavType: type, x, y, facing, size, drill: 0.5, doctrine: 'cavalry', drummer: true }, B.rng);
    B.units.push(C); Unit.survey(C); return C;
  };
  const still = B => { for (const e of B.units) if (e.team === TEAM_ENEMY) e.delay = 1e9; };

  // the square: four faces, two ranks, every man facing out, the colours in the middle
  {
    const B = fresh('plain', 1201), u = B.player;
    Orders.apply(B, u, 'square', {});
    Unit.layout(u);
    const faces = new Set(), out = u.men.filter(m => m.role === 'line').every(m => {
      faces.add(Math.round(angDiff(u.form.facing, m.slotFacing) / (Math.PI / 2)));
      return Math.cos(m.slotFacing) * (m.sx - u.form.x) + Math.sin(m.slotFacing) * (m.sy - u.form.y) > 1;
    });
    const ens = u.men.find(m => m.role === 'ensign');
    chk('a square has four faces and every man faces out', faces.size === 4 && out);
    chk('…with the colours in the hollow middle', dist(ens.sx, ens.sy, u.form.x, u.form.y) < 2);
    run(B, 1.5);
    const early = Combat.squareReady(u, B);
    run(B, 12);
    chk('…it takes some seconds to dress, then it is formed', early < 0.5 && Combat.squareFormed(u, B), early.toFixed(2));
    chk('a square cannot march: Advance opens it into line', (Orders.apply(B, u, 'advance', {}), u.form.kind === 'line'));
  }
  // horse against foot: square, line from the flank, ready line from the front
  const clash = (seed, setup, type) => {
    const B = fresh('plain', seed), P = B.player; still(B);
    const front = setup === 'front';
    const C = squadron(B, P.cx + (front ? 0 : 160), P.cy - (front ? 160 : 0), front ? Math.PI / 2 : Math.PI, type);
    if (setup === 'square') { Orders.apply(B, P, 'square', {}); run(B, 12); }
    if (front) { Orders.apply(B, P, 'ready', {}); run(B, 4); }
    Orders.apply(B, C, 'charge', {});
    for (let i = 0; i < 30 * 40; i++) { Battle.step(B, CFG.STEP); B.events.length = 0; if (P.routed) return 'broke'; if (C.order !== 'charge') return 'off'; }
    return 'none';
  };
  let sq = 0, fl = 0, fr = 0;
  for (let k = 0; k < 10; k++) {
    if (clash(1300 + k, 'square', 'cuirassiers') === 'broke') sq++;
    if (clash(1400 + k, 'flank', 'chasseurs') === 'broke') fl++;
    if (clash(1500 + k, 'front', 'chasseurs') === 'broke') fr++;
  }
  chk('no horse breaks a formed square (not even cuirassiers)', sq <= 1, sq + '/10');
  chk('…but a line taken in the flank is ridden over', fl >= 7, fl + '/10');
  chk('…and a ready line facing them is a coin toss for light horse', fr >= 2 && fr <= 8, fr + '/10');

  // a square still forming when they arrive is worse than none
  {
    let broke = 0;
    for (let k = 0; k < 10; k++) {
      const B = fresh('plain', 1600 + k), P = B.player; still(B);
      const C = squadron(B, P.cx + 160, P.cy, Math.PI);
      Orders.apply(B, C, 'charge', {});
      for (let i = 0; i < 30 * 40 && !P.routed && C.order === 'charge'; i++) {
        Battle.step(B, CFG.STEP); B.events.length = 0;
        if (P.form.kind !== 'square' && dist(C.cx, C.cy, P.cx, P.cy) < 55) Orders.apply(B, P, 'square', {});
      }
      if (P.routed) broke++;
    }
    chk('a square ordered with the horse already on you is often caught', broke >= 2, broke + '/10');
  }
  // horsemen ride down men who are running
  {
    const B = fresh('plain', 1700), P = B.player; still(B);
    const C = squadron(B, P.cx + 60, P.cy + 30, Math.PI);
    Morale.rout(B, P);
    Orders.apply(B, C, 'charge', {});
    const down0 = P.stats.down;
    run(B, 12);
    chk('horse cuts down fugitives', P.stats.down - down0 >= 3, P.stats.down - down0);
  }
  // blown horses draw off to get their wind
  {
    const B = fresh('plain', 1701), P = B.player; still(B);
    const C = squadron(B, P.cx, P.cy - 250, Math.PI / 2); C.delay = 0; C.wind = 0.3;
    C.ai.home = { x: P.cx, y: 40, facing: Math.PI / 2 };
    run(B, 6);
    chk('blown horses draw off toward home rather than charge', C.order !== 'charge' && C.cy < P.cy - 250, C.order + ' ' + C.cy.toFixed(0));
  }
  // the AI: horse hangs about a square, goes for skirmishers; foot form square when horse comes on
  {
    const B = fresh('plain', 1702, { autoPlayer: true }), P = B.player;
    for (const e of B.units) if (e.team === TEAM_ENEMY) e.delay = 1e9;
    const C = squadron(B, P.cx + 150, P.cy - 60, Math.PI); C.delay = 0;
    Orders.apply(B, P, 'skirmish', {});
    let charged = false, squared = false;
    for (let i = 0; i < 30 * 60 && !charged; i++) { Battle.step(B, CFG.STEP); B.events.length = 0; charged = C.order === 'charge' || !!C.ai.target; squared = squared || P.form.kind === 'square'; }
    chk('horse goes for skirmishers in the open', charged);
    for (let i = 0; i < 30 * 20 && !squared; i++) { Battle.step(B, CFG.STEP); B.events.length = 0; squared = P.form.kind === 'square'; }
    chk('…and AI foot form square when it comes on', squared);
  }
  {
    const B = fresh('woods', 1703, { autoPlayer: true }), P = B.player; still(B);
    // stand them in the wood
    let wx = null, wy = null;
    for (let y = 40; y < B.field.h - 40 && wx == null; y += 8) for (let x = 60; x < 660; x += 8) if (Field.typeAt(B.field, x, y) === T.WOODS && Field.typeAt(B.field, x + 12, y) === T.WOODS && Field.typeAt(B.field, x - 12, y) === T.WOODS) { wx = x; wy = y; break; }
    if (wx != null) {
      for (const m of P.men) { m.x = wx + (m.x - P.cx) * 0.3; m.y = wy + (m.y - P.cy) * 0.3; }
      Unit.setForm(P, 'line', wx, wy, -Math.PI / 2); Unit.survey(P);
      const C = squadron(B, wx + 120, wy, Math.PI);
      chk('foot in a wood are no mark for horse', AI.cavMark(B, C, P) < CFG.CAV_MARK && !AI.cavThreat(B, P), AI.cavMark(B, C, P).toFixed(2));
    } else chk('foot in a wood are no mark for horse (no wood found)', false);
  }
  // the campaign: horse comes in, and gets heavier
  {
    let early = 0, late = 0, heavy = 0;
    for (let s = 0; s < 40; s++) {
      const d0 = SCENARIOS.plain.deploy(makeRng(s + 1), 0.1), d1 = SCENARIOS.plain.deploy(makeRng(s + 1), 0.9);
      early += d0.enemies.some(e => e.arm === 'cav'); late += d1.enemies.some(e => e.arm === 'cav');
      heavy += d1.enemies.some(e => e.cavType === 'cuirassiers' || e.cavType === 'lancers');
    }
    const h = SCENARIOS.heath.deploy(makeRng(3), 0.1);
    chk('no horse on open ground early in a campaign, often later — and lancers/cuirassiers by the end', early === 0 && late > 10 && heavy === late, early + ' / ' + late + ' / ' + heavy);
    chk('The Heath always has horse, and is in the battle pool', h.enemies.some(e => e.arm === 'cav') && BATTLE_POOL.includes('heath'));
    const R = fresh('sp_ridge', 1704);
    chk('the Long Ridge has cuirassiers coming in the afternoon', R.units.filter(u => u.cav && u.cav === CAV_TYPES.cuirassiers && u.delay > 300).length === 2);
  }
  // a battle with horse in it still ends
  {
    const B = fresh('heath', 1705, { autoPlayer: true });
    run(B, CFG.NIGHTFALL);
    chk('a battle with horse in it ends (not at nightfall)', B.over && B.result.how !== 'nightfall', B.result && B.result.how);
  }
}

console.log('§13 the guns');
{
  // a battery `gap` m in front of the player's company, everything else gone
  const range = (seed, gap, opts = {}) => {
    const B = fresh(opts.sc || 'plain', seed), P = B.player;
    for (const e of B.units) if (e.team === TEAM_ENEMY) { e.delay = 1e9; for (const m of e.men) m.state = 'gone'; }
    const G = makeUnit({ team: TEAM_ENEMY, faction: 'french', arm: 'gun', guns: opts.guns || 2, x: P.cx + (opts.dx || 0), y: P.cy - gap, facing: Math.PI / 2, drill: 0.5 }, B.rng);
    const F = makeUnit({ team: TEAM_ENEMY, faction: 'french', x: 40, y: 30, facing: Math.PI / 2, size: 20, drill: 0.5 }, B.rng); F.delay = 1e9;
    B.units.push(G, F); Unit.survey(G); Unit.survey(F);
    for (const g of G.guns) { g.m = 'loaded'; g.mt = 0; }
    return { B, P, G };
  };
  {
    const { B, G } = range(1800, 300);
    chk('a battery is pieces with crews of five, no colours, no drum', G.guns.length === 2 && G.formed === 2 * CFG.GUN_CREW && !G.men.some(m => m.role === 'ensign' || m.role === 'drummer'));
    chk('…every gunner is dealt to a piece', G.men.filter(m => m.role === 'line').every(m => G.guns.includes(m.gun)));
    run(B, 30);
    chk('it lays its guns and fires roundshot at what it can see', G.stats.shots >= 2 && B.fx.some(f => f.kind === 'ball'), G.stats.shots);
  }
  // deep targets suffer: a column or a square loses far more men to roundshot than a line
  {
    const loss = form => {
      let n = 0;
      for (let k = 0; k < 6; k++) {
        const { B, P } = range(1810 + k, 380);
        if (form !== 'line') Orders.apply(B, P, form, {});
        run(B, 8);
        const n0 = P.formed;
        for (let i = 0; i < 30 * 100; i++) { Battle.step(B, CFG.STEP); B.events.length = 0; P.lastHit = -99; }
        n += n0 - P.formed;
      }
      return n / 6;
    };
    const line = loss('line'), sq = loss('square'), col = loss('attackcol'), sk = loss('skirmish');
    chk('roundshot: a square or a column loses far more than a line; skirmishers hardly any', sq > line * 1.4 && col > line * 1.3 && sk < line * 0.5, `line ${line.toFixed(1)} square ${sq.toFixed(1)} column ${col.toFixed(1)} skirmish ${sk.toFixed(1)}`);
  }
  // behind a crest you are safe from guns that cannot see you
  {
    const { B, P, G } = range(1820, 300);
    const fl = B.field;
    for (let i = 0; i < fl.height.length; i++) { const y = Math.floor(i / fl.cols) * CFG.CELL; fl.height[i] = 12 * Math.exp(-Math.pow((y - (P.cy - 30)) / 18, 2)); }
    B.seen[TEAM_ENEMY].add(P.id);
    const n0 = P.formed;
    run(B, 60);
    chk('a crest between you and the guns: they cannot lay on you', G.stats.shots === 0 && P.formed === n0, G.stats.shots + ' shots');
  }
  // canister close in, roundshot further off
  {
    const { B, P, G } = range(1830, 90);
    run(B, 3);
    chk('inside canister range they load canister — and it is murder', G.guns.every(g => g.shot === 'canister') && P.stats.down >= 3, P.stats.down + ' down');
    const far = range(1832, 300); run(far.B, 3);
    chk('…outside it, roundshot', far.G.guns.every(g => g.shot === 'round'));
  }
  // a crew shot down reloads slower; none at all and the piece is silent
  {
    const { B, G } = range(1840, 300, { guns: 1 });
    const g = G.guns[0];
    run(B, 4); const t0 = g.mt;
    for (const m of G.men.filter(m => m.role === 'line').slice(0, 3)) m.state = 'down';
    Unit.survey(G);
    run(B, 4);
    chk('fewer hands, slower loading', g.m === 'reloading' && t0 - g.mt < 4 * 0.85, (t0 - g.mt).toFixed(2));
    for (const m of G.men) if (m.role === 'line') m.state = 'down';
    Unit.survey(G); g.m = 'loaded'; const s0 = G.stats.shots;
    run(B, 20);
    chk('…and with no crew the gun is silent', G.stats.shots === s0);
  }
  // guns swing slowly beyond their front: come at them from the flank
  {
    const { B, G } = range(1850, 120, { dx: 0 });
    for (const g of G.guns) g.facing = 0;   // laid east, out past their front
    B.seen[TEAM_ENEMY].add(B.player.id);
    run(B, 3);
    chk('a gun laid off its front comes round slowly', G.stats.shots === 0 && G.guns.every(g => Math.abs(g.facing) < 0.5), G.guns.map(g => g.facing.toFixed(2)).join(','));
  }
  // overrun: gunners gone, a man of ours on the piece = taken
  {
    const { B, P, G } = range(1860, 300, { guns: 1 });
    const g = G.guns[0];
    for (const m of G.men) if (m.role === 'line') { m.state = 'fleeing'; }
    const man = P.men.find(m => m.role === 'line'); man.x = g.x + 2; man.y = g.y + 2; man.sx = man.x; man.sy = man.y;
    Battle.step(B, CFG.STEP); Battle.step(B, CFG.STEP);
    chk('a gun with nobody of its own near it is taken by whoever reaches it', g.taken && g.takenBy === TEAM_PLAYER && B.stats.gunsTaken === 1);
    B.over = false; Battle.finish(B, 'won');
    const rep = Campaign.afterBattle(Campaign.newRun(5), { type: 'battle', scenario: 'plain', row: 3 }, B.result);
    chk('…and it is worth renown', rep.lines.some(l => /gun/.test(l[0])));
  }
  // they will not fire through their own men
  {
    const { B, P, G } = range(1870, 300);
    const F = B.units.find(u => u.team === TEAM_ENEMY && u.arm === 'foot');
    F.delay = 1e9; for (const m of F.men) { m.state = 'formed'; m.x = P.cx + (m.x - F.cx) * 0.4; m.y = P.cy - 150 + (m.y - F.cy) * 0.4; }
    Unit.survey(F);
    run(B, 20);
    chk('a battery holds fire rather than shoot through its own men', G.stats.shots === 0, G.stats.shots);
  }
  {
    chk('The Guns on the Knoll is in the battle pool, with a battery and supports', BATTLE_POOL.includes('battery') && SCENARIOS.battery.deploy(makeRng(2), 0.3).enemies.some(e => e.arm === 'gun'));
    const R = fresh('sp_ridge', 1880);
    chk('the Long Ridge has a grand battery on their ridge', R.units.filter(u => u.arm === 'gun').length === 2);
    const b = fresh('battery', 1881, { autoPlayer: true, playerDoctrine: 'attack' });   // (tune.js plays this map as an attack too)
    run(b, CFG.NIGHTFALL);
    chk('a battle against guns ends', b.over && b.result.how !== 'nightfall', b.result && b.result.how);
  }
}

console.log('§14 volley and charge; your horse');
{
  // the user's way: close up, one volley, then in with the bayonet
  const vc = (seed, at) => {
    const B = fresh('plain', seed), P = B.player, E = B.units.find(u => u.team === TEAM_ENEMY && u.arm === 'foot');
    for (const u of B.units) if (u.team === TEAM_ENEMY && u !== E) for (const m of u.men) m.state = 'gone';
    for (const m of E.men) { m.x += P.cx - E.cx; m.y += (P.cy - 200) - E.cy; }
    Unit.setForm(E, 'line', P.cx, P.cy - 200, Math.PI / 2); E.doctrine = 'hold'; Unit.survey(E); for (const m of E.men) { m.x = m.sx; m.y = m.sy; }
    Orders.apply(B, P, 'advance', { facing: -Math.PI / 2 });
    let phase = 0, t = 0;
    for (let i = 0; i < 30 * 300; i++) {
      Battle.step(B, CFG.STEP); B.events.length = 0; B.cmd.x = P.cx; B.cmd.y = P.cy + 5;
      const d = Math.hypot(E.cx - P.cx, E.cy - P.cy);
      if (phase === 0 && d < at + 8) { Orders.apply(B, P, 'halt', {}); Orders.apply(B, P, 'ready', {}); phase = 1; }
      else if (phase === 1 && P.men.filter(m => m.m === 'present').length > P.formed * 0.6) { Orders.apply(B, P, 'fire', {}); phase = 2; t = B.t; }
      else if (phase === 2 && B.t > t + 2) { Orders.apply(B, P, 'charge', {}); phase = 3; }
      if (E.routed) return true;
      if (P.routed || (phase === 3 && P.order !== 'charge')) return false;
    }
    return false;
  };
  let near = 0;
  for (let k = 0; k < 12; k++) if (vc(1900 + k, 40)) near++;
  chk('march up, volley at 40 m, then charge: it usually carries', near >= 7, near + '/12');
  // a defender that loses its nerve and is left shaken gives way at once
  {
    const b = fresh('plain', 1950), c = b.player, d = b.units.find(e => e.team === TEAM_ENEMY);
    c.morale = 80; d.morale = 55; c.impetus = 1;
    let broke = 0;
    for (let k = 0; k < 20; k++) {
      d.routed = false; d.morale = 55; d.order = 'hold';
      for (const m of d.men) if (m.state === 'fleeing') m.state = 'formed';
      Orders.apply(b, c, 'charge', {}); Combat.nerve(b, c, d, 1.4);
      if (d.routed) broke++;
    }
    chk('a company that loses its nerve before the bayonets, already shaken, breaks', broke >= 12, broke + '/20');
  }
  // your horse: faster, heard further, shot from under you
  {
    const camp = Campaign.newRun(7);
    camp.renown = 100;
    chk('the quartermaster sells you a horse', Campaign.buy(camp, 'horse') && camp.commander.horse && !Campaign.shopItems(camp).find(i => i.key === 'horse').ok);
    const B = fresh('plain', 1960, { commander: { hp: 3, maxHp: 3, horse: true } }), c = B.cmd;
    const x0 = c.x; c.mvx = 1; run(B, 3); c.mvx = 0;
    const B2 = fresh('plain', 1960), c2 = B2.cmd, x2 = c2.x; c2.mvx = 1; run(B2, 3);
    chk('mounted, you cover more ground', c.x - x0 > (c2.x - x2) * 1.3, (c.x - x0).toFixed(1) + ' vs ' + (c2.x - x2).toFixed(1));
    c.x = B.player.cx; c.y = B.player.cy + CFG.VOICE_RANGE + 10;
    chk('…and they hear you further off', Orders.shout(B, 'halt'));
    let horseFirst = 0;
    for (let k = 0; k < 20; k++) { const b = fresh('plain', 1970 + k, { commander: { hp: 3, maxHp: 3, horse: true } }); Combat.hit(b, b.cmd, null); if (b.cmd.hp === 3 && !b.cmd.horse && b.cmd.horseLost) horseFirst++; }
    chk('the first ball that finds you often finds the horse instead', horseFirst >= 8 && horseFirst <= 18, horseFirst + '/20');
    const b = fresh('plain', 1990, { commander: { hp: 3, maxHp: 3, horse: true } });
    b.cmd.horse = null; b.cmd.horseLost = true; b.over = false; Battle.finish(b, 'won');
    const r2 = Campaign.newRun(8); r2.commander.horse = true;
    const rep = Campaign.afterBattle(r2, { type: 'battle', scenario: 'plain', row: 3 }, b.result);
    chk('…and a horse killed under you is gone', !r2.commander.horse && rep.horseLost);
  }
}

console.log('§15 the battle builder');
{
  const { Builder, QUALITY } = X;
  const army = Builder.starter();
  chk('the starter armies are within a 350 budget', Builder.total(army.mine) <= 350 && Builder.total(army.theirs) <= 350, Builder.total(army.mine) + ' / ' + Builder.total(army.theirs));
  chk('better men, more men and heavier horse cost more',
    Builder.cost({ arm: 'foot', size: 24, kind: 'battalion', quality: 'veteran' }) > Builder.cost({ arm: 'foot', size: 24, kind: 'battalion', quality: 'raw' })
    && Builder.cost({ arm: 'foot', size: 40, kind: 'battalion', quality: 'trained' }) > Builder.cost({ arm: 'foot', size: 24, kind: 'battalion', quality: 'trained' })
    && Builder.cost({ arm: 'cav', size: 24, type: 'cuirassiers', quality: 'trained' }) > Builder.cost({ arm: 'cav', size: 24, type: 'chasseurs', quality: 'trained' }));
  chk('each side buys its own horse', Builder.horseFor('british').every(k => CAV_TYPES[k].faction === 'british') && Builder.horseFor('french').includes('cuirassiers') && !Builder.horseFor('british').includes('cuirassiers'));
  army.mine.units.push({ arm: 'cav', size: 24, type: 'heavy_dragoons', quality: 'veteran' }, { arm: 'gun', guns: 2, quality: 'trained' });
  army.theirs.units.push({ arm: 'gun', guns: 2, quality: 'trained' });
  let ok = true, ends = 0;
  for (const map of BATTLE_POOL.concat(SETPIECE_POOL, 'finale')) {
    const B = Battle.create({ scenario: map, seed: 2001, army, company: Builder.company(army.mine.own, 2001) });
    const mine = B.units.filter(u => u.team === TEAM_PLAYER), theirs = B.units.filter(u => u.team === TEAM_ENEMY);
    // every man on open ground, everyone where the builder put them, both sides as built
    const stuck = B.units.some(u => u.men.some(m => !Field.passable(B.field, m.x, m.y)));
    if (stuck || mine.length !== army.mine.units.length + 1 || theirs.length !== army.theirs.units.length || B.hq
      || !mine.every(u => u.isPlayer || u.cy > B.field.h / 2) || !theirs.every(u => u.cy < B.field.h / 2)) { ok = false; console.log('   ', map, stuck, mine.length, theirs.length, !!B.hq); }
  }
  chk('built armies deploy on every field: ours south, theirs north, nobody in a wall, no headquarters', ok);
  const B = Battle.create({ scenario: 'plain', seed: 2002, army, company: Builder.company(army.mine.own, 2002), commander: { hp: 3, maxHp: 3, horse: true } });
  chk('…your company is as you built it, and on its horse if you said so', B.player.startSize === army.mine.own.size && B.player.men.filter(m => m.weapon === 'rifle').length === army.mine.own.rifles && !!B.cmd.horse);
  chk('…with British horse and guns on our side', B.units.some(u => u.team === TEAM_PLAYER && u.cav === CAV_TYPES.heavy_dragoons) && B.units.some(u => u.team === TEAM_PLAYER && u.arm === 'gun'));
  run(B, CFG.NIGHTFALL);
  chk('…and the battle plays out to an end', B.over, B.result && B.result.how);
}

console.log('§16 the acts');
{
  const { ACTS } = X;
  const r = Campaign.newRun(301);
  chk('three acts, ending at Waterloo', ACTS.length === 3 && ACTS[2].boss === 'finale' && r.act === 0);
  // the enemy gets better across the whole campaign, not just the act
  const lv = (act, row) => Campaign.level(row, act);
  chk('the enemy grows stronger act on act', lv(0, MAP_ROWS - 1) <= lv(1, 0) + 0.01 && lv(1, MAP_ROWS - 1) <= lv(2, 0) + 0.01 && lv(0, 0) === 0 && lv(2, MAP_ROWS - 1) === 1);
  // win the act's great battle: winter quarters, then the next act’s road
  const boss = r.map[MAP_ROWS - 1][0];
  const B = fresh(boss.scenario, 302); B.over = false; Battle.finish(B, 'won');
  r.commander.hp = 1;
  Campaign.afterBattle(r, boss, B.result);
  chk('winning an act’s great battle goes to winter quarters, not the end', !r.over && r.winter);
  const before = r.company.soldiers.length, lines = Campaign.winterQuarters(r);
  chk('…where wounds heal and the depot fills the ranks', r.commander.hp === r.commander.maxHp && r.company.soldiers.length >= before && lines.length >= 2);
  Campaign.nextAct(r);
  chk('…and the spring brings the next act’s road', r.act === 1 && !r.winter && r.at === null && r.map[MAP_ROWS - 1][0].scenario === ACTS[1].boss && r.map[0].every(n => !n.done));
  // lose a great battle and the campaign is lost; win the last and it is won
  const r2 = Campaign.newRun(303), b2 = r2.map[MAP_ROWS - 1][0];
  const L = fresh(b2.scenario, 304); L.over = false; Battle.finish(L, 'lost');
  Campaign.afterBattle(r2, b2, L.result);
  chk('losing an act’s great battle ends the campaign', r2.over === 'defeat');
  const r3 = Campaign.newRun(305); r3.act = 2; r3.map = Campaign.genMap(makeRng(5), 2);
  const b3 = r3.map[MAP_ROWS - 1][0], W = fresh(b3.scenario, 306); W.over = false; Battle.finish(W, 'won');
  Campaign.afterBattle(r3, b3, W.result);
  chk('winning the last act wins the campaign', b3.scenario === 'finale' && r3.over === 'victory');
  const old = Campaign.migrate(JSON.parse(JSON.stringify(Object.assign(Campaign.newRun(307), { act: undefined }))));
  chk('older saves load into Act I', old.act === 0 && old.winter === false);
}

console.log('§17 sergeants\u2019 parties, the bugle and runners');
{
  const { Detach } = X;
  // on the company sheet: men into a sergeant's party; a sergeant renamed
  const camp = Campaign.newRun(401), co = camp.company;
  const sg = co.soldiers[0]; sg.rank = 'sgt';
  const men = co.soldiers.slice(1, 7);
  chk('men can be put in a sergeant\u2019s party', men.every(s => Campaign.setParty(camp, s.id, sg.id)) && men.every(s => s.party === sg.id));
  chk('…but a sergeant cannot be put in another\u2019s', !Campaign.setParty(camp, sg.id, sg.id));
  chk('a sergeant can be renamed', Campaign.rename(camp, sg.id, 'Patrick Harper') && sg.name === 'Patrick Harper' && !Campaign.rename(camp, sg.id, '  '));
  camp.renown = 50;
  chk('a bugler can be bought', Campaign.buy(camp, 'bugler') && co.bugler);
  // in battle: Detach sends the party out as a unit of its own, under its sergeant, and you command it
  const quiet = B => { for (const e of B.units) if (e.team === TEAM_ENEMY) e.delay = 1e9; };
  const B = Battle.create({ scenario: 'plain', seed: 402, level: 0.3, company: co }); quiet(B);
  const P = B.player, n0 = P.men.length;
  chk('the bugler comes into battle with you', B.bugle);
  const ok = Orders.shout(B, 'detach'), D = B.units.find(u => u.isDetachment);
  chk('Detach: the party goes out under its sergeant', ok && D && D.leader && D.leader.src === sg && D.men.length === 7 && P.men.length === n0 - 7 && D.name.includes('Harper'));
  chk('…and your orders now go to it', Detach.commanded(B) === D);
  run(B, 1);
  // out of earshot without a bugle: a runner; and only so many runners
  B.bugle = false; B.cmd.x = D.cx - 150; B.cmd.y = D.cy;
  const s1 = Orders.shout(B, 'halt'), s2 = Orders.shout(B, 'advance'), s3 = Orders.shout(B, 'cease');
  chk('out of earshot, a runner carries the order — and you only have two', s1 && s2 && !s3 && B.runnersOut === 2 && B.fx.some(f => f.kind === 'runner'));
  const due = B.pending.find(p => p.unit === D);
  chk('…and he takes his time getting there', due && due.at - B.t > 150 / CFG.RUNNER_SPEED - 1);
  // with the bugle, a simple call is there at once — but placing them still needs a runner
  const B2 = Battle.create({ scenario: 'plain', seed: 403, level: 0.3, company: co }); quiet(B2);
  Orders.shout(B2, 'detach'); const D2 = B2.units.find(u => u.isDetachment); run(B2, 1);
  B2.cmd.x = D2.cx - 200;
  Orders.shout(B2, 'advance');
  const b = B2.pending.find(p => p.unit === D2);
  chk('the bugle carries a simple call to a party 200 m off in a second', b && b.at - B2.t <= CFG.BUGLE_DELAY + 0.01 && !B2.runnersOut);
  Orders.shout(B2, 'line', { x: D2.cx + 20, y: D2.cy, facing: -Math.PI / 2 });
  chk('…but "form there" needs a runner', B2.runnersOut === 1);
  // a runner who runs past the enemy may never arrive
  let lost = 0;
  for (let k = 0; k < 20; k++) {
    const b3 = Battle.create({ scenario: 'plain', seed: 410 + k, level: 0.3, company: co }); quiet(b3);
    Orders.shout(b3, 'detach'); const d3 = b3.units.find(u => u.isDetachment);
    const E = b3.units.find(u => u.team === TEAM_ENEMY);
    b3.bugle = false; b3.cmd.x = d3.cx - 160; b3.cmd.y = d3.cy;
    for (const m of E.men) { m.x += (d3.cx - 80) - E.cx; m.y += d3.cy - E.cy; } Unit.survey(E); b3.seen[TEAM_PLAYER].add(E.id);
    Orders.shout(b3, 'halt');
    if (!b3.pending.some(p => p.unit === d3)) lost++;
  }
  chk('a runner sent past the enemy is sometimes shot down', lost >= 2 && lost <= 16, lost + '/20');
  // Recall: they march back and fall in; at the end of a battle everyone is on the company's roll
  B.selected = D; B.bugle = true;
  Orders.shout(B, 'recall');
  for (let i = 0; i < 120 && B.units.includes(D); i++) run(B, 1);
  chk('Recall: the party marches back into the ranks', !B.units.includes(D) && P.men.length === n0 && Detach.commanded(B) === P);
  const B4 = Battle.create({ scenario: 'plain', seed: 404, level: 0.3, company: co }); quiet(B4);
  Orders.shout(B4, 'detach'); B4.over = false; Battle.finish(B4, 'won');
  chk('…and a party still out at the end is counted with the company', B4.player.men.length === n0 && !B4.units.some(u => u.isDetachment));
  // a quick battle with rifles and no parties set: the rifles go out under the senior sergeant
  const qc = Campaign.quickCompany(5, { stage: 0.6, size: 32 }), B5 = Battle.create({ scenario: 'plain', seed: 405, level: 0.3, company: qc }); quiet(B5);
  chk('with no parties set, the riflemen and best shots go out under the senior sergeant', Orders.shout(B5, 'detach') && B5.units.some(u => u.isDetachment && u.men.some(m => m.weapon === 'rifle')));
}

console.log('§8 music & the page');
chk('every tune note is a real pitch', Object.values(TUNES).every(t => t.melody.every(([n]) => n === 'R' || noteFreq(n) > 200)));
chk('every order has a drum call', ['follow', 'line', 'advance', 'halt', 'ready', 'fire', 'atwill', 'cease', 'charge', 'fallback', 'skirmish', 'rally'].every(k => DRUM_CALLS[k]));
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="src\/([^"]+)"/g)].map(m => m[1]);
  {
    // an id used twice wires a button's click onto the wrong element (it broke the quartermaster's March on once)
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
    const made = [...fs.readFileSync(path.join(__dirname, '..', 'src', 'ui.js'), 'utf8').matchAll(/id="([^"$]+)"/g)].map(m => m[1]);
    const dup = ids.filter((x, i) => ids.indexOf(x) !== i).concat(made.filter(x => ids.includes(x)));
    chk('no element id is used twice (page + screens drawn by ui.js)', !dup.length, dup.join(','));
  }
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

console.log('§18 the great battles: each act its own');
{
  const { ACTS, Path } = X;
  chk('every act has its own pool of great battles, none of them its own boss', ACTS.every(a => a.setpieces.length >= 3 && a.setpieces.every(k => SCENARIOS[k] && SCENARIOS[k].setpiece && SETPIECE_POOL.includes(k)) && !a.setpieces.includes(a.boss)));
  chk('an act’s route never meets the same great battle twice', [0, 1, 2].every(act => [1, 2, 3, 4, 5, 6].every(sd => {
    const sp = Campaign.genMap(makeRng(sd * 31), act).flat().filter(n => n.type === 'setpiece').map(n => n.scenario);
    return sp.length === new Set(sp).size && sp.every(k => ACTS[act].setpieces.includes(k));
  })));
  // the Côa: a written order turns the rearguard round, and the way back is over the bridge
  const C = fresh('sp_coa', 501);
  const back = C.player.task.then.at;
  C.t = back - 1; C.hq[TEAM_PLAYER].next = 0;      // (a company that never fires is routed by then — jump to the hour)
  run(C, 4);
  chk('the Côa: at the hour, the colonel orders you back over the bridge', C.player.task.retire && /bridge/.test(C.dispatch.text));
  const way = Path.find(C.field, 450, 350, 500, 600), ry = SCENARIOS.sp_coa.river;
  chk('…and the only way over is the bridge', way && way.some(p => Math.abs(p.x - 560) < 14 && Math.abs(p.y - ry(560)) < 24), way && JSON.stringify(way.map(p => [p.x | 0, p.y | 0])));
  const AU = fresh('sp_coa', 502, { autoPlayer: true }), rg = AU.units.find(u => /43rd/.test(u.name));
  run(AU, rg.task.then.at + 150);
  chk('…and an AI rearguard falls back toward the bridge even with the French close', rg.cy > 420 || rg.routed, `${rg.cx | 0},${rg.cy | 0}`);
  // Albuera: hail
  const A = fresh('sp_albuera', 503);
  chk('Albuera: a hailstorm — sight is short', A.weather && Battle.sight(A) === 140 && Battle.sight(A) < CFG.SIGHT);
  const u = A.player, m = u.men.find(x => x.role === 'line');
  const save = A.weather.misfire; A.weather.misfire = 1; m.m = 'present';
  const shots = u.stats.shots; Combat.fire(A, u, m, false);
  chk('…wet powder flashes in the pan: no shot, and the man primes again', u.stats.shots === shots && m.m === 'reloading' && u.stats.misfires === 1);
  A.weather.misfire = save;
  run(A, A.weather.until + 2);
  chk('…and the squall passes', !A.weather && Battle.sight(A) === CFG.SIGHT);
  // Maya: the relief is not there, then it is
  const M = fresh('sp_maya', 504);
  const n0 = M.units.length, due = M.arrivals[0].arrive;
  chk('Maya: the relief is not on the field at first', M.arrivals.length === 2 && !M.units.some(x => /82nd/.test(x.name)));
  run(M, due + 1);
  chk('…and marches on when its hour comes', M.units.length > n0 && M.units.some(x => /82nd/.test(x.name)) && M.messages.some(x => /Barnes/.test(x.text)));
  // Quatre Bras: tall rye hides a man at 80 m that ordinary wheat would not
  const Q = fresh('sp_quatrebras', 505), f = Q.field;
  const rye = { w: 200, h: 40, cols: 50, rows: 10, type: new Uint8Array(500).fill(T.WHEAT), height: new Float32Array(500) };
  chk('the Crossroads: rye taller than a man blocks sight at 120 m (wheat does not), not at 60', !Field.los(Object.assign({}, rye, { rye: true }), 10, 20, 130, 20) && Field.los(rye, 10, 20, 130, 20) && Field.los(Object.assign({}, rye, { rye: true }), 10, 20, 70, 20) && f.rye);
  chk('…but a man on horseback sees over it', Field.los(Object.assign({}, rye, { rye: true }), 10, 20, 130, 20, true));
  // and the enemy is not beaten while more of them are still coming
  const S = fresh('sp_salamanca', 506);
  for (const e of S.units) if (e.team === TEAM_ENEMY) { e.routed = true; for (const x of e.men) x.state = 'gone'; Unit.survey(e); }
  run(S, 8);
  chk('the Arapiles: the battle is not won while French reinforcements are still on the road', !S.over && S.arrivals.some(a => a.team === TEAM_ENEMY));
  // Hougoumont: you hold the garden wall
  const H = fresh('sp_hougoumont', 507);
  const behind = H.player.men.filter(x => x.role === 'line').map(x => Field.coverFor(H.field, x.sx, x.sy, x.sx, x.sy - 200)).filter(c => c <= 0.4).length;
  chk('Hougoumont: your line stands behind the garden wall', behind >= H.player.men.filter(x => x.role === 'line').length * 0.6, behind);
}

console.log('§19 round 12: horse that bites, guns everywhere late, real roundshot, reserves, rallying');
{
  const { Artillery, AI: AIx } = X;
  const arms = B => { const e = B.units.filter(u => u.team === TEAM_ENEMY).concat(B.arrivals.filter(a => a.team === TEAM_ENEMY)); return { horse: e.filter(u => u.arm === 'cav').length, guns: e.filter(u => u.arm === 'gun').length }; };
  chk('in the Hundred Days every small battle has French horse and guns', ['plain', 'woods', 'lane', 'farm', 'ford'].every(k => [1, 2, 3].every(sd => { const a = arms(fresh(k, sd, { level: 0.7 })); return a.horse >= 1 && a.guns >= 1; })));
  chk('…but early in the Peninsula they bring none the map does not', [1, 2, 3].every(sd => { const a = arms(fresh('plain', sd, { level: 0.05 })); return a.horse === 0 && a.guns === 0; }));
  const W = fresh('finale', 3, { level: 0.95 });
  chk('Waterloo has a grand battery and Ney’s cuirassiers', W.units.filter(u => u.arm === 'gun').reduce((a, u) => a + u.guns.length, 0) >= 4 && W.units.filter(u => u.arm === 'cav' && u.team === TEAM_ENEMY).length >= 3);

  // horse: the trumpet sounds when they go in, not when they choose you — and a line that never forms square is ridden over
  const warnAt = [], w0 = AIx.warn;
  AIx.warn = function (B, u, t) { warnAt.push(dist(u.cx, u.cy, t.cx, t.cy)); return w0.apply(this, arguments); };
  let broke = 0;
  for (const sd of [101, 202]) {
    const H = fresh('heath', sd, { level: 0.7 });
    H.player.fire = 'ready';                       // an unwary line: presented, never forms square
    run(H, 420);
    if (H.player.everRouted) broke++;
  }
  AIx.warn = w0;
  chk('the trumpet sounds only when the horse go in (~135 m), not as they pick you out', warnAt.length > 0 && warnAt.every(d => d < CFG.CAV_LAUNCH + 25), warnAt.map(Math.round).join(','));
  chk('a line that never forms square is ridden over', broke >= 1, broke);

  // roundshot is a projectile: nobody falls when it is fired, only when it reaches them, and only at the height of a man
  const shoot = shape => {
    const S = fresh('plain', 404), f = S.field, P = S.player, gunU = S.units.find(u => u.team === TEAM_ENEMY);
    for (let i = 0; i < f.height.length; i++) { const y = Math.floor(i / f.cols) * CFG.CELL; f.height[i] = shape(y); f.type[i] = T.GRASS; }
    Unit.setForm(P, 'line', 360, 300, -Math.PI / 2); Unit.layout(P); for (const m of P.men) { m.x = m.sx; m.y = m.sy; }
    gunU.drill = 1;
    const g = { x: 360, y: 40, facing: Math.PI / 2, tx: 360, ty: 300 };
    const p0 = CFG.ROUND_P; CFG.ROUND_P = 1;
    const down0 = P.men.filter(m => m.state === 'down').length;
    Artillery.roundshot(S, gunU, g, null);
    const atOnce = P.men.filter(m => m.state === 'down').length - down0;
    for (let k = 0; k < 40; k++) Artillery.balls(S, CFG.STEP);
    CFG.ROUND_P = p0;
    return { atOnce, hit: P.men.filter(m => m.state === 'down').length - down0 };
  };
  const flat = shoot(() => 0);
  chk('roundshot: nobody falls the moment it is fired; on open ground it reaches the line and strikes', flat.atOnce === 0 && flat.hit > 0, JSON.stringify(flat));
  const crest = shoot(y => (y > 262 && y < 293 ? 6 : 0));
  chk('…a crest in front of them takes the ball', crest.hit === 0, JSON.stringify(crest));
  const reverse = shoot(y => (y < 293 ? 5 : 0));
  chk('…and behind a crest, on lower ground, it passes over their heads (defilade)', reverse.hit === 0, JSON.stringify(reverse));

  // the French reserve: a company breaks, a fresh one comes up
  const R = fresh('plain', 505, { level: 0.5 }), Ef = R.units.find(u => u.team === TEAM_ENEMY && u.arm === 'foot');
  const n0 = R.units.length;
  Morale.rout(R, Ef);
  run(R, 2);
  chk('when a French company breaks, a fresh one is called up and the battle is not over', R.arrivals.some(a => a.team === TEAM_ENEMY && a.objective) && !R.over);
  run(R, CFG.FR_RESERVE_DELAY * 1.3);
  chk('…and it marches on', R.units.length > n0 || R.over);

  // rallying on a steady, drilled company of their own side
  const Q = fresh('sp_ridge', 606), runner = Q.units.find(u => /43rd/.test(u.name)), steady = Q.units.find(u => /Grenadier Coy/.test(u.name));
  Morale.rout(Q, runner);
  for (const m of runner.men) if (m.state === 'fleeing') { m.x = steady.cx + Q.rng.range(-12, 12); m.y = steady.cy + Q.rng.range(-8, 8); }
  runner.morale = CFG.RALLY_AT + 1;
  run(Q, 3);
  chk('a routed company that runs into a steady, drilled one rallies on it', !runner.routed, `morale ${runner.morale | 0}`);

  // the big battles, closed up: friends either side of you
  chk('in every great battle two companies of ours stand within 90 m of you', SETPIECE_POOL.concat('finale').every(k => {
    const B = fresh(k, 7), P = B.player;
    return B.units.filter(u => u.team === TEAM_PLAYER && u !== P && u.arm === 'foot' && dist(u.cx, u.cy, P.cx, P.cy) < 90).length >= (k === 'sp_hougoumont' ? 1 : 2);
  }));
}

console.log('§20 things to buy: your own guns, horse and riflemen');
{
  const { Detach } = X;
  const r = Campaign.newRun(808); r.renown = 9999;
  const before = Campaign.mustered(r.company);
  chk('the quartermaster sells a gun, a troop of horse, remounts and riflemen of the 95th — no caps, rising prices',
    Campaign.buy(r, 'gun') && Campaign.buy(r, 'gun') && Campaign.buy(r, 'troop') && Campaign.buy(r, 'remounts') && Campaign.buy(r, 'rifleman') && Campaign.buy(r, 'rifleman')
    && r.company.battery.pieces === 2 && r.company.troop.size === CFG.TROOP_SIZE + 4 && Campaign.shopItems(r).find(i => i.key === 'gun').cost > 70);
  chk('…the riflemen come with their own rifles and do not count against the company’s numbers', Campaign.mustered(r.company) === before && r.company.soldiers.filter(s => s.attached && s.weapon === 'rifle').length === 2);
  const B = Battle.create({ scenario: 'plain', seed: 31, level: 0.5, company: r.company });
  const G = B.units.find(u => u.attached === 'guns'), Tr = B.units.find(u => u.attached === 'troop');
  chk('in battle your guns and your troop stand beside you, on the rail', G && Tr && G.guns.length === 2 && Tr.formed === CFG.TROOP_SIZE + 4 && Detach.mine(B).includes(G) && Detach.mine(B).includes(Tr));
  // the guns go where they are placed
  B.selected = G;
  const tx = G.cx + 30, ty = G.cy - 50;
  Orders.shout(B, 'line', { x: tx, y: ty, facing: -Math.PI / 2 });
  run(B, 30);                 // (out of earshot, a runner carries it)
  const moving = !!G.limber;
  run(B, 110);
  chk('your guns limber up, move to where you drag them, and unlimber', moving && !G.limber && dist(G.form.x, G.form.y, tx, ty) < 8 && Artillery.live(G).every(g => dist(g.x, g.y, tx, ty) < 20));
  // the troop does not go in on its own; it charges when called
  const T2 = Battle.create({ scenario: 'heath', seed: 32, level: 0.5, company: r.company }), tr = T2.units.find(u => u.attached === 'troop');
  let charged = false;
  for (let i = 0; i < 120 / CFG.STEP && !T2.over; i++) { Battle.step(T2, CFG.STEP); T2.events.length = 0; if (tr.order === 'charge') charged = true; }
  chk('your troop waits for your call — it never charges of its own accord', !charged);
  // (a fresh field: in the one above, an idle captain may well have been shot by now)
  const T3 = Battle.create({ scenario: 'heath', seed: 34, level: 0.5, company: r.company }), tr3 = T3.units.find(u => u.attached === 'troop');
  const E = T3.units.find(u => u.team === TEAM_ENEMY && u.arm === 'foot');
  for (const m of tr3.men) { m.x += E.cx - tr3.cx; m.y += E.cy + 110 - tr3.cy; }
  Unit.survey(tr3); tr3.form.x = tr3.cx; tr3.form.y = tr3.cy; tr3.form.facing = -Math.PI / 2;
  T3.cmd.x = tr3.cx; T3.cmd.y = tr3.cy + 20;
  T3.selected = tr3;
  const called = Orders.shout(T3, 'charge');
  run(T3, 3);
  chk('…and when you call Charge! it goes in', called && (tr3.order === 'charge' || tr3.chargeEnd > 0));
  // after the battle: what is lost stays lost
  const r2 = Campaign.newRun(809); r2.renown = 9999; Campaign.buy(r2, 'gun'); Campaign.buy(r2, 'troop');
  const B2 = fresh('plain', 33, { company: r2.company });
  const g2 = B2.units.find(u => u.attached === 'guns'), t2 = B2.units.find(u => u.attached === 'troop');
  g2.guns[0].taken = true; g2.guns[0].takenBy = TEAM_ENEMY;
  t2.men.filter(m => m.role === 'line').slice(0, 6).forEach(m => { m.state = 'down'; });
  B2.over = false; Battle.finish(B2, 'lost');
  Campaign.afterBattle(r2, { type: 'battle', scenario: 'plain', row: 0, id: 'x' }, B2.result);
  chk('a gun the French took is gone; troopers who fell are gone (some come back unhorsed)', !r2.company.battery && r2.company.troop && r2.company.troop.size < CFG.TROOP_SIZE && r2.company.troop.size > CFG.TROOP_SIZE - 6);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
