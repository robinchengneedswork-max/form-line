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
    // a battle from the builder brings its own armies; otherwise the scenario decides who is here
    const dep = opts.army ? Builder.deploy(opts.army, sc, field, rng) : sc.deploy(rng, opts.level || 0);
    if (!opts.army) escalate(dep, field, rng, opts.level || 0, sc);
    const windA = rng() * Math.PI * 2, windS = rng.range(0.4, 1.6);
    const B = {
      seed, rng, t: 0, field, scenario: sc, scenarioId: opts.scenario, deploy: dep,
      units: [], player: null, cmd: null, agents: [], hash: null,
      smoke: [], smokeT: 0, smokeCols: Math.ceil(FW / CFG.SMOKE_CELL), smokeRows: Math.ceil(FH / CFG.SMOKE_CELL),
      wind: { x: Math.cos(windA) * windS, y: Math.sin(windA) * windS, a: windA, s: windS },
      events: [], fx: [], pending: [], dropped: [], messages: [],
      seen: [new Set(), new Set()], heard: [new Set(), new Set()], visT: 0, endT: 0, checkT: 0,
      over: false, result: null, autoPlayer: !!opts.autoPlayer, level: opts.level || 0,
      stats: { coloursTaken: 0, coloursLost: 0, gunsTaken: 0 },
    };
    B.smokeGrid = new Float32Array(B.smokeCols * B.smokeRows);

    // a quick battle's company knows every drill; a campaign company only what it has learned
    const co = opts.company || Object.assign(Campaign.defaultCompany(rng), { drills: Object.keys(LEARNED_DRILLS) });
    const cm = opts.commander || { name: 'You', hp: 3, maxHp: 3 };
    B.bugle = !!(co.bugler || (co.traits && co.traits.light));   // light companies always had a bugle
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
      traits: co.traits || {}, drills: co.drills || [],
      drummer: co.drummer, fifer: co.fifer, piper: co.piper, colours: co.colours, doctrine: opts.playerDoctrine || 'hold', task: p.task,
    }, rng);
    pu.leader = B.cmd;
    pu.tunes = (co.tunes || ['grenadiers']).filter(k => TUNES[k]);   // the fifer goes through these in turn
    B.player = pu;
    B.units.push(pu);
    // your own guns and horse (bought at the quartermaster): beside you, yours to place and to call on
    if (co.battery && co.battery.pieces > 0) {
      const q = Builder.open(field, { x: p.x - 42, y: p.y + 18 });   // within earshot, so your first orders go by voice
      const gu = makeUnit({ team: TEAM_PLAYER, faction: 'british', arm: 'gun', guns: co.battery.pieces, x: q.x, y: q.y, facing: p.facing, drill: co.battery.drill || 0.55,
        doctrine: 'battery', name: co.battery.name, drummer: false, fifer: false, colours: false }, rng);
      Object.assign(gu, { attached: 'guns', commanded: true });
      B.units.push(gu);
    }
    // the other companies that follow you, each under its own officer (bought from Act II): left, right, left…
    (co.allies || []).forEach((al, i) => {
      const side = i % 2 ? 1 : -1, k = Math.floor(i / 2) + 1;
      const q = Builder.open(field, { x: p.x + side * (CFG.ALLY_STATION + 12) * k, y: p.y + 12 });
      const rifles = al.kind === 'rifles';
      const au = makeUnit({ team: TEAM_PLAYER, faction: 'british', name: al.name, x: q.x, y: q.y, facing: p.facing, size: al.size, drill: al.drill,
        roster: rifles ? Array.from({ length: al.size }, () => ({ weapon: 'rifle' })) : null, ctype: rifles ? 'light' : null,
        nerve: al.temper === 'steady' ? 6 : 0, doctrine: rifles ? 'skirmish' : 'hold', drummer: true, fifer: al.kind === 'line', piper: al.kind === 'highland', colours: false,
        drills: null }, rng);
      if (au.leader) au.leader.name = al.officer;
      Object.assign(au, { attached: 'coy', allyId: al.id, temper: al.temper, side, officer: al.officer,
        tag: `${al.officer.split(' ').slice(-1)[0]} · ${(al.name.match(/\d\w*(?=(?: Rifles| Highlanders| Foot)$)/) || [''])[0] || al.name.split(' ').slice(-1)[0]}` });
      B.units.push(au);
    });
    if (co.troop && co.troop.size >= 3) {
      const q = Builder.open(field, { x: p.x + 95, y: p.y + 35 });
      const tu = makeUnit({ team: TEAM_PLAYER, faction: 'british', arm: 'cav', cavType: co.troop.type, size: co.troop.size, x: q.x, y: q.y, facing: p.facing, drill: 0.55,
        doctrine: 'cavalry', name: co.troop.name, drummer: true, fifer: false, colours: false }, rng);
      Object.assign(tu, { attached: 'troop', commanded: true, post: { x: q.x, y: q.y, facing: p.facing } });
      B.units.push(tu);
    }
    // a company with `arrive` (seconds) is not on the field yet: it marches on from the edge when its time comes
    B.arrivals = [];
    for (const a of dep.allies) { const sp = Object.assign({ faction: 'british' }, a); if (a.arrive) B.arrivals.push(sp); else B.units.push(makeUnit(sp, rng)); }
    for (const e of dep.enemies) { const sp = Object.assign({ faction: 'french' }, e); if (e.arrive) B.arrivals.push(sp); else B.units.push(makeUnit(sp, rng)); }
    B.arrivals.sort((a, b) => a.arrive - b.arrive);
    // (a great battle scripts its own waves; the reserve is the same size as anywhere else at that point in the war)
    B.reserve = { left: opts.army ? 0 : Math.round(CFG.FR_RESERVE_BASE + (opts.level || 0) * CFG.FR_RESERVE_LV), done: new Set() };
    // weather: a storm shortens sight and wets the powder (flashes in the pan), then passes
    const W = sc.weather;
    B.weather = W ? { kind: W.kind || 'rain', sight: W.sight || CFG.SIGHT, misfire: W.misfire || 0, label: W.label || 'Rain',
      until: W.until ? rng.range(W.until[0], W.until[1]) : Infinity, clears: W.clears || 'The rain passes over.' } : null;
    // nobody starts inside a wall or a house: step him out to the nearest open ground
    for (const u of B.units) for (const m of u.men) Battle.unstick(field, m);
    for (const u of B.units) Unit.survey(u);
    if (sc.setpiece && !opts.army) Command.init(B);
    Battle.visibility(B);
    Battle.log(B, `${sc.name}. ${dep.note || ''}`.trim());
    return B;
  },

  step(B, dt) {
    if (B.over) return;
    B.t += dt;
    Orders.deliver(B);
    Detach.step(B);
    AI.cmdRoute(B);
    Move.commander(B, B.cmd, dt);
    Command.step(B);
    Battle.arrive(B);
    if (B.weather && B.t >= B.weather.until) { Battle.log(B, B.weather.clears, 'order'); B.weather = null; }
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
    if (B.checkT <= 0) { B.checkT = 1; Battle.reinforce(B); Battle.checkEnd(B); }
    if (B.fx.length > 400) B.fx.splice(0, B.fx.length - 400);
  },

  // reinforcements whose hour has come march on from the edge
  arrive(B) {
    while (B.arrivals.length && B.t >= B.arrivals[0].arrive) {
      const u = makeUnit(B.arrivals.shift(), B.rng);
      for (const m of u.men) Battle.unstick(B.field, m);
      Unit.survey(u);
      B.units.push(u);
      Battle.log(B, u.team === TEAM_PLAYER ? `${u.name} comes up${u.arriveText ? ' — ' + u.arriveText : ''}!` : `More of them: ${u.name} is coming on.`, u.team === TEAM_PLAYER ? 'good' : 'bad');
    }
  },
  sight(B) { return B.weather ? B.weather.sight : CFG.SIGHT; },

  // as French companies break, the reserve sends fresh ones up to retake the ground they lost
  reinforce(B) {
    const R = B.reserve;
    if (!R || R.left <= 0) return;
    for (const u of B.units) {
      if (u.team !== TEAM_ENEMY || u.arm !== 'foot' || !u.everRouted || R.done.has(u.id)) continue;
      R.done.add(u.id);
      if (R.left <= 0) break;
      R.left--;
      const e = enemyStrength(B.level, B.rng), f = B.field;
      const p = Builder.open(f, { x: clamp(u.cx + B.rng.range(-80, 80), 60, f.w - 60), y: 40 });
      B.arrivals.push(Object.assign(coy(TEAM_ENEMY, p.x, p.y, SOUTH, Math.round(e.size * CFG.FR_RESERVE_SIZE), e.drill, 'attack',
        { nerve: e.nerve, objective: [u.cx, u.cy], fifer: false }), { faction: 'french', arrive: B.t + CFG.FR_RESERVE_DELAY * B.rng.range(0.75, 1.25) }));
      B.arrivals.sort((a, b) => a.arrive - b.arrive);
      Battle.log(B, 'Drums beyond the rise — French reinforcements are coming up.', 'bad');
    }
  },

  // which enemy companies each side can see. Fog is per team, refreshed twice a second.
  visibility(B) {
    for (const team of [TEAM_PLAYER, TEAM_ENEMY]) {
      const S = B.seen[team], SG = Battle.sight(B), HD = B.heard[team];
      S.clear(); HD.clear();
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
        // horse on the move is heard before it is seen — through rye, hail or over a crest
        if (e.arm === 'cav' && (e.order === 'charge' || e.order === 'ride') && eyes.some(s => dist2(s.x, s.y, e.cx, e.cy) < CFG.HEAR_HORSE * CFG.HEAR_HORSE)) HD.add(e.id);
        let ok = false;
        for (let k = 0; k < 4 && !ok; k++) {
          const t = marks[Math.floor(B.rng() * marks.length)];
          for (const s of eyes) {
            const d2v = dist2(s.x, s.y, t.x, t.y);
            if (d2v < 50 * 50 || (d2v < SG * SG && Field.los(B.field, s.x, s.y, t.x, t.y, !!s.horse))) { ok = true; break; }
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
    const theirsOut = B.units.filter(u => u.team === TEAM_ENEMY).every(Battle.out) && !B.arrivals.some(a => a.team === TEAM_ENEMY);
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
    // the parties are the company's men: back on its roll before anyone is counted
    Detach.reabsorbAll(B);
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
      for (const m of u.men) if (!isMusician(m)) { if (m.state === 'down') a.down++; if (m.state === 'gone' || m.state === 'fleeing') a.fled++; }
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
      attached: Battle.attachedResult(B),
      saved: B.player.men.filter(m => m.saved && !isMusician(m)).length, captured,
      player: B.player,
    };
    B.events.push({ type: 'end', how });
  },

  // what came back of your own guns and troop
  attachedResult(B) {
    const out = {};
    const gu = B.units.find(u => u.attached === 'guns'), tu = B.units.find(u => u.attached === 'troop');
    if (gu) out.guns = { pieces: gu.guns.length, lost: gu.guns.filter(g => g.taken && g.takenBy !== TEAM_PLAYER).length };
    if (tu) {
      const men = tu.men.filter(m => m.role === 'line'), down = men.filter(m => m.state === 'down').length;
      const back = Math.round(down * 0.35);      // some of the fallen were only unhorsed or wounded
      out.troop = { start: men.length, alive: men.length - down + back, lost: down - back };
    }
    // the companies that follow you: half their fallen were wounded and come back; their officer may be mentioned
    out.allies = B.units.filter(u => u.attached === 'coy').map(u => {
      const men = u.men.filter(m => m.role === 'line'), down = men.filter(m => m.state === 'down' || m.captured).length, back = Math.round(down * 0.5);
      return { id: u.allyId, alive: men.length - down + back, lost: down - back, mentioned: u.stats.hits >= 6 && !u.everRouted };
    });
    return out;
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
