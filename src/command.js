'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  COMMAND — brigade headquarters, for the set-piece battles.
//
//  Every company (yours included) carries a TASK:
//    hold    — march to a post and stand there, facing the threat
//    reserve — the same, further back, until headquarters commits it
//    attack  — go and take a place, fighting whatever is in the way
//  The AI captains turn a task into a doctrine (ai.js). YOUR company is
//  yours to command: the task reaches you as a DISPATCH from the colonel,
//  marked on the field, and headquarters notes whether you carried it out.
//
//  Headquarters (one per side) looks at the battle every few seconds:
//    · a sector whose holders broke  → commit the nearest reserve to retake it
//    · enemy waves                   → companies with `wave` go in when their time comes
//    · the other side is spent       → general advance
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const COLONELS = ['Colonel Barnard', 'Colonel Colborne', 'Colonel Wallace', 'Colonel Mackinnon'];

const Command = {
  init(B) {
    B.hq = [{ phase: 'opening', next: 3 }, { phase: 'opening', next: 3 }];
    B.colonel = COLONELS[B.seed % COLONELS.length];
    B.orders = { good: 0, total: 0 };
    const t = B.player.task;
    if (t) Command.dispatch(B, t.text, true);
  },

  // turn a task into a doctrine (ai.js reads doctrine / objective / anchor)
  apply(u) {
    if (!u.task || u.taskApplied === u.task) return;
    u.taskApplied = u.task;
    const t = u.task;
    if (t.kind === 'attack') {
      u.doctrine = 'attack'; u.objective = [t.x, t.y]; u.ai.objDone = false; u.anchor = null; u.ai.goal = null;
    } else {
      u.doctrine = 'hold'; u.objective = null; u.anchor = { x: t.x, y: t.y, facing: t.facing != null ? t.facing : u.form.facing };
    }
  },

  assign(B, u, task) {
    task.since = B.t;
    u.task = task;
    if (u.isPlayer) Command.dispatch(B, task.text);
    else Battle.log(B, `${u.name}: ${task.short || task.kind}.`);
  },

  dispatch(B, text, first) {
    B.dispatch = { text, t: B.t, first: !!first };
    B.events.push({ type: 'dispatch' });
    Battle.log(B, `${B.colonel}: “${text}”`, 'order');
  },

  step(B) {
    if (!B.hq) return;
    for (const team of [TEAM_PLAYER, TEAM_ENEMY]) {
      const hq = B.hq[team];
      if (B.t < hq.next) continue;
      hq.next = B.t + 3;
      Command.think(B, team, hq);
      if (team === TEAM_PLAYER) Command.track(B);
    }
  },

  strength(B, team) { return B.units.filter(u => u.team === team && !u.routed).reduce((a, u) => a + u.formed, 0); },

  think(B, team, hq) {
    const mine = B.units.filter(u => u.team === team);
    const foe = 1 - team;
    // 1. waves: a reserve whose hour has come goes in
    for (const u of mine) {
      if (u.task && u.task.kind === 'reserve' && u.task.wave != null && B.t >= u.task.wave && !u.routed) {
        const g = u.task.goal || Command.centroid(B, foe);
        Command.assign(B, u, { kind: 'attack', x: g.x, y: g.y, text: 'Your turn — go in! Take the position in front of you.', short: 'goes in' });
      }
    }
    // 2. a broken sector is retaken by the nearest reserve
    for (const u of mine) {
      if (!u.task || u.task.kind !== 'hold' || u.task.lost || !(u.routed || u.formed < u.startSize * 0.3)) continue;
      u.task.lost = true;
      const res = mine.filter(r => r !== u && !r.routed && r.task && r.task.kind === 'reserve' && r.task.wave == null)
        .sort((a, b) => dist(a.cx, a.cy, u.task.x, u.task.y) - dist(b.cx, b.cy, u.task.x, u.task.y))[0];
      if (res) Command.assign(B, res, { kind: 'attack', x: u.task.x, y: u.task.y, text: `${u.name} has given way. Retake their ground — now!`, short: 'committed to retake a lost post' });
      else if (team === TEAM_PLAYER) Battle.log(B, `${u.name} has broken. There is no reserve left.`, 'bad');
    }
    // 3. the other side is spent: general advance
    if (hq.phase !== 'general' && B.t > 150) {
      const us = Command.strength(B, team), them = Command.strength(B, foe);
      const theirMorale = B.units.filter(u => u.team === foe && !u.routed && u.formed);
      const avg = theirMorale.length ? theirMorale.reduce((a, u) => a + u.morale, 0) / theirMorale.length : 0;
      const waiting = B.units.some(u => u.team === foe && u.task && u.task.kind === 'reserve' && u.task.wave != null && !u.routed);
      // or the day is wearing on and neither has given way: whoever is not outnumbered goes forward
      const lastWave = Math.max(0, ...mine.map(u => u.task && u.task.wave ? u.task.wave : 0));
      const stale = (B.t > 540 && us >= them * 0.85) || (lastWave && B.t > lastWave + 120 && mine.every(u => !u.task || u.task.kind !== 'reserve'));
      if (!waiting && (them < us * 0.55 || (avg < 38 && them < us) || stale)) {
        hq.phase = 'general';
        for (const u of mine) {
          if (u.routed || !u.formed) continue;
          const c = Command.nearestCentroid(B, u, foe);
          if (c) Command.assign(B, u, { kind: 'attack', x: c.x, y: c.y, text: 'General advance! Drive them from the field!', short: 'joins the general advance' });
        }
        Battle.log(B, team === TEAM_PLAYER ? 'The whole line goes forward!' : 'The enemy is coming on all along the line!', team === TEAM_PLAYER ? 'good' : 'bad');
      }
    }
  },

  centroid(B, team) {
    let x = 0, y = 0, n = 0;
    for (const u of B.units) if (u.team === team && !u.routed && u.formed) { x += u.cx * u.formed; y += u.cy * u.formed; n += u.formed; }
    return n ? { x: x / n, y: y / n } : { x: B.field.w / 2, y: team === TEAM_PLAYER ? B.field.h - 80 : 80 };
  },
  nearestCentroid(B, u, team) {
    let best = null, bd = Infinity;
    for (const e of B.units) {
      if (e.team !== team || e.routed || !e.formed) continue;
      const d = dist(u.cx, u.cy, e.cx, e.cy);
      if (d < bd) { bd = d; best = { x: e.cx, y: e.cy }; }
    }
    return best;
  },

  // did the player do as he was told? (sampled every 3 s)
  track(B) {
    const u = B.player, t = u && u.task;
    if (!t || u.routed) return;
    B.orders.total++;
    const near = dist(u.cx, u.cy, t.x, t.y);
    let ok;
    if (t.kind === 'attack') {
      const engaged = B.units.some(e => e.team !== u.team && !e.routed && e.formed && B.seen[u.team].has(e.id) && dist(u.cx, u.cy, e.cx, e.cy) < 160);
      ok = near < 70 || engaged || (t.lastD != null && near < t.lastD - 1);
      t.lastD = near;
    } else ok = near < 50;
    if (ok) B.orders.good++;
  },
  obeyed(B) { return B.orders && B.orders.total > 10 ? B.orders.good / B.orders.total : null; },
};
