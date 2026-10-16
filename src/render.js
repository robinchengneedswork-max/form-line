'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  RENDER — reads a Battle, draws it. World units are metres; the camera
//  turns them into pixels. Terrain is baked once per battle into an
//  offscreen image (hillshade + contours so a reverse slope is legible).
//  Men are drawn SPRITE× life size so a company reads as a company.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const SPRITE = 2.0;
const TERRAIN_PX = 3;            // baked terrain pixels per metre

const Render = {
  cv: null, g: null, W: 0, H: 0, dpr: 1,
  cam: { x: 360, y: 450, zoom: 5.5 },
  terrain: null, terrainFor: null, mini: null,

  init(canvas) {
    Render.cv = canvas; Render.g = canvas.getContext('2d');
    Render.resize();
  },
  resize() {
    const c = Render.cv;
    Render.dpr = window.devicePixelRatio || 1;
    Render.W = c.clientWidth; Render.H = c.clientHeight;
    c.width = Math.round(Render.W * Render.dpr); c.height = Math.round(Render.H * Render.dpr);
  },
  toScreen(x, y) { const c = Render.cam; return [(x - c.x) * c.zoom + Render.W / 2, (y - c.y) * c.zoom + Render.H / 2]; },
  toWorld(sx, sy) { const c = Render.cam; return [(sx - Render.W / 2) / c.zoom + c.x, (sy - Render.H / 2) / c.zoom + c.y]; },

  // ── terrain bake ──
  bake(B) {
    // phones get a lighter bake: 2 px/m is a quarter of the pixels of 3 and bakes in well under a second
    const f = B.field, P = Render.coarse() || f.w > 800 ? 2 : TERRAIN_PX, w = f.w * P, h = f.h * P;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
    const hh = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) hh[y * w + x] = Field.heightAt(f, (x + 0.5) / P, (y + 0.5) / P);
    const COL = {
      [T.GRASS]: [118, 138, 74], [T.WHEAT]: [196, 172, 92], [T.WOODS]: [64, 88, 48], [T.ROAD]: [178, 160, 120],
      [T.WATER]: [70, 108, 132], [T.FORD]: [118, 146, 150], [T.MARSH]: [104, 120, 82], [T.WALL]: [150, 146, 136],
      [T.BUILDING]: [148, 74, 54], [T.BRIDGE]: [132, 104, 72], [T.ORCHARD]: [108, 132, 66],
    };
    const rnd = makeRng(B.seed ^ 77);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, wx = (x + 0.5) / P, wy = (y + 0.5) / P;
      // dithered lookups soften the 4 m cell edges of fields and woods (never walls/houses/roads)
      let ty = Field.typeAt(f, wx, wy);
      const soft = t => t === T.GRASS || t === T.WHEAT || t === T.WOODS || t === T.MARSH || t === T.ORCHARD;
      if (soft(ty)) { const t2 = Field.typeAt(f, wx + (rnd() - 0.5) * 3, wy + (rnd() - 0.5) * 3); if (soft(t2)) ty = t2; }
      const base = COL[ty];
      const gx = (hh[i + (x < w - 1 ? 1 : 0)] - hh[i - (x > 0 ? 1 : 0)]), gy = (hh[i + (y < h - 1 ? w : 0)] - hh[i - (y > 0 ? w : 0)]);
      let shade = 1 + (-gx - gy) * 0.9;                       // light from the north-west
      shade = clamp(shade, 0.72, 1.25);
      let j = 1 + (rnd() - 0.5) * 0.06;
      if (ty === T.WHEAT) j *= (Math.floor(wy * 1.2) % 2 ? 1.04 : 0.95) * (f.rye ? 0.86 : 1);   // tall rye: deeper, darker
      if (ty === T.WALL) j *= 0.85 + rnd() * 0.3;
      if (ty === T.WATER) j *= 1 + Math.sin(wx * 0.9 + wy * 0.3) * 0.04;
      if (ty === T.BUILDING) {
        // roof: darker at the eaves where the next cell is not roof
        const edge = Field.typeAt(f, wx + 1.2, wy) !== T.BUILDING || Field.typeAt(f, wx - 1.2, wy) !== T.BUILDING ||
                     Field.typeAt(f, wx, wy + 1.2) !== T.BUILDING || Field.typeAt(f, wx, wy - 1.2) !== T.BUILDING;
        j *= edge ? 0.62 : (Math.floor(wy * 2) % 2 ? 1 : 0.92);
        shade = 1;
      }
      // contours every 2.5 m
      const band = Math.floor(hh[i] / 2.5);
      const contour = x < w - 1 && y < h - 1 && (Math.floor(hh[i + 1] / 2.5) !== band || Math.floor(hh[i + w] / 2.5) !== band);
      const k = shade * j * (contour && ty !== T.BUILDING ? 0.86 : 1);
      d[i * 4] = clamp(base[0] * k, 0, 255); d[i * 4 + 1] = clamp(base[1] * k, 0, 255); d[i * 4 + 2] = clamp(base[2] * k, 0, 255); d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // trees
    g.save(); g.scale(P, P);
    for (let r = 0; r < f.rows; r++) for (let cc = 0; cc < f.cols; cc++) {
      const ty = f.type[r * f.cols + cc];
      const x = (cc + 0.5) * CFG.CELL, y = (r + 0.5) * CFG.CELL;
      if (ty === T.WOODS && rnd() < 0.75) Render.tree(g, x + rnd.range(-2, 2), y + rnd.range(-2, 2), rnd.range(2.2, 3.6), rnd);
      if (ty === T.ORCHARD && cc % 2 === 0 && r % 2 === 0) Render.tree(g, x, y, 1.8, rnd, true);
    }
    g.restore();
    Render.terrain = c; Render.terrainFor = B;
    // minimap thumbnail
    // sized by the SHORT side of the screen (a phone on its side is 390 px tall), the field's own proportions
    // (it used to be 180 px tall whatever its width — squashed on phones)
    const m = document.createElement('canvas'); m.width = Math.round((Math.min(Render.W, Render.H) < 600 ? 120 : 180) * (f.w > 800 ? 1.15 : 1)); m.height = Math.round(m.width * f.h / f.w);
    m.getContext('2d').drawImage(c, 0, 0, m.width, m.height);
    Render.mini = m;
  },
  tree(g, x, y, r, rnd, small) {
    g.fillStyle = 'rgba(20,30,15,0.35)';
    g.beginPath(); g.arc(x + r * 0.25, y + r * 0.3, r, 0, 7); g.fill();
    g.fillStyle = small ? '#5f7d3a' : `rgb(${46 + rnd() * 20 | 0},${70 + rnd() * 25 | 0},${34 + rnd() * 12 | 0})`;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,220,0.10)';
    g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.5, 0, 7); g.fill();
  },

  // ── frame ──
  draw(B, ui) {
    if (Render.terrainFor !== B) Render.bake(B);
    Render.windA = B.wind.a;
    const g = Render.g, c = Render.cam, z = c.zoom;
    g.setTransform(Render.dpr, 0, 0, Render.dpr, 0, 0);
    g.fillStyle = '#3b4630'; g.fillRect(0, 0, Render.W, Render.H);
    g.save();
    g.translate(Render.W / 2, Render.H / 2); g.scale(z, z); g.translate(-c.x, -c.y);
    g.drawImage(Render.terrain, 0, 0, B.field.w, B.field.h);
    g.lineJoin = 'round'; g.lineCap = 'round';

    Render.helpers(B, g, ui);
    Render.objective(B, g);
    Render.retreat(B, g);
    const seen = B.seen[TEAM_PLAYER];
    for (const u of B.units) for (const m of u.men) if (m.state === 'down') Render.body(g, m);
    for (const d of B.dropped) Render.flag(g, d.x, d.y, d.unit, B.t, true);
    for (const u of B.units) if (u.guns && (u.team === TEAM_PLAYER || seen.has(u.id) || u.guns.some(p => p.taken))) for (const p of u.guns) Render.gun(g, p, u, B.t);
    for (const u of B.units) {
      const vis = u.team === TEAM_PLAYER || seen.has(u.id);
      if (!vis) continue;
      for (const m of u.men) if (m.state === 'formed' || m.state === 'fleeing') Render.man(g, m, u, B.t);
    }
    if (B.cmd.state !== 'down') Render.commander(g, B.cmd, B.t); else Render.body(g, Object.assign({ unit: B.player }, B.cmd));
    Render.flashes(g, B);
    Render.smoke(g, B);
    g.restore();
    if (B.weather) Render.rain(B, g);
    Render.overlay(B, ui);
  },

  helpers(B, g, ui) {
    const C = B.cmd, z = Render.cam.zoom;
    if (C.dest) {
      g.strokeStyle = 'rgba(255,240,200,0.5)'; g.lineWidth = 1.5 / z; g.setLineDash([4 / z, 4 / z]);
      g.beginPath(); g.moveTo(C.x, C.y); g.lineTo(C.dest.x, C.dest.y); g.stroke(); g.setLineDash([]);
      g.beginPath(); g.arc(C.dest.x, C.dest.y, 1.2, 0, 7); g.stroke();
    }
    // the unit you are commanding, if it is not the company: a ring round it
    const S = Detach.commanded(B);
    if (S !== B.player && S.formed) { g.strokeStyle = 'rgba(255,225,140,0.7)'; g.lineWidth = 2 / z; g.setLineDash([5 / z, 4 / z]); g.beginPath(); g.arc(S.cx, S.cy, 9 + S.formed * 0.3, 0, 7); g.stroke(); g.setLineDash([]); }
    // where "Form line" would put them: a ghost bar in front of you, facing the cursor
    const u = B.player;
    if (u && C.state === 'formed' && ui && ui.ghost) {
      const a = C.aim, n = Math.max(1, u.formed), files = Math.ceil(n / u.ranks), hw = (files - 1) / 2 * CFG.FILE_GAP;
      const cx = C.x + Math.cos(a) * 5, cy = C.y + Math.sin(a) * 5, rx = -Math.sin(a), ry = Math.cos(a);
      g.fillStyle = 'rgba(255,250,230,0.45)';
      for (let k = 0; k < files; k++) { const o = k * CFG.FILE_GAP - hw; g.beginPath(); g.arc(cx + rx * o, cy + ry * o, 0.28, 0, 7); g.fill(); }
      g.strokeStyle = 'rgba(255,250,230,0.45)'; g.lineWidth = 0.25;
      const tx = cx + Math.cos(a) * 4, ty = cy + Math.sin(a) * 4;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(tx, ty); g.moveTo(tx - Math.cos(a - 0.5), ty - Math.sin(a - 0.5)); g.lineTo(tx, ty); g.lineTo(tx - Math.cos(a + 0.5), ty - Math.sin(a + 0.5)); g.stroke();
    }
    // musket range when the company is ready to fire
    if (u && !u.routed && u.fire !== 'hold' && u.form.kind !== 'column') {
      const f = u.form;
      g.strokeStyle = 'rgba(255,230,180,0.18)'; g.lineWidth = 1.5 / z;
      g.beginPath(); g.arc(u.cx, u.cy, CFG.RANGE_ATWILL, f.facing - CFG.FIRE_CONE, f.facing + CFG.FIRE_CONE); g.stroke();
      g.beginPath(); g.arc(u.cx, u.cy, 80, f.facing - CFG.FIRE_CONE, f.facing + CFG.FIRE_CONE); g.stroke();
    }
  },

  // the line of retreat: a road sign on the ground
  retreat(B, g) {
    const r = B.retreat;
    if (!r) return;
    const z = Render.cam.zoom;
    g.strokeStyle = 'rgba(60,110,60,0.75)'; g.lineWidth = 2.5 / z; g.setLineDash([5 / z, 5 / z]);
    g.beginPath(); g.arc(r.x, r.y, r.r, 0, 7); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(60,110,60,0.08)'; g.fill();
    g.save(); g.translate(r.x, r.y); g.scale(1 / z, 1 / z);
    g.font = '600 13px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(30,50,30,0.85)'; g.fillText('\u21e3 ' + r.label, 0, 0);
    g.restore();
  },

  // where the colonel wants you: a gold ring and a pennant
  objective(B, g) {
    const t = B.player && B.player.task;
    if (!t) return;
    const z = Render.cam.zoom, pulse = 1 + Math.sin(B.t * 3) * 0.06;
    g.strokeStyle = 'rgba(232,190,80,0.85)'; g.lineWidth = 2.5 / z; g.setLineDash([8 / z, 6 / z]);
    g.beginPath(); g.arc(t.x, t.y, (t.kind === 'attack' ? 30 : 24) * pulse, 0, 7); g.stroke(); g.setLineDash([]);
    g.strokeStyle = '#3b2a18'; g.lineWidth = 2 / z;
    g.beginPath(); g.moveTo(t.x, t.y); g.lineTo(t.x, t.y - 9); g.stroke();
    g.fillStyle = '#e8be50'; g.beginPath(); g.moveTo(t.x, t.y - 9); g.lineTo(t.x + 6, t.y - 7.5); g.lineTo(t.x, t.y - 6); g.closePath(); g.fill();
    if (t.kind === 'hold' || t.kind === 'reserve') {
      const a = t.facing != null ? t.facing : -Math.PI / 2;
      g.strokeStyle = 'rgba(232,190,80,0.7)'; g.lineWidth = 2 / z;
      g.beginPath(); g.moveTo(t.x + Math.cos(a) * 26, t.y + Math.sin(a) * 26); g.lineTo(t.x + Math.cos(a) * 36, t.y + Math.sin(a) * 36); g.stroke();
    }
  },

  // a standing man, top-down. Local frame: +x is the way he faces.
  man(g, m, u, t) {
    if (m.horse) return Render.rider(g, m, u, t);
    const F = u.F, s = SPRITE;
    g.save(); g.translate(m.x, m.y); g.rotate(m.facing); g.scale(s, s);
    const flee = m.state === 'fleeing';
    // shadow
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.ellipse(0.08, 0.1, 0.3, 0.42, 0, 0, 7); g.fill();
    // a gunner's rammer
    if (m.weapon === 'rammer' && !flee) { g.strokeStyle = '#6b4a2a'; g.lineWidth = 0.07; g.beginPath(); g.moveTo(-0.5, 0.25); g.lineTo(0.9, 0.3); g.stroke(); }
    // musket (under the body when shouldered)
    else if (m.role === 'line' && !flee) {
      g.strokeStyle = '#4a3420'; g.lineWidth = 0.09;
      g.beginPath();
      if (m.m === 'present' || m.m === 'presenting') { g.moveTo(0.05, 0.12); g.lineTo(1.25, 0.06); }
      else if (u.order === 'charge') { g.moveTo(-0.1, 0.18); g.lineTo(1.15, 0.12); }
      else if (m.m === 'reloading') { g.moveTo(0.35, -0.05); g.lineTo(0.55, 0.15); }
      else { g.moveTo(0.18, -0.24); g.lineTo(-0.7, -0.26); }
      g.stroke();
      if (u.order === 'charge' || m.m === 'present') { g.strokeStyle = '#cfd3d6'; g.lineWidth = 0.05; g.beginPath(); g.moveTo(u.order === 'charge' ? 1.15 : 1.25, 0.08); g.lineTo(u.order === 'charge' ? 1.55 : 1.45, 0.08); g.stroke(); }
    }
    // body
    g.fillStyle = F.coat; g.beginPath(); g.ellipse(0, 0, 0.2, 0.34, 0, 0, 7); g.fill();
    g.strokeStyle = F.belts; g.lineWidth = 0.05;
    g.beginPath(); g.moveTo(-0.14, -0.25); g.lineTo(0.14, 0.25); g.moveTo(-0.14, 0.25); g.lineTo(0.14, -0.25); g.stroke();
    g.fillStyle = F.facings; g.beginPath(); g.ellipse(0, 0, 0.07, 0.34, 0, 0, 7); g.fill();
    // head + shako
    g.fillStyle = flee ? '#d9b89a' : F.hat;
    g.beginPath(); g.arc(0.02, 0, 0.15, 0, 7); g.fill();
    if (m.grade === 'sgt') { g.strokeStyle = '#a3192e'; g.lineWidth = 0.09; g.beginPath(); g.moveTo(-0.12, 0.26); g.lineTo(0.12, -0.26); g.stroke(); }   // the sergeant's crimson sash
    if (m.weapon === 'rifle') { g.fillStyle = '#2f5a2a'; g.beginPath(); g.arc(-0.05, 0, 0.07, 0, 7); g.fill(); }                                   // a green plume
    if (m.role === 'officer') { g.fillStyle = '#111'; g.beginPath(); g.ellipse(0.02, 0, 0.1, 0.3, 0, 0, 7); g.fill(); g.strokeStyle = '#a3192e'; g.lineWidth = 0.08; g.beginPath(); g.moveTo(-0.15, -0.25); g.lineTo(0.15, 0.25); g.stroke(); }
    if (m.role === 'drummer') {
      g.fillStyle = '#efe9d8'; g.beginPath(); g.arc(0.18, 0.3, 0.2, 0, 7); g.fill();
      g.strokeStyle = F.facings; g.lineWidth = 0.06; g.stroke();
    }
    if (m.role === 'fifer') { g.strokeStyle = '#2a1d10'; g.lineWidth = 0.05; g.beginPath(); g.moveTo(0.18, -0.1); g.lineTo(0.2, 0.42); g.stroke(); }
    if (m.carrying) { g.restore(); Render.flag(g, m.x, m.y, m.carrying, t, false, true); return; }
    g.restore();
    if (m.role === 'ensign' && m.state === 'formed') Render.flag(g, m.x, m.y, u, t);
  },

  // a trooper: the horse long under him, the rider on top, sabre or lance out when they charge
  rider(g, m, u, t) {
    const F = u.F, cv = u.cav || {}, s = SPRITE;
    const flee = m.state === 'fleeing', charging = u.order === 'charge' && !flee;
    const gait = m.moving > 4.5 ? Math.sin(t * 14 + m.id) * 0.05 : m.moving > 1 ? Math.sin(t * 8 + m.id) * 0.03 : 0;
    g.save(); g.translate(m.x, m.y); g.rotate(m.facing); g.scale(s, s);
    // shadow, horse, head and mane
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.ellipse(0.1, 0.12, 0.95, 0.4, 0, 0, 7); g.fill();
    g.fillStyle = m.horse; g.beginPath(); g.ellipse(gait, 0, 0.82, 0.3, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(0.88 + gait * 2, 0, 0.3, 0.14, 0, 0, 7); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(0.55 + gait, 0, 0.28, 0.05, 0, 0, 7); g.fill();
    g.strokeStyle = 'rgba(20,12,6,0.8)'; g.lineWidth = 0.07; g.beginPath(); g.moveTo(-0.78, 0); g.lineTo(-1.05, (m.jx || 0) * 0.08); g.stroke();   // tail
    // saddle cloth in the facings
    g.fillStyle = F.facings; g.beginPath(); g.ellipse(-0.12, 0, 0.26, 0.33, 0, 0, 7); g.fill();
    // weapon
    if (!flee) {
      if (cv.weapon === 'lance') {
        g.strokeStyle = '#6b4a2a'; g.lineWidth = 0.06; g.beginPath();
        if (charging) { g.moveTo(-0.5, 0.26); g.lineTo(2.1, 0.22); }
        g.stroke();
        if (charging) { g.fillStyle = '#c0262b'; g.beginPath(); g.moveTo(1.75, 0.22); g.lineTo(1.5, 0.14); g.lineTo(1.5, 0.3); g.fill(); g.fillStyle = '#f2efe6'; g.beginPath(); g.moveTo(1.5, 0.22); g.lineTo(1.3, 0.12); g.lineTo(1.3, 0.32); g.fill(); }
        else { g.strokeStyle = '#6b4a2a'; g.beginPath(); g.moveTo(-0.2, 0.3); g.lineTo(-0.2, -0.9); g.stroke(); g.fillStyle = '#c0262b'; g.fillRect(-0.2, -0.9, 0.3, 0.12); }
      } else {
        g.strokeStyle = '#d9dde0'; g.lineWidth = 0.05; g.beginPath();
        if (charging) { g.moveTo(0.05, 0.28); g.lineTo(1.05, 0.34); } else { g.moveTo(-0.05, 0.28); g.lineTo(-0.15, 0.9); }
        g.stroke();
      }
    }
    // rider: coat, cuirass, helmet
    g.fillStyle = F.coat; g.beginPath(); g.ellipse(-0.05, 0, 0.19, 0.3, 0, 0, 7); g.fill();
    if (cv.cuirass) { g.fillStyle = '#c9ced2'; g.beginPath(); g.ellipse(-0.03, 0, 0.13, 0.22, 0, 0, 7); g.fill(); }
    g.fillStyle = flee ? '#d9b89a' : F.hat; g.beginPath(); g.arc(-0.03, 0, 0.14, 0, 7); g.fill();
    if (cv.cuirass && !flee) { g.strokeStyle = '#111'; g.lineWidth = 0.06; g.beginPath(); g.moveTo(-0.03, 0); g.lineTo(-0.38, (m.jx || 0) * 0.06); g.stroke(); }   // horsehair mane
    if (m.role === 'drummer') { g.fillStyle = '#d8b440'; g.beginPath(); g.arc(0.15, -0.2, 0.09, 0, 7); g.fill(); }   // the trumpet
    if (m.role === 'officer') { g.strokeStyle = '#d8b440'; g.lineWidth = 0.07; g.beginPath(); g.moveTo(-0.17, -0.2); g.lineTo(0.1, 0.22); g.stroke(); }
    g.restore();
  },

  // a field gun: trail behind, two wheels, the bronze barrel; it jumps back when it fires
  gun(g, p, u, t) {
    const back = p.recoil != null && t - p.recoil < 0.6 ? (1 - (t - p.recoil) / 0.6) * 0.9 : 0;
    g.save(); g.translate(p.x - Math.cos(p.facing) * back, p.y - Math.sin(p.facing) * back); g.rotate(p.facing); g.scale(1.35, 1.35);
    if (p.taken) { g.globalAlpha = 0.75; g.rotate(0.25); }
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(-0.6, 0.2, 2.2, 0.9, 0, 0, 7); g.fill();
    g.strokeStyle = '#3d2b1a'; g.lineWidth = 0.45; g.beginPath(); g.moveTo(0, 0); g.lineTo(-3.2, 0); g.stroke();          // trail
    g.fillStyle = '#2a1d12';
    g.fillRect(-0.35, -1.05, 0.7, 0.28); g.fillRect(-0.35, 0.77, 0.7, 0.28);                                                    // wheels, side on
    g.strokeStyle = '#4a3420'; g.lineWidth = 0.18; g.beginPath(); g.moveTo(0, -0.9); g.lineTo(0, 0.9); g.stroke();            // axle
    g.strokeStyle = '#a07a3a'; g.lineWidth = 0.5; g.beginPath(); g.moveTo(-0.6, 0); g.lineTo(1.9, 0); g.stroke();              // barrel
    g.fillStyle = '#8a6630'; g.beginPath(); g.arc(1.95, 0, 0.3, 0, 7); g.fill();
    if (p.taken && p.takenBy === TEAM_PLAYER) { g.globalAlpha = 1; g.rotate(-0.25); g.fillStyle = '#b3202b'; g.fillRect(-1.6, -1.7, 0.7, 0.45); }
    g.restore();
  },

  commander(g, c, t) {
    const F = FACTIONS.british;
    if (c.horse) {
      // your horse under you
      g.save(); g.translate(c.x, c.y); g.rotate(c.facing); g.scale(SPRITE, SPRITE);
      const gait = c.moving > 4 ? Math.sin(t * 14) * 0.05 : c.moving > 1 ? Math.sin(t * 8) * 0.03 : 0;
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.ellipse(0.1, 0.12, 0.95, 0.4, 0, 0, 7); g.fill();
      g.fillStyle = c.horse; g.beginPath(); g.ellipse(gait, 0, 0.82, 0.3, 0, 0, 7); g.fill();
      g.beginPath(); g.ellipse(0.88 + gait * 2, 0, 0.3, 0.14, 0, 0, 7); g.fill();
      g.fillStyle = '#24306a'; g.beginPath(); g.ellipse(-0.12, 0, 0.26, 0.34, 0, 0, 7); g.fill();
      g.restore();
    }
    g.save(); g.translate(c.x, c.y); g.rotate(c.facing); g.scale(SPRITE * 1.15, SPRITE * 1.15);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(0.08, 0.1, 0.32, 0.44, 0, 0, 7); g.fill();
    g.strokeStyle = '#d9dde0'; g.lineWidth = 0.06; g.beginPath(); g.moveTo(0.1, 0.32); g.lineTo(0.95, 0.5); g.stroke();
    g.fillStyle = F.coat; g.beginPath(); g.ellipse(0, 0, 0.22, 0.36, 0, 0, 7); g.fill();
    g.fillStyle = '#d8b440'; g.beginPath(); g.arc(0, -0.3, 0.08, 0, 7); g.arc(0, 0.3, 0.08, 0, 7); g.fill();
    g.strokeStyle = '#a3192e'; g.lineWidth = 0.1; g.beginPath(); g.moveTo(-0.16, -0.26); g.lineTo(0.16, 0.26); g.stroke();
    g.fillStyle = '#111'; g.beginPath(); g.ellipse(0.02, 0, 0.11, 0.34, 0, 0, 7); g.fill();
    g.restore();
    // a ring so you can always find yourself
    g.strokeStyle = 'rgba(255,225,140,0.75)'; g.lineWidth = 0.18;
    g.beginPath(); g.arc(c.x, c.y, 1.25, 0, 7); g.stroke();
    if (c.trophies) Render.flag(g, c.x, c.y, { F: FACTIONS.french }, t, false, true);
  },

  body(g, m) {
    const u = m.unit, F = u ? u.F : FACTIONS.british;
    g.save(); g.translate(m.x, m.y); g.rotate((m.id * 2.399) % 6.28); g.scale(SPRITE, SPRITE);
    if (m.horse) {
      // a dead horse is the biggest thing on the field after the guns
      g.fillStyle = 'rgba(70,20,15,0.35)'; g.beginPath(); g.ellipse(0.2, 0.15, 0.9, 0.45, 0, 0, 7); g.fill();
      g.globalAlpha = 0.85;
      g.fillStyle = m.horse; g.beginPath(); g.ellipse(0, 0, 0.8, 0.34, 0, 0, 7); g.fill();
      g.beginPath(); g.ellipse(0.85, 0.25, 0.28, 0.13, 0.6, 0, 7); g.fill();
      g.fillStyle = F.coat; g.beginPath(); g.ellipse(-0.2, -0.55, 0.3, 0.15, 0.3, 0, 7); g.fill();
      g.restore();
      return;
    }
    g.fillStyle = 'rgba(70,20,15,0.35)'; g.beginPath(); g.ellipse(0.15, 0.1, 0.35, 0.3, 0, 0, 7); g.fill();
    g.globalAlpha = 0.8;
    g.fillStyle = F.coat; g.beginPath(); g.ellipse(0, 0, 0.42, 0.18, 0, 0, 7); g.fill();
    g.fillStyle = F.trousers; g.beginPath(); g.ellipse(-0.42, 0, 0.22, 0.13, 0, 0, 7); g.fill();
    g.fillStyle = '#c9a98a'; g.beginPath(); g.arc(0.42, 0, 0.12, 0, 7); g.fill();
    g.restore();
  },

  // colours, flying downwind from the pole
  flag(g, x, y, u, t, fallen, trophy) {
    const F = u.F, wa = Render.windA || 0;
    g.save(); g.translate(x, y);
    if (fallen) { g.rotate(0.6); g.globalAlpha = 0.85; }
    else g.rotate(wa);
    const W = 2.0, H = 1.5;
    g.strokeStyle = '#3b2a18'; g.lineWidth = 0.12;
    g.beginPath(); g.arc(0, 0, 0.12, 0, 7); g.stroke();
    // a wavy outline, then the pattern clipped inside it
    const wave = k => fallen ? 0 : Math.sin(t * 5 + k * 3) * 0.18 * k;
    g.beginPath(); g.moveTo(0, -H / 2);
    for (let k = 0; k <= 1.001; k += 0.2) g.lineTo(k * W, -H / 2 + wave(k));
    for (let k = 1; k >= -0.001; k -= 0.2) g.lineTo(k * W, H / 2 + wave(k));
    g.closePath();
    g.save(); g.clip();
    if (F.flag === 'union') {
      g.fillStyle = '#1d2f7a'; g.fillRect(0, -H, W, H * 2);
      const X = (c, w) => { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(0, -H / 2); g.lineTo(W, H / 2); g.moveTo(0, H / 2); g.lineTo(W, -H / 2); g.stroke(); };
      const P = (c, w) => { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(W / 2, -H); g.lineTo(W / 2, H); g.moveTo(0, 0); g.lineTo(W, 0); g.stroke(); };
      X('#fff', H * 0.2); X('#c8102e', H * 0.07); P('#fff', H * 0.32); P('#c8102e', H * 0.19);
    } else {
      g.fillStyle = '#1f3c94'; g.fillRect(0, -H, W / 3, H * 2);
      g.fillStyle = '#f4f1e8'; g.fillRect(W / 3, -H, W / 3, H * 2);
      g.fillStyle = '#c4202b'; g.fillRect(W * 2 / 3, -H, W / 3, H * 2);
    }
    g.restore();
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.05; g.stroke();
    if (F.flag === 'tricolore' && !fallen) { g.fillStyle = '#d8b440'; g.beginPath(); g.arc(0, 0, 0.25, 0, 7); g.fill(); }
    g.restore();
  },

  flashes(g, B) {
    for (const f of B.fx) {
      const age = B.t - f.t;
      if (f.kind === 'gunflash' && age < 0.2) {
        g.fillStyle = `rgba(255,215,130,${1 - age / 0.2})`;
        g.beginPath(); g.arc(f.x + Math.cos(f.a) * 1.2, f.y + Math.sin(f.a) * 1.2, 1.6 + Math.random() * 0.6, 0, 7); g.fill();
      } else if (f.kind === 'canister' && age < 0.25) {
        // the spray of a tin of balls
        g.strokeStyle = `rgba(255,235,190,${0.5 * (1 - age / 0.25)})`; g.lineWidth = 0.12;
        for (let k = -4; k <= 4; k++) { const a = f.a + k * CFG.CANISTER_SPREAD / 4; g.beginPath(); g.moveTo(f.x, f.y); g.lineTo(f.x + Math.cos(a) * f.r * (age / 0.25 + 0.3), f.y + Math.sin(a) * f.r * (age / 0.25 + 0.3)); g.stroke(); }
      } else if (f.kind === 'runner' && age < f.dur * (f.stop || 1)) {
        // your runner, a small red figure at the double
        const k = Math.min(age / f.dur, f.stop || 1), x = f.x0 + (f.x1 - f.x0) * k, y = f.y0 + (f.y1 - f.y0) * k;
        g.fillStyle = '#b3202b'; g.beginPath(); g.arc(x, y, 0.5, 0, 7); g.fill();
        g.strokeStyle = 'rgba(255,240,200,0.6)'; g.lineWidth = 0.15; g.setLineDash([0.6, 0.6]); g.beginPath(); g.moveTo(x, y); g.lineTo(f.x1, f.y1); g.stroke(); g.setLineDash([]);
      } else if (f.kind === 'ball' && age < f.dur + 0.6) {
        // the ball in flight, a spurt of earth where it grazes, and its skips beyond
        const L = Math.hypot(f.x1 - f.x0, f.y1 - f.y0), s = Math.min(L, age * CFG.BALL_SPEED), k = s / L;
        if (age < f.dur) {
          const bx = f.x0 + (f.x1 - f.x0) * k, by = f.y0 + (f.y1 - f.y0) * k;
          g.fillStyle = '#1a1a1a'; g.beginPath(); g.arc(bx, by, 0.35, 0, 7); g.fill();
          g.strokeStyle = 'rgba(30,30,30,0.25)'; g.lineWidth = 0.25; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx - (f.x1 - f.x0) / L * 6, by - (f.y1 - f.y0) / L * 6); g.stroke();
        }
        const gk = Math.hypot(f.gx - f.x0, f.gy - f.y0) / L;
        // once the ball has grazed, its furrow and skips stay in the ground for the rest of the day
        if (!f.scored && age >= gk * f.dur) { f.scored = true; Render.score(B, f); }
        for (let j = 0; j < 4; j++) {
          const at = gk + (1 - gk) * j / 4, when = at * f.dur, a2 = age - when;
          if (a2 < 0 || a2 > 0.6) continue;
          const px = f.x0 + (f.x1 - f.x0) * at, py = f.y0 + (f.y1 - f.y0) * at;
          g.fillStyle = `rgba(110,85,55,${0.6 * (1 - a2 / 0.6)})`; g.beginPath(); g.arc(px, py, 0.6 + a2 * 2.5, 0, 7); g.fill();
        }
      }
      if (f.kind !== 'flash') continue;
      if (age > 0.12) continue;
      g.fillStyle = `rgba(255,${200 + Math.random() * 50 | 0},120,${1 - age / 0.12})`;
      g.beginPath(); g.arc(f.x + Math.cos(f.a) * 0.4, f.y + Math.sin(f.a) * 0.4, (0.55 + Math.random() * 0.3) * (f.pan ? 0.45 : 1), 0, 7); g.fill();
    }
  },

  // a roundshot's track in the turf: a gouge where it first grazed, then shorter scuffs where it skipped
  score(B, f) {
    const c = Render.terrain; if (!c || Render.terrainFor !== B) return;
    const g = c.getContext('2d'), P = c.width / B.field.w;
    const L = Math.hypot(f.x1 - f.gx, f.y1 - f.gy); if (L < 1) return;
    const ux = (f.x1 - f.gx) / L, uy = (f.y1 - f.gy) / L, rnd = makeRng((f.t * 1000) | 0);
    g.save(); g.scale(P, P); g.lineCap = 'round';
    const mark = (s, len, w, a) => {
      const x = f.gx + ux * s, y = f.gy + uy * s, t = Field.typeAt(B.field, x, y);
      if (t === T.WATER || t === T.BUILDING || t === T.FORD) return;
      g.strokeStyle = `rgba(78,58,36,${a})`; g.lineWidth = w;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + ux * len, y + uy * len); g.stroke();
      // thrown-up earth either side
      g.fillStyle = `rgba(96,74,46,${a * 0.6})`;
      for (let k = 0; k < 4; k++) { const o = (rnd() - 0.5) * w * 3, along = rnd() * len; g.beginPath(); g.arc(x + ux * along - uy * o, y + uy * along + ux * o, 0.15 + rnd() * 0.2, 0, 7); g.fill(); }
    };
    mark(0, 3.2, 0.75, 0.6);
    for (const [k, len, w, a] of [[0.22, 2.2, 0.55, 0.45], [0.45, 1.6, 0.45, 0.35], [0.66, 1.1, 0.35, 0.28], [0.84, 0.7, 0.3, 0.2]]) mark(L * k, len, w, a);
    g.restore();
  },

  smoke(g, B) {
    for (const p of B.smoke) {
      const k = p.age / p.life, a = (1 - k) * (p.age < 0.4 ? p.age / 0.4 : 1);
      const sh = 225 + p.s * 25 | 0;
      g.fillStyle = `rgba(${sh},${sh},${sh - 5},${0.32 * a})`;
      g.beginPath(); g.arc(p.x, p.y, p.r * 1.15, 0, 7); g.fill();
      g.fillStyle = `rgba(${sh},${sh},${sh},${0.22 * a})`;
      g.beginPath(); g.arc(p.x - p.r * 0.25, p.y - p.r * 0.2, p.r * 0.7, 0, 7); g.fill();
    }
  },

  // a storm: grey veil and slanting streaks, blown the way the wind blows
  rain(B, g) {
    const W = Render.W, H = Render.H, wx = B.wind.x;
    if (B.weather.kind === 'mist') { g.fillStyle = 'rgba(214,218,222,0.3)'; g.fillRect(0, 0, W, H); return; }
    g.fillStyle = 'rgba(70,78,86,0.34)'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(215,225,235,0.42)'; g.lineWidth = 1.1;
    const n = Math.round(W * H / 2400), t = performance.now() / 1000;
    g.beginPath();
    for (let k = 0; k < n; k++) {
      const x = ((k * 97.3 + t * (60 + wx * 40)) % (W + 40)) - 20, y = ((k * 53.7 + t * 520 + (k % 7) * 31) % (H + 40)) - 20;
      g.moveTo(x, y); g.lineTo(x + 3 + wx * 4, y + 13);
    }
    g.stroke();
  },

  // ── screen-space: speech, labels, edge markers, minimap ──
  // Labels are kept few and short (the user, on a phone: "the ui is getting quite cumbersome"):
  //   yours      — only when there is news (not Steady), or the tag of a unit when you have several
  //   the enemy  — a short name ("17e Léger", "Cuirassiers"), and the state only when it is not Steady
  //   allies     — only when they waver or run, or when you are zoomed right in
  // and never on top of the HUD or another label. At most three arrows round the edge.
  overlay(B, ui) {
    const g = Render.g, W = Render.W, H = Render.H;
    g.font = '600 13px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'bottom';
    const seen = B.seen[TEAM_PLAYER], mine = Detach.mine(B), sel = Detach.commanded(B), many = mine.length > 1;
    const taken = Render.hudRects().slice(), edges = [];
    const free = (x0, y0, x1, y1) => !taken.some(r => x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]);
    // who gets a word, most important first
    const cands = [];
    for (const u of B.units) {
      if (Touch.wheel) break;              // the order wheel needs a clean background
      const vis = u.team === TEAM_PLAYER || seen.has(u.id);
      let [sx, sy] = Render.toScreen(u.cx, u.cy);
      if (!vis) {
        if (u.team === TEAM_ENEMY && u.lastSeen && B.t - u.lastSeen.t < 90) {
          [sx, sy] = Render.toScreen(u.lastSeen.x, u.lastSeen.y);
          cands.push({ u, sx, sy, text: '? last seen', pri: 5, ghost: true });
        }
        continue;
      }
      if (!u.formed && !u.routed) continue;
      const own = mine.includes(u), trouble = u.routed || u.morale < CFG.STEADY;
      const off = sx < 0 || sy < 0 || sx > W || sy > H;
      if (off) { if (u.team === TEAM_ENEMY || own) edges.push(u); continue; }
      let text = null, pri;
      if (own) {
        const tag = many ? (u === B.player ? 'Company' : u.name.replace(/’s party$/, '')) : '';
        text = [tag, trouble ? Unit.moraleWord(u) : ''].filter(Boolean).join(' · ') || null;
        pri = u === sel ? 0 : 1;
      } else if (u.team === TEAM_ENEMY) {
        text = Render.shortName(u) + (trouble ? ' · ' + Unit.moraleWord(u) : '');
        pri = 2 + dist(B.cmd.x, B.cmd.y, u.cx, u.cy) / 1000;
      } else if (trouble || Render.cam.zoom >= 4.5) {
        text = Render.shortName(u) + (trouble ? ' · ' + Unit.moraleWord(u) : ''); pri = trouble ? 1.5 : 4;
      }
      if (text) cands.push({ u, sx, sy: sy - 10 - u.ranks * CFG.RANK_GAP * Render.cam.zoom, text, pri, own });
    }
    cands.sort((a, b) => a.pri - b.pri);
    for (const c of cands) {
      const tw = g.measureText(c.text).width;
      c.sx = clamp(c.sx, tw / 2 + 8, W - tw / 2 - 8);       // never half off the edge
      const x0 = c.sx - tw / 2 - 6, y0 = c.sy - 17, x1 = c.sx + tw / 2 + 6, y1 = c.sy + 2;
      if (!free(x0, y0, x1, y1)) continue;
      taken.push([x0, y0, x1, y1]);
      if (c.ghost) { g.fillStyle = 'rgba(30,50,120,0.5)'; g.fillText(c.text, c.sx, c.sy); continue; }
      const u = c.u, col = u.routed ? '#f2c14e' : u.morale < CFG.SHAKEN ? '#f08a4b' : u.morale < CFG.STEADY ? '#f4e3b0' : '#ffffff';
      g.fillStyle = c.u === sel && c.own ? 'rgba(60,45,10,0.75)' : 'rgba(0,0,0,0.55)';
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
      g.fillStyle = u.team === TEAM_PLAYER ? col : (u.routed ? '#9fe08a' : '#b9c8ff');
      g.fillText(c.text, c.sx, c.sy);
    }
    // round the edge: your own units always, then the three nearest of the enemy
    const en = edges.filter(u => u.team === TEAM_ENEMY).sort((a, b) => dist(B.cmd.x, B.cmd.y, a.cx, a.cy) - dist(B.cmd.x, B.cmd.y, b.cx, b.cy)).slice(0, 3);
    Render._marks = [];
    for (const u of Touch.wheel ? [] : edges.filter(u => u.team === TEAM_PLAYER).concat(en)) {
      const [sx, sy] = Render.toScreen(u.cx, u.cy);
      Render.edgeMark(g, sx, sy, u);
    }
    // what people are shouting
    g.font = '600 14px Georgia, serif';
    for (const f of B.fx) {
      if (f.kind !== 'say') continue;
      const age = B.t - f.t;
      if (age > 2.6) continue;
      if (f.team !== TEAM_PLAYER && !Render.near(f.x, f.y)) continue;
      const [sx, sy] = Render.toScreen(f.x, f.y);
      g.globalAlpha = Math.min(1, (2.6 - age) * 1.5);
      g.font = f.big ? '700 18px Georgia, serif' : '600 14px Georgia, serif';
      const tw = g.measureText(f.text).width;
      const y = sy - 26 - age * 8;
      g.fillStyle = f.team === TEAM_PLAYER ? 'rgba(250,244,228,0.95)' : 'rgba(220,226,250,0.92)';
      g.fillRect(sx - tw / 2 - 7, y - 19, tw + 14, 23);
      g.fillStyle = '#231a10';
      g.fillText(f.text, sx, y);
      g.globalAlpha = 1;
    }
    for (const f of B.fx) {
      if (f.kind !== 'rally' || B.t - f.t > 1) continue;
      const [sx, sy] = Render.toScreen(f.x, f.y), k = (B.t - f.t);
      g.strokeStyle = `rgba(255,220,120,${1 - k})`; g.lineWidth = 3;
      g.beginPath(); g.arc(sx, sy, k * CFG.RALLY_RANGE * Render.cam.zoom, 0, 7); g.stroke();
    }
    Render.minimap(B, g);
    Place.draw(g, B);
    Touch.draw(g);
  },
  // a company's name, short: "2e Cie, 1/17e Léger" → "1/17e Léger", "Voltigeurs, 2/64e" → "Voltigeurs", horse by kind
  shortName(u) {
    if (u.arm === 'cav') return u.cav.short;
    if (u.arm === 'gun') return 'Guns';
    const parts = u.name.replace(/ \(.*\)/, '').split(', ');
    if (parts.length < 2) return parts[0];
    return /^(Voltigeurs|Grenadiers|Carabiniers|Chasseurs|Light|Grenadier|Jäger)/.test(parts[0]) ? parts[0].replace(/ Coy$/, '') : parts[parts.length - 1];
  },
  // where the HUD sits over the canvas (labels keep out of it); measured twice a second
  hudRects() {
    const now = performance.now();
    if (Render._hud && now - Render._hud.t < 500) return Render._hud.v;
    const v = [];
    if (Render.cv.getBoundingClientRect) {
      const cv = Render.cv.getBoundingClientRect();
      for (const id of ['hud-left', 'hud-clock', 'touch-bar', 'dispatch', 'hud-log', 'btn-leavefield']) {
        const el = document.getElementById(id);
        if (!el || !el.offsetParent || !el.getBoundingClientRect) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const q = [r.left - cv.left - 4, r.top - cv.top - 4, r.right - cv.left + 4, r.bottom - cv.top + 4];
        if (id === 'touch-bar') Render._tbRect = q;
        v.push(q);
      }
    }
    if (!v.includes(Render._tbRect)) Render._tbRect = null;
    Render._hud = { t: now, v };
    return v;
  },

  coarse() { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); },
  near(x, y) { const [sx, sy] = Render.toScreen(x, y); return sx > -50 && sy > -50 && sx < Render.W + 50 && sy < Render.H + 50; },

  edgeMark(g, sx, sy, u) {
    const W = Render.W, H = Render.H, cx = W / 2, cy = H / 2;
    const a = Math.atan2(sy - cy, sx - cx);
    let k = Math.min((W / 2 - 30) / Math.abs(Math.cos(a) || 1e-6), (H / 2 - 30) / Math.abs(Math.sin(a) || 1e-6));
    // step in toward the middle until the arrow and its distance are clear of the HUD
    const hud = Render.hudRects(), hit = (x, y) => hud.some(r => x > r[0] - 22 && x < r[2] + 22 && y > r[1] - 14 && y < r[3] + 14);
    while (k > 40 && hit(cx + Math.cos(a) * k, cy + Math.sin(a) * k)) k -= 12;
    const x = cx + Math.cos(a) * k, y = cy + Math.sin(a) * k;
    // two arrows on the same spot say one thing: the nearer (drawn first) speaks for both
    if ((Render._marks || []).some(p => p.team === u.team && Math.hypot(p.x - x, p.y - y) < 44)) return;
    (Render._marks = Render._marks || []).push({ x, y, team: u.team });
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = u.team === TEAM_PLAYER ? 'rgba(200,40,50,0.85)' : 'rgba(50,80,190,0.85)';
    g.beginPath(); g.moveTo(12, 0); g.lineTo(-6, -8); g.lineTo(-6, 8); g.closePath(); g.fill();
    g.restore();
    const d = Math.round(dist(Render.cam.x, Render.cam.y, u.cx, u.cy));
    g.font = '600 11px Georgia, serif'; g.fillStyle = '#fff';
    g.fillText(`${d} m`, x - Math.cos(a) * 22, y - Math.sin(a) * 18 + 4);
  },

  bottomInset(x0) {
    const now = performance.now();
    if (Render._inset && now - Render._inset.t < 500 && Render._inset.x0 === x0) return Render._inset.v;
    if (!Render.cv.getBoundingClientRect) return 12;
    const cv = Render.cv.getBoundingClientRect();
    let v = 0;
    for (const id of ['hud-log', 'hud-orders', 'touch-bar']) {
      const el = document.getElementById(id);
      if (!el || !el.offsetParent || !el.getBoundingClientRect) continue;
      const r = el.getBoundingClientRect();
      if (!r.height || r.right < cv.left + x0 || r.top < cv.top + cv.height * 0.5) continue;
      v = Math.max(v, cv.bottom - r.top);
    }
    Render._inset = { t: now, x0, v };
    return v;
  },

  minimap(B, g) {
    const m = Render.mini; if (!m) return;
    // sit above whatever bar is along the bottom on this screen (the log on a phone, the order keys on a desktop)
    let x0 = Render.W - m.width - 10;
    const y0 = Render.H - m.height - Render.bottomInset(x0) - 10, sc = m.width / B.field.w;
    // a phone on its side: the column of touch buttons comes down past the top of the map — sit left of it
    const tb = Render.hudRects().find(r => r === Render._tbRect);
    if (tb && tb[3] > y0 && tb[0] < Render.W - 4) x0 = Math.min(x0, tb[0] - m.width - 2);
    g.globalAlpha = 0.92; g.drawImage(m, x0, y0); g.globalAlpha = 1;
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 2; g.strokeRect(x0, y0, m.width, m.height);
    const seen = B.seen[TEAM_PLAYER];
    for (const u of B.units) {
      if (u.team === TEAM_ENEMY && !seen.has(u.id)) {
        if (u.lastSeen && B.t - u.lastSeen.t < 90) { g.fillStyle = 'rgba(40,60,160,0.4)'; g.fillRect(x0 + u.lastSeen.x * sc - 3, y0 + u.lastSeen.y * sc - 2, 6, 4); }
        continue;
      }
      g.fillStyle = u.team === TEAM_PLAYER ? (u.isPlayer ? '#ff3b3b' : '#b92d36') : '#2b4cc4';
      for (const mm of u.men) if (mm.state === 'formed' || mm.state === 'fleeing') g.fillRect(x0 + mm.x * sc - 0.8, y0 + mm.y * sc - 0.8, 1.6, 1.6);
    }
    g.fillStyle = '#ffe08a'; g.beginPath(); g.arc(x0 + B.cmd.x * sc, y0 + B.cmd.y * sc, 2.6, 0, 7); g.fill();
    const tk = B.player && B.player.task;
    const rt = B.retreat;
    if (rt) { g.strokeStyle = '#7fb069'; g.lineWidth = 1.5; g.setLineDash([2, 2]); g.beginPath(); g.arc(x0 + rt.x * sc, y0 + rt.y * sc, Math.max(4, rt.r * sc), 0, 7); g.stroke(); g.setLineDash([]); }
    if (tk) { g.strokeStyle = '#e8be50'; g.lineWidth = 1.5; g.beginPath(); g.arc(x0 + tk.x * sc, y0 + tk.y * sc, 5, 0, 7); g.stroke(); }
    const c = Render.cam, vw = Render.W / c.zoom * sc, vh = Render.H / c.zoom * sc;
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1;
    g.strokeRect(x0 + c.x * sc - vw / 2, y0 + c.y * sc - vh / 2, vw, vh);
    Render.miniRect = { x0, y0, w: m.width, h: m.height, sc };
  },
};
