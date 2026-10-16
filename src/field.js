'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  FIELD — the ground. A grid of CFG.CELL-metre cells, each with a terrain
//  type and an elevation. Pure data + queries; scenarios.js paints it,
//  render.js draws it, the sim asks it questions:
//    how fast can I walk here · is that man covered · can I see him.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const T = { GRASS: 0, WHEAT: 1, WOODS: 2, ROAD: 3, WATER: 4, FORD: 5, MARSH: 6, WALL: 7, BUILDING: 8, BRIDGE: 9, ORCHARD: 10 };

// cover = multiplier on a ball's chance to hit a man standing there (lower is safer)
const TERRAIN = [
  { name: 'grass',    speed: 1.0,  cover: 1.0,  pass: true },
  { name: 'wheat',    speed: 0.85, cover: 0.9,  pass: true },
  { name: 'woods',    speed: 0.6,  cover: 0.55, pass: true, woods: true },
  { name: 'road',     speed: 1.12, cover: 1.0,  pass: true },
  { name: 'river',    speed: 0,    cover: 1.0,  pass: false },
  { name: 'ford',     speed: 0.45, cover: 1.15, pass: true },
  { name: 'marsh',    speed: 0.5,  cover: 0.95, pass: true },
  { name: 'wall',     speed: 0.35, cover: 0.35, pass: true },
  { name: 'building', speed: 0,    cover: 1.0,  pass: false, blocks: true },
  { name: 'bridge',   speed: 1.0,  cover: 1.0,  pass: true },
  { name: 'orchard',  speed: 0.8,  cover: 0.75, pass: true, woods: true, thin: true },
];

function makeField(w, h) {
  const cols = Math.ceil(w / CFG.CELL), rows = Math.ceil(h / CFG.CELL);
  return { w, h, cols, rows, type: new Uint8Array(cols * rows), height: new Float32Array(cols * rows), version: 0 };
}

const Field = {
  idx(f, x, y) {
    const c = Math.floor(x / CFG.CELL), r = Math.floor(y / CFG.CELL);
    if (c < 0 || r < 0 || c >= f.cols || r >= f.rows) return -1;
    return r * f.cols + c;
  },
  typeAt(f, x, y) { const i = Field.idx(f, x, y); return i < 0 ? T.GRASS : f.type[i]; },
  inside(f, x, y) { return x >= 0 && y >= 0 && x < f.w && y < f.h; },
  passable(f, x, y) {
    const i = Field.idx(f, x, y);
    return i >= 0 && TERRAIN[f.type[i]].pass;
  },

  heightAt(f, x, y) {        // bilinear, so slopes are smooth under a walking man
    const gx = clamp(x / CFG.CELL - 0.5, 0, f.cols - 1.001), gy = clamp(y / CFG.CELL - 0.5, 0, f.rows - 1.001);
    const c = Math.floor(gx), r = Math.floor(gy), tx = gx - c, ty = gy - r;
    const i = r * f.cols + c, H = f.height;
    const c1 = Math.min(c + 1, f.cols - 1) - c, r1 = (Math.min(r + 1, f.rows - 1) - r) * f.cols;
    return lerp(lerp(H[i], H[i + c1], tx), lerp(H[i + r1], H[i + r1 + c1], tx), ty);
  },

  // speed multiplier for a step from (x,y) heading (dx,dy) (unit vector)
  speedAt(f, x, y, dx, dy) {
    const t = TERRAIN[Field.typeAt(f, x, y)];
    let s = t.speed;
    if (dx !== undefined) {
      const grade = (Field.heightAt(f, x + dx * 3, y + dy * 3) - Field.heightAt(f, x, y)) / 3 * 100;
      if (grade > 0) s *= Math.max(0.45, 1 - grade * CFG.SLOPE_PENALTY);
    }
    return s;
  },

  // A man is covered by the ground he stands on, or by a wall a step in front of
  // him toward the shooter — so a line lying behind a wall is as safe as one on it.
  coverFor(f, tx, ty, sx, sy) {
    let cv = TERRAIN[Field.typeAt(f, tx, ty)].cover;
    const d = dist(tx, ty, sx, sy) || 1;
    for (const step of [2.5, 4.5]) {
      const px = tx + (sx - tx) / d * step, py = ty + (sy - ty) / d * step;
      if (Field.typeAt(f, px, py) === T.WALL) cv = Math.min(cv, TERRAIN[T.WALL].cover);
    }
    return cv;
  },

  // Line of sight between two standing men. Blocked by a crest higher than the
  // sight line (this is what makes a reverse slope work), by buildings, and by
  // more than CFG.WOODS_BLOCK metres of woodland.
  // `mounted`: the eye is on horseback and sees over tall rye (not over woods)
  los(f, ax, ay, bx, by, mounted) {
    const d = dist(ax, ay, bx, by);
    if (d < 6) return true;
    const ha = Field.heightAt(f, ax, ay) + CFG.EYE, hb = Field.heightAt(f, bx, by) + CFG.EYE;
    const steps = Math.ceil(d / 3);
    let woods = 0;
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      const i = Field.idx(f, x, y);
      if (i < 0) continue;
      const ty = TERRAIN[f.type[i]];
      if (ty.blocks) return false;
      if (ty.woods) { woods += ty.thin ? 1.5 : 3; if (woods > CFG.WOODS_BLOCK) return false; }
      else if (f.rye && !mounted && f.type[i] === T.WHEAT) { woods += CFG.RYE_BLOCK; if (woods > CFG.WOODS_BLOCK) return false; }
      if (f.height[i] > lerp(ha, hb, t) - 0.15) return false;
    }
    return true;
  },
};

// ── value noise, for rolling ground and scattered cover ──
function makeNoise(rng, size = 64) {
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const at = (x, y) => g[((y % size + size) % size) * size + ((x % size + size) % size)];
  const sm = t => t * t * (3 - 2 * t);
  const n1 = (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), tx = sm(x - x0), ty = sm(y - y0);
    return lerp(lerp(at(x0, y0), at(x0 + 1, y0), tx), lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), tx), ty);
  };
  return (x, y, oct = 3) => {
    let a = 1, fr = 1, s = 0, n = 0;
    for (let o = 0; o < oct; o++) { s += n1(x * fr, y * fr) * a; n += a; a *= 0.5; fr *= 2; }
    return s / n;
  };
}

// painting helpers for scenarios
const Paint = {
  each(f, fn) {
    for (let r = 0; r < f.rows; r++) for (let c = 0; c < f.cols; c++) {
      fn((c + 0.5) * CFG.CELL, (r + 0.5) * CFG.CELL, r * f.cols + c);
    }
  },
  rect(f, x0, y0, x1, y1, type) {
    Paint.each(f, (x, y, i) => { if (x >= x0 && x <= x1 && y >= y0 && y <= y1) f.type[i] = type; });
  },
  disc(f, cx, cy, r, type) {
    Paint.each(f, (x, y, i) => { if (dist2(x, y, cx, cy) <= r * r) f.type[i] = type; });
  },
  // a line of cells (walls, hedges, roads, rivers) of a given half-width
  line(f, x0, y0, x1, y1, type, hw = 1.6, onlyIf) {
    const len = dist(x0, y0, x1, y1), n = Math.ceil(len / 1.5);
    for (let k = 0; k <= n; k++) {
      const x = lerp(x0, x1, k / n), y = lerp(y0, y1, k / n);
      for (let ox = -hw; ox <= hw; ox += 1.5) for (let oy = -hw; oy <= hw; oy += 1.5) {
        const i = Field.idx(f, x + ox, y + oy);
        if (i >= 0 && (!onlyIf || onlyIf(f.type[i]))) f.type[i] = type;
      }
    }
  },
  polyline(f, pts, type, hw, onlyIf) {
    for (let k = 1; k < pts.length; k++) Paint.line(f, pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1], type, hw, onlyIf);
  },
  // walled enclosure with gaps (gates) — gaps are [side, t] pairs, side 0..3 = N E S W
  enclosure(f, x0, y0, x1, y1, gaps = [], type = T.WALL) {
    const sides = [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]];
    sides.forEach(([ax, ay, bx, by], s) => {
      const len = dist(ax, ay, bx, by), n = Math.ceil(len / 2);
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        if (gaps.some(([gs, gt]) => gs === s && Math.abs(gt - t) * len < 5)) continue;
        const i = Field.idx(f, lerp(ax, bx, t), lerp(ay, by, t));
        // a road through a wall is a gateway (the user found village roads walled shut)
        if (i >= 0 && f.type[i] !== T.ROAD && f.type[i] !== T.BRIDGE) f.type[i] = type;
      }
    });
  },
};

// ━━ PATH ━━ the way round: A* over the 4 m ground grid that avoids houses and open water (fords and bridges
// are fine), then pulled tight so a column walks a few straight legs, not a staircase.
const PATH_CELL = CFG.CELL;
const Path = {
  blockedAt(f, x, y) {
    const t = Field.typeAt(f, x, y);
    return t === T.BUILDING || t === T.WATER;
  },
  closed(f, cx, cy) { return Path.blockedAt(f, cx * PATH_CELL + PATH_CELL / 2, cy * PATH_CELL + PATH_CELL / 2); },
  // a straight walk from a to b crosses nothing impassable
  clear(f, ax, ay, bx, by) {
    const d = dist(ax, ay, bx, by), n = Math.ceil(d / 2);
    for (let k = 1; k < n; k++) if (Path.blockedAt(f, lerp(ax, bx, k / n), lerp(ay, by, k / n))) return false;
    return true;
  },
  find(f, x0, y0, x1, y1) {
    if (Path.clear(f, x0, y0, x1, y1)) return [{ x: x1, y: y1 }];
    // captains ask the same question every second: remember the answer (to within 12 m)
    const key = [x0, y0, x1, y1].map(v => Math.round(v / 12)).join(',');
    f.pathCache = f.pathCache || new Map();
    const hit = f.pathCache.get(key);
    if (hit) return hit.map(p => ({ x: p.x, y: p.y }));
    const out = Path.search(f, x0, y0, x1, y1);
    if (f.pathCache.size > 400) f.pathCache.clear();
    f.pathCache.set(key, out);
    return out.map(p => ({ x: p.x, y: p.y }));
  },
  search(f, x0, y0, x1, y1) {
    const W = Math.ceil(f.w / PATH_CELL), H = Math.ceil(f.h / PATH_CELL);
    if (!f.pathClosed) {
      f.pathClosed = new Uint8Array(W * H);
      for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) f.pathClosed[cy * W + cx] = Path.closed(f, cx, cy) ? 1 : 0;
    }
    const C = f.pathClosed;
    const cell = (x, y) => [clamp(Math.floor(x / PATH_CELL), 0, W - 1), clamp(Math.floor(y / PATH_CELL), 0, H - 1)];
    const [sx, sy] = cell(x0, y0), [gx, gy] = cell(x1, y1);
    const start = sy * W + sx, goal = gy * W + gx;
    const g = new Float32Array(W * H).fill(Infinity), from = new Int32Array(W * H).fill(-1);
    // a tiny binary heap of [f, node]
    const heap = [];
    const push = (pri, n) => { heap.push([pri, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const h = n => Math.hypot(n % W - gx, Math.floor(n / W) - gy);
    g[start] = 0; push(h(start), start);
    let found = false, steps = 0;
    while (heap.length && steps++ < 150000) {
      const [, n] = pop();
      if (n === goal) { found = true; break; }
      const nx = n % W, ny = Math.floor(n / W);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const mx = nx + dx, my = ny + dy;
        if (mx < 0 || my < 0 || mx >= W || my >= H) continue;
        const m = my * W + mx;
        if (C[m] && m !== goal) continue;
        if (dx && dy && (C[ny * W + mx] || C[my * W + nx])) continue;   // no cutting a corner of a house
        const t = Field.typeAt(f, mx * PATH_CELL + PATH_CELL / 2, my * PATH_CELL + PATH_CELL / 2);
        const cost = (dx && dy ? 1.414 : 1) * (t === T.WALL ? 2.5 : t === T.WOODS || t === T.MARSH ? 1.6 : 1);
        if (g[n] + cost < g[m]) { g[m] = g[n] + cost; from[m] = n; push(g[m] + h(m), m); }
      }
    }
    if (!found) return [{ x: x1, y: y1 }];
    const pts = [];
    for (let n = goal; n !== start && n >= 0; n = from[n]) pts.push({ x: (n % W) * PATH_CELL + PATH_CELL / 2, y: Math.floor(n / W) * PATH_CELL + PATH_CELL / 2 });
    pts.reverse(); pts[pts.length - 1] = { x: x1, y: y1 };
    // pull the string tight
    const out = []; let ax = x0, ay = y0, i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !Path.clear(f, ax, ay, pts[j].x, pts[j].y)) j--;
      out.push(pts[j]); ax = pts[j].x; ay = pts[j].y; i = j + 1;
    }
    return out;
  },
};
