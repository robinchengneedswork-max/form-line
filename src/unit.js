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
// the band: they do not fight, and are not counted among the fallen of the enemy
const isMusician = m => m.role === 'drummer' || m.role === 'fifer' || m.role === 'piper';

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
    horse: unit.arm === 'cav' ? HORSE_COATS[Math.floor(rng() * HORSE_COATS.length)] : null,
  };
}

function makeUnit(spec, rng) {
  const F = FACTIONS[spec.faction];
  // company type: Light / Grenadier / Line. The player's comes from the campaign; others from their name
  const name = spec.name || rng.pick(F.companies);
  const ctype = spec.ctype || (/Voltigeur|Light/i.test(name) ? 'light' : /Grenad/i.test(name) ? 'grenadier' : null);
  // what the company is good at: an AI company has one type; yours can have bought several (Campaign.TRAITS)
  const traits = Object.assign(ctype ? { [ctype]: true } : {}, spec.traits || {});
  // a squadron of horse: troopers in two loose ranks, a trumpeter, no colours, no muskets
  const cav = spec.arm === 'cav' ? CAV_TYPES[spec.cavType || 'chasseurs'] : null;
  const gun = spec.arm === 'gun';
  const u = {
    id: NEXT_ID++, team: spec.team, faction: spec.faction,
    F: cav ? Object.assign({}, F, { coat: cav.coat, facings: cav.facings, hat: cav.hat }) : gun ? Object.assign({}, F, F.gunners) : F, ctype, traits,
    arm: cav ? 'cav' : gun ? 'gun' : 'foot', cav,
    melee: cav ? F.meleeSkill * cav.melee : gun ? 0.6 : F.meleeSkill * (traits.grenadier ? 1.2 : 1),
    name: cav && !spec.name ? rng.pick(cav.names) : gun && !spec.name ? rng.pick(F.batteries) : name, isPlayer: !!spec.isPlayer,
    men: [], leader: null,
    form: { kind: gun ? 'battery' : 'line', x: spec.x, y: spec.y, facing: spec.facing },
    ranks: cav ? 2 : F.ranks,
    order: 'hold', fire: 'hold', volleyAt: -1,
    drill: spec.drill, nerveBonus: (spec.nerve || 0) + F.nerve + (traits.grenadier ? 6 : 0) + (cav ? cav.nerve : 0) + (gun ? 6 : 0),
    drills: spec.drills || null,   // null = knows every drill (AI companies)
    morale: CFG.MORALE_BASE + (spec.nerve || 0), startSize: 0,
    routed: false, everRouted: false,
    doctrine: spec.doctrine || 'hold', objective: spec.objective || null, delay: spec.delay || 0,
    task: spec.task || null, taskApplied: null, anchor: null, arriveText: spec.arriveText || null,
    trail: [], slotOrder: [], reslot: 0,
    frontage: {},                 // files you drew for a formation (place.js), by kind; none = the drill-book default
    lossLog: [], lastHit: -99, flanked: 0, beingCharged: 0, chargeT: 0,
    colours: null, coloursLost: false, wind: 1, hasColours: spec.colours !== false && !cav && !gun,
    rallyCd: 0, ai: { next: 0, phase: 'deploy', route: null },
    cx: spec.x, cy: spec.y, formed: 0, visible: spec.team === TEAM_PLAYER,
    lastSeen: null, stats: { shots: 0, hits: 0, down: 0, fled: 0 },
  };
  // a battery: its pieces in a row across the front, and five gunners to each
  if (gun) {
    const k = spec.guns || 2, rx = -Math.sin(spec.facing), ry = Math.cos(spec.facing);
    u.guns = [];
    for (let i = 0; i < k; i++) {
      const off = (i - (k - 1) / 2) * CFG.GUN_GAP;
      // (the first round goes off once the gunners have found the range)
      u.guns.push({ i, x: spec.x + rx * off, y: spec.y + ry * off, facing: spec.facing, m: 'reloading', mt: 8 + i * 5, taken: false, target: null });
    }
    spec.size = k * CFG.GUN_CREW;
  }
  const roster = spec.roster || [];
  const n = spec.roster ? roster.length : spec.size;
  for (let i = 0; i < n; i++) u.men.push(makeMan(u, 'line', Object.assign({}, roster[i] || {}, cav ? { weapon: cav.weapon } : {}), rng));
  if (cav || gun) for (const m of u.men) { m.m = 'none'; if (gun) m.weapon = 'rammer'; }
  if (u.hasColours) u.men.push(makeMan(u, 'ensign', { name: 'Ensign' }, rng));
  if (spec.drummer && !gun) u.men.push(makeMan(u, 'drummer', { name: cav ? 'Trumpeter' : 'Drummer' }, rng));
  if (spec.fifer && !cav && !gun) u.men.push(makeMan(u, 'fifer', { name: 'Fifer' }, rng));
  if (spec.piper && !cav && !gun) u.men.push(makeMan(u, 'piper', { name: 'Piper' }, rng));
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
  bandPlaying: u => Unit.hasRole(u, 'drummer') || Unit.hasRole(u, 'fifer') || Unit.hasRole(u, 'piper'),
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
    if (f.kind === 'battery') {
      const live = u.guns.filter(g => !g.taken);
      men.sort((a, b) => (a.gun ? a.gun.i : 0) - (b.gun ? b.gun.i : 0));
      if (live.length) men.forEach((m, i) => { if (!m.gun || m.gun.taken) m.gun = null; });
      const per = new Map(live.map(g => [g, men.filter(m => m.gun === g).length]));
      for (const m of men) {
        if (m.gun || !live.length) continue;
        let g = live[0];
        for (const h of live) if (per.get(h) < per.get(g)) g = h;
        m.gun = g; per.set(g, per.get(g) + 1);
      }
      u.slotOrder = men;
      return;
    }
    if (f.kind === 'square') {
      const free = men.slice(), order = [];
      for (let i = 0; i < men.length; i++) {
        const p = Unit.squareSlot(u, i, men.length);
        let bi = 0, bd = Infinity;
        free.forEach((m, j) => { const d = dist2(m.x, m.y, p.x, p.y); if (d < bd) { bd = d; bi = j; } });
        order.push(free.splice(bi, 1)[0]);
      }
      u.slotOrder = order;
      return;
    }
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
  // A dragged stroke sets the frontage (u.frontage[kind] = files wanted); the depth follows from it
  grid(u, n) {
    const k = u.form.kind, want = u.frontage && u.frontage[k];
    const fit = (lo, hi, dflt) => Math.max(1, Math.min(n, want ? clamp(want, lo, hi) : dflt));
    if (k === 'skirmish') { const files = fit(Math.ceil(n / 2), n, n); return { ranks: Math.ceil(n / files), files, gap: CFG.SKIRMISH_GAP }; }
    if (k === 'attack') { const files = fit(4, 12, Math.min(CFG.ATTACK_FILES, n)); return { ranks: Math.ceil(n / files), files, gap: CFG.FILE_GAP }; }
    if (k === 'square') return { ranks: 2, files: Math.max(1, Math.ceil(n / 8)), gap: CFG.FILE_GAP };
    const files = u.arm === 'foot' ? fit(Math.ceil(n / (u.ranks + CFG.LINE_DEEP)), Math.ceil(n / u.ranks), Math.ceil(n / u.ranks)) : Math.max(1, Math.ceil(n / u.ranks));
    return { ranks: Math.ceil(n / files), files, gap: u.arm === 'cav' ? CFG.CAV_FILE_GAP : CFG.FILE_GAP };
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
        const d = m.role === 'ensign' ? 4.6 : 2.6, lat = m.role === 'drummer' ? 1.2 : m.role === 'fifer' || m.role === 'piper' ? -1.2 : 0;
        const p = Unit.trailPoint(u, d);
        m.sx = p.x - Math.sin(p.dir) * lat; m.sy = p.y + Math.cos(p.dir) * lat; m.slotFacing = p.dir;
      }
      return;
    }
    if (f.kind === 'battery') {
      // each crew stands in a fan behind and beside its piece; the officer behind the middle
      const seen = new Map();
      for (const m of men) {
        const g = m.gun;
        if (!g) { m.sx = f.x - fx * 6; m.sy = f.y - fy * 6; m.slotFacing = f.facing; continue; }
        const k = seen.get(g) || 0; seen.set(g, k + 1);
        const gx = Math.cos(g.facing), gy = Math.sin(g.facing);
        const spots = [[-0.6, 2.4], [-0.6, -2.4], [-4.4, 1.6], [-4.4, -1.6], [-6.4, 0], [-2.8, 3.4], [-2.8, -3.4]];
        const [b, l] = spots[k % spots.length];
        m.sx = g.x + gx * b - gy * l; m.sy = g.y + gy * b + gx * l; m.slotFacing = g.facing; m.rank = 0;
      }
      for (const m of u.men) {
        if (m.state !== 'formed' || m.role === 'line') continue;
        m.sx = f.x - fx * 8; m.sy = f.y - fy * 8; m.slotFacing = f.facing;
      }
      return;
    }
    if (f.kind === 'square') {
      men.forEach((m, i) => { const p = Unit.squareSlot(u, i, n); m.sx = p.x; m.sy = p.y; m.rank = p.rank; m.slotFacing = p.dir; });
      // colours, drum, fife and the captain in the hollow middle
      for (const m of u.men) {
        if (m.state !== 'formed' || m.role === 'line') continue;
        const lat = m.role === 'drummer' ? 1.2 : m.role === 'fifer' ? -1.2 : 0, b = m.role === 'officer' ? 1.4 : 0;
        m.sx = f.x + rx * lat - fx * b; m.sy = f.y + ry * lat - fy * b; m.slotFacing = f.facing;
      }
      return;
    }
    const { ranks, files, gap } = Unit.grid(u, n);
    // a skirmish line two deep stands in file pairs: the rear man a few paces back, covering the gap
    const loose = f.kind === 'skirmish';
    const rg = u.arm === 'cav' ? CFG.CAV_RANK_GAP : loose ? CFG.SKIRMISH_GAP * 0.8 : CFG.RANK_GAP;
    halfW = (files - 1) / 2 * gap;
    men.forEach((m, i) => {
      const rank = Math.floor(i / files), file = i % files;
      const off = (file - (files - 1) / 2 + (loose && rank % 2 ? 0.5 : 0)) * gap;
      let sx = f.x + rx * off - fx * rank * rg, sy = f.y + ry * off - fy * rank * rg;
      if (f.kind === 'skirmish') { sx += rx * m.jx + fx * m.jy * 2; sy += ry * m.jx + fy * m.jy * 2; }
      m.sx = sx; m.sy = sy; m.rank = rank; m.slotFacing = f.facing;
    });
    back = ranks * rg;
    for (const m of u.men) {
      if (m.state !== 'formed' || m.role === 'line') continue;
      let lat = 0, b = back + 0.3;
      if (m.role === 'drummer') { lat = 2.4; b = back + 1.8; }
      if (m.role === 'fifer') { lat = -2.4; b = back + 1.8; }
      if (m.role === 'piper') { lat = -0.6; b = back + 3.2; }
      if (m.role === 'officer') { lat = halfW + 2.2; b = 1.2; }
      m.sx = f.x + rx * lat - fx * b; m.sy = f.y + ry * lat - fy * b; m.slotFacing = f.facing;
    }
  },

  // the i-th of n places in a hollow square: four faces, two ranks, every man facing out
  squareSlot(u, i, n) {
    const f = u.form, face = i % 4, j = Math.floor(i / 4);
    const per = Math.ceil(n / 4), files = Math.max(1, Math.ceil(per / 2));
    const rank = Math.floor(j / files), file = j % files;
    const dir = f.facing + face * Math.PI / 2, ux = Math.cos(dir), uy = Math.sin(dir);
    const half = (files - 1) / 2 * CFG.FILE_GAP + CFG.RANK_GAP * 2 + 0.8;
    const out = half - rank * CFG.RANK_GAP, lat = (file - (files - 1) / 2) * CFG.FILE_GAP;
    return { x: f.x + ux * out - uy * lat, y: f.y + uy * out + ux * lat, dir, rank };
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
