'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TOUCH — the phone controls. (Mouse + keyboard stay in input.js.)
//    tap               walk there (tap the minimap to walk across the field)
//    touch and hold    the ORDER WHEEL opens under your finger. Two rings, one
//                      stroke: slide into a CATEGORY (inner ring) and its orders
//                      fan out beyond it; slide on to an order and lift.
//                      Holding also sets where you LOOK — so "Line" faces the
//                      spot you held.
//    one-finger drag   look around          pinch   zoom
//    Form → Line / Skirmish / Column: the NEXT drag draws where they stand
//                      (place.js); a tap forms on the spot; a hold re-opens the wheel
//
//  Directions are fixed so they become muscle memory:
//    up = Fire · right = Bayonet · down = Form · left = Move
//    e.g. up-then-up is FIRE!, right-then-right is Charge!, left-then-up is Advance
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const HOLD_MS = 360, TAP_SLOP = 12;
const RING_DEAD = 24, RING_IN = 66, RING_OUT0 = 74, RING_OUT1 = 150, OPT_SPAN = 0.72; // radians per outer option

const WHEEL_GROUPS = [
  // `at` = slot in the outer arc, clockwise from the category's direction (0 = straight on)
  { name: 'Fire', angle: -Math.PI / 2, opts: [
    { cmd: 'ready', label: 'Ready', at: -1 }, { cmd: 'fire', label: 'FIRE!', hot: true, at: 0 }, { cmd: 'atwill', label: 'At will', at: 1 }, { cmd: 'cease', label: 'Cease', at: 2 }, { cmd: 'byrank', label: 'By rank', at: -2 }] },
  { name: 'Bayonet', angle: 0, opts: [
    { cmd: 'charge', label: 'Charge!', hot: true, at: 0 }, { cmd: 'rally', label: 'Rally', at: 1 }, { cmd: 'reform', label: 'Re-form', at: -1 }] },
  { name: 'Form', angle: Math.PI / 2, opts: [
    { cmd: 'close', label: 'Close up', at: -1 }, { cmd: 'line', label: 'Line', at: 0 }, { cmd: 'skirmish', label: 'Skirmish', at: 1 }, { cmd: 'attackcol', label: 'Column', at: -2 }, { cmd: 'square', label: 'Square', at: 2 }] },
  { name: 'Move', angle: Math.PI, opts: [
    { cmd: 'advance', label: 'Advance', at: 1 }, { cmd: 'follow', label: 'Follow me', at: 0 }, { cmd: 'halt', label: 'Halt', at: -1 }, { cmd: 'fallback', label: 'Fall back', at: -2 }, { cmd: 'retire', label: 'Retire', at: 2 }] },
];
const optAngle = (g, i) => g.angle + g.opts[i].at * OPT_SPAN;

const Touch = {
  active: false, pts: new Map(), hold: null, wheel: null, pinch: null,

  init(canvas) {
    canvas.addEventListener('pointerdown', Touch.down);
    canvas.addEventListener('pointermove', Touch.move);
    canvas.addEventListener('pointerup', Touch.up);
    canvas.addEventListener('pointercancel', Touch.cancel);
    const b = id => document.getElementById(id);
    b('tb-pause').onclick = () => UI.togglePause();
    b('tb-run').onclick = () => { if (App.B) App.B.cmd.sprint = !App.B.cmd.sprint; };
    b('tb-centre').onclick = () => { Input.camOff.x = Input.camOff.y = 0; };
    b('tb-speed').onclick = () => { UI.cycleSpeed(); b('tb-speed').textContent = App.speed + '×'; };
    b('btn-help').onclick = () => { UI.togglePause(); UI.toggleHelp(); };
  },

  down(e) {
    if (e.pointerType !== 'touch') return;
    e.preventDefault();
    Sound.resume();
    if (!Touch.active) { Touch.active = true; document.body.classList.add('touch'); }
    Touch.pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY, x0: e.offsetX, y0: e.offsetY, t0: performance.now() });
    if (Touch.pts.size === 1) {
      if (Place.armed && Place.armed.B === App.B) {
        const [ax, ay] = Render.toWorld(e.offsetX, e.offsetY);
        Place.cur = { cmd: Place.armed.cmd, ax, ay, bx: ax, by: ay, id: e.pointerId };
      }
      clearTimeout(Touch.hold);
      Touch.hold = setTimeout(() => Touch.openWheel(e.pointerId), HOLD_MS);
    } else {
      Touch.cancelHold();
      Touch.wheel = null;
      Place.cur = null;                    // a second finger means zoom, not a stroke
      const [a, b] = [...Touch.pts.values()];
      Touch.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: Render.cam.zoom };
    }
  },

  move(e) {
    const p = Touch.pts.get(e.pointerId);
    if (!p) return;
    const dx = e.offsetX - p.x, dy = e.offsetY - p.y;
    p.x = e.offsetX; p.y = e.offsetY;
    if (Touch.wheel) { Touch.pick(p.x, p.y); return; }
    if (Math.hypot(p.x - p.x0, p.y - p.y0) > TAP_SLOP) Touch.cancelHold();
    if (Place.cur && Place.cur.id === e.pointerId) { [Place.cur.bx, Place.cur.by] = Render.toWorld(p.x, p.y); return; }
    if (Touch.pts.size === 2 && Touch.pinch) {
      const [a, b] = [...Touch.pts.values()];
      Render.cam.zoom = clamp(Touch.pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, Touch.pinch.d), 1.4, 12);
      Input.camOff.x -= dx / 2 / Render.cam.zoom; Input.camOff.y -= dy / 2 / Render.cam.zoom;
    } else if (Touch.pts.size === 1 && !Touch.hold) {
      Input.camOff.x -= dx / Render.cam.zoom; Input.camOff.y -= dy / Render.cam.zoom;
      Render.cam.x -= dx / Render.cam.zoom; Render.cam.y -= dy / Render.cam.zoom;
    }
  },

  up(e) {
    const p = Touch.pts.get(e.pointerId);
    if (!p) return;
    Touch.pts.delete(e.pointerId);
    if (Touch.pts.size < 2) Touch.pinch = null;
    if (Touch.wheel) {
      const w = Touch.wheel; Touch.wheel = null;
      const opt = w.group >= 0 && w.opt >= 0 ? WHEEL_GROUPS[w.group].opts[w.opt] : null;
      if (opt && App.B && !App.B.over && !App.paused) {
        // a formation waits for its stroke (unless it is a drill they cannot do — then say so now)
        if (PLACE_KINDS[opt.cmd] && knowsDrill(Detach.commanded(App.B), opt.cmd)) { Place.armed = { cmd: opt.cmd, B: App.B }; Touch.buzz(10); }
        else Orders.shout(App.B, opt.cmd);
      }
      return;
    }
    if (Place.cur && Place.cur.id === e.pointerId) {
      const st = Place.cur, B = App.B;
      Place.cur = null; Place.armed = null;
      Touch.cancelHold();
      if (B && !B.over && !App.paused) {
        if (Place.isStroke(st)) Place.commit(B, st);
        else Orders.shout(B, st.cmd);       // a tap: form on the spot, facing where you held
      }
      return;
    }
    const wasHold = Touch.hold;
    Touch.cancelHold();
    if (wasHold && Math.hypot(p.x - p.x0, p.y - p.y0) <= TAP_SLOP && performance.now() - p.t0 < HOLD_MS) Touch.tap(p.x, p.y);
  },
  cancel(e) { Touch.pts.delete(e.pointerId); Touch.cancelHold(); Touch.wheel = null; Touch.pinch = null; Place.cur = null; },
  cancelHold() { clearTimeout(Touch.hold); Touch.hold = null; },

  tap(sx, sy) {
    const B = App.B;
    if (App.mode !== 'battle' || !B || App.paused || B.over) return;
    const mr = Render.miniRect;
    let wx, wy;
    if (mr && sx >= mr.x0 && sy >= mr.y0 && sx <= mr.x0 + mr.w && sy <= mr.y0 + mr.h) { wx = (sx - mr.x0) / mr.sc; wy = (sy - mr.y0) / mr.sc; }
    else {
      [wx, wy] = Render.toWorld(sx, sy);
      // a tap on your own men (when you have more than one unit) commands them instead of walking there
      const U = Detach.mine(B).length > 1 && Detach.at(B, wx, wy, Math.max(4, 20 / Render.cam.zoom));
      if (U) { B.selected = U; UI.strip(B, true); Touch.buzz(10); return; }
    }
    B.cmd.dest = { x: clamp(wx, 1, B.field.w - 1), y: clamp(wy, 1, B.field.h - 1) };
  },

  openWheel(id) {
    Touch.hold = null;
    const p = Touch.pts.get(id), B = App.B;
    if (!p || App.mode !== 'battle' || !B || App.paused || B.over) return;
    Place.armed = null; Place.cur = null;  // holding instead of dragging: choose again
    // the held spot is where you are looking
    const [wx, wy] = Render.toWorld(p.x, p.y);
    if (dist(wx, wy, B.cmd.x, B.cmd.y) > 3) B.cmd.aim = Math.atan2(wy - B.cmd.y, wx - B.cmd.x);
    const W = Render.W, H = Render.H, m = RING_OUT1 + 8;
    Touch.wheel = { x: clamp(p.x, m, W - m), y: clamp(p.y, m, H - m), group: -1, opt: -1 };
    Touch.buzz(12);
  },
  buzz(ms) { if (navigator.vibrate) navigator.vibrate(ms); },

  // inner ring picks the category (sticky once chosen); outer ring picks its order
  pick(x, y) {
    const w = Touch.wheel, dx = x - w.x, dy = y - w.y, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const g0 = w.group, o0 = w.opt;
    if (r < RING_DEAD) { w.group = -1; w.opt = -1; }
    else if (r < RING_IN) {
      let best = -1, bd = Infinity;
      WHEEL_GROUPS.forEach((g, i) => { const d = Math.abs(angDiff(g.angle, a)); if (d < bd) { bd = d; best = i; } });
      w.group = best; w.opt = -1;
    } else if (w.group >= 0) {
      const g = WHEEL_GROUPS[w.group];
      let best = -1, bd = OPT_SPAN * 0.75;
      g.opts.forEach((o, i) => { const d = Math.abs(angDiff(optAngle(g, i), a)); if (d < bd) { bd = d; best = i; } });
      w.opt = best;
    }
    if (w.group !== g0 || w.opt !== o0) Touch.buzz(w.opt >= 0 ? 8 : 5);
  },

  // drawn by Render.overlay, in screen space
  draw(g) {
    const w = Touch.wheel;
    if (!w) return;
    const TAU = Math.PI * 2, Q = Math.PI / 4;
    const wedge = (r0, r1, a0, a1) => { g.beginPath(); g.arc(w.x, w.y, r1, a0, a1); g.arc(w.x, w.y, r0, a1, a0, true); g.closePath(); };
    g.save();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    // inner ring: four categories
    WHEEL_GROUPS.forEach((G, i) => {
      const on = i === w.group;
      wedge(RING_DEAD, RING_IN, G.angle - Q + 0.03, G.angle + Q - 0.03);
      g.fillStyle = on ? 'rgba(176,138,46,0.95)' : 'rgba(20,16,10,0.78)'; g.fill();
      g.fillStyle = on ? '#fff' : '#f1e8d2'; g.font = `${on ? 700 : 600} 13px Georgia, serif`;
      const lr = (RING_DEAD + RING_IN) / 2;
      g.fillText(G.name, w.x + Math.cos(G.angle) * lr, w.y + Math.sin(G.angle) * lr);
    });
    // outer arc: the chosen category's orders
    if (w.group >= 0) {
      const G = WHEEL_GROUPS[w.group];
      G.opts.forEach((o, i) => {
        const a = optAngle(G, i), on = i === w.opt, locked = App.B && !knowsDrill(Detach.commanded(App.B), o.cmd);
        wedge(RING_OUT0, RING_OUT1, a - OPT_SPAN / 2 + 0.02, a + OPT_SPAN / 2 - 0.02);
        g.fillStyle = on ? (o.hot ? 'rgba(190,30,45,0.95)' : 'rgba(176,138,46,0.95)') : 'rgba(20,16,10,0.8)'; g.fill();
        g.fillStyle = locked ? 'rgba(241,232,210,0.35)' : on ? '#fff' : (o.hot ? '#ffb9b0' : '#f1e8d2');
        g.font = `${on ? 700 : 600} 14px Georgia, serif`;
        const lr = (RING_OUT0 + RING_OUT1) / 2;
        g.fillText(o.label, w.x + Math.cos(a) * lr, w.y + Math.sin(a) * lr);
      });
    }
    g.fillStyle = 'rgba(20,16,10,0.6)'; g.beginPath(); g.arc(w.x, w.y, RING_DEAD - 3, 0, TAU); g.fill();
    g.restore();
  },
};
