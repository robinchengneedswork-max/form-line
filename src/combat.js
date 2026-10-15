'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  COMBAT — the musket, the smoke it makes, and the bayonet.
//
//  A musket cycles  loaded → presenting → present → (fire) → reloading.
//  "Make ready" brings loaded men to the present and HOLDS them there;
//  "Fire!" lets go everyone who is presented, in one ragged crash.
//  "Fire at will" lets each man go when he has a mark.
//  A man only fires when his company is halted, he is in his slot, and he
//  stands in the first two ranks.
//
//  Hit chance = P0·e^(−d/falloff) × aim × nerve × cover × smoke × …
//  Smoke is real: every shot leaves a puff that drifts on the wind, and a
//  ball fired through it is a ball fired blind.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const Combat = {
  reloadTime(B, m, u) {
    const base = CFG.RELOAD_BASE - CFG.RELOAD_DRILL * u.drill - Math.min(m.xp, 6);
    // a rifle must be rammed down a tight, greased patch; Line companies drill hardest at the musket
    return base * B.rng.range(0.85, 1.15) * (m.weapon === 'rifle' ? 1.7 : 1) * (u.ctype === 'line' ? 0.92 : 1);
  },
  // a man's reach with his weapon, at will / in a volley
  range(m, volley) { return m.weapon === 'rifle' ? (volley ? 300 : 280) : volley ? CFG.RANGE_MAX : CFG.RANGE_ATWILL; },

  moraleMul(u) { return u.morale >= CFG.STEADY ? 1 : u.morale >= CFG.SHAKEN ? 0.86 : 0.7; },

  canFire(u, m) {
    if (u.routed || m.foe) return false;
    if (u.form.kind === 'skirmish') return u.order === 'hold' || u.order === 'fallback';
    if (u.order !== 'hold' || u.form.kind === 'column') return false;
    return m.rank < CFG.FIRING_RANKS && dist2(m.x, m.y, m.sx, m.sy) < CFG.SLOT_FORMED * CFG.SLOT_FORMED;
  },

  // fire by rank: the front rank lets go, then the next, so part of the company is always loaded
  rankFire(B, u) {
    if (u.fire !== 'byrank' || B.t < (u.rankNext || 0)) return;
    const nr = Math.min(CFG.FIRING_RANKS, Unit.grid(u, Math.max(1, u.formed)).ranks);
    const r = (u.rankTurn || 0) % nr;
    let tot = 0;
    const pres = [];
    for (const m of u.men) if (m.role === 'line' && m.state === 'formed' && m.rank === r) { tot++; if (m.m === 'present') pres.push(m); }
    if (!tot) { u.rankTurn = r + 1; return; }
    if (pres.length >= tot * 0.6 && Combat.pickTarget(B, pres[0], CFG.RANGE_MAX)) {
      for (const m of pres) m.volleyAt = B.t + B.rng() * CFG.VOLLEY_RIPPLE;
      u.rankTurn = r + 1; u.rankNext = B.t + CFG.BYRANK_GAP;
    }
  },

  muskets(B, dt) {
    for (const u of B.units) {
      Combat.rankFire(B, u);
      const relMul = u.morale >= CFG.SHAKEN ? 1 : 1.3;
      for (const m of u.men) {
        if (m.role !== 'line' || m.state !== 'formed') continue;
        if (m.m === 'reloading') {
          if (!m.foe) m.mt -= dt / relMul;
          if (m.mt <= 0) m.m = 'loaded';
          continue;
        }
        const can = Combat.canFire(u, m);
        if (!can) { if (m.m !== 'loaded') { m.m = 'loaded'; m.volleyAt = 0; } m.aimAt = null; continue; }
        if (m.m === 'loaded') {
          const want = u.fire === 'ready' || u.fire === 'byrank' || (u.fire === 'atwill' && B.rng() < dt * 2 && Combat.pickTarget(B, m, Combat.range(m, false)));
          if (want) { m.m = 'presenting'; m.mt = CFG.PRESENT_TIME * B.rng.range(0.8, 1.3) / (0.7 + u.drill * 0.6); }
        } else if (m.m === 'presenting') {
          m.mt -= dt;
          if (m.mt <= 0) { m.m = 'present'; m.mt = B.rng.range(CFG.AIM_TIME[0], CFG.AIM_TIME[1]); }
        } else if (m.m === 'present') {
          if (u.fire === 'hold') { m.m = 'loaded'; m.aimAt = null; continue; }
          if (m.volleyAt && B.t >= m.volleyAt) { m.volleyAt = 0; Combat.fire(B, u, m, true); continue; }
          if (u.fire === 'atwill') {
            m.mt -= dt;
            if (m.mt <= 0) {
              if (Combat.pickTarget(B, m, Combat.range(m, false))) Combat.fire(B, u, m, false);
              else m.mt = 1;
            }
          }
        }
      }
    }
  },

  // nearest visible enemy company in front of this man, then a man in it
  pickTarget(B, m, range) {
    const seen = B.seen[m.team], face = m.slotFacing != null ? m.slotFacing : m.facing;
    let best = null, bd = Infinity;
    for (const e of B.units) {
      if (e.team === m.team || !seen.has(e.id) || (e.formed === 0 && !e.routed)) continue;
      const d = dist(m.x, m.y, e.cx, e.cy);
      if (d > range + 25 || d >= bd) continue;
      if (Math.abs(angDiff(face, Math.atan2(e.cy - m.y, e.cx - m.x))) > CFG.FIRE_CONE + 12 / Math.max(d, 12)) continue;
      best = e; bd = d;
    }
    if (!best) return null;
    let pick = null, pd = Infinity;
    for (let k = 0; k < 5; k++) {
      const t = best.men[Math.floor(B.rng() * best.men.length)];
      if (t.state !== 'formed' && t.state !== 'fleeing') continue;
      const d = dist(m.x, m.y, t.x, t.y);
      if (d > range || d >= pd) continue;
      if (Math.abs(angDiff(face, Math.atan2(t.y - m.y, t.x - m.x))) > CFG.FIRE_CONE + 0.15) continue;
      if (!Field.los(B.field, m.x, m.y, t.x, t.y)) continue;
      pick = t; pd = d;
    }
    return pick;
  },

  fire(B, u, m, volley) {
    let t = Combat.pickTarget(B, m, Combat.range(m, volley));
    const face = t ? Math.atan2(t.y - m.y, t.x - m.x) : m.facing;
    m.facing = face;
    m.m = 'reloading'; m.mt = Combat.reloadTime(B, m, u); m.aimAt = null; m.firedAt = B.t;
    u.stats.shots++;
    const mx = m.x + Math.cos(face) * 1.4, my = m.y + Math.sin(face) * 1.4;
    Smoke.puff(B, mx, my, face);
    B.events.push({ type: 'shot', x: mx, y: my, team: u.team, volley, unit: u.id });
    B.fx.push({ kind: 'flash', x: mx, y: my, a: face, t: B.t });
    if (!t) return;
    // officers draw fire
    const tu = t.unit;
    const officer = tu.team === TEAM_PLAYER ? B.cmd : tu.leader;
    // officers draw fire — and riflemen go looking for them
    const rifle = m.weapon === 'rifle';
    if (officer && officer.state === 'formed' && dist2(officer.x, officer.y, t.x, t.y) < (rifle ? 900 : 144) && B.rng() < (rifle ? 0.4 : CFG.OFFICER_TARGETED)) t = officer;
    tu.morale -= CFG.SUPPRESS;
    const d = dist(m.x, m.y, t.x, t.y);
    let p = CFG.HIT_P0 * Math.exp(-d / (rifle ? CFG.HIT_FALLOFF * 2 : CFG.HIT_FALLOFF));
    p *= m.aim * (1 + Math.min(m.xp, 8) * 0.025) * Combat.moraleMul(u);
    p *= Field.coverFor(B.field, t.x, t.y, m.x, m.y);
    p *= Math.exp(-CFG.SMOKE_K * Smoke.along(B, m.x, m.y, t.x, t.y));
    if (volley) p *= u.ctype === 'line' ? CFG.VOLLEY_BONUS + 0.1 : CFG.VOLLEY_BONUS;
    if (!m.fired) { p *= CFG.FIRST_FIRE; m.fired = true; }
    if (tu.form.kind === 'skirmish') p *= tu.ctype === 'light' ? 0.42 : 0.55;
    else if (tu.form.kind === 'attack') p *= CFG.ATTACK_EXPOSED;
    else if (tu.form.kind === 'column') p *= 1.3;   // a deep target: a ball that misses one man finds the next
    const dh = Field.heightAt(B.field, m.x, m.y) - Field.heightAt(B.field, t.x, t.y);
    p *= dh > 3 ? 1.08 : dh < -3 ? 0.94 : 1;
    if (t.moving > 2.5) p *= 0.85;
    if (B.rng() < p) Combat.hit(B, t, m);
  },

  // a man goes down. Morale, colours and leadership all follow from here.
  hit(B, t, by) {
    if (t === B.cmd) {
      t.hp--;
      B.events.push({ type: 'cmdhit', x: t.x, y: t.y });
      Battle.log(B, t.hp > 0 ? 'You are hit — but still standing.' : 'You are struck down.');
      if (B.player) B.player.morale -= 8;
      if (t.hp <= 0) { t.state = 'down'; t.downT = B.t; }
      return;
    }
    const u = t.unit;
    t.state = 'down'; t.downT = B.t; t.foe = null; t.wounded = B.rng() < 0.45;
    if (by) { by.kills++; by.unit.stats.hits++; }
    u.stats.down++;
    B.events.push({ type: 'down', x: t.x, y: t.y, team: u.team });
    if (t.role === 'line') u.reslot = B.t + (u.men.some(s => s.grade === 'sgt' && s.state === 'formed') ? 0.8 : 1.5);   // "close up!"
    const flank = by && Math.abs(angDiff(u.form.facing, Math.atan2(by.y - t.y, by.x - t.x))) > Math.PI / 3;
    Morale.onLoss(B, u, flank || u.order === 'retire', t.role);
    if (t.role === 'ensign' || t.carrying) Colours.drop(B, t);
    if (t === u.leader) {
      u.leader = null;
      Battle.log(B, `${u.name}: the captain is down!`);
    }
  },

  // ── the bayonet ──
  melee(B, dt) {
    for (const u of B.units) {
      if (u.order === 'charge') {
        u.chargeT += dt;
        let near = false;
        for (const m of u.men) {
          if (m.role !== 'line' || m.state !== 'formed') continue;
          if (!m.foe || m.foe.state !== 'formed' || B.rng() < dt * 0.8) m.foe = Combat.nearestFoe(B, m, 140);
          if (m.foe) near = true;
        }
        if (near) u.lastFoe = B.t;
        if (u.wind < CFG.CHARGE_BLOWN && !u.engaged) { Combat.endCharge(B, u); Battle.log(B, `${u.name}: the men are blown — the pursuit is called off.`, u.team === TEAM_PLAYER ? 'bad' : ''); }
        else if (B.t - (u.lastFoe || 0) > 3 || u.chargeT > CFG.CHARGE_MAX || u.morale < CFG.SHAKEN) Combat.endCharge(B, u);
      }
    }
    for (const u of B.units) u.engaged = 0;
    // every man within reach of an enemy fights him, charging or not
    for (const u of B.units) {
      for (const m of u.men) {
        if (m.state !== 'formed' || m.role === 'drummer' || m.role === 'fifer') continue;
        let foe = m.foe && m.foe.state === 'formed' && dist2(m.x, m.y, m.foe.x, m.foe.y) < CFG.MELEE_REACH * CFG.MELEE_REACH ? m.foe : null;
        if (!foe) Move.near(B, m.x, m.y, CFG.MELEE_REACH, a => { if (!foe && a.team !== m.team && a.state === 'formed') foe = a; });
        if (!foe) { if (u.order !== 'charge') m.foe = null; continue; }
        m.foe = foe;
        m.aimAt = Math.atan2(foe.y - m.y, foe.x - m.x);
        u.engaged++;
        let p = CFG.MELEE_KILL * u.melee * Combat.moraleMul(u) * (u.order === 'charge' ? 1 + 0.5 * clamp(u.impetus || 0, 0, 1.2) : 1) * (m.role === 'officer' ? 1.5 : 1) * (0.55 + 0.45 * u.wind);
        if (foe === B.cmd) p *= 0.6;
        if (B.rng() < p * dt) Combat.hit(B, foe, m);
      }
    }
    // the commander's sword
    const c = B.cmd;
    if (c.state === 'formed') {
      let foe = null;
      Move.near(B, c.x, c.y, CFG.MELEE_REACH + 0.3, a => { if (!foe && a.team !== TEAM_PLAYER && a.state === 'formed') foe = a; });
      if (foe && B.rng() < 0.35 * dt) { Combat.hit(B, foe, null); c.kills = (c.kills || 0) + 1; B.fx.push({ kind: 'slash', x: c.x, y: c.y, t: B.t }); }
    }
  },

  nearestFoe(B, m, r) {
    let best = null, bd = r * r;
    for (const e of B.units) {
      if (e.team === m.team) continue;
      if (dist2(m.x, m.y, e.cx, e.cy) > (r + 40) * (r + 40)) continue;
      for (const o of e.men) {
        if (o.state !== 'formed') continue;
        const d = dist2(m.x, m.y, o.x, o.y);
        if (d < bd) { bd = d; best = o; }
      }
    }
    return best;
  },

  endCharge(B, u) {
    u.order = 'hold';
    for (const m of u.men) m.foe = null;
    let fx = 0, fy = 0;
    for (const m of u.men) if (m.state === 'formed') { fx += Math.cos(m.facing); fy += Math.sin(m.facing); }
    Unit.setForm(u, 'line', u.cx, u.cy, Math.atan2(fy, fx));
    Battle.say(B, u, 'Re-form!');
  },

  // charging companies sap the nerve of whoever they are running at
  shock(B, dt) {
    for (const u of B.units) {
      u.beingCharged = 0;
    }
    for (const c of B.units) {
      if (c.order !== 'charge' || !c.formed) continue;
      for (const d of B.units) {
        if (d.team === c.team || !d.formed || d.routed) continue;
        const dd = dist(c.cx, c.cy, d.cx, d.cy);
        if (dd > CFG.CHARGE_RANGE) continue;
        const push = Combat.momentum(B, c, d);
        const odds = push * (c.morale / 60);
        const loaded = d.men.filter(m => m.m === 'present').length / Math.max(1, d.formed);
        d.beingCharged = 1;
        d.morale -= CFG.CHARGE_SHOCK * odds * (1 - loaded * 0.5) * dt;
        // "wait for it": a line still presented gives them a volley in the face, unordered
        if (dd < CFG.POINT_BLANK && !d.routed) {
          for (const m of d.men) if (m.m === 'present' && !m.volleyAt && m.state === 'formed') m.volleyAt = B.t + B.rng() * 0.35;
        }
        // and then one side's nerve goes. Most bayonet charges ended here, before steel crossed
        if (dd < CFG.CHARGE_TEST && !c.tested.includes(d.id)) {
          c.tested.push(d.id);
          // two charges meeting: one clash, not two
          if (d.order === 'charge' && d.tested) d.tested.push(c.id);
          Combat.nerve(B, c, d, push);
        }
      }
    }
  },

  // a charge's weight: numbers × how fast they are coming × the drop, × column / grenadiers / steel
  momentum(B, c, d) {
    const dh = clamp(Field.heightAt(B.field, c.cx, c.cy) - Field.heightAt(B.field, d.cx, d.cy), -8, 8);
    return clamp(c.formed / d.formed, 0.4, 2.5) * c.melee
      * (0.35 + 0.65 * clamp(c.impetus || 0, 0, 1.2)) * (1 + dh * CFG.SLOPE_PUSH)
      * (c.chargeFrom === 'attack' ? CFG.ATTACK_SHOCK : 1) * (c.ctype === 'grenadier' ? 1.25 : 1);
  },

  // the moment of the charge: does it go home, or falter in front of them?
  nerve(B, c, d, push) {
    // steadiness: muskets still levelled, or a volley delivered in the last few seconds (holding fire to the last pays);
    // a line caught with its ramrods out is the weakest thing on the field
    const line = d.men.filter(m => m.role === 'line' && m.state === 'formed');
    const loaded = line.filter(m => m.m === 'present' || m.m === 'presenting' || B.t - (m.firedAt || -99) < CFG.STEADY_AFTER).length / Math.max(1, line.length);
    const cover = d.men.some(m => m.state === 'formed' && Field.coverFor(B.field, m.x, m.y, c.cx, c.cy) < 1) ? 1.3 : 1;
    const att = c.morale * push;
    // a company charging too meets you with its own momentum, not its muskets
    const def = d.order === 'charge' ? d.morale * Combat.momentum(B, d, c) : d.morale * (0.75 + 0.6 * loaded) * cover * (d.form.kind === 'skirmish' ? 0.6 : 1);
    const p = att * att / (att * att + def * def);
    if (B.rng() < p) {
      d.morale -= 18;
      Battle.log(B, `${d.name} wavers before the bayonets!`, d.team === TEAM_PLAYER ? 'bad' : 'good');
      B.fx.push({ kind: 'say', x: d.cx, y: d.cy, text: d.team === TEAM_PLAYER ? 'They\u2019re wavering!' : 'Ils fl\u00e9chissent!', t: B.t, team: d.team, foreign: d.team !== TEAM_PLAYER });
    } else {
      c.morale -= 10;
      Combat.endCharge(B, c);
      Battle.log(B, `${c.name}: the charge falters in front of them.`, c.team === TEAM_PLAYER ? 'bad' : 'good');
      B.fx.push({ kind: 'say', x: c.cx, y: c.cy, text: c.team === TEAM_PLAYER ? 'The charge falters!' : 'Halte!', t: B.t, team: c.team, foreign: c.team !== TEAM_PLAYER });
    }
  },
};

// ── smoke ──
const Smoke = {
  puff(B, x, y, a) {
    if (B.smoke.length > 1100) B.smoke.shift();
    B.smoke.push({ x, y, vx: Math.cos(a) * 3.2, vy: Math.sin(a) * 3.2, r: 1.2, age: 0, life: CFG.SMOKE_LIFE * B.rng.range(0.7, 1.2), s: B.rng() });
  },
  step(B, dt) {
    const w = B.wind;
    for (const p of B.smoke) {
      p.age += dt;
      p.vx *= Math.pow(0.4, dt); p.vy *= Math.pow(0.4, dt);
      p.x += (p.vx + w.x) * dt; p.y += (p.vy + w.y) * dt;
      p.r = 1.2 + Math.sqrt(p.age) * 1.3;
    }
    if (B.smoke.length && B.smoke[0].age > B.smoke[0].life) B.smoke = B.smoke.filter(p => p.age < p.life);
    B.smokeT -= dt;
    if (B.smokeT <= 0) {
      B.smokeT = 0.25;
      const g = B.smokeGrid; g.fill(0);
      const S = CFG.SMOKE_CELL, cols = B.smokeCols;
      for (const p of B.smoke) {
        const c = Math.floor(p.x / S), r = Math.floor(p.y / S);
        if (c < 0 || r < 0 || c >= cols || r >= B.smokeRows) continue;
        g[r * cols + c] += 0.11 * (1 - p.age / p.life);
      }
    }
  },
  // summed density along a sight line (samples one per cell)
  along(B, ax, ay, bx, by) {
    const S = CFG.SMOKE_CELL, d = dist(ax, ay, bx, by), n = Math.max(1, Math.ceil(d / S));
    let s = 0;
    for (let k = 0; k <= n; k++) {
      const x = lerp(ax, bx, k / n), y = lerp(ay, by, k / n);
      const c = Math.floor(x / S), r = Math.floor(y / S);
      if (c >= 0 && r >= 0 && c < B.smokeCols && r < B.smokeRows) s += B.smokeGrid[r * B.smokeCols + c];
    }
    return s;
  },
};
