'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  AI — the other captains (enemy AND allied). They give the same orders
//  you do, through the same Orders API, once a second.
//
//  Doctrines:
//    attack   — close in column, deploy into line at ~250 m, advance to
//               musket range, volley, then fire at will; charge a company
//               that is wavering, or break a long deadlock with the bayonet.
//    hold     — stand, face the threat, hold fire until it is close.
//    skirmish — loose order, fire at will, give ground if rushed.
//
//  Several ideas are borrowed from DoDoCat's "Day of Slaughter" NW AI mod
//  (TaleWorlds forum, 2026-07): spread targets by centroid, march on until
//  the crest is passed when the centres cannot see each other, a firing
//  distance that kills push in and losses push out, sliding sideways to stay
//  square-on to the target (with a deadzone), and a troop-ratio check.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const AI = {
  step(B) {
    for (const u of B.units) {
      if (u.isPlayer && !B.autoPlayer) continue;
      if (B.t < u.ai.next) continue;
      u.ai.next = B.t + 1 + B.rng() * 0.3;
      AI.think(B, u);
    }
  },

  // nearest visible enemy, but spread out: a company already taken on by a friend
  // counts as further away, and our own current target a little nearer (stickiness)
  nearestEnemy(B, u) {
    let best = null, bs = Infinity;
    for (const e of B.units) {
      if (e.team === u.team || e.routed || !e.formed || !B.seen[u.team].has(e.id)) continue;
      let s = dist(u.cx, u.cy, e.cx, e.cy);
      for (const f of B.units) if (f !== u && f.team === u.team && !f.routed && f.ai.target === e.id) s += 90;
      if (u.ai.target === e.id) s -= 30;
      if (s < bs) { bs = s; best = e; }
    }
    u.ai.target = best ? best.id : null;
    return best;
  },

  // the firefight distance is a tug of war: every man we drop pulls us in, every man we lose pushes us out
  idealRange(u) {
    return clamp(50 + (1 - u.drill) * 35 + (u.stats.down - u.stats.hits) * 3, 35, 130);
  },

  // slide the line sideways to stay square-on opposite the target (deadzone + cooldown, so no jitter)
  realign(B, u, E, face) {
    if (B.t < (u.ai.alignT || 0) || u.form.kind === 'column') return false;
    const f = u.form, rx = -Math.sin(f.facing), ry = Math.cos(f.facing);
    const lat = (E.cx - f.x) * rx + (E.cy - f.y) * ry;
    if (Math.abs(lat) < 18) return false;
    const shift = clamp(lat * 0.6, -30, 30);
    if (!Field.passable(B.field, f.x + rx * shift, f.y + ry * shift)) return false;
    u.ai.alignT = B.t + 15;
    Orders.give(B, u, 'line', { x: f.x + rx * shift, y: f.y + ry * shift, facing: face });
    return true;
  },

  think(B, u) {
    if (u.routed) {
      if (u.morale >= CFG.RALLY_AT && !u.isPlayer && u.leader && u.leader.state === 'formed') Morale.unrout(B, u);
      return;
    }
    if (!u.formed || B.t < u.delay || u.order === 'charge') return;
    if (!u.leader && !u.isPlayer) AI.promote(B, u);
    Command.apply(u);

    const E = AI.nearestEnemy(B, u);
    // a company with a post to hold goes there first, unless the enemy is already on it
    if (u.doctrine === 'hold' && u.anchor && AI.toPost(B, u, E)) return;
    if (!E) {
      if (u.doctrine === 'attack') {
        // nobody where we last saw them, or the objective is ours: press on toward their side and find them
        if (u.ai.lastSeen && dist(u.cx, u.cy, u.ai.lastSeen.x, u.ai.lastSeen.y) < 45) u.ai.lastSeen = null;
        if (u.objective && dist(u.cx, u.cy, u.objective[0], u.objective[1]) < 40) u.ai.objDone = true;
        const farY = u.team === TEAM_ENEMY ? B.field.h - 60 : 60;
        const goal = u.objective && !u.ai.objDone ? u.objective
          : u.ai.lastSeen ? [u.ai.lastSeen.x, u.ai.lastSeen.y] : [lerp(u.cx, B.field.w / 2, 0.3), farY];
        AI.march(B, u, goal[0], goal[1]);
      } else if (u.form.kind === 'column') Orders.give(B, u, 'line', { x: u.cx, y: u.cy, facing: u.form.facing });
      return;
    }
    u.ai.lastSeen = { x: E.cx, y: E.cy };
    const d = dist(u.cx, u.cy, E.cx, E.cy);
    const face = Math.atan2(E.cy - u.cy, E.cx - u.cx);
    const off = Math.abs(angDiff(u.form.facing, face));

    // nerve
    if (u.morale < CFG.SHAKEN && u.doctrine === 'attack' && d < 140 && u.order !== 'fallback') {
      Orders.give(B, u, 'fallback'); u.ai.fallT = B.t; return;
    }
    if (u.order === 'fallback' && u.doctrine !== 'skirmish') {
      const gaveGround = u.ai.giveUntil && B.t > u.ai.giveUntil;
      if (gaveGround || (!u.ai.giveUntil && (u.morale > CFG.SHAKEN + 12 || d > 200 || B.t - (u.ai.fallT || 0) > 25))) { u.ai.giveUntil = 0; Orders.give(B, u, 'halt'); }
      return;
    }
    // outnumbered: give ground rather than stand and be shot to pieces
    const ratio = u.formed / Math.max(1, E.formed);
    if (u.doctrine === 'attack' && ratio < 0.55 && d < 130 && u.order !== 'charge') {
      Orders.give(B, u, 'fallback'); u.ai.giveUntil = B.t + 12; return;
    }

    // the French way: come on in column of attack and go in with the bayonet, unless nerve fails —
    // then deploy into line and trade volleys like everyone else
    // about a third of French captains prefer to deploy and trade volleys
    if (u.ai.deployed === undefined) u.ai.deployed = B.rng() < 0.35;
    const colAtk = u.doctrine === 'attack' && u.F.columns && !u.ai.deployed && knowsDrill(u, 'attackcol');
    if (colAtk && u.morale < CFG.STEADY - 5 && u.order !== 'charge') {
      u.ai.deployed = true;
      Orders.give(B, u, 'line', { x: u.cx, y: u.cy, facing: face });
      return;
    }
    const formCmd = colAtk ? 'attackcol' : 'line';
    const formed = colAtk ? u.form.kind === 'attack' : u.form.kind === 'line' || u.form.kind === 'skirmish';
    if (colAtk && u.form.kind === 'attack' && d < 70 && u.inSlot > 0.4 && Field.los(B.field, u.cx, u.cy, E.cx, E.cy)) {
      Orders.give(B, u, 'charge'); return;
    }

    // the bayonet
    const inRange = u.ai.inRangeT ? B.t - u.ai.inRangeT : 0;
    const keen = u.melee > 1 ? 1.25 : 1;
    if (u.form.kind !== 'column' && u.inSlot > 0.5 && u.morale > CFG.STEADY - 8 &&
        d < (u.doctrine === 'attack' ? 95 * keen : 65) &&
        (E.morale < CFG.SHAKEN + 6 || ratio > 1.8 || (inRange > 180 / keen && u.morale > E.morale + 12))) {
      Orders.give(B, u, 'charge'); return;
    }

    if (u.doctrine === 'attack') {
      const ideal = AI.idealRange(u);
      const head = u.leader || { x: u.cx, y: u.cy };
      // across only when the BODY of the column is across, not just the officer at its head
      const mustCross = AI.route(B, u.cx, u.cy, E.cx, E.cy).length > 1 || AI.route(B, head.x, head.y, E.cx, E.cy).length > 1;
      const blocked = B.t - (u.blocked || -99) < 25;
      // line of sight between the two centres: if a crest is in the way, keep marching until we are over it
      const sight = Field.los(B.field, u.cx, u.cy, E.cx, E.cy);
      if (mustCross && (u.leader || u.isPlayer)) {
        // a river between us: column, by the ford or the bridge, under their muskets
        AI.march(B, u, E.cx, E.cy);
      } else if (d > 270 && (u.leader || u.isPlayer)) {
        const k = (d - 200) / d;
        AI.march(B, u, u.cx + (E.cx - u.cx) * k, u.cy + (E.cy - u.cy) * k);
      } else if (!sight && !blocked && d > 30) {
        if (u.form.kind === 'column') Orders.give(B, u, formCmd, { x: head.x + Math.cos(face) * 6, y: head.y + Math.sin(face) * 6, facing: face });
        else if (!formed || off > 0.45) Orders.give(B, u, formCmd, { x: u.cx, y: u.cy, facing: face });
        else { if (u.fire !== 'hold') Orders.give(B, u, 'cease'); Orders.give(B, u, 'advance'); }
      } else if (d > ideal && blocked) {
        // the advance ran into a wall or a house: a column cannot charge through it, so deploy;
        // then fire from here if it reaches, else side-step
        if (u.form.kind === 'attack') { u.ai.deployed = true; Orders.give(B, u, 'line', { x: u.cx, y: u.cy, facing: face }); return; }
        if (d < 170) { if (u.order !== 'hold') Orders.give(B, u, 'halt'); else AI.shoot(B, u, d, 170); }
        else Orders.give(B, u, 'line', { x: u.cx + Math.sign(E.cx - u.cx || 1) * 30, y: u.cy, facing: face });
      } else if (d > ideal || colAtk) {
        // a column deploys at its head (which is across the river), not its middle
        if (u.form.kind === 'column') Orders.give(B, u, formCmd, { x: head.x + Math.cos(face) * 6, y: head.y + Math.sin(face) * 6, facing: face });
        else if (!formed || off > 0.45) Orders.give(B, u, formCmd, { x: u.cx, y: u.cy, facing: face });
        else { if (u.fire !== 'hold') Orders.give(B, u, 'cease'); Orders.give(B, u, 'advance'); }
      } else {
        if (u.order !== 'hold') Orders.give(B, u, 'halt');
        else if (off > 0.5) Orders.give(B, u, 'line', { x: u.form.x, y: u.form.y, facing: face });
        else if (d < ideal - 25 && u.stats.down > u.stats.hits + 2) { Orders.give(B, u, 'fallback'); u.ai.giveUntil = B.t + 8; }
        else if (!AI.realign(B, u, E, face)) AI.shoot(B, u, d, Math.max(110, ideal + 20));
      }
    } else if (u.doctrine === 'hold') {
      if (u.form.kind === 'column') Orders.give(B, u, 'line', { x: u.cx, y: u.cy, facing: face });
      // a holding company keeps its ground (and its wall) unless the threat is well off its front
      else if (off > (AI.inCover(B, u) ? 0.9 : CFG.FIRE_CONE * 0.8) && d < 260) Orders.give(B, u, 'line', { x: u.form.x, y: u.form.y, facing: face });
      // against a column, hold the volley until it is close — then it breaks them
      else AI.shoot(B, u, d, E.form.kind === 'attack' ? 60 : u.drill > 0.5 ? 70 : 90);
    } else if (u.doctrine === 'skirmish') {
      if (u.form.kind !== 'skirmish' || off > 0.7) Orders.give(B, u, 'skirmish', { x: u.cx, y: u.cy, facing: face });
      else if (d < 70) Orders.give(B, u, 'fallback');
      else if (d > 190) Orders.give(B, u, 'advance');
      else if (u.order !== 'hold') Orders.give(B, u, 'halt');
      else if (u.fire !== 'atwill') Orders.give(B, u, 'atwill');
    }
  },

  // volley, volley, then fire at will
  shoot(B, u, d, openAt) {
    if (d > CFG.RANGE_MAX) return;
    if (!u.ai.inRangeT) u.ai.inRangeT = B.t;
    if (u.fire === 'atwill' || u.fire === 'byrank') return;
    // well-drilled British companies keep a rank loaded: fire by rank
    const byRank = u.faction === 'british' && u.drill > 0.5 && knowsDrill(u, 'byrank');
    if (u.fire === 'hold') { if (d < openAt + 50) Orders.give(B, u, byRank ? 'byrank' : 'ready'); return; }
    let elig = 0, pres = 0;
    for (const m of u.men) {
      if (m.role !== 'line' || m.state !== 'formed' || m.rank >= CFG.FIRING_RANKS) continue;
      elig++; if (m.m === 'present') pres++;
    }
    const share = elig ? pres / elig : 0;
    if (d < openAt && (share > 0.7 || (share > 0.4 && d < 60))) {
      Orders.give(B, u, 'fire');
      u.ai.volleys = (u.ai.volleys || 0) + 1;
      if (u.ai.volleys >= (u.drill > 0.55 ? 3 : 1)) u.ai.thenAtWill = B.t + 4;
    } else if (u.ai.thenAtWill && B.t > u.ai.thenAtWill) {
      Orders.give(B, u, 'atwill'); u.ai.thenAtWill = 0;
    }
  },

  // walk the company somewhere in column, via a ford or bridge if a river is in the way
  march(B, u, tx, ty) {
    const L = u.leader;
    if (!L) { Orders.give(B, u, 'line', { x: u.cx, y: u.cy, facing: Math.atan2(ty - u.cy, tx - u.cx) }); Orders.give(B, u, 'advance'); return; }
    if (u.order !== 'follow') Orders.give(B, u, 'follow');
    const g = u.ai.goal;
    if (g && dist2(g.x, g.y, tx, ty) < 900 && (u.ai.dest || (L === B.cmd && L.dest))) return;
    u.ai.goal = { x: tx, y: ty };
    const route = AI.route(B, L.x, L.y, tx, ty);
    if (L === B.cmd) { B.cmd.dest = route[0]; u.ai.route = route.slice(1); u.ai.cmdRoute = true; }
    else { u.ai.dest = route[0]; u.ai.route = route.slice(1); }
  },

  route(B, x0, y0, x1, y1) {
    const f = B.field, d = dist(x0, y0, x1, y1), n = Math.ceil(d / 5);
    let blocked = false;
    for (let k = 1; k < n && !blocked; k++) if (Field.typeAt(f, lerp(x0, x1, k / n), lerp(y0, y1, k / n)) === T.WATER) blocked = true;
    const cs = B.scenario.crossings;
    if (!blocked || !cs) return [{ x: x1, y: y1 }];
    let best = cs[0], bd = Infinity;
    for (const c of cs) { const dd = dist(x0, y0, c[0], c[1]) + dist(c[0], c[1], x1, y1); if (dd < bd) { bd = dd; best = c; } }
    const s = y0 < best[1] ? 1 : -1;
    return [{ x: best[0], y: best[1] - s * 30 }, { x: best[0], y: best[1] }, { x: best[0], y: best[1] + s * 30 }, { x: x1, y: y1 }];
  },

  // march to the post, then form line on it facing the way headquarters said. true = busy getting there
  toPost(B, u, E) {
    const a = u.anchor, far = dist(u.cx, u.cy, a.x, a.y);
    if (E && dist(u.cx, u.cy, E.cx, E.cy) < 140) return false;
    if (far > 30) { AI.march(B, u, a.x, a.y); return true; }
    const L = u.leader || B.cmd;
    if (u.order === 'follow' && L && dist(L.x, L.y, a.x, a.y) < 12) { Orders.give(B, u, 'line', { x: a.x, y: a.y, facing: a.facing }); return true; }
    if (!E && (u.form.kind === 'column' || Math.abs(angDiff(u.form.facing, a.facing)) > 0.3)) { Orders.give(B, u, 'line', { x: a.x, y: a.y, facing: a.facing }); return true; }
    return false;
  },

  // is the front rank of this company behind a wall or in a wood?
  inCover(B, u) {
    const f = u.form;
    return Field.coverFor(B.field, f.x, f.y, f.x + Math.cos(f.facing) * 60, f.y + Math.sin(f.facing) * 60) < 0.7;
  },

  // a sergeant steps up when the captain falls
  promote(B, u) {
    const c = u.men.find(m => m.role === 'line' && m.state === 'formed');
    if (!c) return;
    c.role = 'officer'; c.m = 'none';
    u.leader = c;
    u.reslot = B.t + 0.5;
    if (u.order === 'follow') u.trail = [{ x: c.x, y: c.y }];
  },

  // the headless autoplayer drives YOUR commander's legs too
  cmdRoute(B) {
    const u = B.player;
    if (!B.autoPlayer || !u || !u.ai.cmdRoute) return;
    if (!B.cmd.dest && u.ai.route && u.ai.route.length) B.cmd.dest = u.ai.route.shift();
  },
};
