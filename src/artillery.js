'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ARTILLERY — the guns. A battery is a unit (`arm: 'gun'`) whose men are
//  the crews; the pieces themselves live in `u.guns`. Each piece loads,
//  traverses onto a target its crew can see, and fires:
//
//    ROUNDSHOT  out to GUN_RANGE. A projectile: it grazes short of the aim point and
//               skips on along the ground at its own height, killing whoever it reaches.
//               A line two deep loses a man or two; a column or a square loses
//               a file. A crest between gun and target saves everyone behind it.
//    CANISTER   inside CANISTER_RANGE: a tin of musket balls, a shotgun blast.
//
//  Crews reload slower as they are shot down; a gun with no crew is silent,
//  and a gun with nobody of its own side near it is taken by whoever reaches it.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const Artillery = {
  // the pieces still in this battery's hands
  live: u => u.guns.filter(g => !g.taken),

  // a piece's crew: the men dealt to it who are still on their feet
  crew(u, g) { return u.men.filter(m => m.state === 'formed' && m.role === 'line' && m.gun === g); },

  // send a battery somewhere: limber up, move at a walk (each piece keeps its place in the row), unlimber
  moveTo(B, u, x, y, facing) {
    if (!Field.passable(B.field, x, y)) { if (u.team === TEAM_PLAYER) Battle.log(B, 'The guns cannot go there.', 'bad'); return; }
    u.limber = { x, y, facing, phase: 'limber', t: B.t + CFG.GUN_LIMBER * (1.3 - u.drill * 0.5) };
    for (const g of u.guns) g.target = null;
    if (u.team === TEAM_PLAYER) Battle.log(B, `${u.name}: limber up!`);
  },
  moving(B, u, dt) {
    const L = u.limber, live = Artillery.live(u);
    if (L.phase === 'limber') { if (B.t >= L.t) L.phase = 'move'; return; }
    if (L.phase === 'move') {
      const rx = -Math.sin(L.facing), ry = Math.cos(L.facing);
      let arrived = true;
      for (const g of live) {
        // the drivers walk the piece to its place in the new row (crews follow on foot)
        const off = (g.i - (u.guns.length - 1) / 2) * CFG.GUN_GAP, tx = L.x + rx * off, ty = L.y + ry * off;
        const d = dist(g.x, g.y, tx, ty);
        if (d > 0.5) {
          arrived = false;
          const step = Math.min(d, CFG.GUN_MOVE * Field.speedAt(B.field, g.x, g.y) * dt);
          const nx = g.x + (tx - g.x) / d * step, ny = g.y + (ty - g.y) / d * step;
          if (Field.passable(B.field, nx, ny)) { g.x = nx; g.y = ny; }
          g.facing = turnToward(g.facing, Math.atan2(ty - g.y, tx - g.x), 1.2 * dt);
        }
      }
      u.form.x = L.x; u.form.y = L.y;
      if (B.t >= (u.limberSlot || 0)) { u.limberSlot = B.t + 0.5; Unit.assignSlots(u); }
      if (arrived) { L.phase = 'unlimber'; L.t = B.t + CFG.GUN_LIMBER * (1.3 - u.drill * 0.5); for (const g of live) g.facing = L.facing; u.form.facing = L.facing; Unit.assignSlots(u); }
      return;
    }
    if (B.t >= L.t) { u.limber = null; if (u.team === TEAM_PLAYER) Battle.log(B, `${u.name}: in action.`); }
  },

  step(B, dt) {
    Artillery.balls(B, dt);
    for (const u of B.units) {
      if (u.arm !== 'gun') continue;
      if (u.limber) { Artillery.moving(B, u, dt); continue; }
      for (const g of u.guns) {
        if (g.taken) continue;
        Artillery.capture(B, u, g);
        if (g.taken || u.routed || B.t < u.delay) continue;
        const crew = Artillery.crew(u, g).filter(m => dist2(m.x, m.y, g.x, g.y) < 16);
        if (!crew.length) continue;
        const hands = Math.min(1, crew.length / CFG.GUN_CREW);
        if (g.m === 'reloading') {
          g.mt -= dt * Math.pow(hands, 0.7) * (u.morale >= CFG.SHAKEN ? 1 : 0.7);
          if (g.mt <= 0) g.m = 'loaded';
        }
        // choose a target once a second; traverse onto it; fire when laid
        if (B.t >= (g.next || 0)) { g.next = B.t + 1; if (u.holdFire) g.target = null; else Artillery.choose(B, u, g); }
        if (!g.target) continue;
        const want = Math.atan2(g.ty - g.y, g.tx - g.x);
        const wide = Math.abs(angDiff(u.form.facing, g.facing)) > CFG.GUN_ARC || Math.abs(angDiff(u.form.facing, want)) > CFG.GUN_ARC;
        g.facing = turnToward(g.facing, want, (wide ? CFG.GUN_SWING : CFG.GUN_TRAVERSE) * hands * dt);
        if (g.m === 'loaded' && Math.abs(angDiff(g.facing, want)) < 0.03) Artillery.fire(B, u, g);
      }
    }
  },

  // the best target this piece can see: canister for anything close, else roundshot at the densest
  choose(B, u, g) {
    g.target = null;
    let best = 0;
    for (const e of B.units) {
      if (e.team === u.team || !e.formed || e.routed || !B.seen[u.team].has(e.id)) continue;
      const d = dist(g.x, g.y, e.cx, e.cy);
      if (d > CFG.GUN_RANGE || d < 6) continue;
      if (!Field.los(B.field, g.x, g.y, e.cx, e.cy)) continue;
      if (Artillery.friendInWay(B, u, g.x, g.y, e.cx, e.cy)) continue;
      let s;
      if (d < CFG.CANISTER_RANGE) s = 4 - d / CFG.CANISTER_RANGE;
      else {
        const k = e.form.kind;
        const dense = k === 'square' ? 2.4 : k === 'column' ? 2.0 : k === 'attack' ? 1.9 : k === 'skirmish' ? 0.25 : e.arm === 'cav' ? 1.3 : 1;
        s = dense * (1.4 - d / CFG.GUN_RANGE) * (u.ai.gunTarget === e.id ? 1.15 : 1);
      }
      if (s > best) { best = s; g.target = e; g.tx = e.cx; g.ty = e.cy; g.shot = d < CFG.CANISTER_RANGE ? 'canister' : 'round'; }
    }
    if (g.target) u.ai.gunTarget = g.target.id;
  },

  // never fire over our own men's heads at this range: a friendly company near the line of fire
  friendInWay(B, u, x0, y0, x1, y1) {
    const L = dist(x0, y0, x1, y1);
    for (const o of B.units) {
      if (o.team !== u.team || o === u || !o.formed) continue;
      const t = ((o.cx - x0) * (x1 - x0) + (o.cy - y0) * (y1 - y0)) / (L * L);
      if (t < 0 || t > 1.05) continue;
      if (dist(o.cx, o.cy, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t) < 16) return true;
    }
    return false;
  },

  fire(B, u, g) {
    g.m = 'reloading'; g.mt = CFG.GUN_RELOAD * B.rng.range(0.9, 1.15);
    const a = g.facing, mx = g.x + Math.cos(a) * 2.2, my = g.y + Math.sin(a) * 2.2;
    for (let k = 0; k < 6; k++) Smoke.puff(B, mx + Math.cos(a) * k * 1.4 + B.rng.range(-1, 1), my + Math.sin(a) * k * 1.4 + B.rng.range(-1, 1), a);
    B.events.push({ type: 'cannon', x: mx, y: my, team: u.team });
    B.fx.push({ kind: 'gunflash', x: mx, y: my, a, t: B.t });
    g.recoil = B.t;
    u.stats.shots++;
    const gunner = Artillery.crew(u, g)[0] || null;
    if (g.shot === 'canister') Artillery.canister(B, u, g, gunner);
    else Artillery.roundshot(B, u, g, gunner);
  },

  // A roundshot is a projectile, not a hit-scan (the user: "the cannons are hit scan even though the ball is
  // not"). It flies over everyone to its first graze, a little short of the mark, then skips on about a metre
  // off the ground, at its own height: rising ground buries it, and where the ground falls away behind a crest
  // it sails over the heads of men lying there ("defilade should block round shot"). Men are hit only when
  // the ball actually reaches them (Artillery.balls, every step).
  roundshot(B, u, g, gunner) {
    const d = dist(g.x, g.y, g.tx, g.ty);
    const skill = 1.25 - u.drill * 0.6;
    const a = g.facing + B.rng.gauss() * CFG.ROUND_SD * skill;
    const fall = d + B.rng.gauss() * CFG.ROUND_LONG_SD * d * skill;
    const ux = Math.cos(a), uy = Math.sin(a);
    const s0 = Math.max(10, fall - CFG.ROUND_SHORT), s1 = fall + CFG.ROUND_SKIP;
    const gx = g.x + ux * s0, gy = g.y + uy * s0;
    const fx = { kind: 'ball', x0: g.x, y0: g.y, gx, gy, x1: g.x + ux * s1, y1: g.y + uy * s1, t: B.t, dur: s1 / CFG.BALL_SPEED };
    B.fx.push(fx);
    (B.balls = B.balls || []).push({ u, gunner, x0: g.x, y0: g.y, ux, uy, s: 0, s0, s1, z0: Field.heightAt(B.field, gx, gy) + CFG.ROUND_SKIP_H, n: 0, scared: new Set(), fx });
  },

  // the ball's height above sea level at distance s along its line (only meaningful from the graze on)
  ballZ(b, s) { return b.z0 - (s - b.s0) * CFG.ROUND_SINK; },

  // fly every ball on by one step; whoever it reaches at the height of a man may be struck
  balls(B, dt) {
    if (!B.balls || !B.balls.length) return;
    const f = B.field;
    for (let i = B.balls.length - 1; i >= 0; i--) {
      const b = B.balls[i], sa = b.s, sb = Math.min(b.s1, b.s + CFG.BALL_SPEED * dt);
      b.s = sb;
      let stop = sb >= b.s1 ? b.s1 : null;
      // the ground and the houses along this stretch, from the graze on: a slope higher than the ball buries it
      for (let s = Math.max(sa, b.s0); s < sb && stop == null; s += 2) {
        const x = b.x0 + b.ux * s, y = b.y0 + b.uy * s;
        if (!Field.inside(f, x, y) || Field.typeAt(f, x, y) === T.BUILDING || Field.heightAt(f, x, y) > Artillery.ballZ(b, s) + 0.3) stop = s;
      }
      const end = stop != null ? stop : sb;
      if (end > b.s0 - 2) {
        const hits = [];
        for (const e of B.units) {
          if (e === b.u) continue;
          for (const m of e.men) {
            if (m.state !== 'formed' && m.state !== 'fleeing') continue;
            const along = (m.x - b.x0) * b.ux + (m.y - b.y0) * b.uy;
            if (along < Math.max(sa, b.s0 - 2) || along > end) continue;
            const off = Math.abs(-(m.x - b.x0) * b.uy + (m.y - b.y0) * b.ux);
            if (off >= CFG.ROUND_WIDTH * (m.horse ? 1.5 : 1)) continue;
            // only at the height of a man (a horseman stands taller): over the crest it passes overhead
            const z = Artillery.ballZ(b, Math.max(along, b.s0)) - Field.heightAt(f, m.x, m.y);
            if (z < -0.3 || z > (m.horse ? 2.6 : 1.8)) continue;
            hits.push({ m, along });
          }
        }
        hits.sort((p, q) => p.along - q.along);
        for (const h of hits) {
          if (b.n >= CFG.ROUND_KILLS) break;
          if (Field.typeAt(f, h.m.x, h.m.y) === T.WOODS && B.rng() < 0.5) continue;
          // packed men (a square is really four deep, a column a crowd) are hit far more often
          const k = h.m.unit.form.kind;
          if (B.rng() > CFG.ROUND_P * (k === 'square' ? 1.6 : k === 'attack' || k === 'column' ? 1.3 : 1)) continue;
          Combat.hit(B, h.m, b.gunner);
          b.n++;
        }
        // even a ball that kills nobody frightens everyone it passes close to
        for (const e of B.units) {
          if (e.team === b.u.team || !e.formed || b.scared.has(e)) continue;
          const along = (e.cx - b.x0) * b.ux + (e.cy - b.y0) * b.uy;
          if (along < Math.max(sa, b.s0) - 10 || along > end + 10) continue;
          if (Math.abs(-(e.cx - b.x0) * b.uy + (e.cy - b.y0) * b.ux) < 18) { b.scared.add(e); e.morale -= CFG.ROUND_SCARE; e.lastHit = B.t; e.shelled = B.t; }
        }
      }
      if (stop != null) {
        // the picture ends where the ball did
        b.fx.x1 = b.x0 + b.ux * stop; b.fx.y1 = b.y0 + b.uy * stop; b.fx.dur = stop / CFG.BALL_SPEED;
        B.balls.splice(i, 1);
      }
    }
  },

  canister(B, u, g, gunner) {
    // a cone of balls: each finds the first man in its path, if it carries that far
    const men = [];
    for (const e of B.units) {
      if (e.team === u.team) continue;
      for (const m of e.men) {
        if (m.state !== 'formed' && m.state !== 'fleeing') continue;
        const d = dist(g.x, g.y, m.x, m.y);
        if (d > CFG.CANISTER_RANGE || d < 1) continue;
        if (Math.abs(angDiff(g.facing, Math.atan2(m.y - g.y, m.x - g.x))) > CFG.CANISTER_SPREAD + 0.05) continue;
        men.push({ m, d, a: Math.atan2(m.y - g.y, m.x - g.x) });
      }
    }
    men.sort((p, q) => p.d - q.d);
    const down = new Set();
    let n = 0;
    for (let k = 0; k < CFG.CANISTER_BALLS && n < CFG.CANISTER_KILLS; k++) {
      const a = g.facing + B.rng.range(-CFG.CANISTER_SPREAD, CFG.CANISTER_SPREAD);
      for (const h of men) {
        if (down.has(h.m)) continue;
        if (Math.abs(Math.sin(a - h.a)) * h.d > 0.45 * (h.m.horse ? 1.6 : 1)) continue;
        if (B.rng() < CFG.CANISTER_P * Math.exp(-h.d / CFG.CANISTER_FALLOFF) * Field.coverFor(B.field, h.m.x, h.m.y, g.x, g.y)) {
          down.add(h.m); Combat.hit(B, h.m, gunner); n++;
        }
        break;
      }
    }
    for (const e of B.units) if (e.team !== u.team && e.formed && dist(g.x, g.y, e.cx, e.cy) < CFG.CANISTER_RANGE + 20) { e.morale -= CFG.ROUND_SCARE; e.shelled = B.t; }
    B.fx.push({ kind: 'canister', x: g.x, y: g.y, a: g.facing, r: CFG.CANISTER_RANGE * 0.7, t: B.t });
  },

  // a piece with nobody of its own near it belongs to whoever gets there
  capture(B, u, g) {
    if (u.men.some(m => m.state === 'formed' && dist2(m.x, m.y, g.x, g.y) < 36)) return;
    let by = null;
    Move.near(B, g.x, g.y, CFG.GUN_CAPTURE, a => { if (!by && a.team !== u.team && a.state === 'formed') by = a; });
    if (!by) return;
    g.taken = true; g.takenBy = by.team;
    if (by.team === TEAM_PLAYER) B.stats.gunsTaken = (B.stats.gunsTaken || 0) + 1;
    B.events.push({ type: 'guntaken', team: by.team });
    u.morale -= CFG.GUN_LOST;
    u.reslot = B.t + 0.3;
    Battle.log(B, by.team === TEAM_PLAYER ? `A gun of ${u.name} is ours!` : `${u.name}: a gun is lost!`, by.team === TEAM_PLAYER ? 'good' : 'bad');
    if (!Artillery.live(u).length) { u.morale = 0; Morale.rout(B, u); }
  },
};
