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
    const [FW, FH] = sc.size || [CFG.FIELD_W, CFG.FIELD_H];
    const field = makeField(FW, FH);
    sc.build(field, makeRng(seed ^ 0x9e3779b9));
    const dep = sc.deploy(rng, opts.level || 0);
    const windA = rng() * Math.PI * 2, windS = rng.range(0.4, 1.6);
    const B = {
      seed, rng, t: 0, field, scenario: sc, scenarioId: opts.scenario, deploy: dep,
      units: [], player: null, cmd: null, agents: [], hash: null,
      smoke: [], smokeT: 0, smokeCols: Math.ceil(FW / CFG.SMOKE_CELL), smokeRows: Math.ceil(FH / CFG.SMOKE_CELL),
      wind: { x: Math.cos(windA) * windS, y: Math.sin(windA) * windS, a: windA, s: windS },
      events: [], fx: [], pending: [], dropped: [], messages: [],
      seen: [new Set(), new Set()], visT: 0, endT: 0, checkT: 0,
      over: false, result: null, autoPlayer: !!opts.autoPlayer,
      stats: { coloursTaken: 0, coloursLost: 0, gunsTaken: 0 },
    };
    B.smokeGrid = new Float32Array(B.smokeCols * B.smokeRows);

    // a quick battle's company knows every drill; a campaign company only what it has learned
    const co = opts.company || Object.assign(Campaign.defaultCompany(rng), { drills: Object.keys(LEARNED_DRILLS) });
    const cm = opts.commander || { name: 'You', hp: 3, maxHp: 3 };
    const p = dep.player;
    B.cmd = { id: NEXT_ID++, team: TEAM_PLAYER, isCommander: true, x: p.x, y: p.y + 7, facing: p.facing, aim: p.facing,
      hp: cm.hp, maxHp: cm.maxHp, state: 'formed', dest: null, mvx: 0, mvy: 0, run: false, sprint: false, wind: 1, moving: 0, rallyCd: 0,
      horse: cm.horse ? '#6b4a2c' : null, horseLost: false };
    // the line of retreat: where your men may leave the field (scenario's own, else the road behind you)
    const rt = sc.retreat || {};
    B.retreat = { x: rt.x != null ? rt.x : p.x, y: rt.y != null ? rt.y : FH - 14, r: rt.r || 34, label: rt.label || 'The road to the rear' };
    const pu = makeUnit({
      team: TEAM_PLAYER, faction: 'british', isPlayer: true, name: co.name,
      x: p.x, y: p.y, facing: p.facing, drill: co.drill, nerve: co.nerve || 0,
      roster: co.soldiers.map(s => ({ name: s.name, aim: s.aim, nerve: s.nerve, xp: s.xp, rank: s.rank, weapon: s.weapon, src: s })),
      ctype: co.type || null, drills: co.drills || [],
      drummer: co.drummer, fifer: co.fifer, colours: co.colours, doctrine: opts.playerDoctrine || 'hold', task: p.task,
    }, rng);
    pu.leader = B.cmd;
    B.player = pu;
    B.units.push(pu);
    for (const a of dep.allies) B.units.push(makeUnit(Object.assign({ faction: 'british' }, a), rng));
    for (const e of dep.enemies) B.units.push(makeUnit(Object.assign({ faction: 'french' }, e), rng));
    // nobody starts inside a wall or a house: step him out to the nearest open ground
    for (const u of B.units) for (const m of u.men) Battle.unstick(field, m);
    for (const u of B.units) Unit.survey(u);
    if (sc.setpiece) Command.init(B);
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
    Command.step(B);
    AI.step(B);
    for (const u of B.units) {
      if (u.reslot && B.t >= u.reslot) { u.reslot = 0; Unit.assignSlots(u); }
      Unit.survey(u);
      Move.unit(B, u, dt);
    }
    Move.men(B, dt);
    Combat.muskets(B, dt);
    Artillery.step(B, dt);
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
  // your own broken company, still on the field with you able to reach it: not over yet
  rallyable(B, u) {
    return u.isPlayer && u.routed && B.cmd.state === 'formed' && B.t - (u.routT || 0) < CFG.RALLY_WINDOW
      && u.men.filter(m => m.state === 'fleeing' && m.role === 'line').length > Math.max(2, u.startSize * 0.25);
  },

  checkEnd(B) {
    const nightfall = B.t >= CFG.NIGHTFALL;
    if (B.cmd.state !== 'formed') return Battle.finish(B, 'fell');
    // a retreat is over when you are on the road and nobody of yours is left formed on the field
    const P = B.player;
    if (P.saved && Battle.atRetreat(B, B.cmd.x, B.cmd.y) && !P.men.some(m => m.state === 'formed' && m.role !== 'officer')) return Battle.finish(B, 'withdrew');
    // a company that has marched off the field is not beaten
    const mineOut = B.units.filter(u => u.team === TEAM_PLAYER && !(u.isPlayer && u.saved && !u.routed)).every(u => Battle.out(u) && !Battle.rallyable(B, u));
    const theirsOut = B.units.filter(u => u.team === TEAM_ENEMY).every(Battle.out);
    if (mineOut || theirsOut) { B.endT += 1; } else B.endT = 0;
    if (B.endT >= 6) return Battle.finish(B, theirsOut ? 'won' : 'lost');
    if (nightfall) Battle.finish(B, 'nightfall');
  },

  unstick(f, m) {
    if (Field.passable(f, m.x, m.y)) return;
    for (let r = 1; r <= 24; r++) for (let k = 0; k < 16; k++) {
      const x = m.x + Math.cos(k * Math.PI / 8) * r, y = m.y + Math.sin(k * Math.PI / 8) * r;
      if (Field.inside(f, x, y) && Field.passable(f, x, y)) { m.x = x; m.y = y; return; }
    }
  },

  atRetreat(B, x, y) { const r = B.retreat; return dist2(x, y, r.x, r.y) < r.r * r.r; },

  finish(B, how) {
    if (B.over) return;
    B.over = true;
    // withdrawing: whoever is still on the field takes his chances
    let captured = 0;
    if (how === 'withdrew') {
      const P = B.player;
      for (const m of P.men) {
        if (m.state !== 'formed' || m.role === 'officer' || m.saved) continue;
        let near = false;
        for (const e of B.units) {
          if (e.team === TEAM_PLAYER || e.routed) continue;
          if (e.men.some(o => o.state === 'formed' && dist2(o.x, o.y, m.x, m.y) < CFG.CAPTURE_RANGE * CFG.CAPTURE_RANGE)) { near = true; break; }
        }
        if (near) {
          m.captured = true; captured++;
          if (m.role === 'ensign' && !P.coloursLost) { P.coloursLost = true; B.stats.coloursLost++; }
        } else m.saved = true;       // nobody near: they make their own way back
      }
    }
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
      coloursTaken: B.stats.coloursTaken, coloursLost: B.player.coloursLost, gunsTaken: B.stats.gunsTaken || 0,
      commanderHp: Math.max(0, B.cmd.hp), commanderKills: B.cmd.kills || 0, horseLost: B.cmd.horseLost,
      orders: B.hq ? Command.obeyed(B) : null,
      saved: B.player.men.filter(m => m.saved && m.role !== 'drummer' && m.role !== 'fifer').length, captured,
      player: B.player,
    };
    B.events.push({ type: 'end', how });
  },

  // give up the field now. On the road with your men that is a retreat; anywhere else it is abandoning them
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
