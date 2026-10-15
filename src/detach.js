'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DETACH — your sergeants' parties. Between battles you put men in a
//  sergeant's party (soldier.party = his id) on the company sheet. In battle,
//  "Detach parties" splits every party off as a unit of its own under its
//  sergeant; you pick which unit you are commanding from the strip at the top
//  (or G), and "Recall" marches them back into the ranks.
//
//  How an order reaches a party:
//    · your voice, if you are close enough (VOICE_RANGE)
//    · your BUGLER, for the simple calls (BUGLE_CALLS) out to BUGLE_RANGE
//    · otherwise a RUNNER: you have CFG.RUNNERS; each runs the order over at
//      RUNNER_SPEED, comes back, and can be shot on the way if he passes close
//      to the enemy. Placing a party somewhere (a drag) always needs a runner
//      or your voice — a bugle cannot say "there".
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const BUGLE_CALLS = new Set(['advance', 'halt', 'charge', 'skirmish', 'close', 'line', 'square', 'rejoin', 'retire', 'fallback', 'atwill', 'cease', 'ready', 'fire']);

const Detach = {
  // the unit your orders go to
  commanded(B) { const s = B.selected; return s && B.units.includes(s) ? s : B.player; },
  mine(B) { return B.units.filter(u => u === B.player || u.isDetachment); },
  cycle(B) {
    const m = Detach.mine(B); if (m.length < 2) return;
    B.selected = m[(m.indexOf(Detach.commanded(B)) + 1) % m.length];
  },

  // who would go with whom: { sgt, men[] } for every sergeant still standing with a party
  parties(B) {
    const P = B.player, out = [];
    const sgts = P.men.filter(m => m.state === 'formed' && m.role === 'line' && m.grade === 'sgt' && m.src);
    for (const s of sgts) {
      const men = P.men.filter(m => m !== s && m.state === 'formed' && m.role === 'line' && m.src && m.src.party === s.src.id);
      if (men.length >= 2) out.push({ sgt: s, men });
    }
    // nobody assigned (a quick battle): the riflemen and the best shots go out under the senior sergeant
    if (!out.length && sgts.length) {
      const pool = P.men.filter(m => m.state === 'formed' && m.role === 'line' && m !== sgts[0] && m.grade !== 'sgt');
      pool.sort((a, b) => (b.weapon === 'rifle') - (a.weapon === 'rifle') || b.aim - a.aim);
      const n = Math.max(pool.filter(m => m.weapon === 'rifle').length, Math.min(6, Math.floor(P.formed / 4)));
      if (n >= 2) out.push({ sgt: sgts[0], men: pool.slice(0, n) });
    }
    return out;
  },

  split(B) {
    const P = B.player;
    if (P.routed) return false;
    const parties = Detach.parties(B);
    if (!parties.length) { Battle.log(B, 'No sergeant has a party. Put men in a sergeant’s party on the company sheet (or carry rifles and have a sergeant).', 'bad'); return false; }
    let last = null;
    for (const { sgt, men } of parties) {
      const all = [sgt].concat(men);
      let cx = 0, cy = 0; for (const m of all) { cx += m.x; cy += m.y; } cx /= all.length; cy /= all.length;
      const surname = (sgt.name || 'Sergeant').split(' ').slice(-1)[0];
      const d = makeUnit({ team: TEAM_PLAYER, faction: 'british', name: `Sgt ${surname}’s party`, x: cx, y: cy, facing: P.form.facing, size: 0,
        drill: P.drill, drills: P.drills, ctype: P.ctype, colours: false, drummer: false, fifer: false, doctrine: 'hold' }, B.rng);
      d.men = []; d.leader = null;
      P.men = P.men.filter(m => !all.includes(m));
      for (const m of all) { m.unit = d; m.foe = null; m.volleyAt = 0; d.men.push(m); }
      sgt.role = 'officer'; sgt.m = 'none'; d.leader = sgt;
      Object.assign(d, { isDetachment: true, parent: P, commanded: true, morale: P.morale, nerveBonus: P.nerveBonus, melee: P.melee, fire: 'atwill' });
      d.startSize = men.length; P.startSize = Math.max(1, P.startSize - men.length);
      // riflemen and light companies go out in skirmish order; others in a little line
      const loose = P.ctype === 'light' || men.filter(m => m.weapon === 'rifle').length > men.length / 2;
      const fx = Math.cos(P.form.facing), fy = Math.sin(P.form.facing);
      Unit.setForm(d, loose ? 'skirmish' : 'line', cx + fx * 12, cy + fy * 12, P.form.facing);
      Unit.survey(d);
      B.units.push(d);
      Battle.log(B, `${sgt.name || 'A sergeant'} takes his party out — ${men.length} men.`);
      last = d;
    }
    Unit.assignSlots(P); Unit.survey(P);
    B.selected = last;
    return true;
  },

  // march a party back to the company
  rejoin(B, d) {
    if (!d.isDetachment) return;
    d.rejoining = true; d.fire = 'hold';
    if (!d.leader || d.leader.state !== 'formed') AI.promote(B, d);
    if (!d.leader) return Detach.merge(B, d);
    d.order = 'follow';
    d.trail = [{ x: d.leader.x, y: d.leader.y }, { x: d.cx, y: d.cy }];
    Unit.setForm(d, 'column', d.leader.x, d.leader.y, d.leader.facing);
    for (const m of d.men) m.foe = null;
    d.ai.dest = { x: d.parent.cx, y: d.parent.cy }; d.ai.route = [];
  },
  recallAll(B) {
    const ds = B.units.filter(u => u.isDetachment);
    if (!ds.length) return false;
    for (const d of ds) Detach.rejoin(B, d);
    Battle.log(B, 'The recall sounds — the parties come in.');
    return true;
  },

  merge(B, d) {
    const P = d.parent;
    for (const m of d.men) { m.unit = P; m.foe = null; if (m.role === 'officer') m.role = 'line'; if (m.state === 'fleeing' && !P.routed) m.state = 'formed'; P.men.push(m); }
    P.startSize += d.startSize; P.saved = (P.saved || 0) + (d.saved || 0);
    B.units.splice(B.units.indexOf(d), 1);
    if (B.selected === d) B.selected = P;
    Unit.assignSlots(P); Unit.survey(P);
    if (!B.over) Battle.log(B, `${d.name} is back in the ranks.`);
  },
  reabsorbAll(B) { for (const d of B.units.filter(u => u.isDetachment)) Detach.merge(B, d); },

  // a runner carries an order: he takes time, and he can be shot on the way
  runner(B, u, cmd, opts) {
    const c = B.cmd;
    B.runnersOut = B.runnersOut || 0;
    const have = B.runners != null ? B.runners : CFG.RUNNERS;
    if (B.runnersOut >= have) { Battle.log(B, have ? 'Your runners are all out — wait for one to come back, or go yourself.' : 'You have no runners left. Go yourself.', 'bad'); return false; }
    const d = dist(c.x, c.y, u.cx, u.cy), dur = d / CFG.RUNNER_SPEED + 0.6;
    let risk = 0;
    for (const e of B.units) {
      if (e.team === TEAM_PLAYER || !e.formed || e.routed || !B.seen[TEAM_PLAYER].has(e.id)) continue;
      const t = clamp(((e.cx - c.x) * (u.cx - c.x) + (e.cy - c.y) * (u.cy - c.y)) / Math.max(1, d * d), 0, 1);
      if (dist(e.cx, e.cy, c.x + (u.cx - c.x) * t, c.y + (u.cy - c.y) * t) < CFG.RUNNER_RISK) risk += CFG.RUNNER_LOSS;
    }
    const lost = B.rng() < Math.min(0.8, risk), at = lost ? B.rng.range(0.3, 0.8) : 1;
    B.runnersOut++;
    B.fx.push({ kind: 'runner', x0: c.x, y0: c.y, x1: u.cx, y1: u.cy, t: B.t, dur, stop: at });
    B.timers = B.timers || [];
    if (lost) {
      B.timers.push({ at: B.t + dur * at, kind: 'lost', name: u.name });
    } else {
      B.pending.push({ at: B.t + dur, unit: u, cmd, opts });
      B.timers.push({ at: B.t + dur * 2, kind: 'back' });
    }
    Battle.log(B, `A runner goes to ${u.name} (${Math.round(dur)} s).`);
    return true;
  },

  step(B) {
    if (B.timers) for (let i = B.timers.length - 1; i >= 0; i--) {
      const t = B.timers[i];
      if (B.t < t.at) continue;
      B.timers.splice(i, 1);
      if (t.kind === 'back') B.runnersOut = Math.max(0, (B.runnersOut || 0) - 1);
      if (t.kind === 'lost') {
        B.runnersOut = Math.max(0, (B.runnersOut || 0) - 1);
        B.runners = (B.runners != null ? B.runners : CFG.RUNNERS) - 1;
        Battle.log(B, `Your runner to ${t.name} is shot down — the order never arrives.`, 'bad');
      }
    }
    for (const d of B.units.filter(u => u.isDetachment)) {
      if (!d.leader || d.leader.state !== 'formed') { d.leader = null; if (d.formed) AI.promote(B, d); }
      if (d.rejoining) {
        const P = d.parent;
        if (d.order !== 'follow' && !d.routed) Detach.rejoin(B, d);
        if (d.leader) d.ai.dest = { x: P.cx, y: P.cy };
        if (d.leader && dist(d.leader.x, d.leader.y, P.cx, P.cy) < 14) Detach.merge(B, d);
      }
    }
  },
};
