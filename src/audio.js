'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  AUDIO — all procedural (Web Audio). Lazy AudioContext.
//
//  Each company's band plays while it marches: the side-drum beats the
//  cadence and the fife plays the tune (factions.js → tunes.js). The
//  drum also beats a short CALL for every order — that is the drummer
//  relaying it. Everything is placed by distance from your commander,
//  so you hear French drums over the crest before you see a coat.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const Sound = {
  ac: null, out: null, noiseBuf: null, muted: false, vol: 0.8,
  bands: {}, listener: { x: 0, y: 0 }, wind: null,

  ctx() {
    if (Sound.ac) return Sound.ac;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ac = Sound.ac = new AC();
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4;
    Sound.out = ac.createGain(); Sound.out.gain.value = Sound.muted ? 0 : Sound.vol;
    Sound.out.connect(comp); comp.connect(ac.destination);
    const len = ac.sampleRate * 1.5, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    Sound.noiseBuf = buf;
    return ac;
  },
  resume() { const ac = Sound.ctx(); if (ac && ac.state === 'suspended') ac.resume(); },
  setMuted(m) { Sound.muted = m; if (Sound.out) Sound.out.gain.value = m ? 0 : Sound.vol; },

  // distance → [gain, pan]
  place(x, y, ref = 50) {
    const L = Sound.listener, d = dist(L.x, L.y, x, y);
    return [1 / (1 + d / ref), clamp((x - L.x) / 160, -0.9, 0.9)];
  },
  chain(gain, pan) {
    const ac = Sound.ac, gn = ac.createGain(); gn.gain.value = gain;
    if (ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; gn.connect(p); p.connect(Sound.out); }
    else gn.connect(Sound.out);
    return gn;
  },
  noise(t, dur, type, freq, q, peak, dest, attack = 0.002) {
    const ac = Sound.ac, s = ac.createBufferSource(); s.buffer = Sound.noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
    return f;
  },

  // ── the musket ──
  musket(t, x, y, loud = 1) {
    const [gain, pan] = Sound.place(x, y, 45), ac = Sound.ac;
    const out = Sound.chain(gain * loud, pan), far = 1 - gain;
    Sound.noise(t, 0.28 + far * 0.4, 'lowpass', 3200 - far * 2400, 0.7, 0.9, out);
    Sound.noise(t + 0.01, 1.1 + far * 0.6, 'lowpass', 420, 0.5, 0.35, out, 0.01);
    const o = ac.createOscillator(), og = ac.createGain();
    o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    og.gain.setValueAtTime(0.5, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.25);
  },

  // ── side-drum ──
  hit(t, out, accent) {
    const ac = Sound.ac;
    Sound.noise(t, accent ? 0.16 : 0.09, 'highpass', 1700, 0.6, accent ? 0.7 : 0.35, out);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(accent ? 210 : 230, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.07);
    g.gain.setValueAtTime(accent ? 0.5 : 0.25, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.1);
  },
  stroke(sym, t, out, step) {
    if (sym === 'X') Sound.hit(t, out, true);
    else if (sym === 'x') Sound.hit(t, out, false);
    else if (sym === 'f') { Sound.hit(t - 0.03, out, false); Sound.hit(t, out, true); }
    else if (sym === 'r') { for (let k = 0; k < 4; k++) Sound.hit(t + k * step / 4, out, k === 3); }
  },

  // ── fife ──
  fife(t, freq, dur, out) {
    const ac = Sound.ac;
    const o = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle'; o.frequency.value = freq; o2.type = 'sine'; o2.frequency.value = freq * 2;
    const lfo = ac.createOscillator(), lg = ac.createGain();
    lfo.frequency.value = 5.6; lg.gain.value = freq * 0.006; lfo.connect(lg); lg.connect(o.frequency);
    const g2 = ac.createGain(); g2.gain.value = 0.18;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.025);
    g.gain.setValueAtTime(0.28, t + Math.max(0.03, dur - 0.06)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(out);
    Sound.noise(t, Math.min(dur, 0.12), 'bandpass', freq * 2, 2, 0.05, out, 0.01);
    for (const x of [o, o2, lfo]) { x.start(t); x.stop(t + dur + 0.02); }
  },

  // ── crowd roar for a charge ──
  roar(x, y) {
    const ac = Sound.ctx(); if (!ac) return;
    const [gain, pan] = Sound.place(x, y, 70), out = Sound.chain(gain, pan), t = ac.currentTime;
    for (let k = 0; k < 3; k++) {
      const f = Sound.noise(t + k * 0.08, 1.6, 'bandpass', 520 + k * 180, 3, 0.35, out, 0.12);
      f.frequency.setValueAtTime(480 + k * 160, t); f.frequency.linearRampToValueAtTime(820 + k * 140, t + 1.2);
    }
  },

  // a cavalry trumpet: the charge (rising, urgent) or a call to advance
  trumpet(x, y, charge) {
    const ac = Sound.ctx(); if (!ac) return;
    const [gain, pan] = Sound.place(x, y, 90), out = Sound.chain(gain * 0.5, pan), t = ac.currentTime + 0.05;
    const notes = charge ? [[392, 0.12], [523, 0.12], [659, 0.12], [784, 0.36], [659, 0.12], [784, 0.5]] : [[523, 0.3], [392, 0.15], [523, 0.15], [659, 0.5]];
    let at = t;
    for (const [f, d] of notes) {
      const o = ac.createOscillator(), env = ac.createGain(), lp = ac.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 2200;
      env.gain.setValueAtTime(0, at); env.gain.linearRampToValueAtTime(0.22, at + 0.025); env.gain.setValueAtTime(0.2, at + d * 0.8); env.gain.linearRampToValueAtTime(0, at + d);
      o.connect(lp); lp.connect(env); env.connect(out); o.start(at); o.stop(at + d + 0.02);
      at += d + 0.02;
    }
  },

  // a field gun: a deep thump and a long rolling boom
  cannon(x, y) {
    const ac = Sound.ctx(); if (!ac) return;
    const [gain, pan] = Sound.place(x, y, 160), out = Sound.chain(Math.min(1, gain * 1.4), pan), t = ac.currentTime + Math.random() * 0.03;
    const o = ac.createOscillator(), env = ac.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.5);
    env.gain.setValueAtTime(0.9, t); env.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(env); env.connect(out); o.start(t); o.stop(t + 0.75);
    Sound.noise(t, 1.8, 'lowpass', 260, 0.7, 0.9, out, 0.004);
  },

  // the ground shaking: a low drumming that swells as the squadron opens into the gallop
  hooves(x, y) {
    const ac = Sound.ctx(); if (!ac) return;
    const [gain, pan] = Sound.place(x, y, 120), out = Sound.chain(gain, pan), t = ac.currentTime;
    for (let k = 0; k < 40; k++) Sound.noise(t + k * 0.11 + Math.random() * 0.04, 0.09, 'lowpass', 140 + Math.random() * 60, 1, 0.25 + 0.35 * Math.min(1, k / 25), out);
  },

  // ── per-frame: drain the battle's sound events ──
  battle(B) {
    const ac = Sound.ac;
    Sound.listener = { x: B.cmd.x, y: B.cmd.y };
    if (!ac || Sound.muted) { B.events.length = 0; return; }
    const now = ac.currentTime;
    let shots = 0;
    for (const e of B.events) {
      if (e.type === 'shot') {
        if (shots++ < 9) Sound.musket(now + Math.random() * 0.05, e.x, e.y);
      } else if (e.type === 'drumcall') {
        const u = B.units.find(v => v.id === e.unit);
        const pat = DRUM_CALLS[e.order];
        if (u && pat) {
          const [gain, pan] = Sound.place(u.cx, u.cy, 60), out = Sound.chain(gain, pan), step = 0.13;
          pat.forEach((s, i) => Sound.stroke(s, now + 0.05 + i * step, out, step));
        }
      } else if (e.type === 'charge') {
        const u = B.units.find(v => v.id === e.unit);
        if (u && u.arm === 'cav') { Sound.trumpet(u.cx, u.cy, true); Sound.hooves(u.cx, u.cy); }
        else if (u) Sound.roar(u.cx, u.cy);
      } else if (e.type === 'bugle') {
        Sound.trumpet(e.x, e.y, false);
      } else if (e.type === 'cannon') {
        Sound.cannon(e.x, e.y);
      } else if (e.type === 'trumpet') {
        Sound.trumpet(e.x, e.y, false);
      } else if (e.type === 'dispatch') {
        // a galloper's bugle: five rising notes
        const out = Sound.chain(0.5, 0);
        [523, 659, 784, 659, 1047].forEach((f, i) => Sound.fife(now + 0.05 + i * 0.16, f, i === 4 ? 0.5 : 0.14, out));
      } else if (e.type === 'cmdhit') {
        const out = Sound.chain(0.6, 0);
        Sound.noise(now, 0.25, 'lowpass', 300, 1, 0.8, out);
      }
    }
    B.events.length = 0;
    Sound.bandsTick(B, now);
    Sound.windTick(B);
  },

  bandsTick(B, now) {
    for (const u of B.units) {
      const bs = Sound.bands[u.id] || (Sound.bands[u.id] = { d: 0, di: 0, f: 0, fi: 0, playing: false });
      const marching = !u.routed && (u.order === 'advance' || u.order === 'follow' || u.order === 'fallback' || u.order === 'charge');
      const drum = marching && Unit.hasRole(u, 'drummer');
      const fife = marching && u.order !== 'charge' && Unit.hasRole(u, 'fifer');
      if (!drum && !fife) { bs.playing = false; continue; }
      if (!bs.playing) { bs.playing = true; bs.d = bs.f = now + 0.1; bs.di = bs.fi = 0; }
      const [gain, pan] = Sound.place(u.cx, u.cy, 55);
      if (gain < 0.06) { bs.d = bs.f = now + 0.1; continue; }
      const out = bs.out && bs.outGain === Math.round(gain * 20) ? bs.out : (bs.out = Sound.chain(gain * 0.55, pan), bs.outGain = Math.round(gain * 20), bs.out);
      if (drum) {
        const cad = CADENCES[u.order === 'charge' ? 'longroll' : u.F.cadence], step = 60 / cad.bpm / 2;
        while (bs.d < now + 0.3) { Sound.stroke(cad.bar[bs.di % cad.bar.length], bs.d, out, step); bs.d += step; bs.di++; }
      } else bs.d = now + 0.1;
      if (fife) {
        const tune = TUNES[u.F.tune], beat = 60 / tune.bpm;
        while (bs.f < now + 0.3) {
          const [n, b] = tune.melody[bs.fi % tune.melody.length];
          if (n !== 'R') Sound.fife(bs.f, noteFreq(n) * 2, b * beat * 0.95, out);
          bs.f += b * beat; bs.fi++;
        }
      } else bs.f = now + 0.1;
    }
  },

  // a low wind bed so silence is never quite silent
  windTick(B) {
    if (Sound.wind) return;
    const ac = Sound.ac, s = ac.createBufferSource(); s.buffer = Sound.noiseBuf; s.loop = true;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
    const g = ac.createGain(); g.gain.value = 0.05 + B.wind.s * 0.03;
    s.connect(f); f.connect(g); g.connect(Sound.out); s.start();
    Sound.wind = { s, g };
  },
  stopBattle() {
    if (Sound.wind) { try { Sound.wind.s.stop(); } catch (e) { /* already stopped */ } Sound.wind = null; }
    Sound.bands = {};
  },
};
