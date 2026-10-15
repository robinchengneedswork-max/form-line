'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PLACE — drag out where the company should stand.
//    mouse   left-drag on the field: the company re-forms along the stroke
//            (same shape it is in now; a march column forms line)
//    touch   Form → Line / Skirmish / Column on the wheel, then drag the
//            stroke; a tap instead forms on the spot, facing where you held
//
//  The stroke gives the CENTRE (its midpoint) and the ALIGNMENT; the length
//  is only a gesture — frontage is what the men make it. The company faces
//  across the stroke toward the nearest enemy you can see, or, with none in
//  sight, away from you (an officer stands behind his line).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const PLACE_KINDS = { line: 'line', skirmish: 'skirmish', attackcol: 'attack' };

const Place = {
  cur: null,      // the stroke being drawn: { cmd, ax, ay, bx, by } in world metres
  armed: null,    // touch: a Form order waiting for its stroke { cmd, B }

  // what a stroke from a to b would make. Pure; no DOM.
  plan(B, cmd, ax, ay, bx, by) {
    const u = B.player, c = B.cmd;
    let x = (ax + bx) / 2, y = (ay + by) / 2;
    // the men will only re-form so far from where they stand
    const d = dist(x, y, u.cx, u.cy), clamped = d > CFG.PLACE_RANGE;
    if (clamped) { x = u.cx + (x - u.cx) * CFG.PLACE_RANGE / d; y = u.cy + (y - u.cy) * CFG.PLACE_RANGE / d; }
    x = clamp(x, 4, B.field.w - 4); y = clamp(y, 4, B.field.h - 4);
    const s = Math.atan2(by - ay, bx - ax);
    // which side of the stroke is the front?
    let tx = null, ty = null, best = Infinity;
    for (const e of B.units) {
      if (e.team === TEAM_PLAYER || e.routed || !B.seen[TEAM_PLAYER].has(e.id)) continue;
      const de = dist(x, y, e.cx, e.cy);
      if (de < best) { best = de; tx = e.cx; ty = e.cy; }
    }
    let sign;
    const nx = Math.cos(s - Math.PI / 2), ny = Math.sin(s - Math.PI / 2);
    if (tx != null) sign = (tx - x) * nx + (ty - y) * ny >= 0 ? 1 : -1;
    else { const k = (x - c.x) * nx + (y - c.y) * ny; sign = Math.abs(k) < 1 ? 1 : k > 0 ? 1 : -1; }
    const facing = sign > 0 ? s - Math.PI / 2 : s + Math.PI / 2;
    return { cmd, kind: PLACE_KINDS[cmd], x, y, facing, clamped, slots: Place.slots(u, PLACE_KINDS[cmd], x, y, facing) };
  },

  // where the men would stand (no skirmish jitter — it is a sketch)
  slots(u, kind, x, y, facing) {
    const n = Unit.lineMen(u).filter(m => m.state === 'formed').length;
    const { ranks, files, gap } = Unit.grid({ form: { kind }, ranks: u.ranks }, n);
    const fx = Math.cos(facing), fy = Math.sin(facing), rx = -fy, ry = fx, out = [];
    for (let i = 0; i < n; i++) {
      const rank = Math.floor(i / files), off = (i % files - (files - 1) / 2) * gap;
      out.push([x + rx * off - fx * rank * CFG.RANK_GAP, y + ry * off - fy * rank * CFG.RANK_GAP]);
    }
    return out;
  },

  // a stroke long enough to mean something (else it was a tap or a twitch)
  isStroke(p) { return dist(p.ax, p.ay, p.bx, p.by) >= CFG.PLACE_MIN; },

  commit(B, p) {
    const pl = Place.plan(B, p.cmd, p.ax, p.ay, p.bx, p.by);
    return Orders.shout(B, p.cmd, { x: pl.x, y: pl.y, facing: pl.facing });
  },

  // the order a left-drag gives: keep the shape the company is in
  dragCmd(u) {
    const k = u.form.kind;
    if (k === 'skirmish') return 'skirmish';
    if (k === 'attack') return 'attackcol';
    return 'line';
  },

  // browser only (Render): the ghost formation under your finger
  draw(g, B) {
    const W = Render.W;
    if (Place.armed && Place.armed.B === B && !Place.cur) {
      const label = (ORDER_TEXT[Place.armed.cmd] || '') + '  Drag where they stand · tap to form here';
      g.save(); g.font = '600 15px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const tw = g.measureText(label).width;
      g.fillStyle = 'rgba(20,16,10,0.8)'; g.fillRect(W / 2 - tw / 2 - 12, 58, tw + 24, 30);
      g.fillStyle = '#f1e8d2'; g.fillText(label, W / 2, 73);
      g.restore();
    }
    const p = Place.cur;
    if (!p || !Place.isStroke(p)) return;
    const pl = Place.plan(B, p.cmd, p.ax, p.ay, p.bx, p.by), z = Render.cam.zoom;
    g.save();
    const [ax, ay] = Render.toScreen(p.ax, p.ay), [bx, by] = Render.toScreen(p.bx, p.by);
    g.strokeStyle = 'rgba(241,232,210,0.5)'; g.lineWidth = 2; g.setLineDash([6, 6]);
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); g.setLineDash([]);
    g.fillStyle = pl.clamped ? 'rgba(240,140,80,0.75)' : 'rgba(230,190,90,0.8)';
    const r = Math.max(1.5, 0.35 * z);
    for (const [x, y] of pl.slots) { const [sx, sy] = Render.toScreen(x, y); g.beginPath(); g.arc(sx, sy, r, 0, 7); g.fill(); }
    // the arrow: which way they will face
    const [cx, cy] = Render.toScreen(pl.x, pl.y), L = Math.max(28, 7 * z);
    const hx = cx + Math.cos(pl.facing) * L, hy = cy + Math.sin(pl.facing) * L;
    g.strokeStyle = g.fillStyle; g.lineWidth = 3;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(hx, hy); g.stroke();
    g.beginPath(); g.moveTo(hx + Math.cos(pl.facing) * 9, hy + Math.sin(pl.facing) * 9);
    g.lineTo(hx + Math.cos(pl.facing + 2.4) * 9, hy + Math.sin(pl.facing + 2.4) * 9);
    g.lineTo(hx + Math.cos(pl.facing - 2.4) * 9, hy + Math.sin(pl.facing - 2.4) * 9); g.fill();
    if (pl.clamped) {
      g.font = '600 13px Georgia, serif'; g.textAlign = 'center'; g.fillStyle = '#f7d7b8';
      g.fillText(`They will not go further than ${CFG.PLACE_RANGE} m`, cx, cy - 18);
    }
    g.restore();
  },
};
