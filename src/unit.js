'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  UNIT — a company: its men, its leader, and where each man should stand.
//
//  Every man has a SLOT. A formation (line / column / skirmish) is just a
//  rule for turning (centre, facing) — or the leader's trail, for a column —
//  into slot positions. Men walk to their slots on their own; the drill is
//  emergent, which is why a line visibly ripples when it crosses a hedge.
//
//  Column follows the leader's TRAIL (his footsteps), so a company told
//  "follow me" snakes through a ford behind you instead of cutting a corner
//  into the river.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let NEXT_ID = 1;

function makeMan(unit, role, spec, rng) {
  return {
    id: NEXT_ID++, unit, team: unit.team, role,
    name: spec.name || '', src: spec.src || null,
    aim: spec.aim != null ? spec.aim : clamp(1 + rng.gauss() * 0.13, 0.7, 1.35),
    nerve: spec.nerve != null ? spec.nerve : rng.gauss() * 6,
    xp: spec.xp || 0, kills: 0, grade: spec.rank || 'pte', weapon: spec.weapon || 'musket',
    x: 0, y: 0, facing: unit.form.facing, moving: 0,
    state: 'formed',            // formed · fleeing · down · gone
    m: role === 'line' ? 'loaded' : 'none', mt: 0,   // musket: loaded · presenting · present · reloading
    rank: 0, sx: 0, sy: 0, jx: rng.range(-1.2, 1.2), jy: rng.range(-1.5, 1.5),
    foe: null, downT: 0, wounded: false, carrying: null,
  };
}

function makeUnit(spec, rng) {
  const F = FACTIONS[spec.faction];
  // company type: Light / Grenadier / Line. The player's comes from the campaign; others from their name
  const name = spec.name || rng.pick(F.companies);
  const ctype = spec.ctype || (/Voltigeur|Light/i.test(name) ? 'light' : /Grenad/i.test(name) ? 'grenadier' : null);
  const u = {
    id: NEXT_ID++, team: spec.team, faction: spec.faction, F, ctype,
    melee: F.meleeSkill * (ctype === 'grenadier' ? 1.2 : 1),
    name, isPlayer: !!spec.isPlayer,
    men: [], leader: null,
    form: { kind: 'line', x: spec.x, y: spec.y, facing: spec.facing },
    ranks: F.ranks,
    order: 'hold', fire: 'hold', volleyAt: -1,
    drill: spec.drill, nerveBonus: (spec.nerve || 0) + F.nerve + (ctype === 'grenadier' ? 6 : 0),
    drills: spec.drills || null,   // null = knows every drill (AI companies)
    morale: CFG.MORALE_BASE + (spec.nerve || 0), startSize: 0,
    routed: false, everRouted: false,
    doctrine: spec.doctrine || 'hold', objective: spec.objective || null, delay: spec.delay || 0,
    task: spec.task || null, taskApplied: null, anchor: null,
    trail: [], slotOrder: [], reslot: 0,
    lossLog: [], lastHit: -99, flanked: 0, beingCharged: 0, chargeT: 0,
    colours: null, coloursLost: false, hasColours: spec.colours !== false,
    rallyCd: 0, ai: { next: 0, phase: 'deploy', route: null },
    cx: spec.x, cy: spec.y, formed: 0, visible: spec.team === TEAM_PLAYER,
    lastSeen: null, stats: { shots: 0, hits: 0, down: 0, fled: 0 },
  };
  const roster = spec.roster || [];
  const n = spec.roster ? roster.length : spec.size;
  for (let i = 0; i < n; i++) u.men.push(makeMan(u, 'line', roster[i] || {}, rng));
  if (u.hasColours) u.men.push(makeMan(u, 'ensign', { name: 'Ensign' }, rng));
  if (spec.drummer) u.men.push(makeMan(u, 'drummer', { name: 'Drummer' }, rng));
  if (spec.fifer) u.men.push(makeMan(u, 'fifer', { name: 'Fifer' }, rng));
  if (!spec.isPlayer) {
    const off = makeMan(u, 'officer', { name: F.name === 'French' ? 'Capitaine' : 'Captain', aim: 1 }, rng);
    u.men.push(off);
    u.leader = off;
  }
  u.startSize = u.men.filter(m => m.role === 'line').length;
  Unit.assignSlots(u);
  Unit.layout(u);
  for (const m of u.men) { m.x = m.sx; m.y = m.sy; }
  return u;
}

const Unit = {
  lineMen: u => u.men.filter(m => m.role === 'line' && m.state === 'formed'),
  alive: m => m.state === 'formed' || m.state === 'fleeing',
  hasRole: (u, role) => u.men.some(m => m.role === role && m.state === 'formed'),
  bandPlaying: u => Unit.hasRole(u, 'drummer') || Unit.hasRole(u, 'fifer'),
  moraleWord(u) {
    if (u.routed) return 'Routing';
    if (u.morale >= CFG.STEADY) return 'Steady';
    if (u.morale >= CFG.SHAKEN) return 'Shaken';
    return 'Wavering';
  },

  // Which man goes in which slot. Greedy by position so a re-forming company
  // shuffles sideways rather than crossing itself: sort men left→right, deal
  // them into files, and within a file put the man furthest forward in front.
  assignSlots(u) {
    const men = Unit.lineMen(u);
    const f = u.form, rx = Math.cos(f.facing + Math.PI / 2), ry = Math.sin(f.facing + Math.PI / 2);
    const fx = Math.cos(f.facing), fy = Math.sin(f.facing);
    if (f.kind === 'column') {   // nearest to the leader leads
      const L = u.leader || { x: f.x, y: f.y };
      men.sort((a, b) => dist2(a.x, a.y, L.x, L.y) - dist2(b.x, b.y, L.x, L.y));
      u.slotOrder = men;
      return;
    }
    const { ranks, files } = Unit.grid(u, men.length);
    men.sort((a, b) => (a.x * rx + a.y * ry) - (b.x * rx + b.y * ry));
    const order = new Array(men.length);
    let k = 0;
    for (let file = 0; file < files; file++) {
      const slots = [];
      for (let r = 0; r < ranks; r++) { const i = r * files + file; if (i < men.length) slots.push(i); }
      const group = men.slice(k, k + slots.length);
      k += slots.length;
      group.sort((a, b) => (b.x * fx + b.y * fy) - (a.x * fx + a.y * fy));
      slots.forEach((i, j) => { order[i] = group[j]; });
    }
    u.slotOrder = order.filter(Boolean);
  },

  // files × ranks for a block formation of n men
  grid(u, n) {
    const k = u.form.kind;
    if (k === 'skirmish') return { ranks: 1, files: Math.max(1, n), gap: CFG.SKIRMISH_GAP };
    if (k === 'attack') { const files = Math.max(1, Math.min(CFG.ATTACK_FILES, n)); return { ranks: Math.ceil(n / files), files, gap: CFG.FILE_GAP }; }
    return { ranks: u.ranks, files: Math.max(1, Math.ceil(n / u.ranks)), gap: CFG.FILE_GAP };
  },

  // slot positions from the current formation. Runs every tick (cheap).
  layout(u) {
    const f = u.form, men = u.slotOrder.filter(m => m.state === 'formed');
    const fx = Math.cos(f.facing), fy = Math.sin(f.facing), rx = -fy, ry = fx;
    const n = men.length;
    let back = 0, halfW = 0;
    if (f.kind === 'column') {
      const W = CFG.COLUMN_FILES;
      men.forEach((m, i) => {
        const row = Math.floor(i / W), file = i % W;
        const p = Unit.trailPoint(u, 6.5 + row * CFG.RANK_GAP);
        m.sx = p.x - Math.sin(p.dir) * (file - (W - 1) / 2) * CFG.FILE_GAP;
        m.sy = p.y + Math.cos(p.dir) * (file - (W - 1) / 2) * CFG.FILE_GAP;
        m.slotFacing = p.dir; m.rank = 0;
      });
      for (const m of u.men) {
        if (m.state !== 'formed' || m.role === 'line' || m.role === 'officer') continue;
        const d = m.role === 'ensign' ? 4.6 : 2.6, lat = m.role === 'drummer' ? 1.2 : m.role === 'fifer' ? -1.2 : 0;
        const p = Unit.trailPoint(u, d);
        m.sx = p.x - Math.sin(p.dir) * lat; m.sy = p.y + Math.cos(p.dir) * lat; m.slotFacing = p.dir;
      }
      return;
    }
    const { ranks, files, gap } = Unit.grid(u, n);
    halfW = (files - 1) / 2 * gap;
    men.forEach((m, i) => {
      const rank = Math.floor(i / files), file = i % files;
      const off = (file - (files - 1) / 2) * gap;
      let sx = f.x + rx * off - fx * rank * CFG.RANK_GAP, sy = f.y + ry * off - fy * rank * CFG.RANK_GAP;
      if (f.kind === 'skirmish') { sx += rx * m.jx + fx * m.jy * 2; sy += ry * m.jx + fy * m.jy * 2; }
      m.sx = sx; m.sy = sy; m.rank = rank; m.slotFacing = f.facing;
    });
    back = ranks * CFG.RANK_GAP;
    for (const m of u.men) {
      if (m.state !== 'formed' || m.role === 'line') continue;
      let lat = 0, b = back + 0.3;
      if (m.role === 'drummer') { lat = 2.4; b = back + 1.8; }
      if (m.role === 'fifer') { lat = -2.4; b = back + 1.8; }
      if (m.role === 'officer') { lat = halfW + 2.2; b = 1.2; }
      m.sx = f.x + rx * lat - fx * b; m.sy = f.y + ry * lat - fy * b; m.slotFacing = f.facing;
    }
  },

  // ── the leader's footsteps ──
  pushTrail(u, x, y) {
    const t = u.trail;
    if (!t.length || dist2(t[0].x, t[0].y, x, y) > 2.25) {
      t.unshift({ x, y });
      const need = 12 + Math.ceil(u.men.length / CFG.COLUMN_FILES) * CFG.RANK_GAP + 20;
      let len = 0;
      for (let i = 1; i < t.length; i++) {
        len += dist(t[i - 1].x, t[i - 1].y, t[i].x, t[i].y);
        if (len > need) { t.length = i + 1; break; }
      }
    }
    // (trailPoint measures from the leader's live position, so the newest footprint may lag him)
  },
  trailPoint(u, d) {
    const t = u.trail;
    const L = u.leader;
    let px = L ? L.x : u.form.x, py = L ? L.y : u.form.y, lastDir = null;
    for (let i = 0; i < t.length; i++) {
      const seg = dist(px, py, t[i].x, t[i].y);
      if (seg >= d && seg > 0.001) {
        const k = d / seg;
        return { x: px + (t[i].x - px) * k, y: py + (t[i].y - py) * k, dir: Math.atan2(py - t[i].y, px - t[i].x) };
      }
      d -= seg;
      if (seg > 0.001) { lastDir = Math.atan2(py - t[i].y, px - t[i].x); }
      px = t[i].x; py = t[i].y;
    }
    const dir = lastDir != null ? lastDir : (L ? L.facing : u.form.facing);
    return { x: px - Math.cos(dir) * d, y: py - Math.sin(dir) * d, dir };
  },

  // centroid + formed count, cached once per tick
  survey(u) {
    let sx = 0, sy = 0, n = 0, inSlot = 0;
    for (const m of u.men) {
      if (m.role !== 'line' || m.state !== 'formed') continue;
      sx += m.x; sy += m.y; n++;
      if (dist2(m.x, m.y, m.sx, m.sy) < CFG.SLOT_FORMED * CFG.SLOT_FORMED) inSlot++;
    }
    u.formed = n;
    u.inSlot = n ? inSlot / n : 0;
    if (n) { u.cx = sx / n; u.cy = sy / n; }
  },

  setForm(u, kind, x, y, facing) {
    u.form = { kind, x, y, facing };
    Unit.assignSlots(u);
  },
};
