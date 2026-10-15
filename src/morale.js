'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MORALE — the real casualty figure. Companies are rarely shot to pieces;
//  they are shot until they run.
//
//  Morale (0..100) falls with every man down, harder when they fall
//  together (a volley) or from the flank, and when the colours or the
//  captain go. It drifts back toward a baseline set by the company's own
//  nerve, its colours, its music and how many are left, faster with an
//  officer close by.
//    ≥55 Steady · ≥30 Shaken (slower, wilder) · <30 Wavering (men slip
//    away one by one) · <15 or a quarter left: the company ROUTS.
//  A routed company that is left alone, with you among them shouting
//  "Rally!", can be brought back.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const Morale = {
  onLoss(B, u, flank, role) {
    u.lossLog.push(B.t);
    while (u.lossLog.length && u.lossLog[0] < B.t - 3) u.lossLog.shift();
    const sudden = u.lossLog.length >= 3;
    let d = CFG.LOSS_SHOCK / Math.max(8, u.startSize);
    if (sudden) d *= CFG.SUDDEN_MULT;
    if (flank) { d *= CFG.FLANK_MULT; u.flanked = B.t; }
    // the depth of a column of attack is what carries it: the men feel the mass behind them
    if (u.form.kind === 'attack') d *= CFG.ATTACK_NERVE;
    // a squadron is a handful of men here, and horsemen at the gallop do not see who fell
    if (u.arm === 'cav') d *= CFG.CAV_NERVE;
    if (role === 'officer') d += CFG.OFFICER_LOST;
    u.morale -= d;
    u.lastHit = B.t;
  },

  // is someone with authority close enough to steady them?
  aura(B, u) {
    if (u.team === TEAM_PLAYER && B.cmd.state === 'formed' && dist2(B.cmd.x, B.cmd.y, u.cx, u.cy) < CFG.COMMANDER_AURA * CFG.COMMANDER_AURA * 2.2) return true;
    return !!(u.leader && u.leader !== B.cmd && u.leader.state === 'formed');
  },

  // NCOs still on their feet: sergeants steady the ranks, corporals a little
  ncos(u) {
    let s = 0;
    for (const m of u.men) if (m.state === 'formed') s += m.grade === 'sgt' ? 2 : m.grade === 'cpl' ? 0.7 : 0;
    return Math.min(8, s);
  },

  baseline(B, u) {
    // men who have marched off by the road are not losses
    const left = (u.formed + (u.saved || 0)) / Math.max(1, u.startSize);
    return CFG.MORALE_BASE + u.nerveBonus + Morale.ncos(u)
      + (Unit.hasRole(u, 'ensign') ? 6 : u.coloursLost ? -8 : 0)
      + (Unit.bandPlaying(u) ? 5 : 0)
      + (u.leader || u.isPlayer ? 0 : -10)
      - (1 - left) * CFG.LEFT_WEIGHT;
  },

  step(B, dt) {
    for (const u of B.units) {
      const quiet = B.t - u.lastHit > CFG.QUIET;
      const aura = Morale.aura(B, u);
      if (u.routed) {
        // with an officer among them they start to steady even while the balls are still coming
        if (aura || B.t - u.lastHit > 8) u.morale += CFG.REGEN * 0.5 * dt * (aura ? 3 : 1);
        u.morale = clamp(u.morale, 0, 100);
        continue;
      }
      const base = Morale.baseline(B, u);
      if (u.morale < base && quiet) u.morale += CFG.REGEN * dt * (aura ? 1.8 : 1) * (Unit.bandPlaying(u) ? 1.3 : 1);
      else if (u.morale > base) u.morale -= 0.3 * dt;
      // fugitives running through your ranks are contagious (the one-off shock is in rout())
      for (const o of B.units) {
        if (o !== u && o.team === u.team && o.routed && o.men.some(m => m.state === 'fleeing' && dist2(m.x, m.y, u.cx, u.cy) < 25 * 25)) u.morale -= 0.4 * dt;
      }
      u.morale = clamp(u.morale, 0, 100);

      // wavering: men slip away one at a time
      if (u.morale < CFG.SHAKEN) {
        const pr = 0.05 * (CFG.SHAKEN - u.morale) / CFG.SHAKEN;
        for (const m of u.men) {
          if (m.state !== 'formed' || m.role === 'officer' || m.role === 'ensign') continue;
          if (B.rng() < pr * dt * (1 - m.nerve / 20)) { m.state = 'fleeing'; m.foe = null; u.reslot = B.t + 1; }
        }
      }
      if (u.morale < CFG.WAVERING || (u.formed + (u.saved || 0) <= Math.max(2, u.startSize * 0.25) && u.formed < u.startSize && !(u.saved && u.order === 'retire'))) Morale.rout(B, u);
      else if (!u.routed && u.morale >= CFG.SHAKEN + 6 && quiet) {
        // stragglers come back when the company steadies and someone calls them
        for (const m of u.men) {
          if (m.state !== 'fleeing') continue;
          const L = u.isPlayer ? B.cmd : u.leader;
          const near = (L && L.state === 'formed' && dist2(L.x, L.y, m.x, m.y) < 55 * 55) ||
            u.men.some(s => s.grade === 'sgt' && s.state === 'formed' && dist2(s.x, s.y, m.x, m.y) < 40 * 40);
          if (near && B.rng() < 0.3 * dt) { m.state = 'formed'; u.reslot = B.t + 0.5; }
        }
      }
    }
  },

  rout(B, u) {
    if (u.routed) return;
    u.routed = true; u.everRouted = true; u.routT = B.t;
    u.order = 'rout'; u.fire = 'hold';
    for (const m of u.men) if (m.state === 'formed') { m.state = 'fleeing'; m.foe = null; m.m = m.role === 'line' ? 'loaded' : 'none'; }
    B.events.push({ type: 'rout', team: u.team, x: u.cx, y: u.cy });
    // the neighbours watch it happen
    for (const o of B.units) {
      if (o === u || o.team !== u.team || o.routed) continue;
      const d = dist(o.cx, o.cy, u.cx, u.cy);
      if (d < 150) o.morale -= 12 * (1 - d / 150);
    }
    Battle.log(B, `${u.name} ${u.team === TEAM_PLAYER ? 'breaks and runs!' : 'breaks and runs! ' + u.F.cry.replace(/!$/, '') + ' no more.'}`, u.team === TEAM_PLAYER ? 'bad' : 'good');
  },

  // a routed company comes back together around its leader
  unrout(B, u) {
    const L = u.isPlayer ? B.cmd : u.leader;
    if (!L || L.state !== 'formed') return false;
    // enough of them have to stop to make a stand, or they just keep going
    if (Morale.gathered(u, L) <= Math.max(2, u.startSize * 0.25)) return false;
    u.routed = false;
    let n = 0;
    for (const m of u.men) {
      if (m.state === 'fleeing' && dist2(m.x, m.y, L.x, L.y) < 70 * 70) { m.state = 'formed'; n++; }
    }
    u.order = 'hold'; u.fire = 'hold';
    u.morale = Math.max(u.morale, CFG.SHAKEN + 2);
    const face = u.team === TEAM_PLAYER ? -Math.PI / 2 : Math.PI / 2;
    Unit.survey(u);
    Unit.setForm(u, 'line', L.x + Math.cos(face) * 4, L.y + Math.sin(face) * 4, face);
    Battle.log(B, `${u.name} rallies — ${n} men back in the ranks.`, u.team === TEAM_PLAYER ? 'good' : 'bad');
    return true;
  },

  gathered(u, L) { return u.men.filter(m => m.state === 'fleeing' && m.role === 'line' && dist2(m.x, m.y, L.x, L.y) < 70 * 70).length; },

  // the player's "Rally!" — immediate, not relayed. Only works in person.
  rally(B) {
    const c = B.cmd;
    if (c.state !== 'formed') return false;
    if (B.t < (c.rallyCd || 0)) { Battle.log(B, `Your voice is gone — rally again in ${Math.ceil(c.rallyCd - B.t)}s.`, 'bad'); return false; }
    c.rallyCd = B.t + CFG.RALLY_COOLDOWN;
    let any = false, took = false, failed = null;
    for (const u of B.units) {
      if (u.team !== TEAM_PLAYER) continue;
      let near = dist2(c.x, c.y, u.cx, u.cy) < CFG.RALLY_RANGE * CFG.RALLY_RANGE * 2;
      if (!near) for (const m of u.men) if (m.state === 'fleeing' && dist2(m.x, m.y, c.x, c.y) < CFG.RALLY_RANGE * CFG.RALLY_RANGE) { near = true; break; }
      if (!near) continue;
      any = true;
      u.morale = clamp(u.morale + CFG.RALLY_BOOST * (u.isPlayer ? 1 : 0.6), 0, 100);
      if (u.routed) {
        if (u.morale >= CFG.RALLY_AT && Morale.unrout(B, u)) took = true;
        else failed = u;
      } else took = true;
    }
    B.fx.push({ kind: 'rally', x: c.x, y: c.y, t: B.t });
    if (!any) { Battle.log(B, 'Nobody near enough to hear you rally — get among them.', 'bad'); c.rallyCd = B.t + CFG.RALLY_RETRY; }
    else if (failed && !took) {
      // it did not take: say why, and let him try again soon
      const few = Morale.gathered(failed, c) <= Math.max(2, failed.startSize * 0.25);
      Battle.log(B, few ? `${failed.name}: too few of them near you to make a stand — get in front of the rest.`
        : `${failed.name} won't stop yet — stay among them and try again.`, 'bad');
      c.rallyCd = B.t + CFG.RALLY_RETRY;
    }
    return any;
  },
};

// ━━ COLOURS ━━ the company's flag. Lose it and the men feel it; take one and the army hears of it.
const Colours = {
  drop(B, carrier) {
    const u = carrier.unit;
    const owner = carrier.carrying ? carrier.carrying : u;
    if (carrier.carrying) carrier.carrying = null;
    B.dropped.push({ unit: owner, x: carrier.x, y: carrier.y, t: B.t });
    if (owner === u) { u.morale -= 5; Battle.log(B, `${u.name}: the colours are down!`, u.team === TEAM_PLAYER ? 'bad' : ''); }
  },
  step(B) {
    for (let i = B.dropped.length - 1; i >= 0; i--) {
      const d = B.dropped[i];
      if (B.t - d.t < 1.5) continue;
      let friend = null, foe = null;
      Move.near(B, d.x, d.y, 6, a => {
        if (a.state !== 'formed' || a.role === 'drummer' || a.role === 'fifer') return;
        if (a.team === d.unit.team) { if (a.unit === d.unit && (!friend || (a.grade === 'sgt' && friend.grade !== 'sgt'))) friend = a; }
        else if (!foe && dist2(a.x, a.y, d.x, d.y) < 6.25) foe = a;
      });
      if (friend && !foe) {
        friend.role = 'ensign'; friend.m = 'none'; friend.foe = null;
        d.unit.reslot = B.t + 0.5;
        B.dropped.splice(i, 1);
        Battle.log(B, `${d.unit.name}: a sergeant takes up the colours.`);
      } else if (foe) {
        B.dropped.splice(i, 1);
        d.unit.coloursLost = true;
        d.unit.morale -= CFG.COLOURS_LOST;
        if (foe === B.cmd) B.cmd.trophies = (B.cmd.trophies || 0) + 1;
        else { foe.carrying = d.unit; }
        if (foe.team === TEAM_PLAYER) B.stats.coloursTaken++; else B.stats.coloursLost++;
        B.events.push({ type: 'colours', team: foe.team });
        Battle.log(B, foe.team === TEAM_PLAYER ? `The ${d.unit.F.adj} colours are taken!` : `Our colours are lost — ${d.unit.name}!`, foe.team === TEAM_PLAYER ? 'good' : 'bad');
      }
    }
  },
};
