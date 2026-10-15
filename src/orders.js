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
  close: 'Close order!', rally: 'Rally! Rally on me!',
  byrank: 'Fire by rank!', attackcol: 'Column of attack!', retire: 'Retire! To the rear!', reform: 'Re-form! Re-form on the colours!',
};

// drills a company must LEARN (at camp) before it can be ordered to do them. AI companies know them all.
const LEARNED_DRILLS = {
  byrank: 'Fire by rank', attackcol: 'Column of attack', skirmish: 'Skirmish order',
};
const knowsDrill = (u, cmd) => !LEARNED_DRILLS[cmd] || !u.drills || u.drills.includes(cmd);

const Orders = {
  // the player shouts. Returns false if nobody could hear.
  shout(B, cmd, opts = {}) {
    const c = B.cmd, u = B.player;
    if (c.state !== 'formed') return false;
    B.fx.push({ kind: 'say', x: c.x, y: c.y, text: ORDER_TEXT[cmd] || cmd, t: B.t, team: 0 });
    B.events.push({ type: 'shout', order: cmd });
    if (cmd === 'rally') { Morale.rally(B); return true; }
    if (!u || u.routed && cmd !== 'rally') { Battle.log(B, 'They are running — get among them and rally them (R).', 'bad'); return false; }
    if (!knowsDrill(u, cmd)) { Battle.log(B, `Your company has never learned ${LEARNED_DRILLS[cmd].toLowerCase()} — drill it in camp.`, 'bad'); return false; }
    const d = dist(c.x, c.y, u.cx, u.cy);
    const drum = Unit.hasRole(u, 'drummer');
    if (drum) B.events.push({ type: 'drumcall', order: cmd, unit: u.id });
    let delay;
    if (d <= CFG.VOICE_RANGE) delay = CFG.VOICE_DELAY;
    else if (drum) delay = CFG.DRUM_DELAY;
    else { Battle.log(B, 'They cannot hear you — your drummer is down. Get closer.', 'bad'); return false; }
    // geometry is decided NOW, where you are standing, not when the drum finishes
    if (cmd === 'line' || cmd === 'advance' || cmd === 'skirmish' || cmd === 'close' || cmd === 'attackcol') {
      const a = c.aim != null ? c.aim : c.facing;
      if (opts.x == null) { opts.x = c.x + Math.cos(a) * 5; opts.y = c.y + Math.sin(a) * 5; }
      if (opts.facing == null) opts.facing = a;
    }
    B.pending.push({ at: B.t + delay, unit: u, cmd, opts });
    return true;
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
      if (!p.unit.routed) Orders.apply(B, p.unit, p.cmd, p.opts);
    }
  },

  apply(B, u, cmd, o) {
    const f = u.form;
    const toLine = (x, y, facing) => Unit.setForm(u, 'line', x, y, facing);
    switch (cmd) {
      case 'follow':
        if (!u.leader) return;
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
        if (f.kind === 'column') toLine(u.cx, u.cy, o.facing != null ? o.facing : f.facing);
        else if (o.facing != null && Math.abs(angDiff(f.facing, o.facing)) > 0.35) Unit.setForm(u, f.kind, u.cx, u.cy, o.facing);
        u.order = 'advance';
        break;
      case 'halt':
        if (u.order === 'charge') Combat.endCharge(B, u);
        u.order = 'hold';
        if (f.kind !== 'column') { f.x = lerp(f.x, u.cx, 0.5); f.y = lerp(f.y, u.cy, 0.5); }
        break;
      case 'fallback':
        if (f.kind === 'column') toLine(u.cx, u.cy, o.facing != null ? o.facing : f.facing);
        u.order = 'fallback';
        break;
      case 'ready': u.fire = 'ready'; break;
      case 'byrank': u.fire = 'byrank'; u.rankTurn = 0; u.rankNext = B.t + 1; break;
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
        if (f.kind === 'column') toLine(u.cx, u.cy, f.facing);
        const r = B.retreat;
        if (!r) break;
        u.order = 'retire'; u.fire = 'hold';
        u.retireRoute = AI.route(B, u.cx, u.cy, r.x, r.y);
        break;
      }
      case 'charge':
        u.order = 'charge'; u.chargeT = 0; u.lastFoe = B.t; u.fire = 'hold'; u.tested = [];
        u.chargeFrom = f.kind;
        if (f.kind === 'column') f.kind = 'line';
        B.events.push({ type: 'charge', team: u.team, unit: u.id });
        B.fx.push({ kind: 'say', x: u.cx, y: u.cy, text: u.F.cry, t: B.t, team: u.team, big: true });
        break;
      case 'skirmish':
        u.order = 'hold'; u.fire = 'atwill';
        Unit.setForm(u, 'skirmish', o.x != null ? o.x : u.cx, o.y != null ? o.y : u.cy, o.facing != null ? o.facing : f.facing);
        break;
      case 'close':
        u.order = 'hold';
        toLine(o.x != null ? o.x : u.cx, o.y != null ? o.y : u.cy, o.facing != null ? o.facing : f.facing);
        break;
    }
  },
};
