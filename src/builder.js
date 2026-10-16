'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  BUILDER — the sandbox. Pick a field, then both sides out of foot, horse
//  and guns, each priced in renown, with a budget per side (or none at all).
//  Pure: `Builder.cost(spec)` and `Builder.deploy(army, scenario, field, rng)`
//  (→ the same { player, allies, enemies } a scenario's deploy() returns),
//  so the sim and the headless tests use it directly. A later PvP mode can
//  hand two of these armies to the same deploy.
//
//  A unit spec:
//    { arm: 'foot', size, kind: 'battalion'|'line'|'light'|'grenadier', quality, posture: 'attack'|'hold' }
//    { arm: 'cav',  size, type: (a CAV_TYPES key of that side's faction), quality }
//    { arm: 'gun',  guns: 1..3, quality }
//  Your own company: { size, kind, quality, rifles, mounted }
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const QUALITY = {
  raw:     { name: 'Raw',     drill: 0.18, nerve: -3, cost: 1.2, stage: 0.05 },
  trained: { name: 'Trained', drill: 0.4,  nerve: 0,  cost: 1.6, stage: 0.4 },
  veteran: { name: 'Veteran', drill: 0.65, nerve: 5,  cost: 2.2, stage: 0.8 },
  guard:   { name: 'Guard',   drill: 0.8,  nerve: 10, cost: 2.9, stage: 1 },
};
const BUDGETS = [0, 200, 350, 500, 800];   // 0 = no limit
const FOOT_KINDS = { battalion: 'Battalion coy', line: 'Line coy (drilled)', light: 'Light coy', grenadier: 'Grenadiers' };

const Builder = {
  // renown cost of one unit (or of your own company, with `own`)
  cost(s, own) {
    const q = QUALITY[s.quality || 'trained'];
    if (s.arm === 'cav') return Math.round(s.size * CAV_TYPES[s.type].price * q.cost / 1.6);
    if (s.arm === 'gun') return Math.round(s.guns * 45 * q.cost / 1.6);
    let c = s.size * q.cost + (s.kind && s.kind !== 'battalion' ? 8 : 0);
    if (own) c += (s.rifles || 0) * 4 + (s.mounted ? 15 : 0);
    return Math.round(c);
  },
  total(side) { return side.units.reduce((a, s) => a + Builder.cost(s), side.own ? Builder.cost(side.own, true) : 0); },

  // the cavalry each side can buy
  horseFor(faction) { return Object.keys(CAV_TYPES).filter(k => CAV_TYPES[k].faction === faction); },

  // your company as the campaign would have it
  company(own, seed) {
    const co = Campaign.quickCompany(seed, { stage: QUALITY[own.quality].stage, size: own.size, type: own.kind === 'battalion' ? null : own.kind });
    co.drill = QUALITY[own.quality].drill + (own.kind === 'line' ? 0.05 : 0);
    co.nerve = QUALITY[own.quality].nerve;
    co.rifles = own.rifles || 0;
    for (const s of co.soldiers) s.weapon = 'musket';
    Campaign.armRifles(co);
    return co;
  },

  // both armies onto the field: yours along the south edge, theirs along the north; foot in the middle,
  // guns between the foot and a little forward, horse on the wings. A second line if the first is full.
  deploy(army, sc, f, rng) {
    const W = f.w, H = f.h;
    const place = (team, list, withPlayer) => {
      const south = team === TEAM_PLAYER, y0 = south ? H - 90 : 90, facing = south ? NORTH : SOUTH, back = south ? 1 : -1;
      const foot = list.filter(s => s.arm === 'foot'), cav = list.filter(s => s.arm === 'cav'), guns = list.filter(s => s.arm === 'gun');
      const nFoot = foot.length + (withPlayer ? 1 : 0);
      const perLine = Math.max(1, Math.floor((W - 160) / 110));
      const slot = k => { const line = Math.floor(k / perLine), j = k % perLine; const off = (j % 2 ? 1 : -1) * Math.ceil(j / 2); return { x: W / 2 + off * 110, y: y0 + back * line * 75 }; };
      const out = [];
      let k = 0, player = null;
      if (withPlayer) player = Object.assign(Builder.open(f, slot(k++)), { facing });
      for (const s of foot) {
        const p = Builder.open(f, slot(k++)), q = QUALITY[s.quality];
        out.push(Object.assign({ team, x: p.x, y: p.y, facing, size: s.size, drill: q.drill, nerve: q.nerve, doctrine: s.posture || 'attack',
          drummer: true, fifer: s.size >= 28, colours: true, ctype: s.kind === 'battalion' ? null : s.kind, built: s }));
      }
      guns.forEach((s, i) => {
        const p = Builder.open(f, { x: W / 2 + ((i % 2 ? 1 : -1) * (55 + Math.floor(i / 2) * 110)), y: y0 - back * 25 });
        out.push({ team, x: p.x, y: p.y, facing, arm: 'gun', guns: s.guns, drill: QUALITY[s.quality].drill, doctrine: 'battery', drummer: false, fifer: false, colours: false, built: s });
      });
      const wing = Math.min(W / 2 - 50, (Math.min(nFoot, perLine) / 2 + 0.8) * 110);
      cav.forEach((s, i) => {
        const p = Builder.open(f, { x: W / 2 + (i % 2 ? 1 : -1) * (wing + Math.floor(i / 2) * 70), y: y0 + back * 30 });
        out.push({ team, x: p.x, y: p.y, facing, arm: 'cav', cavType: s.type, size: s.size, drill: QUALITY[s.quality].drill, nerve: QUALITY[s.quality].nerve,
          doctrine: 'cavalry', drummer: true, fifer: false, colours: false, built: s });
      });
      return { player, out };
    };
    const mine = place(TEAM_PLAYER, army.mine.units, true), theirs = place(TEAM_ENEMY, army.theirs.units, false);
    return { player: mine.player, allies: mine.out, enemies: theirs.out, note: 'A battle of your own making.' };
  },

  // the nearest open ground to a spot (no river, no house, no wood if it can be helped), kept on the field
  open(f, p) {
    const ok = (x, y) => Field.inside(f, x, y) && x > 40 && x < f.w - 40 && Field.passable(f, x, y) && Field.typeAt(f, x, y) !== T.WOODS && Field.typeAt(f, x, y) !== T.WALL;
    const x0 = clamp(p.x, 50, f.w - 50), y0 = clamp(p.y, 40, f.h - 40);
    if (ok(x0, y0)) return { x: x0, y: y0 };
    for (let r = 6; r < 120; r += 6) for (let k = 0; k < 16; k++) {
      const x = x0 + Math.cos(k * Math.PI / 8) * r, y = y0 + Math.sin(k * Math.PI / 8) * r;
      if (ok(x, y)) return { x, y };
    }
    return { x: x0, y: y0 };
  },

  // a sensible starting army: your company and one each way
  starter() {
    return {
      map: 'plain', budget: 350,
      mine: { own: { size: 32, kind: 'battalion', quality: 'trained', rifles: 2, mounted: false },
        units: [{ arm: 'foot', size: 24, kind: 'battalion', quality: 'trained', posture: 'hold' }] },
      theirs: { units: [
        { arm: 'foot', size: 32, kind: 'battalion', quality: 'trained', posture: 'attack' },
        { arm: 'foot', size: 24, kind: 'light', quality: 'trained', posture: 'attack' },
        { arm: 'cav', size: 24, type: 'chasseurs', quality: 'trained' }] },
    };
  },
};
