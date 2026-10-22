'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ORDERS — what a commander can say, and how it reaches the men.
//
//  Your voice carries CFG.VOICE_RANGE metres. Beyond that, an order only
//  arrives if your DRUMMER is alive to beat it — a couple of seconds
//  later. Lose the drummer and you must walk to your men to command them.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const ORDER_TEXT = {
  follow: 'Follow me!', line: 'Form line!', advance: 'Advance!', halt: 'Halt!',
  ready: 'Make ready!', fire: 'Present — FIRE!', atwill: 'Fire at will!', cease: 'Cease fire!',
  charge: 'Fix bayonets — CHARGE!', fallback: 'Fall back!', skirmish: 'Extend — skirmish order!',
  close: 'Close order!', screen: 'Skirmishers — cover the front!', rally: 'Rally! Rally on me!', detach: 'Sergeants — take your parties out!', recall: 'Sound the recall!', rejoin: 'Rejoin the company!',
  byrank: 'Fire by rank!', attackcol: 'Column of attack!', square: 'Form square! Prepare to receive cavalry!', ride: 'Trot!', retire: 'Retire! To the rear!', reform: 'Re-form! Re-form on the colours!',
};

// drills a company must LEARN (at camp) before it can be ordered to do them. AI companies know them all.
const LEARNED_DRILLS = {
  byrank: 'Fire by rank', attackcol: 'Column of attack', skirmish: 'Skirmish order',
};
const knowsDrill = (u, cmd) => !LEARNED_DRILLS[cmd] || !u.drills || u.drills.includes(cmd);

// what makes sense to say to horse and to guns (the wheel and the order bar hide the rest — the user:
// "remove the extra options which don't work when commanding cav")
const ARM_ORDERS = {
  cav: new Set(['follow', 'line', 'close', 'halt', 'charge', 'reform', 'retire', 'rally']),
  gun: new Set(['follow', 'line', 'close', 'halt', 'ready', 'fire', 'atwill', 'cease', 'retire']),
};
const armAllows = (u, cmd) => cmd === 'screen' ? !!u && u.arm === 'foot' && (u.isDetachment || u.attached === 'coy') : !u || !ARM_ORDERS[u.arm] || ARM_ORDERS[u.arm].has(cmd) || cmd === 'detach' || cmd === 'recall';

const Orders = {
  // the player shouts. Returns false if nobody could hear.
  shout(B, cmd, opts = {}) {
    const c = B.cmd, u = Detach.commanded(B);
    if (c.state !== 'formed') return false;
    B.fx.push({ kind: 'say', x: c.x, y: c.y, text: ORDER_TEXT[cmd] || cmd, t: B.t, team: 0 });
    B.events.push({ type: 'shout', order: cmd });
    if (cmd === 'rally') { Morale.rally(B); return true; }
    if (cmd === 'detach') return Detach.split(B);
    if (cmd === 'recall') { if (B.bugle) B.events.push({ type: 'bugle', x: c.x, y: c.y }); return Detach.recallAll(B); }
    // a party of yours: your voice, the bugle, or a runner
    if (!armAllows(u, cmd)) { if (cmd === 'screen') Battle.log(B, 'A screen is for a sergeant’s party or another company — pick one on the rail.', 'bad'); return false; }
    if (u.isDetachment || u.attached) return Orders.toParty(B, u, cmd, opts);
    if (!u || u.routed && cmd !== 'rally') { Battle.log(B, 'They are running — get among them and rally them (R).', 'bad'); return false; }
    if (!knowsDrill(u, cmd)) { Battle.log(B, `Your company has never learned ${LEARNED_DRILLS[cmd].toLowerCase()} — drill it in camp.`, 'bad'); return false; }
    const d = dist(c.x, c.y, u.cx, u.cy);
    const drum = Unit.hasRole(u, 'drummer');
    if (drum) B.events.push({ type: 'drumcall', order: cmd, unit: u.id });
    let delay;
    if (d <= CFG.VOICE_RANGE + (c.horse ? CFG.HORSE_VOICE : 0)) delay = CFG.VOICE_DELAY;
    else if (drum) delay = CFG.DRUM_DELAY;
    else { Battle.log(B, 'They cannot hear you — your drummer is down. Get closer.', 'bad'); return false; }
    // geometry is decided NOW, where you are standing, not when the drum finishes. (Advance is not: it goes
    // straight on, the way the company faces — it used to wheel them to whichever way you happened to face)
    if (cmd === 'line' || cmd === 'skirmish' || cmd === 'close' || cmd === 'attackcol') {
      const a = c.aim != null ? c.aim : c.facing;
      if (opts.x == null) { opts.x = c.x + Math.cos(a) * 5; opts.y = c.y + Math.sin(a) * 5; }
      if (opts.facing == null) opts.facing = a;
    }
    B.pending.push({ at: B.t + delay, unit: u, cmd, opts });
    return true;
  },

  toParty(B, u, cmd, opts) {
    const c = B.cmd;
    if (u.routed) { Battle.log(B, `${u.name} is running — get among them and rally them (R).`, 'bad'); return false; }
    if (!knowsDrill(u, cmd)) { Battle.log(B, `They have never learned ${LEARNED_DRILLS[cmd].toLowerCase()}.`, 'bad'); return false; }
    const d = dist(c.x, c.y, u.cx, u.cy), near = d <= CFG.VOICE_RANGE + (c.horse ? CFG.HORSE_VOICE : 0);
    // geometry: in earshot, where you point; otherwise where they stand, facing the way you face
    if (cmd === 'line' || cmd === 'skirmish' || cmd === 'close' || cmd === 'attackcol') {
      const placed = opts.x != null, a = c.aim != null ? c.aim : c.facing;
      if (!placed) { if (near) { opts.x = c.x + Math.cos(a) * 5; opts.y = c.y + Math.sin(a) * 5; } else { opts.x = u.cx; opts.y = u.cy; } }
      if (opts.facing == null) opts.facing = a;
      opts.placed = placed;
    }
    if (near) { B.pending.push({ at: B.t + CFG.VOICE_DELAY, unit: u, cmd, opts, you: true }); return true; }
    if (B.bugle && d <= CFG.BUGLE_RANGE && BUGLE_CALLS.has(cmd) && !opts.placed) {
      B.events.push({ type: 'bugle', x: c.x, y: c.y });
      B.pending.push({ at: B.t + CFG.BUGLE_DELAY, unit: u, cmd, opts, you: true });
      return true;
    }
    return Detach.runner(B, u, cmd, opts);
  },

  // AI officers: a short delay, no drum needed (they stand with their men)
  give(B, u, cmd, opts = {}) {
    if (Orders.inEffect(u, cmd) || B.pending.some(p => p.unit === u && p.cmd === cmd)) return;
    if (Unit.hasRole(u, 'drummer')) B.events.push({ type: 'drumcall', order: cmd, unit: u.id });
    B.pending.push({ at: B.t + 0.6, unit: u, cmd, opts });
    if (u.leader && u.leader.state === 'formed' && B.rng() < 0.6) B.fx.push({ kind: 'say', x: u.leader.x, y: u.leader.y, text: ORDER_TEXT[cmd] || cmd, t: B.t, team: u.team, foreign: u.team !== TEAM_PLAYER });
  },

  // is this order already what the company is doing? (so AI can repeat itself freely)
  inEffect(u, cmd) {
    switch (cmd) {
      case 'follow': return u.order === 'follow';
      case 'advance': return u.order === 'advance';
      case 'halt': return u.order === 'hold';
      case 'fallback': return u.order === 'fallback';
      case 'retire': return u.order === 'retire';
      case 'charge': return u.order === 'charge';
      case 'ready': return u.fire === 'ready';
      case 'atwill': return u.fire === 'atwill';
      case 'byrank': return u.fire === 'byrank';
      case 'attackcol': return u.form.kind === 'attack';
      case 'square': return u.form.kind === 'square' && u.order === 'hold';
      case 'cease': return u.fire === 'hold';
      case 'skirmish': return u.form.kind === 'skirmish' && u.order === 'hold';
      default: return false;
    }
  },

  deliver(B) {
    for (let i = B.pending.length - 1; i >= 0; i--) {
      const p = B.pending[i];
      if (B.t < p.at) continue;
      B.pending.splice(i, 1);
      if (p.unit.routed) continue;
      // another regiment's company does what you say, for a while; then its officer's judgement takes over again
      if (p.you && p.unit.attached === 'coy') p.unit.obeyUntil = B.t + (p.unit.temper === 'obedient' ? CFG.ALLY_OBEY_OBEDIENT : CFG.ALLY_OBEY);
      Orders.apply(B, p.unit, p.cmd, p.you ? Object.assign({}, p.opts, { you: true }) : p.opts);
    }
  },

  apply(B, u, cmd, o) {
    const f = u.form;
    // your own guns: they go where they are placed (limbering, moving, unlimbering) and choose their own targets;
    // "cease fire" holds them, any fire order lets them loose again; "follow me" brings them up beside you
    if (u.attached === 'guns') {
      const placeCmd = cmd === 'line' || cmd === 'advance' || cmd === 'close' || cmd === 'skirmish' || cmd === 'attackcol';
      if (placeCmd && o.x != null && o.placed) Artillery.moveTo(B, u, o.x, o.y, o.facing != null ? o.facing : f.facing);
      else if (cmd === 'rejoin' || cmd === 'follow') Artillery.moveTo(B, u, B.cmd.x - Math.cos(B.cmd.facing) * 10, B.cmd.y - Math.sin(B.cmd.facing) * 10, B.cmd.facing);
      else if (cmd === 'halt') Artillery.moveTo(B, u, u.cx, u.cy, f.facing);
      else if (cmd === 'cease') u.holdFire = true;
      else if (cmd === 'atwill' || cmd === 'fire' || cmd === 'ready' || cmd === 'byrank') u.holdFire = false;
      return;
    }
    // your own horse: a placing order is "ride there and wait"; "follow me" brings them up behind you
    if (u.attached === 'troop') {
      const placeCmd = cmd === 'line' || cmd === 'close' || cmd === 'skirmish' || cmd === 'attackcol' || cmd === 'advance';
      if ((placeCmd && o.x != null) || cmd === 'rejoin' || cmd === 'follow') {
        const back = cmd === 'rejoin' || cmd === 'follow';
        u.followCmd = back;
        const x = back ? B.cmd.x - Math.cos(B.cmd.facing) * 25 : o.x, y = back ? B.cmd.y - Math.sin(B.cmd.facing) * 25 : o.y;
        const face = back ? B.cmd.facing : (o.facing != null ? o.facing : f.facing);
        u.post = { x, y, facing: face };
        if (u.order === 'charge') Combat.endCharge(B, u);
        return Orders.apply(B, u, 'ride', { x, y, pace: CFG.CAV_TROT, facing: face });
      }
      if (cmd === 'square' || cmd === 'ready' || cmd === 'fire' || cmd === 'atwill' || cmd === 'byrank' || cmd === 'cease') return;
    }
    if (u.isDetachment && cmd !== 'rejoin') u.rejoining = false;
    // a dragged stroke said how wide (unit.js grid turns that into a depth)
    if (o && o.files && PLACE_KINDS[cmd]) u.frontage[PLACE_KINDS[cmd]] = o.files;
    if (u.followCmd && cmd !== 'follow') u.followCmd = false;
    // a screen stays out until it is told something else (firing orders do not count)
    if (u.screen && !['screen', 'ready', 'fire', 'atwill', 'cease', 'byrank'].includes(cmd)) u.screen = null;
    const toLine = (x, y, facing) => Unit.setForm(u, 'line', x, y, facing);
    switch (cmd) {
      case 'follow':
        if (!u.leader) return;
        // a party or another company: its own officer leads, after YOU (Detach.step walks him behind you)
        if (o.you && u.leader !== B.cmd && (u.isDetachment || u.attached)) { u.followCmd = true; u.rejoining = false; u.ai.dest = null; u.ai.route = []; }
        u.order = 'follow';
        u.trail = [{ x: u.leader.x, y: u.leader.y }, { x: u.cx, y: u.cy }];
        Unit.setForm(u, 'column', u.leader.x, u.leader.y, u.leader.facing);
        for (const m of u.men) { m.foe = null; }
        break;
      case 'line':
        u.order = 'hold';
        toLine(o.x, o.y, o.facing);
        break;
      case 'advance':
        // advancing toward somewhere else wheels the formation about its own centre first
        // (a column of attack stays a column of attack — that is the point of it)
        // (a square cannot march: it opens out into line first)
        if (f.kind === 'column' || f.kind === 'square') toLine(u.cx, u.cy, o.facing != null ? o.facing : f.facing);
        else if (o.facing != null && Math.abs(angDiff(f.facing, o.facing)) > 0.35) Unit.setForm(u, f.kind, u.cx, u.cy, o.facing);
        u.order = 'advance';
        break;
      case 'halt':
        if (u.order === 'charge') Combat.endCharge(B, u);
        u.order = 'hold';
        if (f.kind !== 'column') { f.x = lerp(f.x, u.cx, 0.5); f.y = lerp(f.y, u.cy, 0.5); }
        break;
      case 'fallback':
        if (f.kind === 'column' || f.kind === 'square') toLine(u.cx, u.cy, o.facing != null ? o.facing : f.facing);
        u.order = 'fallback';
        break;
      case 'ready': u.fire = 'ready'; break;
      case 'byrank':
        // yours: every order is one rank's volley (they wait presented for it); a fresh order starts at the front rank
        if (u.fire !== 'byrank') { u.rankTurn = 0; u.rankCalls = 0; u.rankNext = B.t + 1; }
        u.fire = 'byrank';
        if (Combat.manualRanks(B, u)) { u.rankCalls = Math.min(2, (u.rankCalls || 0) + 1); u.rankCallT = B.t; }
        break;
      case 'attackcol':
        u.order = 'hold';
        Unit.setForm(u, 'attack', o.x != null ? o.x : u.cx, o.y != null ? o.y : u.cy, o.facing != null ? o.facing : f.facing);
        break;
      case 'atwill': u.fire = 'atwill'; break;
      case 'cease': u.fire = 'hold'; for (const m of u.men) m.volleyAt = 0; break;
      case 'fire': {
        let n = 0;
        for (const m of u.men) if (m.state === 'formed' && m.m === 'present') { m.volleyAt = B.t + B.rng() * CFG.VOLLEY_RIPPLE; n++; }
        if (!n && u.isPlayer) Battle.log(B, 'Nobody is presented. Make ready (5) first — and they must be halted.', 'bad');
        if (u.fire === 'hold') u.fire = 'ready';
        break;
      }
      case 'reform': {
        // stop chasing, close up on the colours where they are, face the nearest enemy you can see
        if (u.order === 'charge') u.order = 'hold';
        for (const m of u.men) m.foe = null;
        const col = u.men.find(m => m.role === 'ensign' && m.state === 'formed');
        const x = col ? (col.x + u.cx) / 2 : u.cx, y = col ? (col.y + u.cy) / 2 : u.cy;
        let face = f.facing, bd = Infinity;
        for (const e of B.units) {
          if (e.team === u.team || e.routed || !e.formed || (u.team === TEAM_PLAYER && !B.seen[TEAM_PLAYER].has(e.id))) continue;
          const de = dist(x, y, e.cx, e.cy);
          if (de < bd) { bd = de; face = Math.atan2(e.cy - y, e.cx - x); }
        }
        u.order = 'hold';
        Unit.setForm(u, u.form.kind === 'skirmish' ? 'skirmish' : 'line', x, y, face);
        break;
      }
      case 'retire': {
        // about face and march for the line of retreat; can't fire, and every hit hurts like a flank
        if (u.order === 'charge') Combat.endCharge(B, u);
        if (f.kind === 'column' || f.kind === 'square') toLine(u.cx, u.cy, f.facing);
        const r = B.retreat;
        if (!r) break;
        u.order = 'retire'; u.fire = 'hold';
        u.retireRoute = AI.route(B, u.cx, u.cy, r.x, r.y);
        break;
      }
      case 'charge':
        u.order = 'charge'; u.chargeT = 0; u.lastFoe = B.t; u.fire = 'hold'; u.tested = [];
        u.chargeFrom = f.kind;
        if (f.kind === 'column' || f.kind === 'square') f.kind = 'line';
        B.events.push({ type: 'charge', team: u.team, unit: u.id });
        B.fx.push({ kind: 'say', x: u.cx, y: u.cy, text: u.F.cry, t: B.t, team: u.team, big: true });
        break;
      case 'skirmish':
        u.order = 'hold'; u.fire = 'atwill';
        Unit.setForm(u, 'skirmish', o.x != null ? o.x : u.cx, o.y != null ? o.y : u.cy, o.facing != null ? o.facing : f.facing);
        break;
      case 'square':
        // on the spot, around the company's middle; every face presents outward and fires at will
        u.order = 'hold';
        if (u.fire === 'hold' || u.fire === 'byrank') u.fire = 'ready';
        if (f.kind !== 'square') { u.squareT = B.t; u.squareMul = (CFG.SQUARE_FROM[f.kind] || 1) * (1 + 1.5 * (u.disorder || 0)); }
        Unit.setForm(u, 'square', u.cx, u.cy, o.facing != null ? o.facing : f.facing);
        break;
      case 'ride': {
        // horse: the whole squadron moves as a block toward a point, at a walk or a trot
        u.order = 'ride';
        u.ride = { x: o.x, y: o.y, pace: o.pace || CFG.CAV_TROT, face: o.facing };
        Unit.setForm(u, 'line', u.cx, u.cy, Math.atan2(o.y - u.cy, o.x - u.cx));
        break;
      }
      case 'rejoin': Detach.rejoin(B, u); break;
      case 'screen':
        u.screen = { back: false, t: 0 }; u.followCmd = false; u.rejoining = false;
        Detach.screenStep(B, u, true);
        break;
      case 'close':
        u.order = 'hold';
        toLine(o.x != null ? o.x : u.cx, o.y != null ? o.y : u.cy, o.facing != null ? o.facing : f.facing);
        break;
    }
  },
};
