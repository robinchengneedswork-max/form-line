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

  nearestEnemy(B, u) {
    let best = null, bd = Infinity;
    for (const e of B.units) {
      if (e.team === u.team || e.routed || !e.formed || !B.seen[u.team].has(e.id)) continue;
      const d = dist2(u.cx, u.cy, e.cx, e.cy);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  },

  think(B, u) {
    if (u.routed) {
      if (u.morale >= CFG.RALLY_AT && !u.isPlayer && u.leader && u.leader.state === 'formed') Morale.unrout(B, u);
      return;
    }
    if (!u.formed || B.t < u.delay || u.order === 'charge') return;
    if (!u.leader && !u.isPlayer) AI.promote(B, u);

    const E = AI.nearestEnemy(B, u);
    if (!E) {
      if (u.doctrine === 'attack') {
        const goal = u.objective || (u.ai.lastSeen ? [u.ai.lastSeen.x, u.ai.lastSeen.y] : [u.cx, u.team === TEAM_ENEMY ? B.field.h - 60 : 60]);
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
      if (u.morale > CFG.SHAKEN + 12 || d > 200 || B.t - (u.ai.fallT || 0) > 25) Orders.give(B, u, 'halt');
      return;
    }

    // the bayonet
    const inRange = u.ai.inRangeT ? B.t - u.ai.inRangeT : 0;
    const keen = u.F.meleeSkill > 1 ? 1.25 : 1;
    if (u.form.kind !== 'column' && u.inSlot > 0.5 && u.morale > CFG.STEADY - 8 &&
        d < (u.doctrine === 'attack' ? 95 * keen : 65) &&
        (E.morale < CFG.SHAKEN + 6 || E.formed < u.formed * 0.5 || (inRange > 180 / keen && u.morale > E.morale + 12))) {
      Orders.give(B, u, 'charge'); return;
    }

    if (u.doctrine === 'attack') {
      const ideal = 50 + (1 - u.drill) * 35;
      const head = u.leader || { x: u.cx, y: u.cy };
      const mustCross = AI.route(B, head.x, head.y, E.cx, E.cy).length > 1;
      if (mustCross && (u.leader || u.isPlayer)) {
        // a river between us: column, by the ford or the bridge, under their muskets
        AI.march(B, u, E.cx, E.cy);
      } else if (d > 270 && (u.leader || u.isPlayer)) {
        const k = (d - 200) / d;
        AI.march(B, u, u.cx + (E.cx - u.cx) * k, u.cy + (E.cy - u.cy) * k);
      } else if (d > ideal && B.t - (u.blocked || -99) < 25) {
        // the advance ran into a wall or a house: fire from here if it reaches, else side-step
        if (d < 170) { if (u.order !== 'hold') Orders.give(B, u, 'halt'); else AI.shoot(B, u, d, 170); }
        else Orders.give(B, u, 'line', { x: u.cx + Math.sign(E.cx - u.cx || 1) * 30, y: u.cy, facing: face });
      } else if (d > ideal) {
        // a column deploys at its head (which is across the river), not its middle
        if (u.form.kind === 'column') Orders.give(B, u, 'line', { x: head.x + Math.cos(face) * 6, y: head.y + Math.sin(face) * 6, facing: face });
        else if (off > 0.45) Orders.give(B, u, 'line', { x: u.cx, y: u.cy, facing: face });
        else { if (u.fire !== 'hold') Orders.give(B, u, 'cease'); Orders.give(B, u, 'advance'); }
      } else {
        if (u.order !== 'hold') Orders.give(B, u, 'halt');
        else if (off > 0.5) Orders.give(B, u, 'line', { x: u.form.x, y: u.form.y, facing: face });
        else AI.shoot(B, u, d, 110);
      }
    } else if (u.doctrine === 'hold') {
      if (u.form.kind === 'column') Orders.give(B, u, 'line', { x: u.cx, y: u.cy, facing: face });
      // a holding company keeps its ground (and its wall) unless the threat is well off its front
      else if (off > (AI.inCover(B, u) ? 0.9 : CFG.FIRE_CONE * 0.8) && d < 260) Orders.give(B, u, 'line', { x: u.form.x, y: u.form.y, facing: face });
      else AI.shoot(B, u, d, u.drill > 0.5 ? 70 : 90);
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
    if (u.fire === 'atwill') return;
    if (u.fire === 'hold') { if (d < openAt + 50) Orders.give(B, u, 'ready'); return; }
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
