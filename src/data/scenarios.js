'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SCENARIOS — a battle is a piece of ground plus who is on it.
//  Usually it is commander against commander; the ground is what lets
//  more companies in: a farm wants a garrison, a ford lets the enemy
//  bring two, a ridge hides yours.
//
//  build(f, rng)        paints terrain + elevation
//  deploy(rng, level)   → { player, allies[], enemies[] }  (level 0..1 = campaign progress)
//  You always deploy on the SOUTH edge facing north; the enemy on the north.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const NORTH = -Math.PI / 2, SOUTH = Math.PI / 2;

function baseGround(f, rng, { amp = 5, wheat = 0.3, woods = 0.12, scale = 1 } = {}) {
  const hN = makeNoise(rng), cN = makeNoise(rng), wN = makeNoise(rng);
  Paint.each(f, (x, y, i) => {
    f.height[i] = hN(x / 140 * scale, y / 140 * scale, 3) * amp;
    const c = cN(x / 60, y / 60, 2), w = wN(x / 90, y / 90, 3);
    if (w > 1 - woods * 0.9) f.type[i] = T.WOODS;
    else if (c > 1 - wheat) f.type[i] = T.WHEAT;
  });
  // keep deployment zones clear of woods so companies start formed
  Paint.each(f, (x, y, i) => {
    if ((y < 120 || y > f.h - 120) && Math.abs(x - f.w / 2) < 170 && f.type[i] === T.WOODS) f.type[i] = T.GRASS;
  });
}

// an enemy/ally company spec — the battle turns these into Units
function coy(team, x, y, facing, size, drill, doctrine, extra = {}) {
  return Object.assign({ team, x, y, facing, size, drill, doctrine,
    drummer: true, fifer: team === TEAM_ENEMY ? size >= 28 : true, colours: true }, extra);
}
const enemyStrength = (level, rng) => ({
  size: Math.round(22 + level * 16 + rng.int(-2, 3)),
  drill: clamp(0.25 + level * 0.5 + rng.range(-0.08, 0.08), 0.1, 0.95),
  nerve: Math.round(level * 8),
});

const SCENARIOS = {
  plain: {
    name: 'Open Ground', blurb: 'Rolling farmland and nowhere to hide. Two companies, one field, and whoever stands longest.',
    build(f, rng) { baseGround(f, rng, { amp: 6 }); },
    deploy(rng, lv) {
      const e = enemyStrength(lv, rng);
      return {
        player: { x: 360, y: 470, facing: NORTH },
        allies: [],
        enemies: [coy(1, 360 + rng.range(-60, 60), 95, SOUTH, e.size, e.drill, 'attack', { nerve: e.nerve })],
      };
    },
  },

  ridge: {
    name: 'The Reverse Slope', blurb: 'A low ridge runs across the field. Keep your men behind the crest and they will not be seen — or shot — until the enemy is on top of you.',
    build(f, rng) {
      baseGround(f, rng, { amp: 4, woods: 0.08 });
      const rN = makeNoise(rng);
      Paint.each(f, (x, y, i) => {
        const ry = 330 + (rN(x / 200, 3, 2) - 0.5) * 60;
        f.height[i] += 13 * Math.exp(-Math.pow((y - ry) / 55, 2));
      });
    },
    deploy(rng, lv) {
      const e = enemyStrength(lv, rng);
      return {
        player: { x: 360, y: 440, facing: NORTH },
        allies: [],
        enemies: [
          coy(1, 280, 90, SOUTH, Math.round(e.size * 0.75), e.drill - 0.05, 'attack', { nerve: e.nerve }),
          coy(1, 450, 80, SOUTH, Math.round(e.size * 0.65), e.drill - 0.05, 'attack', { nerve: e.nerve, fifer: false, delay: 40 }),
        ],
        note: 'They bring two companies. You have the ridge.',
      };
    },
  },

  farm: {
    retreat: { x: 120, label: 'The sunken road' },
    name: 'The Walled Farm', blurb: 'A stone-walled farm sits in the middle of the field. A company of ours holds it; the enemy means to take it. Support them.',
    build(f, rng) {
      baseGround(f, rng, { amp: 4, woods: 0.06 });
      const x0 = 300, y0 = 230, x1 = 410, y1 = 310;
      Paint.rect(f, x0 - 4, y0 - 4, x1 + 4, y1 + 4, T.GRASS);
      Paint.enclosure(f, x0, y0, x1, y1, [[2, 0.5], [0, 0.2]]);
      Paint.rect(f, x0 + 10, y0 + 10, x0 + 42, y0 + 26, T.BUILDING);
      Paint.rect(f, x1 - 34, y0 + 8, x1 - 10, y0 + 30, T.BUILDING);
      Paint.rect(f, x0 + 12, y1 - 22, x0 + 30, y1 - 10, T.BUILDING);
      Paint.rect(f, x1 + 8, y0 - 10, x1 + 70, y1 + 10, T.ORCHARD);
      Paint.enclosure(f, x1 + 6, y0 - 12, x1 + 72, y1 + 12, [[3, 0.5], [2, 0.5]], T.WALL);
      Paint.line(f, 360, f.h, 360, y1, T.ROAD, 2.5);
    },
    deploy(rng, lv) {
      const e = enemyStrength(lv, rng);
      return {
        player: { x: 340, y: 450, facing: NORTH },
        allies: [coy(0, 355, 234, NORTH, 22, 0.45, 'hold', { name: 'Garrison, 2/3rd Guards', fifer: false })],
        enemies: [
          coy(1, 270, 70, SOUTH, e.size, e.drill, 'attack', { nerve: e.nerve, objective: [355, 240] }),
          coy(1, 470, 70, SOUTH, e.size, e.drill, 'attack', { nerve: e.nerve, objective: [440, 260], fifer: false }),
        ],
        note: 'A friendly garrison holds the farm. Two enemy companies are coming for it.',
      };
    },
  },

  ford: {
    retreat: { x: 400, r: 26, label: 'The road south' },
    name: 'The Ford', blurb: 'A river cuts the field, crossed by a ford and a narrow bridge. Hold the south bank; anyone who crosses must do it in column, under your muskets.',
    // the river's centreline; crossings sit ON it so they span the whole channel
    crossings: [[190, 260 + Math.sin(190 / 90) * 18], [520, 260 + Math.sin(520 / 90) * 18]],
    build(f, rng) {
      baseGround(f, rng, { amp: 4, woods: 0.1 });
      const pts = [];
      for (let x = -10; x <= f.w + 10; x += 20) pts.push([x, 260 + Math.sin(x / 90) * 18]);
      Paint.polyline(f, pts, T.WATER, 7);
      Paint.polyline(f, pts, T.MARSH, 12, t => t !== T.WATER && t !== T.WOODS && rng() < 0.4);
      Paint.each(f, (x, y, i) => { if (f.type[i] === T.WATER) f.height[i] -= 1.5; });
      const [fx, fy] = SCENARIOS.ford.crossings[0], [bx, by] = SCENARIOS.ford.crossings[1];
      Paint.disc(f, fx, fy, 14, T.FORD);
      Paint.line(f, bx, by - 16, bx, by + 16, T.BRIDGE, 2.5);
      Paint.line(f, bx, 0, bx, by - 17, T.ROAD, 2.5, t => t !== T.WATER);
      Paint.line(f, bx, by + 17, 400, f.h, T.ROAD, 2.5, t => t !== T.WATER);
    },
    deploy(rng, lv) {
      const e = enemyStrength(lv, rng);
      return {
        player: { x: 360, y: 400, facing: NORTH },
        allies: [],
        enemies: [
          coy(1, 220, 80, SOUTH, Math.round(e.size * 0.75), e.drill, 'attack', { nerve: e.nerve }),
          coy(1, 500, 70, SOUTH, Math.round(e.size * 0.7), e.drill, 'attack', { nerve: e.nerve, fifer: false, delay: 60 }),
        ],
        note: 'Two companies must cross at the ford and the bridge.',
      };
    },
  },

  woods: {
    retreat: { x: 600, r: 28, label: 'The cart track' },
    name: 'Edge of the Wood', blurb: 'The enemy has thrown skirmishers into the wood ahead, with a formed company behind. Men in trees are hard to hit and harder to dig out.',
    build(f, rng) {
      baseGround(f, rng, { amp: 5, woods: 0.05 });
      const wN = makeNoise(rng);
      Paint.each(f, (x, y, i) => {
        const edge = 230 + (wN(x / 80, 7, 2) - 0.5) * 70;
        if (y < edge && y > 130 && wN(x / 40, y / 40, 2) > 0.28) f.type[i] = T.WOODS;
      });
    },
    deploy(rng, lv) {
      const e = enemyStrength(lv, rng);
      return {
        player: { x: 360, y: 470, facing: NORTH },
        allies: [],
        enemies: [
          coy(1, 360, 200, SOUTH, Math.round(e.size * 0.45), e.drill, 'skirmish', { nerve: e.nerve, name: 'Voltigeurs', fifer: false, colours: false }),
          coy(1, 360, 75, SOUTH, Math.round(e.size * 0.85), e.drill, 'hold', { nerve: e.nerve }),
        ],
      };
    },
  },

  village: {
    name: 'The Village', blurb: 'The enemy holds a village of stone cottages and garden walls. A company of ours will go in with you. Take it.',
    build(f, rng) {
      baseGround(f, rng, { amp: 3, woods: 0.05 });
      Paint.line(f, 360, 0, 360, f.h, T.ROAD, 3);
      Paint.line(f, 180, 210, 560, 200, T.ROAD, 2.5);
      const houses = [];
      for (let k = 0; k < 9; k++) {
        const side = k % 2 ? 1 : -1, y = 130 + Math.floor(k / 2) * 38 + rng.range(-6, 6);
        houses.push([360 + side * rng.range(14, 30), y]);
      }
      houses.push([260, 196], [470, 186], [300, 230]);
      for (const [hx, hy] of houses) {
        const hw = rng.range(6, 10), hh = rng.range(5, 8);
        Paint.rect(f, hx - hw, hy - hh, hx + hw, hy + hh, T.BUILDING);
        if (rng() < 0.6) Paint.enclosure(f, hx - hw - 10, hy + hh, hx + hw + 10, hy + hh + 22, [[2, 0.5], [0, 0.85]]);
      }
      Paint.rect(f, 230, 260, 300, 300, T.ORCHARD);
    },
    deploy(rng, lv) {
      const e = enemyStrength(lv, rng);
      return {
        player: { x: 300, y: 470, facing: NORTH },
        allies: [coy(0, 450, 475, NORTH, 24, 0.4, 'attack', { name: 'No. 5 Coy, 1/43rd', fifer: false, objective: [400, 210] })],
        enemies: [
          coy(1, 360, 215, SOUTH, Math.round(e.size * 0.75), e.drill, 'hold', { nerve: e.nerve + 4 }),
          coy(1, 380, 80, SOUTH, Math.round(e.size * 0.8), e.drill, 'attack', { nerve: e.nerve, fifer: false, delay: 150 }),
        ],
        note: 'You attack, with a friendly company on your right. Their reserve will come up from the north.',
      };
    },
  },

  lane: {
    name: 'The Hollow Lane', blurb: 'A sunken lane hedged on both banks crosses the field. The enemy is lying in it. Hedges stop very little and hide a great deal.',
    build(f, rng) {
      baseGround(f, rng, { amp: 4, woods: 0.06 });
      const pts = [];
      for (let x = -10; x <= f.w + 10; x += 30) pts.push([x, 230 + Math.sin(x / 130) * 20]);
      Paint.polyline(f, pts, T.ROAD, 3);
      Paint.each(f, (x, y, i) => {
        if (f.type[i] === T.ROAD) f.height[i] -= 2.2;
      });
      Paint.polyline(f, pts.map(([x, y]) => [x, y + 6]), T.WALL, 0.8, t => t !== T.ROAD);
      Paint.polyline(f, pts.map(([x, y]) => [x, y - 6]), T.WALL, 0.8, t => t !== T.ROAD);
    },
    deploy(rng, lv) {
      const e = enemyStrength(lv, rng);
      return {
        player: { x: 300, y: 470, facing: NORTH },
        // a lane is too long for one company to rush: the brigade lends you another
        allies: [coy(0, 460, 475, NORTH, 22, 0.45, 'attack', { name: 'No. 6 Coy, 1/45th', fifer: false, objective: [430, 228] })],
        enemies: [coy(1, 360, 228, SOUTH, e.size, e.drill + 0.05, 'hold', { nerve: e.nerve + 6 })],
        note: 'One company, well placed in the lane. You and the 45th go in together.',
      };
    },
  },

  // the campaign's last battle
  finale: {
    name: 'The Field of Glory', blurb: 'The whole army is up. A ridge, a farm on the flank, and the Emperor’s columns coming on. Hold the centre.',
    final: true,
    build(f, rng) {
      SCENARIOS.ridge.build(f, rng);
      Paint.enclosure(f, 70, 250, 160, 320, [[1, 0.5]]);
      Paint.rect(f, 85, 262, 120, 285, T.BUILDING);
    },
    deploy(rng, lv) {
      const e = enemyStrength(Math.max(lv, 0.85), rng);
      return {
        player: { x: 360, y: 440, facing: NORTH },
        allies: [
          coy(0, 220, 445, NORTH, 26, 0.55, 'hold', { name: 'No. 2 Coy, 1/52nd', fifer: false }),
          coy(0, 115, 300, NORTH, 20, 0.5, 'hold', { name: 'Light Coy, 2/95th', fifer: false, colours: false }),
        ],
        enemies: [
          coy(1, 250, 70, SOUTH, e.size, e.drill, 'attack', { nerve: e.nerve }),
          coy(1, 400, 60, SOUTH, e.size, e.drill, 'attack', { nerve: e.nerve, fifer: false }),
          coy(1, 540, 80, SOUTH, e.size, e.drill, 'attack', { nerve: e.nerve, fifer: false }),
          coy(1, 130, 90, SOUTH, Math.round(e.size * 0.7), e.drill, 'attack', { nerve: e.nerve, fifer: false, colours: false, objective: [115, 290] }),
        ],
        note: 'Two companies of ours beside you. Four of theirs.',
      };
    },
  },
};

const BATTLE_POOL = ['plain', 'ridge', 'farm', 'ford', 'woods', 'village', 'lane'];
