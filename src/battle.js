'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  BATTLE — one engagement. Pure sim: no DOM, no audio. It pushes
//  `events` (for the sound) and `fx` (for the picture) and lets
//  main.js drain them. test/ drives this file directly.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const Battle = {
  // opts: { scenario, seed, level, company?, commander? }
  create(opts) {
    const seed = opts.seed >>> 0 || 1;
    const rng = makeRng(seed);
    const sc = SCENARIOS[opts.scenario];
    const field = makeField(CFG.FIELD_W, CFG.FIELD_H);
    sc.build(field, makeRng(seed ^ 0x9e3779b9));
    const dep = sc.deploy(rng, opts.level || 0);
    const windA = rng() * Math.PI * 2, windS = rng.range(0.4, 1.6);
    const B = {
      seed, rng, t: 0, field, scenario: sc, scenarioId: opts.scenario, deploy: dep,
      units: [], player: null, cmd: null, agents: [], hash: null,
      smoke: [], smokeT: 0, smokeCols: Math.ceil(CFG.FIELD_W / CFG.SMOKE_CELL), smokeRows: Math.ceil(CFG.FIELD_H / CFG.SMOKE_CELL),
      wind: { x: Math.cos(windA) * windS, y: Math.sin(windA) * windS, a: windA, s: windS },
      events: [], fx: [], pending: [], dropped: [], messages: [],
      seen: [new Set(), new Set()], visT: 0, endT: 0, checkT: 0,
      over: false, result: null, autoPlayer: !!opts.autoPlayer,
      stats: { coloursTaken: 0, coloursLost: 0 },
    };
    B.smokeGrid = new Float32Array(B.smokeCols * B.smokeRows);

    const co = opts.company || Campaign.defaultCompany(rng);
    const cm = opts.commander || { name: 'You', hp: 3, maxHp: 3 };
    const p = dep.player;
    B.cmd = { id: NEXT_ID++, team: TEAM_PLAYER, isCommander: true, x: p.x, y: p.y + 7, facing: p.facing, aim: p.facing,
      hp: cm.hp, maxHp: cm.maxHp, state: 'formed', dest: null, mvx: 0, mvy: 0, run: false, moving: 0, rallyCd: 0 };
    const pu = makeUnit({
      team: TEAM_PLAYER, faction: 'british', isPlayer: true, name: co.name,
      x: p.x, y: p.y, facing: p.facing, drill: co.drill, nerve: co.nerve || 0,
      roster: co.soldiers.map(s => ({ name: s.name, aim: s.aim, nerve: s.nerve, xp: s.xp, src: s })),
      drummer: co.drummer, fifer: co.fifer, colours: co.colours, doctrine: opts.playerDoctrine || 'hold',
    }, rng);
    pu.leader = B.cmd;
    B.player = pu;
    B.units.push(pu);
    for (const a of dep.allies) B.units.push(makeUnit(Object.assign({ faction: 'british' }, a), rng));
    for (const e of dep.enemies) B.units.push(makeUnit(Object.assign({ faction: 'french' }, e), rng));
    for (const u of B.units) Unit.survey(u);
    Battle.visibility(B);
    Battle.log(B, `${sc.name}. ${dep.note || ''}`.trim());
    return B;
  },

  step(B, dt) {
    if (B.over) return;
    B.t += dt;
    Orders.deliver(B);
    AI.cmdRoute(B);
    Move.commander(B, B.cmd, dt);
    AI.step(B);
    for (const u of B.units) {
      if (u.reslot && B.t >= u.reslot) { u.reslot = 0; Unit.assignSlots(u); }
      Unit.survey(u);
      Move.unit(B, u, dt);
    }
    Move.men(B, dt);
    Combat.muskets(B, dt);
    Combat.melee(B, dt);
    Combat.shock(B, dt);
    Morale.step(B, dt);
    Colours.step(B);
    Smoke.step(B, dt);
    B.visT -= dt;
    if (B.visT <= 0) { B.visT = 0.5; Battle.visibility(B); }
    B.checkT -= dt;
    if (B.checkT <= 0) { B.checkT = 1; Battle.checkEnd(B); }
    if (B.fx.length > 400) B.fx.splice(0, B.fx.length - 400);
  },

  // which enemy companies each side can see. Fog is per team, refreshed twice a second.
  visibility(B) {
    for (const team of [TEAM_PLAYER, TEAM_ENEMY]) {
      const S = B.seen[team];
      S.clear();
      const eyes = [];
      for (const u of B.units) {
        if (u.team !== team) continue;
        const pool = u.men.filter(m => m.state === 'formed');
        for (let k = 0; k < Math.min(5, pool.length); k++) eyes.push(pool[Math.floor(k * pool.length / Math.min(5, pool.length))]);
      }
      if (team === TEAM_PLAYER && B.cmd.state === 'formed') eyes.push(B.cmd);
      for (const e of B.units) {
        if (e.team === team) continue;
        const marks = e.men.filter(m => m.state === 'formed' || m.state === 'fleeing');
        if (!marks.length) continue;
        let ok = false;
        for (let k = 0; k < 4 && !ok; k++) {
          const t = marks[Math.floor(B.rng() * marks.length)];
          for (const s of eyes) {
            const d2v = dist2(s.x, s.y, t.x, t.y);
            if (d2v < 50 * 50 || (d2v < CFG.SIGHT * CFG.SIGHT && Field.los(B.field, s.x, s.y, t.x, t.y))) { ok = true; break; }
          }
        }
        if (ok) { S.add(e.id); if (team === TEAM_PLAYER) e.lastSeen = { x: e.cx, y: e.cy, t: B.t, facing: e.form.facing }; }
      }
    }
  },

  out(u) { return u.routed || u.formed <= 2; },

  checkEnd(B) {
    const nightfall = B.t >= CFG.NIGHTFALL;
    if (B.cmd.state !== 'formed') return Battle.finish(B, 'fell');
    const mineOut = B.units.filter(u => u.team === TEAM_PLAYER).every(Battle.out);
    const theirsOut = B.units.filter(u => u.team === TEAM_ENEMY).every(Battle.out);
    if (mineOut || theirsOut) { B.endT += 1; } else B.endT = 0;
    if (B.endT >= 6) return Battle.finish(B, theirsOut ? 'won' : 'lost');
    if (nightfall) Battle.finish(B, 'nightfall');
  },

  finish(B, how) {
    if (B.over) return;
    B.over = true;
    const enemies = B.units.filter(u => u.team === TEAM_ENEMY);
    const tally = us => us.reduce((a, u) => {
      for (const m of u.men) if (m.role !== 'drummer' && m.role !== 'fifer') { if (m.state === 'down') a.down++; if (m.state === 'gone' || m.state === 'fleeing') a.fled++; }
      return a;
    }, { down: 0, fled: 0 });
    const et = tally(enemies);
    B.result = {
      how, won: how === 'won', time: B.t,
      enemyDown: et.down, enemyFled: et.fled,
      enemyRouted: enemies.filter(u => u.everRouted).length, enemyUnits: enemies.length,
      coloursTaken: B.stats.coloursTaken, coloursLost: B.player.coloursLost,
      commanderHp: Math.max(0, B.cmd.hp), commanderKills: B.cmd.kills || 0,
      player: B.player,
    };
    B.events.push({ type: 'end', how });
  },

  withdraw(B) { if (!B.over) Battle.finish(B, 'withdrew'); },

  log(B, text, tone = '') {
    B.messages.push({ text, tone, t: B.t });
    if (B.messages.length > 40) B.messages.shift();
  },
  say(B, u, text) {
    const L = u.leader;
    if (L && L.state === 'formed' && u.team === TEAM_ENEMY) B.fx.push({ kind: 'say', x: L.x, y: L.y, text, t: B.t, team: u.team, foreign: true });
  },

  clockText(B) {
    const mins = CFG.START_HOUR * 60 + B.t / 60;
    const h = Math.floor(mins / 60), mm = Math.floor(mins % 60);
    return `${h}:${String(mm).padStart(2, '0')}`;
  },
};
