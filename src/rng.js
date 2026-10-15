'use strict';
// Seeded RNG (mulberry32). The battle sim never touches Math.random, so a
// seed replays a battle exactly — the tuning harness depends on it.
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  const r = () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.pick = arr => arr[Math.floor(r() * arr.length)];
  r.chance = p => r() < p;
  r.gauss = () => (r() + r() + r() - 1.5) * 2;   // mean 0, sd ≈ 1
  return r;
}

// small vector helpers shared by every module
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));
function angDiff(a, b) {            // signed b - a, wrapped to [-π, π]
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function turnToward(a, b, maxStep) {
  const d = angDiff(a, b);
  return Math.abs(d) <= maxStep ? b : a + Math.sign(d) * maxStep;
}
