'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  INPUT — e.code throughout. You are one man on foot:
//    right-click   walk there        WASD  walk      Shift (hold) / Q (toggle)  sprint
//    mouse         where you look — "Form line" faces this way
//    left-drag     draw where the company should stand (place.js)
//    1-9, F/Space, C, R   orders (see ORDER_KEYS)
//    wheel zoom · arrows look around · V re-centre · Tab speed · P/Esc pause · M mute
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const ORDER_KEYS = [
  { code: 'Digit1', key: '1', cmd: 'follow', label: 'Follow me' },
  { code: 'Digit2', key: '2', cmd: 'line', label: 'Form line' },
  { code: 'Digit3', key: '3', cmd: 'advance', label: 'Advance' },
  { code: 'Digit4', key: '4', cmd: 'halt', label: 'Halt' },
  { code: 'Digit5', key: '5', cmd: 'ready', label: 'Make ready' },
  { code: 'KeyF', key: 'F', cmd: 'fire', label: 'FIRE!', alt: 'Space' },
  { code: 'Digit6', key: '6', cmd: 'atwill', label: 'Fire at will' },
  { code: 'Digit7', key: '7', cmd: 'cease', label: 'Cease fire' },
  { code: 'KeyB', key: 'B', cmd: 'byrank', label: 'Fire by rank' },
  { code: 'Digit0', key: '0', cmd: 'attackcol', label: 'Column of attack' },
  { code: 'Digit8', key: '8', cmd: 'skirmish', label: 'Skirmish / close' },
  { code: 'Digit9', key: '9', cmd: 'fallback', label: 'Fall back' },
  { code: 'KeyX', key: 'X', cmd: 'retire', label: 'Retire to the road' },
  { code: 'KeyC', key: 'C', cmd: 'charge', label: 'Charge!' },
  { code: 'KeyR', key: 'R', cmd: 'rally', label: 'Rally' },
  { code: 'KeyT', key: 'T', cmd: 'reform', label: 'Re-form' },
  { code: 'KeyE', key: 'E', cmd: 'square', label: 'Form square' },
  { code: 'KeyY', key: 'Y', cmd: 'detach', label: 'Detach parties' },
  { code: 'KeyU', key: 'U', cmd: 'recall', label: 'Recall parties' },
];

const Input = {
  held: new Set(), mx: 0, my: 0, camOff: { x: 0, y: 0 }, dragging: false,
  init(canvas) {
    window.addEventListener('keydown', Input.down);
    window.addEventListener('keyup', e => Input.held.delete(e.code));
    window.addEventListener('blur', () => Input.held.clear());
    canvas.addEventListener('mousemove', e => {
      Input.mx = e.offsetX; Input.my = e.offsetY;
      if (Place.cur && Input.dragging) [Place.cur.bx, Place.cur.by] = Render.toWorld(e.offsetX, e.offsetY);
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('mousedown', Input.click);
    window.addEventListener('mouseup', Input.release);
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const c = Render.cam;
      c.zoom = clamp(c.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 1.4, 12);
    }, { passive: false });
  },

  down(e) {
    Sound.resume();
    const B = App.B;
    if (App.mode !== 'battle' || !B) return;
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash'].includes(e.code)) e.preventDefault();
    Input.held.add(e.code);
    if (e.repeat) return;
    if (e.code === 'KeyO' || (e.code === 'Escape' && $('orders-sheet').classList.contains('show'))) return UI.toggleOrders();
    if (e.code === 'Escape' || e.code === 'KeyP') return UI.togglePause();
    if (e.code === 'KeyM') return UI.toggleMute();
    if (e.code === 'Tab') return UI.cycleSpeed();
    if (e.code === 'KeyV') { Input.camOff.x = Input.camOff.y = 0; return; }
    if (e.code === 'KeyH') return UI.toggleHelp();
    if (e.code === 'KeyL') return UI.leaveField();
    if (e.code === 'KeyQ') { B.cmd.sprint = !B.cmd.sprint; return; }
    if (App.paused || B.over) return;
    let k = ORDER_KEYS.find(o => o.code === e.code || o.alt === e.code);
    if (!k) return;
    let cmd = k.cmd;
    if (cmd === 'skirmish' && Detach.commanded(B).form.kind === 'skirmish') cmd = 'close';
    Orders.shout(B, cmd);
  },

  click(e) {
    Sound.resume();
    const B = App.B;
    if (App.mode !== 'battle' || !B || App.paused || B.over) return;
    const mr = Render.miniRect;
    let wx, wy;
    if (mr && e.offsetX >= mr.x0 && e.offsetY >= mr.y0 && e.offsetX <= mr.x0 + mr.w && e.offsetY <= mr.y0 + mr.h) {
      wx = (e.offsetX - mr.x0) / mr.sc; wy = (e.offsetY - mr.y0) / mr.sc;
    } else if (e.button === 2) {
      [wx, wy] = Render.toWorld(e.offsetX, e.offsetY);
    } else {
      // left-drag: draw where the company should stand
      const U = Detach.commanded(B);
      if (e.button === 0 && U && !U.routed) {
        const [ax, ay] = Render.toWorld(e.offsetX, e.offsetY);
        Place.cur = { cmd: Place.dragCmd(U), ax, ay, bx: ax, by: ay };
        Input.dragging = true;
      }
      return;
    }
    B.cmd.dest = { x: clamp(wx, 1, B.field.w - 1), y: clamp(wy, 1, B.field.h - 1) };
    B.fx.push({ kind: 'mark', x: wx, y: wy, t: B.t });
  },

  release(e) {
    if (!Input.dragging || e.button !== 0) return;
    Input.dragging = false;
    const p = Place.cur, B = App.B;
    Place.cur = null;
    if (!p || !B || App.mode !== 'battle' || App.paused || B.over) return;
    if (Place.isStroke(p)) Place.commit(B, p);
    else {
      // a click (no stroke) on your own men commands them
      const U = Detach.mine(B).length > 1 && Detach.at(B, p.ax, p.ay, Math.max(4, 16 / Render.cam.zoom));
      if (U) { B.selected = U; UI.strip(B, true); }
    }
  },

  // every frame: legs, eyes, camera
  update(B, dt) {
    const h = Input.held, c = B.cmd;
    c.mvx = (h.has('KeyD') ? 1 : 0) - (h.has('KeyA') ? 1 : 0);
    c.mvy = (h.has('KeyS') ? 1 : 0) - (h.has('KeyW') ? 1 : 0);
    if (c.mvx || c.mvy) c.dest = null;
    c.run = h.has('ShiftLeft') || h.has('ShiftRight') || c.sprint;
    const cam = Render.cam, k = Math.min(1, dt * 3);
    if (Touch.active) {
      // on a phone the aim is set by holding (touch.js) and the camera by dragging
      cam.x = clamp(lerp(cam.x, c.x + Input.camOff.x, k), 0, B.field.w);
      cam.y = clamp(lerp(cam.y, c.y + Input.camOff.y, k), 0, B.field.h);
      return;
    }
    const [wx, wy] = Render.toWorld(Input.mx, Input.my);
    c.aim = Math.atan2(wy - c.y, wx - c.x);
    const pan = 160 / Render.cam.zoom * dt * 2;
    if (h.has('ArrowLeft')) Input.camOff.x -= pan * 3;
    if (h.has('ArrowRight')) Input.camOff.x += pan * 3;
    if (h.has('ArrowUp')) Input.camOff.y -= pan * 3;
    if (h.has('ArrowDown')) Input.camOff.y += pan * 3;
    const tx = c.x + (wx - c.x) * 0.4 + Input.camOff.x, ty = c.y + (wy - c.y) * 0.4 + Input.camOff.y;
    cam.x = clamp(lerp(cam.x, tx, k), 0, B.field.w);
    cam.y = clamp(lerp(cam.y, ty, k), 0, B.field.h);
  },
};
