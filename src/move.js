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
    } else if (u.order === 'ride' && u.ride) {
      // a squadron moves as a block: the frame trots toward the point, wheeling as it goes
      const w = u.ride, d = dist(f.x, f.y, w.x, w.y);
      if (d < 3) {
        u.order = 'hold'; u.ride = null;
        if (w.face != null) Unit.setForm(u, 'line', f.x, f.y, w.face);
      } else {
        const ux = (w.x - f.x) / d, uy = (w.y - f.y) / d;
        f.facing = turnToward(f.facing, Math.atan2(uy, ux), 1.2 * dt);
        const coh = clamp(u.inSlot * 1.4 - 0.2, 0.35, 1);
        const pace = w.pace * Move.horseGround(B, f.x, f.y, ux, uy) * coh * (u.cav ? u.cav.speed : 1);
        f.x += ux * Math.min(d, pace * dt); f.y += uy * Math.min(d, pace * dt);
      }
    } else if (u.order === 'retire' && u.retireRoute && u.retireRoute.length) {
      const w = u.retireRoute[0], d = dist(f.x, f.y, w.x, w.y);
      if (d < 3 && u.retireRoute.length > 1) u.retireRoute.shift();
      else if (d > 0.5) {
        const ux = (w.x - f.x) / d, uy = (w.y - f.y) / d;
        const coh = clamp(u.inSlot * 1.4 - 0.25, 0.3, 1);
        const pace = CFG.WALK * 1.15 * Field.speedAt(B.field, f.x, f.y, ux, uy) * coh;
        f.x += ux * Math.min(d, pace * dt); f.y += uy * Math.min(d, pace * dt);
      }
    } else if ((u.order === 'advance' || u.order === 'fallback') && f.kind !== 'column') {
      const sign = u.order === 'advance' ? 1 : -1;
      const fx = Math.cos(f.facing) * sign, fy = Math.sin(f.facing) * sign;
      // cohesion: a line waits for its stragglers rather than leaving them behind
      // (a column of attack goes at quick time and, being deep and narrow, keeps its order far better)
      const col = f.kind === 'attack' && sign > 0;
      const coh = clamp(u.inSlot * 1.4 - 0.25, col ? 0.6 : 0.2, 1) * (1 - CFG.DIS_PACE * (u.disorder || 0));
      const pace = (col ? CFG.ATTACK_PACE : CFG.WALK) * (sign < 0 ? 0.8 : 1) * Field.speedAt(B.field, f.x, f.y, fx, fy) * coh;
      const nx = f.x + fx * pace * dt, ny = f.y + fy * pace * dt;
      const ahead = 8;
      if (!Field.passable(B.field, f.x + fx * ahead, f.y + fy * ahead) || !Field.inside(B.field, nx, ny)) {
        u.order = 'hold'; u.blocked = B.t;
        Battle.say(B, u, 'Halt!');
      } else { f.x = nx; f.y = ny; }
    }
    Move.disorder(B, u, dt);
    Unit.layout(u);
  },

  // rough ground breaks a line's dressing (CFG.DIS_*). Sampled twice a second
  disorder(B, u, dt) {
    u.disT = (u.disT || 0) - dt;
    if (u.disT > 0) return;
    const step = 0.5 + (u.disT || 0); u.disT = 0.5;
    if (u.arm !== 'foot' || u.routed) { u.disorder = 0; return; }
    let n = 0, rough = 0, moving = 0;
    for (const m of u.men) {
      if (m.role !== 'line' || m.state !== 'formed') continue;
      n++;
      if (m.moving > 0.3) moving++;
      const t = Field.typeAt(B.field, m.x, m.y);
      if (t === T.WOODS || t === T.ORCHARD || t === T.MARSH || t === T.WALL || t === T.FORD) rough++;
    }
    if (!n) return;
    const kind = CFG.DIS_KIND[u.form.kind] != null ? CFG.DIS_KIND[u.form.kind] : 1;
    const wide = u.form.kind === 'line' ? clamp(Unit.grid(u, n).files / 10, 0.5, 2.5) : 1;
    const mov = moving / n, r = rough / n;
    if (mov > 0.3 && r > 0.05) u.disorder += CFG.DIS_RATE * r * kind * wide * (1.2 - u.drill * 0.4) * step;
    else if (mov < 0.3 && r < 0.25) u.disorder -= CFG.DIS_RECOVER * (1 + u.drill) * step;
    else if (mov < 0.3) u.disorder -= CFG.DIS_RECOVER * 0.25 * step;
    if (kind === 0) u.disorder -= CFG.DIS_RECOVER * 2 * step;     // loose order has no dressing to lose
    u.disorder = clamp(u.disorder, 0, 1);
    if (u.isPlayer && u.disorder > 0.4 && !u.disWarned) { u.disWarned = true; Battle.log(B, 'The line is losing its dressing in the rough ground — halt on open ground to re-form, or go through in column.', 'bad'); }
    if (u.disorder < 0.15) u.disWarned = false;
  },

  // where to walk to get to (tx, ty): straight there, or — when a river or a house is in the way — the first leg
  // of a path round it (by a ford or a bridge). Men used to walk straight at their places and stick on the bank
  // (the user, twice). Looked at once a second per man; at most a few new searches a step
  via(B, a, tx, ty) {
    if (B.t >= (a.viaT || 0)) {
      a.viaT = B.t + 0.8 + (a.id % 7) * 0.05;
      if (Path.clear(B.field, a.x, a.y, tx, ty)) a.via = null;
      else if ((B.pathBudget = (B.pathBudget || 0) + 1) <= 8) { const w = Path.find(B.field, a.x, a.y, tx, ty)[0]; a.via = w && dist2(w.x, w.y, tx, ty) > 1 ? { x: w.x, y: w.y } : null; }
      else a.viaT = B.t + 0.1;                 // over budget this step: ask again shortly
    }
    if (a.via && dist2(a.x, a.y, a.via.x, a.via.y) < 2.5 * 2.5) { a.viaT = 0; return { x: tx, y: ty }; }
    return a.via || { x: tx, y: ty };
  },

  // the player's commander: right-click destination or WASD
  commander(B, c, dt) {
    if (c.state !== 'formed') return;
    // walking with a company of yours: keep a few paces behind its centre as it goes (not while it is following YOU)
    const A = c.attach;
    if (A && (!B.units.includes(A) || A.routed || !A.formed)) c.attach = null;
    else if (A && !(A.order === 'follow' && A.leader === c)) {
      const bx = A.cx - Math.cos(A.form.facing) * 6, by = A.cy - Math.sin(A.form.facing) * 6;
      c.dest = dist2(c.x, c.y, bx, by) > 2.5 * 2.5 ? { x: bx, y: by } : null;
      if (!c.dest && A.form.kind !== 'column') c.aim = A.form.facing;
    }
    let vx = c.mvx || 0, vy = c.mvy || 0;
    if (!vx && !vy && c.dest) {
      const d = dist(c.x, c.y, c.dest.x, c.dest.y);
      if (d < 0.6) c.dest = null;
      else { const w = Move.via(B, c, c.dest.x, c.dest.y), dw = Math.max(0.01, dist(c.x, c.y, w.x, w.y)); vx = (w.x - c.x) / dw; vy = (w.y - c.y) / dw; }
    }
    const len = Math.hypot(vx, vy);
    if (len > 0) {
      vx /= len; vy /= len;
      const run = c.run && c.wind > 0;
      // on a horse you walk faster and gallop far faster; it tires more slowly than you do
      const walk = c.horse ? CFG.HORSE_WALK : CFG.CMD_WALK, fast = c.horse ? CFG.HORSE_GALLOP : CFG.CMD_SPRINT;
      const ground = c.horse ? Move.horseGround(B, c.x, c.y, vx, vy) : Field.speedAt(B.field, c.x, c.y, vx, vy);
      const sp = (run ? lerp(walk, fast, clamp(c.wind / 0.25, 0, 1)) : walk) * ground;
      c.wind = clamp(c.wind + (run ? -(c.horse ? CFG.HORSE_WIND_DRAIN : CFG.CMD_WIND_DRAIN) : CFG.CMD_WIND_REST * 0.5) * dt, 0, 1);
      Move.step(B, c, vx * sp * dt, vy * sp * dt);
      c.facing = turnToward(c.facing, Math.atan2(vy, vx), 8 * dt);
      c.moving = sp;
    } else {
      c.moving = 0;
      c.wind = clamp(c.wind + CFG.CMD_WIND_REST * dt, 0, 1);
      if (c.aim != null) c.facing = turnToward(c.facing, c.aim, 5 * dt);
    }
  },

  // a horse in woods, over a wall or in a marsh is a horse slowed to a walk
  horseGround(B, x, y, ux, uy) {
    const t = Field.typeAt(B.field, x, y);
    const extra = t === T.WOODS ? 0.55 : t === T.WALL ? 0.6 : t === T.MARSH ? 0.6 : t === T.ORCHARD ? 0.8 : t === T.FORD ? 0.8 : 1;
    return Field.speedAt(B.field, x, y, ux, uy) * extra;
  },

  // every man in the battle
  men(B, dt) {
    B.pathBudget = 0;
    for (const u of B.units) { u.rushing = 0; u.mo = 0; u.moN = 0; }
    for (const u of B.units) {
      const fleeDir = u.team === TEAM_PLAYER ? 1 : -1;
      for (const m of u.men) {
        if (m.state === 'down' || m.state === 'gone') continue;
        let tx, ty, max;
        if (m.state === 'fleeing') {
          tx = m.x + m.jx * 4; ty = m.y + fleeDir * 20; max = m.horse ? CFG.CAV_FLEE : CFG.FLEE;
          // running for the edge of the field — round a river by the crossing, not into the bank
          if (!Field.passable(B.field, m.x + (tx - m.x) * 0.4, m.y + (ty - m.y) * 0.4) || m.via) { const w = Move.via(B, m, m.x, fleeDir > 0 ? B.field.h - 1 : 1); tx = w.x; ty = w.y; }
          // an officer among them, grabbing collars, slows them down
          const L = u.isPlayer ? B.cmd : u.leader;
          if (L && L.state === 'formed' && dist2(L.x, L.y, m.x, m.y) < CFG.COMMANDER_AURA * CFG.COMMANDER_AURA) max *= CFG.RALLY_HOLD;
          if (m.y < 2 || m.y > B.field.h - 2) { m.state = 'gone'; u.stats.fled++; continue; }
        } else if (m.foe && (m.foe.state === 'formed' || (m.horse && m.foe.state === 'fleeing'))) {
          tx = m.foe.x; ty = m.foe.y;
          if (u.order === 'charge' && m.horse) {
            // trot in, then open out into the gallop for the last stretch
            const gallop = dist2(m.x, m.y, tx, ty) < CFG.CAV_GALLOP_AT * CFG.CAV_GALLOP_AT;
            if (gallop) u.rushing++;
            max = gallop ? lerp(CFG.CAV_TROT, CFG.CAV_GALLOP, clamp((u.wind - 0.05) / 0.35, 0, 1)) : CFG.CAV_CANTER;
            u.mo += m.moving || 0; u.moN++;
          } else if (m.horse && m.foe.state === 'fleeing') {
            max = CFG.CAV_TROT * 1.4;
          } else if (u.order === 'charge') {
            const rush = dist2(m.x, m.y, tx, ty) < CFG.CHARGE_RUSH * CFG.CHARGE_RUSH;
            if (rush) u.rushing++;
            max = rush ? lerp(CFG.QUICK, CFG.CHARGE, clamp((u.wind - 0.05) / 0.35, 0, 1)) : CFG.QUICK;
            if (rush) {
              // running downhill carries you; uphill is already slowed by speedAt
              const d0 = Math.hypot(tx - m.x, ty - m.y) || 1, ux = (tx - m.x) / d0, uy = (ty - m.y) / d0;
              const grade = (Field.heightAt(B.field, m.x, m.y) - Field.heightAt(B.field, m.x + ux * 3, m.y + uy * 3)) / 3 * 100;
              if (grade > 0) max *= 1 + Math.min(0.18, grade * CFG.DOWNHILL_RUSH);
            }
            u.mo += m.moving || 0; u.moN++;
          } else max = CFG.QUICK;
          const reach = m.horse ? CFG.CAV_REACH * 0.8 : CFG.MELEE_REACH * 0.7;
          if (dist2(m.x, m.y, tx, ty) < reach * reach) { m.moving = 0; m.facing = Math.atan2(ty - m.y, tx - m.x); continue; }
        } else if (m === u.leader && u.order === 'follow' && u.ai.dest) {
          tx = u.ai.dest.x; ty = u.ai.dest.y; max = CFG.WALK * 1.15;
          if (dist2(m.x, m.y, tx, ty) < 4) { u.ai.dest = u.ai.route && u.ai.route.length ? u.ai.route.shift() : null; }
        } else {
          tx = m.sx; ty = m.sy;
          if (dist2(m.x, m.y, tx, ty) > 16) { const w = Move.via(B, m, tx, ty); tx = w.x; ty = w.y; } else m.via = null;
          const d = dist(m.x, m.y, tx, ty);
          max = m.horse ? (d > 5 || u.order === 'ride' ? CFG.CAV_TROT * 1.15 : CFG.CAV_WALK)
            : d > 5 ? CFG.CATCH_UP : (u.order === 'advance' || u.order === 'fallback' || u.order === 'follow') ? CFG.QUICK : CFG.WALK;
          if (m.state === 'formed' && m.role === 'line' && (m.m === 'present' || m.m === 'presenting') && d < CFG.SLOT_FORMED) max = 0;
          // on the road with orders to retire: off the field and safe
          if (u.order === 'retire' && m.state === 'formed' && B.retreat && Battle.atRetreat(B, m.x, m.y)) {
            m.state = 'gone'; m.saved = true; u.saved = (u.saved || 0) + 1; continue;
          }
        }
        if (u.traits.light) max *= 1.1;
        if (u.cav) max *= u.cav.speed;
        const dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy);
        if (d > 0.15 && max > 0) {
          const ux = dx / d, uy = dy / d;
          const sp = Math.min(max * (m.horse ? Move.horseGround(B, m.x, m.y, ux, uy) : Field.speedAt(B.field, m.x, m.y, ux, uy)), d * 2.2);
          Move.step(B, m, ux * sp * dt, uy * sp * dt);
          m.moving = sp;
          const backing = u.order === 'fallback' && m.state === 'formed';
          if (sp > 0.6 && !backing) m.facing = turnToward(m.facing, Math.atan2(uy, ux), (m.horse ? 3 : 6) * dt);
          else m.facing = turnToward(m.facing, m.aimAt != null ? m.aimAt : m.slotFacing, 4 * dt);
        } else {
          m.moving = 0;
          m.facing = turnToward(m.facing, m.aimAt != null ? m.aimAt : (m.slotFacing != null ? m.slotFacing : m.facing), 4 * dt);
        }
      }
    }
    Move.separate(B);
    Move.wind(B, dt);
    // impetus: how fast the charging men are actually going (1 = a fresh rush on the flat)
    for (const u of B.units) u.impetus = lerp(u.impetus || 0, u.moN ? u.mo / u.moN / (u.arm === 'cav' ? CFG.CAV_GALLOP : CFG.CHARGE) : 0, Math.min(1, dt * 3));
  },

  // breath: the rush spends it, fighting spends it, standing still gives it back
  wind(B, dt) {
    for (const u of B.units) {
      let r;
      if (u.arm === 'cav') {
        // horses: the gallop blows them, the trot barely, standing they recover
        r = u.rushing > u.formed * 0.25 ? -CFG.CAV_WIND_GALLOP : u.engaged ? -CFG.WIND_FIGHT
          : u.order === 'charge' || (u.order === 'ride' && u.ride && u.ride.pace > CFG.CAV_WALK) ? -CFG.CAV_WIND_TROT : CFG.WIND_REST * 0.8;
        u.wind = clamp(u.wind + r * dt, 0, 1);
        continue;
      }
      if (u.rushing > u.formed * 0.25) r = -CFG.WIND_RUSH;
      else if (u.engaged) r = -CFG.WIND_FIGHT;
      else if (u.order === 'charge') r = -CFG.WIND_QUICK;
      else if (u.order === 'hold') r = CFG.WIND_REST;
      else r = CFG.WIND_WALK;
      u.wind = clamp(u.wind + r * dt, 0, 1);
    }
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
          // a horse takes up more room than a man
          const r = a.horse || o.horse ? (a.horse && o.horse ? 1.35 : 1.05) : R;
          if (d2 >= r * r || d2 < 1e-6) continue;
          const d = Math.sqrt(d2), push = (r - d) * 0.5, ux = dx / d, uy = dy / d;
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
