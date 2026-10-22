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
//    cavalry  — (horse only) hang about out of musket range, wait for a mark
//               — skirmishers, a line reloading or taken in flank, a square
//               still forming, anyone running — and go in; then ride back
//               and get the horses' wind. Foot form square when they come on.
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
      if (u.attached === 'troop' && !B.autoPlayer) { AI.troop(B, u); continue; }
      if ((u.isPlayer || u.commanded) && !B.autoPlayer) continue;
      // another regiment's company you have just given an order to: it carries it out before thinking for itself
      if (u.attached === 'coy' && (B.t < (u.obeyUntil || 0) || u.screen) && !B.autoPlayer) continue;
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
      if (e.arm === 'cav' && u.arm !== 'cav') s += 250;
      for (const f of B.units) if (f !== u && f.team === u.team && !f.routed && f.ai.target === e.id) s += 90;
      if (u.ai.target === e.id) s -= 30;
      if (s < bs) { bs = s; best = e; }
    }
    u.ai.target = best ? best.id : null;
    return best;
  },

  // the nearest seen enemy foot or guns (horse are the square's business)
  closestFoe(B, u) {
    let best = null, bd = Infinity;
    for (const e of B.units) {
      if (e.team === u.team || e.routed || !e.formed || e.arm === 'cav' || !B.seen[u.team].has(e.id)) continue;
      const d = dist(u.cx, u.cy, e.cx, e.cy);
      if (d < bd) { bd = d; best = e; }
    }
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
      const S = u.steadiedBy;
      if (S && !u.isPlayer && u.morale >= CFG.RALLY_AT) {
        // they fall in on the steady company: with their captain gone, a sergeant (or the steadiest man) takes charge
        if (!u.leader || u.leader.state !== 'formed') {
          const c = u.men.filter(m => m.state === 'fleeing' && m.role === 'line').sort((a, b) => (b.grade === 'sgt') - (a.grade === 'sgt') || dist2(a.x, a.y, S.cx, S.cy) - dist2(b.x, b.y, S.cx, S.cy))[0];
          if (c) { c.state = 'formed'; c.role = 'officer'; c.m = 'none'; u.leader = c; }
        }
        Morale.unrout(B, u);         // (it says so in the log)
        return;
      }
      if (u.morale >= CFG.RALLY_AT + CFG.RALLY_BOOST && !u.isPlayer && u.leader && u.leader.state === 'formed') Morale.unrout(B, u);
      return;
    }
    if (!u.formed || B.t < u.delay || u.order === 'charge') return;
    if (!u.leader && !u.isPlayer) AI.promote(B, u);
    if (u.arm === 'cav') return AI.cavalry(B, u);
    if (u.arm === 'gun') return AI.battery(B, u);
    Command.apply(u);
    if (u.attached === 'coy' && AI.escort(B, u)) return;

    // horse coming on and no wall or wood to stand in: form square, and stay in it while they are about
    const H = AI.cavThreat(B, u);
    if (H) {
      if (u.form.kind !== 'square' || u.order !== 'hold') { Orders.give(B, u, 'square', { facing: Math.atan2(H.cy - u.cy, H.cx - u.cx) }); return; }
      if (u.fire === 'hold' || u.fire === 'ready') Orders.give(B, u, 'atwill');
      return;
    }
    if (u.form.kind === 'square') {
      if (B.t - (u.ai.cavSeen || 0) < 8) return;
      Orders.give(B, u, 'line', { x: u.cx, y: u.cy, facing: u.ai.lastSeen ? Math.atan2(u.ai.lastSeen.y - u.cy, u.ai.lastSeen.x - u.cx) : u.form.facing });
      return;
    }

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
    if (colAtk && u.form.kind === 'attack' && d < 70 && u.inSlot > 0.4 && u.wind > CFG.AI_CHARGE_BREATH && Field.los(B.field, u.cx, u.cy, E.cx, E.cy)) {
      Orders.give(B, u, 'charge'); return;
    }

    // the bayonet
    const inRange = u.ai.inRangeT ? B.t - u.ai.inRangeT : 0;
    const keen = u.melee > 1 || u.temper === 'dashing' ? 1.25 : 1;
    // a garrison behind its wall does not leave it for the bayonet unless the enemy in front is already breaking
    const sallyOk = !(u.doctrine === 'hold' && AI.inCover(B, u)) || (E.morale < CFG.SHAKEN && d < 45);
    // no captain sends blown men in again: let them get their breath first
    if (sallyOk && u.form.kind !== 'column' && u.inSlot > 0.5 && u.morale > CFG.STEADY - 8 && u.wind > CFG.AI_CHARGE_BREATH &&
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
      // behind a crest and the enemy is in range of it: step up to where we can shoot (Wellington's way)
      else if (u.order === 'hold' && d < CFG.CREST_STEP_RANGE && !AI.inCover(B, u) && AI.stepUp(B, u, E, face)) return;
      else {
        // a holder faces and fires at the NEAREST enemy foot, not the spread-out target (that is for attackers
        // choosing whom to go for): at Quatre Bras a line wheeled off its bank toward a company 133 m off at
        // the oblique while a column walked straight up to 30 m outside its fire cone, unfired on
        const N = AI.closestFoe(B, u) || E, dn = dist(u.cx, u.cy, N.cx, N.cy);
        const fN = Math.atan2(N.cy - u.cy, N.cx - u.cx), offN = Math.abs(angDiff(u.form.facing, fN));
        // keep its ground (and its wall) unless the threat is well off its front
        if (offN > (AI.inCover(B, u) ? 0.9 : CFG.FIRE_CONE * 0.8) && dn < 260) Orders.give(B, u, 'line', { x: u.form.x, y: u.form.y, facing: fN });
        // against a column, hold the volley until it is close — then it breaks them;
        // a march column crossing in front of us (a bridge, a ford) is the best target there is
        else AI.shoot(B, u, dn, N.form.kind === 'attack' ? 60 : N.form.kind === 'column' ? 120 : u.drill > 0.5 ? 70 : 90);
      }
    } else if (u.doctrine === 'skirmish') {
      if (u.form.kind !== 'skirmish' || off > 0.7) Orders.give(B, u, 'skirmish', { x: u.cx, y: u.cy, facing: face });
      else if (d < 70) Orders.give(B, u, 'fallback');
      else if (d > 190) Orders.give(B, u, 'advance');
      else if (u.order !== 'hold') Orders.give(B, u, 'halt');
      else if (u.fire !== 'atwill') Orders.give(B, u, 'atwill');
    }
  },

  // seen horse close enough to come on: the nearest squadron within CAV_WARN that is not beaten or blown
  cavThreat(B, u) {
    if (u.arm === 'cav' || u.order === 'retire') return null;
    // a company in a wood, a village or behind a wall is safe from horse where it stands
    if (AI.inCover(B, u) || Field.typeAt(B.field, u.cx, u.cy) === T.WOODS) return null;
    // foot coming on with the bayonet this close is the danger that matters: forming square now is death
    // (at Hougoumont a company left its wall to form square for lancers charging someone else, 27 m from a column)
    if (B.units.some(e => e.team !== u.team && e.arm === 'foot' && !e.routed && e.formed && (e.order === 'charge' || e.order === 'advance') && dist(e.cx, e.cy, u.cx, u.cy) < CFG.CAV_FOOT_FIRST)) return null;
    let best = null, bd = CFG.CAV_WARN;
    for (const e of B.units) {
      if (e.team === u.team || e.arm !== 'cav' || e.routed || e.formed < 3 || !(B.seen[u.team].has(e.id) || B.heard[u.team].has(e.id))) continue;
      const d = dist(u.cx, u.cy, e.cx, e.cy);
      // a squadron hanging about out there is a worry, not a threat; one coming on, or close, is
      // only a charge actually coming on, or horse very close: forming square for every squadron that trotted
      // nearer meant the horse never had a chance (the user had "never seen a cav charge work")
      const coming = e.order === 'charge' && e.ai.target === u.id && dist(e.cx, e.cy, u.cx, u.cy) < CFG.CAV_LAUNCH + 40;
      if (d < bd && (coming || d < CFG.CAV_CLOSE)) { bd = d; best = e; }
    }
    if (best) u.ai.cavSeen = B.t;
    return best;
  },

  // how inviting a mark this company is for horse: ~0 for a formed square, >1 for men running
  cavMark(B, u, e) {
    if (e.arm === 'cav') return 0;
    if (e.routed) return 1.4;
    if (AI.inCover(B, e) || Field.typeAt(B.field, e.cx, e.cy) === T.WOODS || Field.typeAt(B.field, e.cx, e.cy) === T.ORCHARD) return 0.1;
    let s;
    if (e.form.kind === 'square') s = Combat.squareFormed(e, B) ? (e.morale < CFG.SHAKEN ? 0.75 : 0.05) : 1.2;
    else s = (e.form.kind === 'skirmish' ? 1.15 : e.form.kind === 'column' ? 1.05 : e.form.kind === 'attack' ? 0.65 : 0.55) + 0.5 * (e.disorder || 0);
    if (e.form.kind !== 'square') {
      // taken in the flank or the rear
      if (Math.abs(angDiff(e.form.facing, Math.atan2(u.cy - e.cy, u.cx - e.cx))) > Math.PI / 3) s += 0.45;
      // caught with their muskets empty
      const line = e.men.filter(m => m.role === 'line' && m.state === 'formed');
      const ready = line.filter(m => m.m === 'loaded' || m.m === 'present' || m.m === 'presenting').length / Math.max(1, line.length);
      s += ready < 0.35 ? 0.35 : ready > 0.75 ? -0.15 : 0;
    }
    s += e.morale < CFG.SHAKEN ? 0.4 : e.morale < CFG.STEADY ? 0.15 : 0;
    // busy in a firefight: to form square now is to be shot to pieces by the foot in front of them
    if (e.form.kind !== 'square' && B.units.some(o => o.team === u.team && o.arm === 'foot' && o.formed && !o.routed && dist(o.cx, o.cy, e.cx, e.cy) < CFG.CAV_BUSY)) s += 0.25;
    return s * (u.morale < CFG.STEADY ? 0.7 : 1);
  },

  // a squadron trots (or walks) somewhere as a block
  ride(B, u, x, y, pace, facing) {
    // horse ride straight, so round a house rather than into it (a squadron leaving the field once trotted
    // on the spot under the wall of Gemioncourt until nightfall). Path.find's first leg is clear by construction
    if (!Path.clear(B.field, u.cx, u.cy, x, y)) { const w = Path.find(B.field, u.cx, u.cy, x, y)[0]; if (w) { x = w.x; y = w.y; } }
    if (u.order === 'ride' && u.ride && dist2(u.ride.x, u.ride.y, x, y) < 400) return;
    if (u.order === 'hold' && dist2(u.form.x, u.form.y, x, y) < 100) return;
    Orders.apply(B, u, 'ride', { x, y, pace, facing });
  },

  cavalry(B, u) {
    const a = u.ai, edge = u.team === TEAM_ENEMY ? 4 : B.field.h - 4;
    if (!a.home) a.home = { x: u.form.x, y: u.form.y, facing: u.form.facing };
    // their own foot are beaten (or they are): the squadron covers the retreat and leaves the field
    const friends = B.units.some(o => o !== u && o.team === u.team && o.arm !== 'cav' && !Battle.out(o));
    if (!friends || u.morale < CFG.SHAKEN - 5) {
      AI.ride(B, u, u.cx, edge, CFG.CAV_TROT);
      if (Math.abs(u.cy - edge) < 25) for (const m of u.men) if (m.state === 'formed') { m.state = 'gone'; m.saved = true; }
      return;
    }
    // blown, or just back from a charge: draw off toward home a little way and get their wind
    if (u.wind < 0.55 || B.t < (a.restUntil || 0)) {
      if (!a.restAt) {
        const d = dist(u.cx, u.cy, a.home.x, a.home.y) || 1, k = Math.min(160, d) / d;
        a.restAt = { x: u.cx + (a.home.x - u.cx) * k, y: u.cy + (a.home.y - u.cy) * k };
      }
      if (dist(u.cx, u.cy, a.restAt.x, a.restAt.y) > 20) AI.ride(B, u, a.restAt.x, a.restAt.y, CFG.CAV_TROT * 0.7, a.home.facing);
      return;
    }
    a.restAt = null;
    // the best mark in sight
    let best = null, bs = 0, near = null, nd = Infinity;
    for (const e of B.units) {
      if (e.team === u.team || !B.seen[u.team].has(e.id) || e.arm === 'cav' || (!e.formed && !e.routed)) continue;
      const d = dist(u.cx, u.cy, e.cx, e.cy);
      if (!e.routed && d < nd) { nd = d; near = e; }
      if (d > CFG.CAV_SCOUT) continue;
      const s = AI.cavMark(B, u, e) * (1.15 - 0.4 * d / CFG.CAV_SCOUT);
      if (s > bs) { bs = s; best = e; }
    }
    if (best && bs > CFG.CAV_MARK) {
      const d = dist(u.cx, u.cy, best.cx, best.cy);
      // pick the mark quietly and close to charging distance at the trot; the trumpet sounds only when
      // they go in (it used to sound as soon as they chose you, 300 m off — half a minute to form square,
      // and the user had "never seen a cav charge work")
      a.target = best.id;
      if (d > CFG.CAV_LAUNCH) AI.ride(B, u, best.cx + (u.cx - best.cx) / d * (CFG.CAV_LAUNCH - 10), best.cy + (u.cy - best.cy) / d * (CFG.CAV_LAUNCH - 10), CFG.CAV_CANTER);
      else { if (u.order !== 'charge') AI.warn(B, u, best); Orders.give(B, u, 'charge'); }
      return;
    }
    a.target = null;
    // nothing worth the risk: hang about where they can see us, so they have to stand in square
    if (near) {
      const d = nd, hx = near.cx + (u.cx - near.cx) / d * CFG.CAV_HOVER, hy = near.cy + (u.cy - near.cy) / d * CFG.CAV_HOVER;
      if (dist(u.cx, u.cy, hx, hy) > 30) AI.ride(B, u, hx, hy, d > CFG.CAV_HOVER + 120 ? CFG.CAV_TROT : CFG.CAV_WALK, Math.atan2(near.cy - hy, near.cx - hx));
      return;
    }
    // nobody in sight: walk forward to look for them
    AI.ride(B, u, lerp(u.cx, B.field.w / 2, 0.3), u.team === TEAM_ENEMY ? Math.min(B.field.h * 0.55, u.cy + 80) : Math.max(B.field.h * 0.45, u.cy - 80), CFG.CAV_WALK);
  },

  // a battery lays its own guns (artillery.js); its captain only decides when the day is lost
  battery(B, u) {
    const friends = B.units.some(o => o !== u && o.team === u.team && o.arm === 'foot' && !Battle.out(o));
    if (friends) return;
    // limber up and away, leaving whatever cannot be dragged off
    for (const g of u.guns) if (!g.taken) { g.taken = true; g.takenBy = 1 - u.team; }
    for (const m of u.men) if (m.state === 'formed') { m.state = 'gone'; m.saved = true; }
    Battle.log(B, `${u.name} limbers up and leaves the field — abandoning the guns.`, u.team === TEAM_PLAYER ? 'bad' : 'good');
  },

  // the trumpet, and a shout down the line — so the player has a few seconds to form square
  warn(B, u, target) {
    B.events.push({ type: 'trumpet', x: u.cx, y: u.cy, unit: u.id });
    const seen = B.seen[TEAM_PLAYER].has(u.id), heard = B.heard[TEAM_PLAYER].has(u.id);
    if (target.team === TEAM_PLAYER && (seen || heard) && B.t > (B.cavWarnT || -99)) {
      B.cavWarnT = B.t + 15;
      const side = Math.abs(angDiff(-Math.PI / 2, Math.atan2(u.cy - target.cy, u.cx - target.cx)));
      const where = side < 0.6 ? 'to the front' : side > 2.5 ? 'in the rear' : u.cx < target.cx ? 'on the left' : 'on the right';
      Battle.log(B, target.isPlayer ? (seen ? `Cavalry! ${u.cav.short} ${where} — form square (E)!` : `Horses! You hear them ${where} — form square (E)!`) : `Cavalry ${where} of ${target.name}!`, 'bad');
      B.fx.push({ kind: 'say', x: target.cx, y: target.cy, text: 'Cavalry!', t: B.t, team: target.team, big: true });
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

  // the way there on the real ground: round houses, over a river only by a ford or a bridge (field.js Path).
  // (It used to aim at a named crossing ±30 m, which walked columns into the water wherever the
  // river bent or the bridge sat off the line — the user saw it at bridges.)
  route(B, x0, y0, x1, y1) {
    const r = Path.find(B.field, x0, y0, x1, y1);
    // a column must take a bridge or a ford square on, not cut across its corner: stand off it first
    const out = [];
    let px = x0, py = y0;
    for (const w of r) {
      const crossing = AI.crossingOn(B.field, px, py, w.x, w.y);
      if (crossing) {
        const ux = (w.x - px), uy = (w.y - py), L = Math.hypot(ux, uy) || 1;
        out.push({ x: crossing.x - ux / L * 14, y: crossing.y - uy / L * 14 });
      }
      out.push(w); px = w.x; py = w.y;
    }
    return out;
  },
  // the first ford or bridge cell on a leg (where the column meets the water), if any
  crossingOn(f, ax, ay, bx, by) {
    const d = dist(ax, ay, bx, by), n = Math.ceil(d / 2);
    for (let k = 1; k < n; k++) {
      const x = lerp(ax, bx, k / n), y = lerp(ay, by, k / n), t = Field.typeAt(f, x, y);
      if (t === T.BRIDGE || t === T.FORD) return k * 2 > 16 ? { x, y } : null;
    }
    return null;
  },

  // march to the post, then form line on it facing the way headquarters said. true = busy getting there
  toPost(B, u, E) {
    const a = u.anchor, far = dist(u.cx, u.cy, a.x, a.y);
    // a rearguard ordered back goes back, shot at or not, until it is there
    const t = u.task, falling = t && t.retire && !t.reached;
    if (falling && far <= 30) t.reached = true;
    // a garrison that sallied out of its wall goes back to it — in line, facing the enemy — unless the enemy is
    // already at the bayonet (at Hougoumont the company charged a breaking column and then stood in the orchard,
    // 30 m in front of its garden wall, until the lancers came: the old rule waited for nobody within 140 m)
    if (u.ai.postCover === undefined) u.ai.postCover = Field.coverFor(B.field, a.x, a.y, a.x + Math.cos(a.facing) * 60, a.y + Math.sin(a.facing) * 60) < 0.7;
    if (u.ai.postCover && far > 12 && !AI.inCover(B, u) && u.order !== 'charge' && (!E || dist(u.cx, u.cy, E.cx, E.cy) > 45)) {
      if (B.t > (u.ai.backT || 0)) { u.ai.backT = B.t + 6; Orders.give(B, u, 'line', { x: a.x, y: a.y, facing: a.facing }); }
      return true;
    }
    if (E && dist(u.cx, u.cy, E.cx, E.cy) < 140 && !falling) return false;
    if (far > 30) { AI.march(B, u, a.x, a.y); return true; }
    const L = u.leader || B.cmd;
    if (u.order === 'follow' && L && dist(L.x, L.y, a.x, a.y) < 12) { Orders.give(B, u, 'line', { x: a.x, y: a.y, facing: a.facing }); return true; }
    if (!E && (u.form.kind === 'column' || Math.abs(angDiff(u.form.facing, a.facing)) > 0.3)) { Orders.give(B, u, 'line', { x: a.x, y: a.y, facing: a.facing }); return true; }
    return false;
  },

  // the nearest spot ahead (within CREST_STEP of the post) from which the line can see its target
  stepUp(B, u, E, face) {
    const f = u.form;
    if (Field.los(B.field, f.x, f.y, E.cx, E.cy) || B.t < (u.ai.stepT || 0)) return false;
    u.ai.stepT = B.t + 6;
    const home = u.anchor || f, fx = Math.cos(face), fy = Math.sin(face);
    for (let k = 6; k <= CFG.CREST_STEP; k += 6) {
      const x = f.x + fx * k, y = f.y + fy * k;
      if (dist(x, y, home.x, home.y) > CFG.CREST_STEP) break;
      if (!Field.passable(B.field, x, y)) break;
      if (Field.los(B.field, x, y, E.cx, E.cy)) { Orders.give(B, u, 'line', { x, y, facing: face }); return true; }
    }
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

  // your own horse (bought): they wait where you put them and go in only when you call; after a charge
  // they come back to their post, at a walk, to get their wind
  troop(B, u) {
    if (u.routed || !u.formed || u.order === 'charge' || !u.post) return;
    // told to follow you: they keep coming after you, at a trot, a little way behind
    if (u.followCmd) {
      const c = B.cmd, x = c.x - Math.cos(c.facing) * 25, y = c.y - Math.sin(c.facing) * 25;
      u.post = { x, y, facing: c.facing };
      if (dist(u.cx, u.cy, x, y) > 22 && (u.order !== 'ride' || !u.ride || dist2(u.ride.x, u.ride.y, x, y) > 225)) Orders.apply(B, u, 'ride', { x, y, pace: CFG.CAV_TROT, facing: c.facing });
      u.followCmd = true;
      return;
    }
    if (u.order === 'ride') return;
    if (B.t - (u.chargeEnd || -99) > CFG.TROOP_RETURN && dist(u.cx, u.cy, u.post.x, u.post.y) > 25) Orders.apply(B, u, 'ride', { x: u.post.x, y: u.post.y, pace: CFG.CAV_WALK, facing: u.post.facing });
  },

  // another regiment's company that follows you (bought). With nothing in front of it, it keeps station on
  // your company — off your flank, or out ahead in skirmish order for riflemen — and marches when you march;
  // with the enemy close it fights its own fight (the usual doctrines below), but never far from that station.
  // true = busy getting there
  escort(B, u) {
    const P = B.player.routed || !B.player.formed ? null : B.player;
    const fx = P ? Math.cos(P.form.facing) : Math.cos(B.cmd.facing), fy = P ? Math.sin(P.form.facing) : Math.sin(B.cmd.facing);
    const ox = P ? P.cx : B.cmd.x, oy = P ? P.cy : B.cmd.y, face = Math.atan2(fy, fx);
    const ahead = u.doctrine === 'skirmish' ? 70 : 0, side = u.side * (u.doctrine === 'skirmish' ? 25 : CFG.ALLY_STATION);
    const st = Builder.open(B.field, { x: clamp(ox + fx * ahead - fy * side, 10, B.field.w - 10), y: clamp(oy + fy * ahead + fx * side, 10, B.field.h - 10) });
    const E = AI.nearestEnemy(B, u), far = dist(u.cx, u.cy, st.x, st.y);
    const fight = E && dist(u.cx, u.cy, E.cx, E.cy) < 240;
    if (fight && far < CFG.ALLY_LEASH) return false;
    if (far > 45) { AI.march(B, u, st.x, st.y); return true; }
    if (fight) return false;
    // there: form up facing the way your company faces (and keep up with it when it moves)
    const kind = u.doctrine === 'skirmish' ? 'skirmish' : 'line';
    if (u.form.kind !== kind || Math.abs(angDiff(u.form.facing, face)) > 0.4 || dist(u.form.x, u.form.y, st.x, st.y) > 18) Orders.give(B, u, kind, { x: st.x, y: st.y, facing: face });
    return true;
  },

  // the headless autoplayer drives YOUR commander's legs too
  cmdRoute(B) {
    const u = B.player, c = B.cmd;
    if (!B.autoPlayer || !u) return;
    // the company has halted or deployed: stop leading (he once walked on alone into a French column)
    // and take post a few paces behind the centre of the line
    if (u.order !== 'follow' && !B.pending.some(p => p.cmd === 'follow')) {
      if (u.ai.cmdRoute) { u.ai.cmdRoute = false; u.ai.route = null; c.dest = null; }
      // his men have broken: go back with them (they run for the road) rather than stand alone where the line was
      if (u.routed) { if (!c.dest) c.dest = { x: B.retreat.x, y: B.retreat.y }; return; }
      const bx = u.cx - Math.cos(u.form.facing) * 6, by = u.cy - Math.sin(u.form.facing) * 6;
      if (u.formed && !c.dest && dist(c.x, c.y, bx, by) > 14) c.dest = { x: bx, y: by };
      return;
    }
    if (!u.ai.cmdRoute) return;
    if (!c.dest && u.ai.route && u.ai.route.length) c.dest = u.ai.route.shift();
  },
};
