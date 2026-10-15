'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MOVE — walking. The formation centre moves (advance / fall back),
//  every man walks to his slot, the commander walks where you sent him,
//  and nobody walks through anybody else or into a river.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const Move = {
  // the formation itself: line centres advance, columns follow the leader
  unit(B, u, dt) {
    const f = u.form;
    if (u.order === 'follow' && u.leader) {
      Unit.pushTrail(u, u.leader.x, u.leader.y);
      f.x = u.leader.x; f.y = u.leader.y; f.facing = u.leader.facing;
    } else if (u.order === 'charge' && u.formed) {
      // the colours, the drum and the slot frame go in behind the bayonets
      f.x = lerp(f.x, u.cx, 0.05); f.y = lerp(f.y, u.cy, 0.05);
    } else if ((u.order === 'advance' || u.order === 'fallback') && f.kind !== 'column') {
      const sign = u.order === 'advance' ? 1 : -1;
      const fx = Math.cos(f.facing) * sign, fy = Math.sin(f.facing) * sign;
      // cohesion: a line waits for its stragglers rather than leaving them behind
      const coh = clamp(u.inSlot * 1.4 - 0.25, 0.2, 1);
      const pace = CFG.WALK * (sign < 0 ? 0.8 : 1) * Field.speedAt(B.field, f.x, f.y, fx, fy) * coh;
      const nx = f.x + fx * pace * dt, ny = f.y + fy * pace * dt;
      const ahead = 8;
      if (!Field.passable(B.field, f.x + fx * ahead, f.y + fy * ahead) || !Field.inside(B.field, nx, ny)) {
        u.order = 'hold'; u.blocked = B.t;
        Battle.say(B, u, 'Halt!');
      } else { f.x = nx; f.y = ny; }
    }
    Unit.layout(u);
  },

  // the player's commander: right-click destination or WASD
  commander(B, c, dt) {
    if (c.state !== 'formed') return;
    let vx = c.mvx || 0, vy = c.mvy || 0;
    if (!vx && !vy && c.dest) {
      const d = dist(c.x, c.y, c.dest.x, c.dest.y);
      if (d < 0.6) c.dest = null;
      else { vx = (c.dest.x - c.x) / d; vy = (c.dest.y - c.y) / d; }
    }
    const len = Math.hypot(vx, vy);
    if (len > 0) {
      vx /= len; vy /= len;
      const sp = (c.run ? CFG.CMD_RUN : CFG.CMD_WALK) * Field.speedAt(B.field, c.x, c.y, vx, vy);
      Move.step(B, c, vx * sp * dt, vy * sp * dt);
      c.facing = turnToward(c.facing, Math.atan2(vy, vx), 8 * dt);
      c.moving = sp;
    } else {
      c.moving = 0;
      if (c.aim != null) c.facing = turnToward(c.facing, c.aim, 5 * dt);
    }
  },

  // every man in the battle
  men(B, dt) {
    for (const u of B.units) {
      const fleeDir = u.team === TEAM_PLAYER ? 1 : -1;
      for (const m of u.men) {
        if (m.state === 'down' || m.state === 'gone') continue;
        let tx, ty, max;
        if (m.state === 'fleeing') {
          tx = m.x + m.jx * 4; ty = m.y + fleeDir * 20; max = CFG.FLEE;
          if (m.y < 2 || m.y > B.field.h - 2) { m.state = 'gone'; u.stats.fled++; continue; }
        } else if (m.foe && m.foe.state === 'formed') {
          tx = m.foe.x; ty = m.foe.y; max = CFG.CHARGE;
          if (dist2(m.x, m.y, tx, ty) < CFG.MELEE_REACH * CFG.MELEE_REACH * 0.5) { m.moving = 0; m.facing = Math.atan2(ty - m.y, tx - m.x); continue; }
        } else if (m === u.leader && u.order === 'follow' && u.ai.dest) {
          tx = u.ai.dest.x; ty = u.ai.dest.y; max = CFG.WALK * 1.15;
          if (dist2(m.x, m.y, tx, ty) < 4) { u.ai.dest = u.ai.route && u.ai.route.length ? u.ai.route.shift() : null; }
        } else {
          tx = m.sx; ty = m.sy;
          const d = dist(m.x, m.y, tx, ty);
          max = d > 5 ? CFG.CATCH_UP : (u.order === 'advance' || u.order === 'fallback' || u.order === 'follow') ? CFG.QUICK : CFG.WALK;
          if (m.state === 'formed' && m.role === 'line' && (m.m === 'present' || m.m === 'presenting') && d < CFG.SLOT_FORMED) max = 0;
        }
        const dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy);
        if (d > 0.15 && max > 0) {
          const ux = dx / d, uy = dy / d;
          const sp = Math.min(max * Field.speedAt(B.field, m.x, m.y, ux, uy), d * 2.2);
          Move.step(B, m, ux * sp * dt, uy * sp * dt);
          m.moving = sp;
          const backing = u.order === 'fallback' && m.state === 'formed';
          if (sp > 0.6 && !backing) m.facing = turnToward(m.facing, Math.atan2(uy, ux), 6 * dt);
          else m.facing = turnToward(m.facing, m.aimAt != null ? m.aimAt : m.slotFacing, 4 * dt);
        } else {
          m.moving = 0;
          m.facing = turnToward(m.facing, m.aimAt != null ? m.aimAt : (m.slotFacing != null ? m.slotFacing : m.facing), 4 * dt);
        }
      }
    }
    Move.separate(B);
  },

  // step with river/building avoidance: try straight, then slide along the obstacle
  step(B, a, dx, dy) {
    const f = B.field;
    const ok = (x, y) => Field.passable(f, x, y) && x > 0.5 && y > 0.5 && x < f.w - 0.5 && y < f.h - 0.5;
    if (ok(a.x + dx, a.y + dy)) { a.x += dx; a.y += dy; return; }
    if (ok(a.x + dx, a.y)) { a.x += dx; return; }
    if (ok(a.x, a.y + dy)) { a.y += dy; return; }
    const s = Math.hypot(dx, dy), base = Math.atan2(dy, dx);
    for (const off of [0.8, -0.8, 1.5, -1.5]) {
      const nx = a.x + Math.cos(base + off) * s, ny = a.y + Math.sin(base + off) * s;
      if (ok(nx, ny)) { a.x = nx; a.y = ny; return; }
    }
    // fleeing men and fallen-back men can get pinned against the field edge — let them leave
    if (a.state === 'fleeing' && (a.y + dy < 0.5 || a.y + dy > f.h - 0.5)) a.y += dy;
  },

  // spatial hash push-apart so ranks keep their shape and crowds don't merge
  separate(B) {
    const H = new Map(), C = 2, R = 0.78;
    const all = B.agents;
    all.length = 0;
    for (const u of B.units) for (const m of u.men) if (m.state === 'formed' || m.state === 'fleeing') all.push(m);
    if (B.cmd.state === 'formed') all.push(B.cmd);
    for (const a of all) {
      const k = Math.floor(a.x / C) * 4096 + Math.floor(a.y / C);
      let b = H.get(k); if (!b) H.set(k, b = []); b.push(a);
    }
    B.hash = H;
    for (const a of all) {
      const cx = Math.floor(a.x / C), cy = Math.floor(a.y / C);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const b = H.get((cx + ox) * 4096 + cy + oy);
        if (!b) continue;
        for (const o of b) {
          if (o.id <= a.id) continue;
          const dx = o.x - a.x, dy = o.y - a.y, d2 = dx * dx + dy * dy;
          if (d2 >= R * R || d2 < 1e-6) continue;
          const d = Math.sqrt(d2), push = (R - d) * 0.5, ux = dx / d, uy = dy / d;
          if (Field.passable(B.field, a.x - ux * push, a.y - uy * push)) { a.x -= ux * push; a.y -= uy * push; }
          if (Field.passable(B.field, o.x + ux * push, o.y + uy * push)) { o.x += ux * push; o.y += uy * push; }
        }
      }
    }
  },

  // agents near a point, via the hash built this tick
  near(B, x, y, r, fn) {
    const C = 2, n = Math.ceil(r / C);
    const cx = Math.floor(x / C), cy = Math.floor(y / C);
    for (let ox = -n; ox <= n; ox++) for (let oy = -n; oy <= n; oy++) {
      const b = B.hash && B.hash.get((cx + ox) * 4096 + cy + oy);
      if (!b) continue;
      for (const a of b) if (dist2(a.x, a.y, x, y) <= r * r) fn(a);
    }
  },
};
