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
      if (ty === T.WHEAT) j *= (Math.floor(wy * 1.2) % 2 ? 1.04 : 0.95);
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
    const m = document.createElement('canvas'); m.width = (Render.W < 700 ? 112 : 180) * (f.w > 800 ? 1.15 : 1); m.height = Math.round(180 * f.h / f.w);
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
    const seen = B.seen[TEAM_PLAYER];
    for (const u of B.units) for (const m of u.men) if (m.state === 'down') Render.body(g, m);
    for (const d of B.dropped) Render.flag(g, d.x, d.y, d.unit, B.t, true);
    for (const u of B.units) {
      const vis = u.team === TEAM_PLAYER || seen.has(u.id);
      if (!vis) continue;
      for (const m of u.men) if (m.state === 'formed' || m.state === 'fleeing') Render.man(g, m, u, B.t);
    }
    if (B.cmd.state !== 'down') Render.commander(g, B.cmd, B.t); else Render.body(g, Object.assign({ unit: B.player }, B.cmd));
    Render.flashes(g, B);
    Render.smoke(g, B);
    g.restore();
    Render.overlay(B, ui);
  },

  helpers(B, g, ui) {
    const C = B.cmd, z = Render.cam.zoom;
    if (C.dest) {
      g.strokeStyle = 'rgba(255,240,200,0.5)'; g.lineWidth = 1.5 / z; g.setLineDash([4 / z, 4 / z]);
      g.beginPath(); g.moveTo(C.x, C.y); g.lineTo(C.dest.x, C.dest.y); g.stroke(); g.setLineDash([]);
      g.beginPath(); g.arc(C.dest.x, C.dest.y, 1.2, 0, 7); g.stroke();
    }
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
    const F = u.F, s = SPRITE;
    g.save(); g.translate(m.x, m.y); g.rotate(m.facing); g.scale(s, s);
    const flee = m.state === 'fleeing';
    // shadow
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.ellipse(0.08, 0.1, 0.3, 0.42, 0, 0, 7); g.fill();
    // musket (under the body when shouldered)
    if (m.role === 'line' && !flee) {
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

  commander(g, c, t) {
    const F = FACTIONS.british;
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
      if (f.kind !== 'flash') continue;
      const age = B.t - f.t;
      if (age > 0.12) continue;
      g.fillStyle = `rgba(255,${200 + Math.random() * 50 | 0},120,${1 - age / 0.12})`;
      g.beginPath(); g.arc(f.x + Math.cos(f.a) * 0.4, f.y + Math.sin(f.a) * 0.4, 0.55 + Math.random() * 0.3, 0, 7); g.fill();
    }
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

  // ── screen-space: speech, labels, edge markers, minimap ──
  overlay(B, ui) {
    const g = Render.g, W = Render.W, H = Render.H;
    g.font = '600 13px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'bottom';
    const seen = B.seen[TEAM_PLAYER];
    for (const u of B.units) {
      if (Touch.wheel) break;              // the order wheel needs a clean background
      const vis = u.team === TEAM_PLAYER || seen.has(u.id);
      let [sx, sy] = Render.toScreen(u.cx, u.cy);
      if (!vis) {
        if (u.team === TEAM_ENEMY && u.lastSeen && B.t - u.lastSeen.t < 90) {
          [sx, sy] = Render.toScreen(u.lastSeen.x, u.lastSeen.y);
          g.fillStyle = 'rgba(30,50,120,0.45)'; g.fillText('? last seen', sx, sy);
        }
        continue;
      }
      if (!u.formed && !u.routed) continue;
      const off = sx < 0 || sy < 0 || sx > W || sy > H;
      if (off) { Render.edgeMark(g, sx, sy, u); continue; }
      const word = Unit.moraleWord(u);
      const col = u.routed ? '#f2c14e' : u.morale < CFG.SHAKEN ? '#f08a4b' : u.morale < CFG.STEADY ? '#f4e3b0' : '#ffffff';
      sy -= 10 + u.ranks * CFG.RANK_GAP * Render.cam.zoom;
      g.fillStyle = 'rgba(0,0,0,0.55)';
      const label = `${u.isPlayer ? '' : u.name + ' · '}${word}`;
      const tw = g.measureText(label).width;
      g.fillRect(sx - tw / 2 - 6, sy - 17, tw + 12, 19);
      g.fillStyle = u.team === TEAM_PLAYER ? col : (u.routed ? '#9fe08a' : '#b9c8ff');
      g.fillText(label, sx, sy);
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
  coarse() { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); },
  near(x, y) { const [sx, sy] = Render.toScreen(x, y); return sx > -50 && sy > -50 && sx < Render.W + 50 && sy < Render.H + 50; },

  edgeMark(g, sx, sy, u) {
    const W = Render.W, H = Render.H, cx = W / 2, cy = H / 2;
    const a = Math.atan2(sy - cy, sx - cx);
    const k = Math.min((W / 2 - 30) / Math.abs(Math.cos(a) || 1e-6), (H / 2 - 30) / Math.abs(Math.sin(a) || 1e-6));
    const x = cx + Math.cos(a) * k, y = cy + Math.sin(a) * k;
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = u.team === TEAM_PLAYER ? 'rgba(200,40,50,0.85)' : 'rgba(50,80,190,0.85)';
    g.beginPath(); g.moveTo(12, 0); g.lineTo(-6, -8); g.lineTo(-6, 8); g.closePath(); g.fill();
    g.restore();
    const d = Math.round(dist(Render.cam.x, Render.cam.y, u.cx, u.cy));
    g.font = '600 11px Georgia, serif'; g.fillStyle = '#fff';
    g.fillText(`${d} m`, x - Math.cos(a) * 22, y - Math.sin(a) * 18 + 4);
  },

  minimap(B, g) {
    const m = Render.mini; if (!m) return;
    const x0 = Render.W - m.width - 10, y0 = Render.H - m.height - (document.body.classList.contains('touch') || Render.W < 700 ? 12 : 92), sc = m.width / B.field.w;
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
    if (tk) { g.strokeStyle = '#e8be50'; g.lineWidth = 1.5; g.beginPath(); g.arc(x0 + tk.x * sc, y0 + tk.y * sc, 5, 0, 7); g.stroke(); }
    const c = Render.cam, vw = Render.W / c.zoom * sc, vh = Render.H / c.zoom * sc;
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1;
    g.strokeRect(x0 + c.x * sc - vw / 2, y0 + c.y * sc - vh / 2, vw, vh);
    Render.miniRect = { x0, y0, w: m.width, h: m.height, sc };
  },
};
