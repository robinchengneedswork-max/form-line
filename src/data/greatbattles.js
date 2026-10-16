'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  GREAT BATTLES — the set pieces drawn from the real campaigns, two to
//  an act (campaign.js ACTS[k].setpieces). Each one is a different kind
//  of day, and most bring one thing the others do not:
//
//    I   The Bridge on the Côa   a rearguard: hold, fall back over the one
//                                bridge on a written order (task.then), hold it
//        The Hill at Albuera     a hailstorm (sc.weather): 140 m of sight,
//                                wet powder — and lancers out of the rain
//    II  The Arapiles            YOU attack: a French division strung out on
//                                the march, and our heavy dragoons behind you
//        The Pass at Maya        outnumbered in a pass, mist; hold until the
//                                relief marches on from the valley (`arrive`)
//    III The Crossroads          rye taller than a man (f.rye): no one sees
//                                anyone past ~90 m — least of all the cuirassiers
//        Hougoumont              you are the garrison: the garden wall, the
//                                wood in front, brigade after brigade
//
//  Uses the helpers in setpieces.js (hold / reserve / wave / attack / post).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const EAST = 0, WEST = Math.PI;
// a task that changes at a given hour: the rearguard holds, then goes back over the river
const thenRetire = (task, at, x, y, text) => Object.assign(task, { then: { at, task: { kind: 'hold', retire: true, x, y, facing: NORTH, text: text || 'fall back' } } });
// one of ours, waiting off the field, who marches on at `at` and goes straight in
const relief = (x, y, at, goal, extra) => Object.assign({ x, y, facing: NORTH, arrive: at,
  task: { kind: 'reserve', x, y: y - 40, facing: NORTH, wave: at + 4, goal } }, extra);
// a smooth hump of ground
function hill(f, cx, cy, h, rx, ry = rx) {
  Paint.each(f, (x, y, i) => { f.height[i] += h * Math.exp(-(Math.pow(x - cx, 2) / (2 * rx * rx) + Math.pow(y - cy, 2) / (2 * ry * ry))); });
}

Object.assign(SCENARIOS, {
  // ── Act I ──────────────────────────────────────────
  sp_coa: {
    name: 'The Bridge on the Côa', setpiece: true, size: [1000, 760],
    retreat: { x: 540, r: 36, label: 'The road to Pinhel' },
    blurb: 'The Light Division’s rearguard, on the wrong side of a river in flood, with Ney’s whole corps coming on. One bridge behind you. Hold, then get over it — then hold it.',
    river: x => 470 + Math.sin(x / 130) * 18,
    build(f, rng) {
      baseGround(f, rng, { amp: 4, wheat: 0.12, woods: 0.04 });
      const ry = SCENARIOS.sp_coa.river, bx = 560;
      // the river runs in a gorge; the far bank climbs to a long slope above the bridge
      Paint.each(f, (x, y, i) => {
        f.height[i] -= 9 * Math.exp(-Math.pow((y - ry(x)) / 38, 2));
        f.height[i] += 13 * clamp((y - ry(x) - 30) / 150, 0, 1);
      });
      const pts = [];
      for (let x = -10; x <= f.w + 10; x += 20) pts.push([x, ry(x)]);
      Paint.polyline(f, pts, T.WATER, 7);
      Paint.line(f, bx, ry(bx) - 17, bx, ry(bx) + 17, T.BRIDGE, 3);
      Paint.line(f, 510, 0, bx, ry(bx) - 18, T.ROAD, 2.5, t => t !== T.WATER);
      Paint.line(f, bx, ry(bx) + 18, 540, f.h, T.ROAD, 2.5, t => t !== T.WATER);
      // the vineyards on the near bank: low stone walls, every one a breastwork
      Paint.enclosure(f, 250, 300, 360, 350, [[2, 0.5], [0, 0.3]]);
      Paint.enclosure(f, 400, 290, 490, 345, [[2, 0.3], [1, 0.5]]);
      Paint.enclosure(f, 600, 300, 720, 350, [[2, 0.6], [3, 0.5]]);
      Paint.rect(f, 254, 304, 356, 346, T.ORCHARD); Paint.rect(f, 604, 304, 716, 346, T.ORCHARD);
      Paint.disc(f, 840, 640, 50, T.WOODS); Paint.disc(f, 160, 650, 45, T.WOODS);
    },
    deploy(rng, lv) {
      const e = enemyStrength(lv, rng), sz = Math.round(e.size * 0.78);
      const back = 270 + rng() * 50;
      const you = thenRetire(hold(450, 350, 'Hold the vineyard walls with the rearguard. The bridge behind you is the only way over the river. When I send word, fall back over it — quickly, before they cut you off from it.'),
        back, 500, 600, 'Fall back over the bridge — now! Form on the slope above it and let nobody across.');
      return {
        player: { x: you.x, y: you.y, facing: NORTH, task: you },
        allies: [
          beside(you, -75, 'No. 6 Coy, 1/43rd'),
          beside(you, 85, 'No. 2 Coy, 1/95th Rifles', null, 18, 0.6, { colours: false }),
          post(0, thenRetire(hold(300, 352, 'hold the left vineyard'), back + 25, 380, 612), 22, 0.5, { name: 'Light Coy, 1/43rd', fifer: false }),
          post(0, thenRetire(hold(660, 352, 'skirmish in the vineyards'), back - 30, 640, 600), 18, 0.6, { name: 'No. 4 Coy, 1/95th Rifles', fifer: false, colours: false }),
          post(0, hold(600, 590, 'cover the bridge from the far bank'), 22, 0.5, { name: 'No. 2 Coy, 1/52nd', fifer: false }),
          guns(450, 650, NORTH, 2, 0.5, { team: TEAM_PLAYER, name: 'Ross’s Troop, RHA' }),
        ],
        enemies: [
          post(1, attack(450, 340), sz, e.drill, { nerve: e.nerve, x: 440, y: 50, fifer: false, name: 'Voltigeurs, 6e Léger' }),
          post(1, attack(300, 340), sz, e.drill, { nerve: e.nerve, x: 290, y: 80 }),
          post(1, attack(450, 340), sz, e.drill, { nerve: e.nerve, x: 460, y: 70, fifer: false }),
          post(1, attack(660, 340), sz, e.drill, { nerve: e.nerve, x: 680, y: 80 }),
          horse(870, 110, SOUTH, lv, rng, { name: '2e Esc., 3e Hussards' }),
          // then they try to storm the bridge, one column after another
          post(1, wave(520, 40, back + 160 + rng() * 40, { x: 560, y: 560 }), sz + 2, e.drill + 0.05, { nerve: e.nerve + 4, name: 'Grenadiers, 66e Ligne', fifer: false }),
          post(1, wave(600, 40, back + 260 + rng() * 40, { x: 560, y: 560 }), sz + 2, e.drill + 0.05, { nerve: e.nerve + 4, name: 'Carabiniers, 4e Léger' }),
          post(1, wave(440, 40, back + 360 + rng() * 40, { x: 560, y: 560 }), sz + 4, e.drill + 0.08, { nerve: e.nerve + 8, name: 'Chasseurs de la Siège, 66e', fifer: false }),
        ],
        note: 'The rearguard of the Light Division. Three French columns now — and three more to storm the bridge once you are over it.',
      };
    },
  },

  sp_albuera: {
    name: 'The Hill at Albuera', setpiece: true, size: [1000, 760],
    blurb: 'The French have turned the flank and taken the hill. The brigade goes up in line to take them in the side — into a hailstorm so thick you cannot see the next company. There is French horse somewhere out on the right.',
    weather: { kind: 'rain', label: 'A hailstorm', sight: 140, misfire: 0.35, until: [270, 380],
      clears: 'The squall blows through. You can see the hill again — and what is on it.' },
    build(f, rng) {
      baseGround(f, rng, { amp: 3, wheat: 0.12, woods: 0.02 });
      hill(f, 480, 220, 17, 260, 120);
      hill(f, 140, 520, 6, 90);
      Paint.disc(f, 110, 300, 40, T.WOODS);
      Paint.line(f, 920, f.h, 760, 0, T.ROAD, 2.2);
    },
    deploy(rng, lv) {
      const e = enemyStrength(lv, rng), sz = Math.round(e.size * 0.85);
      const you = { kind: 'attack', x: 480, y: 270, text: 'Up the hill in line with the brigade — take the French in the flank. Keep the men together: in this you cannot see fifty yards. If you hear horses, form square.' };
      return {
        player: { x: 470, y: 640, facing: NORTH, task: you },
        allies: [
          beside(you, -80, 'No. 1 Coy, 2/31st', { x: 470, y: 640 }),
          beside(you, 85, 'No. 4 Coy, 2/66th', { x: 470, y: 640 }),
          post(0, attack(310, 280), 24, 0.45, { name: 'No. 3 Coy, 1/3rd (The Buffs)', fifer: false, x: 300, y: 640, facing: NORTH }),
          post(0, attack(650, 280), 24, 0.45, { name: 'No. 5 Coy, 2/48th', fifer: false, x: 650, y: 640, facing: NORTH }),
          // the Fusiliers, coming up behind when the hail lifts
          coy(0, 480, 715, NORTH, 26, 0.6, 'hold', { name: 'No. 1 Coy, 1/7th Fusiliers', fifer: false,
            task: { kind: 'reserve', x: 480, y: 715, facing: NORTH, wave: 420 + rng() * 60, goal: { x: 480, y: 250 } } }),
        ],
        enemies: [
          post(1, hold(480, 225, '', SOUTH), sz, e.drill, { nerve: e.nerve, fifer: false, name: '4e Cie, 2/28e Léger' }),
          post(1, hold(390, 225, '', SOUTH), sz, e.drill, { nerve: e.nerve }),
          post(1, hold(570, 225, '', SOUTH), sz, e.drill, { nerve: e.nerve, fifer: false }),
          post(1, attack(480, 520), sz + 4, e.drill, { nerve: e.nerve, x: 480, y: 120, name: 'Grenadiers, 64e Ligne' }),
          // the Vistula Lancers, out of the hail onto the open flank
          horse(950, 560, WEST, lv, rng, { cavType: 'lancers', name: '1er Esc., Lanciers de la Vistule', delay: 80 + rng() * 60 }),
          horse(960, 660, WEST, lv, rng, { name: '2e Esc., 2e Hussards', delay: 120 + rng() * 60 }),
        ],
        note: 'Three companies of ours go up the hill in a hailstorm. Three of theirs on it — and lancers and hussars on the right, if anyone could see them.',
      };
    },
  },

  // ── Act II ─────────────────────────────────────────
  sp_salamanca: {
    name: 'The Arapiles', setpiece: true, size: [1100, 760],
    blurb: 'Salamanca. A French division has stretched itself out along the road, marching west across our front, and it does not know we are behind the rise. Wellington: “Mon cher Alava, Marmont est perdu.” Go and hit the head of it.',
    build(f, rng) {
      baseGround(f, rng, { amp: 3, wheat: 0.45, woods: 0.03 });
      // the fold in the ground that hides the Third Division
      Paint.each(f, (x, y, i) => { f.height[i] += 7 * Math.exp(-Math.pow((y - 430) / 32, 2)); });
      hill(f, 950, 640, 16, 70);             // the Greater Arapil (not yours)
      hill(f, 120, 120, 10, 80);
      Paint.line(f, 0, 262, f.w, 238, T.ROAD, 2.5);
      Paint.line(f, 560, f.h, 520, 250, T.ROAD, 1.8);
      Paint.disc(f, 980, 640, 30, T.WOODS);
    },
    deploy(rng, lv) {
      const e = enemyStrength(lv, rng), sz = Math.round(e.size * 0.7);
      const you = { kind: 'attack', x: 380, y: 255, text: 'They are strung out along the road and they do not know we are here. Go over the rise and take the head of their column before it can form. The dragoons will follow you in.' };
      const west = (x, n, extra) => post(1, attack(40, 255), sz, e.drill, Object.assign({ nerve: e.nerve, x, y: 255 - (x / 1100) * 20, facing: WEST, fifer: n % 2 === 0 }, extra));
      return {
        player: { x: 380, y: 570, facing: NORTH, task: you },
        allies: [
          beside(you, -80, 'No. 9 Coy, 1/74th', { x: 380, y: 570 }),
          beside(you, 80, 'No. 1 Coy, 2/5th', { x: 380, y: 570 }),
          post(0, attack(220, 255), 24, 0.5, { name: 'No. 2 Coy, 1/45th', fifer: false, x: 220, y: 575, facing: NORTH }),
          post(0, attack(540, 255), 24, 0.5, { name: 'No. 7 Coy, 1/88th (Connaught Rangers)', fifer: false, x: 540, y: 580, facing: NORTH }),
          // Le Marchant's heavy brigade, waiting for the foot to shake them
          horse(720, 650, NORTH, lv, rng, { team: TEAM_PLAYER, cavType: 'heavy_dragoons', name: 'A Troop, 5th Dragoon Guards', size: 22, delay: 140 }),
          horse(860, 660, NORTH, lv, rng, { team: TEAM_PLAYER, cavType: 'heavy_dragoons', name: 'C Troop, 4th Dragoons', size: 22, delay: 170 }),
        ],
        enemies: [
          Object.assign(post(1, attack(300, 255), sz, e.drill, { nerve: e.nerve, x: 1080, y: 250, facing: WEST, fifer: false }), { arrive: 200 + rng() * 60 }),
          west(300, 0, { name: 'Voltigeurs, 1er Ligne' }),
          west(500, 1), west(700, 2), west(900, 3),
          guns(820, 170, SOUTH, 2, lv),
          horse(1050, 110, SOUTH, lv, rng, { delay: 200 }),
          Object.assign(post(1, attack(300, 255), sz, e.drill, { nerve: e.nerve, x: 1080, y: 240, facing: WEST }), { arrive: 330 + rng() * 60 }),
        ],
        note: 'You attack. Four French companies on the march, guns and horse behind them. Two troops of heavy dragoons behind you.',
      };
    },
  },

  sp_maya: {
    name: 'The Pass at Maya', setpiece: true, size: [1000, 760], noHorse: true,   // no country for horse
    weather: { kind: 'mist', label: 'Mist on the pass', sight: 200, misfire: 0.04, until: [200, 300], clears: 'The mist burns off the pass. Now you see how many there are.' },
    blurb: 'The Pyrenees. One brigade holds the pass and d’Erlon’s whole corps is coming up out of the mist. Barnes is marching up from the valley with the 7th Division. Hold until he comes.',
    build(f, rng) {
      baseGround(f, rng, { amp: 3, wheat: 0, woods: 0.04 });
      // the mountains either side; the pass is a saddle between them
      Paint.each(f, (x, y, i) => {
        const side = clamp((Math.abs(x - 500) - 150) / 230, 0, 1);
        f.height[i] += 38 * Math.pow(side, 1.5) + 8 * Math.exp(-Math.pow((y - 360) / 90, 2));
        if (Math.abs(x - 500) > 300 + Math.sin(y / 60) * 25) f.type[i] = T.WOODS;
      });
      const road = [];
      for (let y = -10; y <= f.h + 10; y += 20) road.push([500 + Math.sin(y / 90) * 22, y]);
      Paint.polyline(f, road, T.ROAD, 2.4);
      // a breastwork of loose stones thrown up across the col, and shepherds' folds behind it
      Paint.line(f, 330, 384, 680, 384, T.WALL, 1.2, t => t !== T.ROAD);   // the road goes through it
      Paint.enclosure(f, 560, 405, 610, 440, [[2, 0.5]]);
      Paint.enclosure(f, 380, 408, 425, 440, [[2, 0.5]]);
    },
    deploy(rng, lv) {
      const e = enemyStrength(lv, rng), sz = Math.round(e.size * 0.7);
      const you = hold(500, 388.5, 'Hold the pass. We are one brigade against a corps — but Barnes is marching up from the valley. Hold until he comes.');
      const comes = 420 + rng() * 60;
      return {
        player: { x: you.x, y: you.y, facing: NORTH, task: you },
        allies: [
          beside(you, -65, 'No. 6 Coy, 1/92nd (Gordon Highlanders)'),
          beside(you, 65, 'No. 8 Coy, 1/50th'),
          post(0, hold(370, 388.5, 'hold the left of the pass'), 22, 0.55, { name: 'No. 1 Coy, 1/92nd (Gordon Highlanders)', fifer: false }),
          post(0, hold(630, 388.5, 'hold the right of the pass'), 22, 0.45, { name: 'No. 4 Coy, 1/50th', fifer: false }),
          post(0, thenRetire(hold(505, 270, 'picquet the road'), 60 + rng() * 30, 520, 470), 16, 0.55, { name: 'Light Coy, 1/71st (Highland Light)', fifer: false, colours: false }),
          relief(470, 740, comes, { x: 480, y: 390 }, { team: TEAM_PLAYER, size: 24, drill: 0.55, doctrine: 'hold', drummer: true, fifer: false, colours: true, name: 'No. 3 Coy, 1/82nd', arriveText: 'Barnes’s brigade, up from the valley' }),
          relief(540, 740, comes + 25, { x: 540, y: 390 }, { team: TEAM_PLAYER, size: 24, drill: 0.55, doctrine: 'hold', drummer: true, fifer: false, colours: true, name: 'No. 5 Coy, 1/6th' }),
        ],
        enemies: [
          post(1, wave(500, 30, 260 + rng() * 50, { x: 500, y: 400 }), sz + 2, e.drill, { nerve: e.nerve, fifer: false, name: '1re Cie, 1/45e Ligne' }),
          post(1, attack(380, 400), sz, e.drill, { nerve: e.nerve, x: 390, y: 70 }),
          post(1, attack(500, 400), sz, e.drill, { nerve: e.nerve, x: 500, y: 55, fifer: false }),
          post(1, attack(620, 400), sz, e.drill, { nerve: e.nerve, x: 610, y: 70 }),
          post(1, wave(440, 30, 220 + rng() * 50, { x: 450, y: 400 }), sz + 2, e.drill, { nerve: e.nerve, fifer: false }),
          post(1, wave(560, 30, 330 + rng() * 50, { x: 550, y: 400 }), sz + 2, e.drill, { nerve: e.nerve }),
          post(1, wave(500, 30, 450 + rng() * 50, { x: 500, y: 400 }), sz + 2, e.drill + 0.05, { nerve: e.nerve + 4, fifer: false }),
        ],
        note: 'Four companies of ours in the pass. Six of theirs, wave on wave. The relief is somewhere down the road behind you.',
      };
    },
  },

  // ── Act III ────────────────────────────────────────
  sp_quatrebras: {
    name: 'The Crossroads', setpiece: true, size: [1100, 760],
    retreat: { x: 560, r: 36, label: 'The road to Brussels' },
    blurb: 'Quatre Bras. The rye is taller than a man: you will not see them until they are on you, and the French horse know it. Hold the bank along the Namur road until the Guards come up.',
    build(f, rng) {
      baseGround(f, rng, { amp: 3, wheat: 0.85, woods: 0 });
      f.rye = true;
      // the Bois de Bossu on the right of the French — on your left
      for (let k = 0; k < 7; k++) Paint.disc(f, 110 + rng.range(-40, 40), 170 + k * 75, 85 + rng.range(-15, 15), T.WOODS);
      // the crossroads and the roads out of it
      Paint.line(f, 540, 0, 560, f.h, T.ROAD, 2.5);
      Paint.line(f, 560, 470, f.w, 440, T.ROAD, 2.2);
      Paint.line(f, 560, 470, 0, 530, T.ROAD, 2.2);
      // trampled ground along the road where the troops formed, and the bank beside it
      Paint.each(f, (x, y, i) => { if (f.type[i] === T.WHEAT && x > 590 && x < 1070 && y > 449 && y < 478) f.type[i] = T.GRASS; });
      Paint.line(f, 610, 448, 1060, 448, T.WALL, 1.2);
      Paint.rect(f, 575, 485, 600, 505, T.BUILDING);
      // Gemioncourt, out in front, held by the French
      Paint.enclosure(f, 600, 200, 680, 260, [[2, 0.5]]);
      Paint.rect(f, 612, 212, 640, 232, T.BUILDING);
    },
    deploy(rng, lv) {
      const e = enemyStrength(Math.max(lv, 0.7), rng), sz = Math.round(e.size * 0.7);
      const you = hold(760, 452.5, 'Line the bank along the Namur road. The rye is taller than a man — you will not see them until they are close. If you hear horses, form square.');
      const guards = 450 + rng() * 60;
      return {
        player: { x: you.x, y: you.y, facing: NORTH, task: you },
        allies: [
          beside(you, -60, 'No. 3 Coy, 1/32nd'),
          beside(you, 65, 'No. 5 Coy, 1/79th (Cameron Highlanders)'),
          post(0, hold(640, 452.5, 'line the Namur road'), 22, 0.55, { name: 'No. 6 Coy, 1/28th', fifer: false }),
          post(0, hold(890, 452.5, 'hold the left'), 24, 0.55, { name: 'No. 2 Coy, 1/42nd (Black Watch)', fifer: false }),
          post(0, hold(480, 520, 'hold the crossroads'), 22, 0.55, { name: 'No. 1 Coy, 1/92nd', fifer: false }),
          guns(640, 560, NORTH, 2, 0.6, { team: TEAM_PLAYER, name: 'Rogers’s Battery, RA' }),
          relief(260, 740, guards, { x: 180, y: 420 }, { team: TEAM_PLAYER, size: 26, drill: 0.7, doctrine: 'hold', drummer: true, fifer: false, colours: true, name: 'Light Coy, 2/1st Foot Guards', arriveText: 'the Guards, down the Nivelles road' }),
          relief(340, 740, guards + 20, { x: 300, y: 430 }, { team: TEAM_PLAYER, size: 26, drill: 0.7, doctrine: 'hold', drummer: true, fifer: false, colours: true, name: 'No. 3 Coy, 3/1st Foot Guards' }),
        ],
        enemies: [
          post(1, attack(640, 470), sz, e.drill, { nerve: e.nerve, x: 650, y: 90 }),
          post(1, attack(880, 455), sz, e.drill, { nerve: e.nerve, x: 870, y: 100, fifer: false }),
          post(1, attack(200, 500), sz, e.drill, { nerve: e.nerve, x: 180, y: 70, name: 'Voltigeurs, 1er Léger', fifer: false }),
          guns(560, 150, SOUTH, 2, lv),
          horse(1060, 160, SOUTH, lv, rng, { cavType: 'lancers', name: '1er Esc., 6e Lanciers', delay: 120 + rng() * 40 }),
          // Kellermann's cuirassiers, through the rye
          horse(560, 30, SOUTH, lv, rng, { cavType: 'cuirassiers', name: '1er Esc., 8e Cuirassiers', delay: 330 + rng() * 40 }),
          horse(780, 30, SOUTH, lv, rng, { cavType: 'cuirassiers', name: '2e Esc., 11e Cuirassiers', delay: 360 + rng() * 40 }),
          post(1, wave(720, 40, 430 + rng() * 60, { x: 720, y: 460 }), sz + 2, e.drill, { nerve: e.nerve + 4 }),
        ],
        note: 'Four of ours at the crossroads, the Guards on the road behind. Four French companies, lancers — and cuirassiers somewhere in the rye.',
      };
    },
  },

  sp_hougoumont: {
    name: 'Hougoumont', setpiece: true, size: [1000, 760],
    retreat: { x: 500, r: 36, label: 'The lane to the ridge' },
    blurb: 'Waterloo, the right of the line. A château, a walled garden and an orchard, with a wood in front full of French. You hold the garden wall. Brigade after brigade will come out of those trees.',
    build(f, rng) {
      baseGround(f, rng, { amp: 2, wheat: 0.2, woods: 0 });
      Paint.each(f, (x, y, i) => { f.height[i] += 8 * Math.exp(-Math.pow((y - 700) / 60, 2)); });   // our ridge, behind
      // the wood
      for (let k = 0; k < 9; k++) Paint.disc(f, 330 + k * 42 + rng.range(-12, 12), 230 + rng.range(-40, 40), 62 + rng.range(-10, 10), T.WOODS);
      // the lane from the wood through the north gate, and out of the south gate to the ridge
      Paint.line(f, 470, 0, 480, 360, T.ROAD, 2.2);
      Paint.line(f, 480, 460, 500, f.h, T.ROAD, 2.2);
      // the farm: château, barn, cart-shed, gardener's house — walls round all of it, a gate north and south
      Paint.rect(f, 400, 360, 560, 460, T.GRASS);
      Paint.enclosure(f, 400, 360, 560, 460, [[0, 0.5], [2, 0.5]]);
      Paint.rect(f, 440, 385, 466, 418, T.BUILDING);
      Paint.rect(f, 410, 428, 440, 452, T.BUILDING);
      Paint.rect(f, 532, 372, 552, 410, T.BUILDING);
      Paint.rect(f, 505, 438, 525, 452, T.BUILDING);
      // the formal garden, walled, open only to the south
      Paint.rect(f, 560, 360, 700, 470, T.GRASS);
      Paint.enclosure(f, 560, 360, 700, 470, [[2, 0.8]]);
      // the orchard beyond it, hedged
      Paint.rect(f, 580, 290, 740, 355, T.ORCHARD);
      Paint.disc(f, 150, 520, 50, T.WOODS);
    },
    deploy(rng, lv) {
      const e = enemyStrength(Math.max(lv, 0.75), rng), sz = Math.round(e.size * 0.68);
      const you = hold(630, 364.5, 'Line the garden wall. It is loopholed, and it is all there is between that wood and the château. Whatever comes out of the trees, you hold this wall.');
      return {
        player: { x: you.x, y: you.y, facing: NORTH, task: you },
        allies: [
          beside(you, -48, 'No. 2 Coy, 2/3rd Foot Guards'),
          post(0, hold(445, 364.5, 'hold the north gate and the wall'), 22, 0.65, { name: 'Light Coy, 2nd Coldstream Guards', fifer: false }),
          post(0, thenRetire(hold(660, 320, 'skirmish in the orchard'), 220 + rng() * 40, 640, 505), 20, 0.45, { name: 'No. 1 Coy, 1/2nd Nassau', fifer: false, colours: false }),
          post(0, thenRetire(hold(380, 320, 'hold the edge of the wood'), 160 + rng() * 40, 450, 490), 18, 0.55, { name: 'Jäger Coy, Lüneburg Field Bn.', fifer: false, colours: false }),
          post(0, reserve(560, 610, 'in reserve behind the farm'), 24, 0.65, { name: 'Light Coy, 2/3rd Foot Guards', fifer: false }),
          guns(470, 690, NORTH, 1, 0.6, { team: TEAM_PLAYER, name: 'Bull’s Troop, RHA (howitzer)' }),
        ],
        enemies: [
          post(1, attack(480, 390), sz, e.drill, { nerve: e.nerve, x: 430, y: 70 }),
          post(1, attack(640, 375), sz, e.drill, { nerve: e.nerve, x: 640, y: 70, fifer: false }),
          post(1, wave(380, 30, 220 + rng() * 40, { x: 470, y: 380 }), sz + 2, e.drill, { nerve: e.nerve, fifer: false }),
          post(1, wave(640, 30, 330 + rng() * 40, { x: 640, y: 375 }), sz + 2, e.drill, { nerve: e.nerve }),
          post(1, wave(520, 30, 450 + rng() * 50, { x: 480, y: 380 }), sz + 2, e.drill + 0.05, { nerve: e.nerve + 6, fifer: false, name: 'Grenadiers, 1er Léger' }),
          guns(830, 190, Math.atan2(180, -190), 2, lv),
        ],
        note: 'Five of ours in and around the farm. Five French companies, one after another, and a battery on the right.',
      };
    },
  },
});

SETPIECE_POOL.push('sp_coa', 'sp_albuera', 'sp_salamanca', 'sp_maya', 'sp_quatrebras', 'sp_hougoumont');
