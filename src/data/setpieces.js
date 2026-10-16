'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SET PIECES — the big battles. A brigade either side, a headquarters
//  (command.js) handing out tasks, and you: always one company, told
//  what to do by the colonel. Bigger field (`size`); `setpiece: true`
//  switches headquarters on.
//
//  Task shapes (see command.js):
//    hold    { kind:'hold', x, y, facing, text }
//    reserve { kind:'reserve', x, y, facing, text, wave?: seconds, goal?: {x,y} }
//    attack  { kind:'attack', x, y, text }
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const hold = (x, y, text, facing = NORTH) => ({ kind: 'hold', x, y, facing, text });
const reserve = (x, y, text, facing = NORTH) => ({ kind: 'reserve', x, y, facing, text });
const wave = (x, y, at, goal) => ({ kind: 'reserve', x, y, facing: SOUTH, wave: at, goal });
const attack = (x, y) => ({ kind: 'attack', x, y });
// a company spec carrying its task, standing where the task puts it
const post = (team, task, size, drill, extra = {}) => coy(team, task.x, task.y, task.facing != null ? task.facing : (team === TEAM_ENEMY ? SOUTH : NORTH), size, drill, task.kind === 'attack' ? 'attack' : 'hold', Object.assign({ task }, extra));

// a company beside you, sharing your task (the user wanted the big battles "close up, and more people":
// shoulder to shoulder, ~65-75 m apart). `at` = where you start, for an attack (post() would put them on
// the objective); a timed fall-back moves with them, a few seconds after yours
function beside(you, dx, name, at, size = 22, drill = 0.5, extra = {}) {
  const t = Object.assign({}, you, { x: you.x + dx, text: 'beside you' });
  if (you.then) t.then = { at: you.then.at + 8, task: Object.assign({}, you.then.task, { x: you.then.task.x + dx }) };
  if (you.kind === 'attack') t.x = you.x + dx * 0.6;
  const start = you.kind === 'attack' && at ? { x: at.x + dx, y: at.y, facing: NORTH } : {};
  return post(0, t, size, drill, Object.assign({ name, fifer: false }, start, extra));
}

// where a road crosses a ridge it goes through a saddle: lower the crest along the road line
function saddle(f, x0, x1, ry, depth = 9, w = 32) {
  Paint.each(f, (x, y, i) => {
    const rx = lerp(x0, x1, y / f.h);
    f.height[i] -= depth * Math.exp(-Math.pow((x - rx) / w, 2) / 2) * Math.exp(-Math.pow((y - ry) / 90, 2) / 2);
  });
}

function ridgeLine(f, rng, ry, h = 16, w = 70) {
  const rN = makeNoise(rng);
  Paint.each(f, (x, y, i) => {
    const cy = ry + (rN(x / 260, 5, 2) - 0.5) * 50;
    f.height[i] += h * Math.exp(-Math.pow((y - cy) / w, 2));
  });
}

Object.assign(SCENARIOS, {
  sp_ridge: {
    name: 'The Long Ridge', setpiece: true, size: [1000, 720],
    retreat: { x: 520, r: 36, label: 'The Brussels road' },
    blurb: 'The whole brigade is drawn up behind a long ridge. The French will come up it in columns. Wellington wants them met at the crest.',
    build(f, rng) {
      baseGround(f, rng, { amp: 4, woods: 0.06 });
      ridgeLine(f, rng, 455);
      saddle(f, 500, 520, 455);
      Paint.disc(f, 60, 430, 70, T.WOODS); Paint.disc(f, 950, 450, 60, T.WOODS);
      Paint.line(f, 500, 0, 520, f.h, T.ROAD, 2.5);
    },
    deploy(rng, lv) {
      const e = enemyStrength(lv, rng), sz = Math.round(e.size * 0.75);
      const you = hold(480, 505, 'Hold the centre of the ridge, just behind the crest. When they come up the slope, step up to the crest and give them a volley — but do not go down the hill until I say.');
      return {
        player: { x: you.x, y: you.y, facing: NORTH, task: you },
        allies: [
          beside(you, -75, 'No. 1 Coy, 1/9th'),
          beside(you, 75, 'No. 5 Coy, 1/38th'),
          post(0, hold(180, 500, 'hold the left'), 22, 0.45, { name: 'Light Coy, 1/43rd', fifer: false }),
          post(0, hold(330, 505, 'hold the left-centre'), 24, 0.45, { name: 'No. 3 Coy, 1/88th', fifer: false }),
          post(0, hold(630, 505, 'hold the right-centre'), 24, 0.45, { name: 'No. 6 Coy, 1/45th', fifer: false }),
          post(0, hold(780, 500, 'hold the right'), 22, 0.45, { name: 'No. 2 Coy, 1/7th Fusiliers', fifer: false }),
          post(0, reserve(500, 640, 'in reserve'), 24, 0.55, { name: 'Grenadier Coy, 1/28th', fifer: false }),
        ],
        enemies: [
          post(1, wave(480, 40, 240 + rng() * 60, { x: 480, y: 480 }), sz, e.drill, { nerve: e.nerve, fifer: false, name: '3e Cie, 2/31e Léger' }),
          post(1, attack(270, 470), sz, e.drill, { nerve: e.nerve, y: 100 }),
          post(1, attack(430, 470), sz, e.drill, { nerve: e.nerve, y: 90, fifer: false }),
          post(1, attack(590, 470), sz, e.drill, { nerve: e.nerve, y: 90 }),
          post(1, attack(750, 470), sz, e.drill, { nerve: e.nerve, y: 100, fifer: false }),
          post(1, wave(380, 40, 300 + rng() * 60, { x: 420, y: 480 }), sz, e.drill, { nerve: e.nerve, fifer: false }),
          post(1, wave(620, 40, 330 + rng() * 60, { x: 600, y: 480 }), sz, e.drill, { nerve: e.nerve, fifer: false }),
          // the grand battery on their ridge: it can only hurt what stands where it can see
          guns(400, 170, SOUTH, 2, Math.max(lv, 0.5)),
          guns(640, 170, SOUTH, 2, Math.max(lv, 0.5)),
          // the afternoon: heavy horse comes over the valley to break whatever the foot have shaken
          horse(250, 30, SOUTH, Math.max(lv, 0.8), rng, { cavType: 'cuirassiers', delay: 420 }),
          horse(760, 30, SOUTH, Math.max(lv, 0.8), rng, { cavType: 'cuirassiers', delay: 450 }),
        ],
        note: 'Five companies of ours on the ridge. Six of theirs, in two waves, a grand battery — and their heavy cavalry behind.',
      };
    },
  },

  sp_village: {
    name: 'The Village on the Stream', setpiece: true, size: [1000, 720],
    blurb: 'Two companies hold a village of stone houses behind a stream. You stand in reserve. The village will be lost and retaken before the day is out.',
    crossings: [[300, 250 + Math.sin(300 / 110) * 20], [500, 250 + Math.sin(500 / 110) * 20], [700, 250 + Math.sin(700 / 110) * 20]],
    build(f, rng) {
      baseGround(f, rng, { amp: 3, woods: 0.05 });
      const pts = [];
      for (let x = -10; x <= f.w + 10; x += 20) pts.push([x, 250 + Math.sin(x / 110) * 20]);
      Paint.polyline(f, pts, T.WATER, 6);
      Paint.each(f, (x, y, i) => { if (f.type[i] === T.WATER) f.height[i] -= 1.5; });
      const cs = SCENARIOS.sp_village.crossings;
      Paint.disc(f, cs[0][0], cs[0][1], 13, T.FORD); Paint.disc(f, cs[2][0], cs[2][1], 13, T.FORD);
      Paint.line(f, cs[1][0], cs[1][1] - 14, cs[1][0], cs[1][1] + 14, T.BRIDGE, 2.5);
      Paint.line(f, 500, 0, 500, cs[1][1] - 15, T.ROAD, 2.5, t => t !== T.WATER);
      Paint.line(f, 500, cs[1][1] + 15, 500, f.h, T.ROAD, 2.5, t => t !== T.WATER);
      // the village: houses either side of the road, garden walls, a church. The houses sit back from
      // the north wall so the garrison can line it, facing the stream (they once spawned inside them)
      Paint.rect(f, 515, 355, 545, 385, T.BUILDING);
      for (let k = 0; k < 10; k++) {
        const side = k % 2 ? 1 : -1, y = 332 + Math.floor(k / 2) * 22 + rng.range(-3, 3);
        const hx = 500 + side * rng.range(30, 70), hw = rng.range(6, 10), hh = rng.range(5, 7);
        Paint.rect(f, hx - hw, y - hh, hx + hw, y + hh, T.BUILDING);
      }
      Paint.enclosure(f, 400, 300, 600, 430, [[0, 0.5], [2, 0.5], [0, 0.2], [0, 0.8], [1, 0.5], [3, 0.5]]);
      Paint.disc(f, 200, 400, 55, T.WOODS);
    },
    deploy(rng, lv) {
      const e = enemyStrength(lv, rng), sz = Math.round(e.size * 0.68);
      const you = reserve(470, 600, 'Stand in reserve behind the village. When I send for you, go in hard.');
      return {
        player: { x: you.x, y: you.y, facing: NORTH, task: you },
        allies: [
          beside(you, -70, 'No. 8 Coy, 2/30th'),
          beside(you, 70, 'No. 3 Coy, 1/5th'),
          post(0, hold(458, 306, 'line the village wall'), 22, 0.45, { name: 'No. 3 Coy, 1/88th', fifer: false }),
          post(0, hold(542, 306, 'line the village wall'), 22, 0.45, { name: 'No. 6 Coy, 1/45th', fifer: false }),
          post(0, hold(300, 305, 'watch the west ford'), 20, 0.5, { name: 'Light Coy, 2/95th', fifer: false, colours: false }),
          post(0, reserve(640, 610, 'in reserve'), 24, 0.5, { name: 'No. 2 Coy, 1/7th Fusiliers', fifer: false }),
        ],
        enemies: [
          post(1, wave(500, 40, 330 + rng() * 60, { x: 500, y: 350 }), sz, e.drill, { nerve: e.nerve, fifer: false, name: '5e Cie, 1/47e Ligne' }),
          post(1, attack(300, 300), sz, e.drill, { nerve: e.nerve, x: 300, y: 90 }),
          post(1, attack(500, 330), sz, e.drill, { nerve: e.nerve, x: 470, y: 80, fifer: false }),
          post(1, attack(520, 330), sz, e.drill, { nerve: e.nerve, x: 560, y: 80 }),
          post(1, attack(700, 300), sz, e.drill, { nerve: e.nerve, x: 700, y: 90, fifer: false }),
          post(1, wave(420, 40, 200 + rng() * 60, { x: 470, y: 340 }), sz, e.drill + 0.05, { nerve: e.nerve + 4, fifer: false }),
          post(1, wave(600, 40, 260 + rng() * 60, { x: 540, y: 340 }), sz, e.drill + 0.05, { nerve: e.nerve + 4, fifer: false, name: 'Grenadiers, 1/88e' }),
        ],
        note: 'You are in reserve. Six French companies are coming for the village.',
      };
    },
  },

  // the campaign's last battle
  finale: {
    name: 'The Field of Glory', setpiece: true, final: true, size: [1100, 760],
    retreat: { x: 500, r: 40, label: 'The road to Brussels' },
    blurb: 'The whole army is up. A ridge, two walled farms out in front of it, and the Emperor’s columns coming on in waves. Hold the centre.',
    build(f, rng) {
      baseGround(f, rng, { amp: 4, woods: 0.06 });
      ridgeLine(f, rng, 500);
      saddle(f, 550, 560, 500);
      Paint.line(f, 550, 0, 560, f.h, T.ROAD, 2.5);
      // the great farm on the right, with its orchard and wood
      Paint.rect(f, 820, 360, 920, 450, T.GRASS);
      Paint.enclosure(f, 820, 360, 920, 450, [[3, 0.5], [2, 0.3]]);
      Paint.rect(f, 835, 372, 870, 392, T.BUILDING); Paint.rect(f, 885, 400, 908, 438, T.BUILDING);
      Paint.rect(f, 925, 360, 1000, 450, T.ORCHARD);
      Paint.disc(f, 870, 300, 50, T.WOODS);
      // the little farm in the centre, by the road
      Paint.enclosure(f, 590, 400, 650, 450, [[3, 0.5], [2, 0.5]]);
      Paint.rect(f, 600, 410, 625, 428, T.BUILDING);
    },
    deploy(rng, lv) {
      const e = enemyStrength(Math.max(lv, 0.85), rng), sz = Math.round(e.size * 0.68);
      const you = hold(470, 545, 'Hold the centre of the ridge, left of the road. When the Guard comes, it comes at you. Stand.');
      return {
        player: { x: you.x, y: you.y, facing: NORTH, task: you },
        allies: [
          beside(you, -75, 'No. 7 Coy, 1/40th'),
          beside(you, 72, 'No. 4 Coy, 1/30th'),
          post(0, hold(870, 405, 'hold the great farm'), 22, 0.6, { name: 'Light Coy, 2nd Foot Guards', fifer: false }),
          post(0, hold(620, 440, 'hold the little farm'), 20, 0.6, { name: 'No. 1 Coy, 2nd Light KGL', fifer: false, colours: false }),
          post(0, hold(280, 545, 'hold the left'), 24, 0.5, { name: 'No. 2 Coy, 1/52nd', fifer: false }),
          post(0, hold(640, 545, 'hold the right-centre'), 24, 0.5, { name: 'No. 6 Coy, 1/45th', fifer: false }),
          post(0, reserve(500, 670, 'in reserve'), 26, 0.7, { name: 'Grenadier Coy, 1st Foot Guards', fifer: false }),
        ],
        enemies: [
          post(1, attack(870, 400), sz, e.drill, { nerve: e.nerve, x: 860, y: 110 }),
          post(1, attack(860, 420), sz, e.drill, { nerve: e.nerve, x: 950, y: 120, fifer: false }),
          post(1, attack(620, 430), sz, e.drill, { nerve: e.nerve, x: 620, y: 90 }),
          post(1, wave(300, 50, 140 + rng() * 40, { x: 300, y: 530 }), sz, e.drill, { nerve: e.nerve, fifer: false }),
          post(1, wave(470, 40, 300 + rng() * 40, { x: 470, y: 530 }), sz, e.drill, { nerve: e.nerve }),
          post(1, wave(650, 40, 320 + rng() * 40, { x: 640, y: 530 }), sz, e.drill, { nerve: e.nerve, fifer: false }),
          post(1, wave(440, 30, 540 + rng() * 60, { x: 470, y: 540 }), sz + 4, Math.min(0.95, e.drill + 0.2), { nerve: e.nerve + 12, name: 'Grenadiers de la Garde' }),
          post(1, wave(520, 30, 560 + rng() * 60, { x: 500, y: 540 }), sz + 4, Math.min(0.95, e.drill + 0.2), { nerve: e.nerve + 12, name: 'Chasseurs de la Garde', fifer: false }),
          // the grand battery: the reverse slope is what it is for
          guns(400, 170, SOUTH, 2, 0.9, { name: 'Grande Batterie (left)' }),
          guns(700, 170, SOUTH, 2, 0.9, { name: 'Grande Batterie (right)' }),
          // Ney's cuirassiers come up the slope in the afternoon; lancers work round the flank first
          horse(1060, 260, SOUTH, 0.9, rng, { cavType: 'lancers', name: '1er Esc., 6e Lanciers', delay: 200 + rng() * 60 }),
          horse(300, 30, SOUTH, 0.9, rng, { cavType: 'cuirassiers', name: '1er Esc., 4e Cuirassiers', delay: 380 + rng() * 60 }),
          horse(800, 30, SOUTH, 0.9, rng, { cavType: 'cuirassiers', name: '2e Esc., 9e Cuirassiers', delay: 410 + rng() * 60 }),
        ],
        note: 'Five companies of ours beside you. Eight of theirs, the Guard last — a grand battery, and Ney’s cuirassiers.',
      };
    },
  },
});

const SETPIECE_POOL = ['sp_ridge', 'sp_village'];
