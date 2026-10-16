# Form Line

Top-down Napoleonic **company commander** roguelike. You are one officer on foot. You walk where you
must (right-click / WASD) and shout orders (number keys); a company of automated soldiers forms, presents,
fires, breaks and rallies by itself. Single-player. Open `index.html`: no build, no server.

Pitched by the user as "top-down Mount & Blade: Napoleonic Wars organised fights, with the regular
soldiers automated — don't forget the banners and the instruments". They then narrowed it to **a
single-player roguelike campaign earning renown; usually commander v commander, with terrain sometimes
bringing in more allies or enemies; deliberate real-time pacing of about one round per minute per
infantryman; morale, aiming skill and terrain modelled.**

## Run / test

```bash
node test/headless.js        # 214 checks: musket, ground, orders+drum, morale+colours, campaign, page boots
node test/tune.js            # every scenario x 6 seeds, AI driving YOUR company too: length, losses, rds/man/min
node test/tune.js ford 20    # one scenario, more seeds, per-battle lines
```

`test/load.js` loads `src/` into a vm in index.html order (top-level `const` is hoisted out by an
export line). A headless check asserts that index.html's script order matches.

## Architecture (script tags, shared globals, load order = dependency order)

| file | what |
|---|---|
| `config.js` | every tuning number, with its reason. Metres and seconds throughout |
| `rng.js` | seeded mulberry32 + vector helpers. **The sim never calls Math.random**, so a seed replays a battle exactly |
| `data/factions.js` | British (2 ranks) / French (3 ranks, better in melee), names, ranks → company size |
| `data/tunes.js` | fife melodies + drum cadences + per-order drum calls, **written down by ear** |
| `field.js` | 4 m terrain grid + elevation; `los` (crest/buildings/>22 m of woods block), `coverFor` (a wall one step toward the shooter covers you), `speedAt` (slope) |
| `data/scenarios.js` | each battle = `build(field)` + `deploy(rng, level)`. This is where terrain decides who else turns up |
| `unit.js` | a company: men, leader, **slots**. Line/skirmish slots come from (centre, facing); a column's from the leader's **trail** (footsteps) |
| `move.js` | formation centre moves; every man walks to his slot; river/house sliding; spatial-hash separation |
| `combat.js` | musket state machine, hit roll, smoke grid, melee, charge shock |
| `artillery.js` | batteries: laying, roundshot that skips through the ranks, canister, crews, capture |
| `morale.js` | loss shock, suppression, baseline, wavering, rout, rally; `Colours` (drop / pick up / capture) |
| `orders.js` | `shout` (player: voice ≤48 m, else only via a living drummer, 1.8 s late), `give` (AI), `apply` |
| `ai.js` | every non-player captain (enemy AND allied): doctrines attack / hold / skirmish. Several ideas borrowed from DoDoCat's *Day of Slaughter* NW AI mod (spread targets, march until the centres can see each other, a firing distance kills push in and losses push out, sideways realignment with a deadzone, troop-ratio retreat/charge) |
| `command.js` | brigade **headquarters** for set pieces: every company has a task (hold / reserve / attack); waves, reserves committed to retake a lost post, general advance; YOUR task arrives as a dispatch and obedience is scored |
| `data/factions.js` CAV_TYPES | the three kinds of French horse |
| `data/setpieces.js` | the big battles (bigger `size`, `setpiece: true`): The Long Ridge, The Village on the Stream, and the finale; the task helpers |
| `data/greatbattles.js` | six more from the real campaigns, two per act (`ACTS[k].setpieces`): the Côa, Albuera, the Arapiles, Maya, Quatre Bras, Hougoumont — see *Great battles* below |
| `place.js` | **drag to place** (the user asked for it): a stroke gives centre (midpoint) + alignment; the company faces across it toward the nearest enemy you can see, else away from you; at most `PLACE_RANGE` from where it stands. Mouse = left-drag (keeps the current shape); touch = Form → Line/Skirmish/Column arms it, the next drag places, a tap forms on the spot, a hold re-opens the wheel. Pure `plan()` is in the headless sim |
| `touch.js` | phone controls: tap = walk, hold = two-level order wheel (Fire up / Bayonet right / Form down / Move left), drag = look, pinch = zoom |
| `builder.js` | the battle builder: unit costs in renown, budgets, auto-deployment of two built armies |
| `detach.js` | sergeants' parties: split off, command (voice / bugle / runner), recall and merge |
| `battle.js` | create / fixed-step tick / per-team fog of war / end check. Pure: emits `events` (sound) + `fx` (picture) |
| `campaign.js` | three ACTS, each a 9-row StS-style route ending in a great battle, winter quarters between, renown, rank, roster persistence, camp/shop/events |
| `render.js` `audio.js` `input.js` `ui.js` `main.js` | the browser side. `Sound`, not `Audio` (that is a DOM global) |

## Rules that are load-bearing

- **The pacing anchor is the user's: ~1 round/min.** `reload = 72 − 34·drill` s ±15%; a drill-35 company ≈ 60 s.
  headless §2 pins it. Tune.js reports real rds/man/min (≈0.8 on open ground, since men also march).
- **Men only fire halted, in their slot, in the front two ranks.** That is the whole drill game:
  Make ready (5) → they present and *hold* → FIRE (F/Space) is one volley. A third (French) rank never fires.
- Hit chance `0.4·e^(−d/60)` × aim × morale × cover × smoke × first-fire 1.2 × volley 1.15. ~12% at 70 m.
- **Smoke is real**: every shot puffs; a coarse density grid (8 m) along the sight line multiplies hit chance by `e^(−0.55·density)`.
- **Morale is the casualty figure.** Each man down costs `120/startSize`, ×1.6 if 3+ fall within 3 s (a volley), ×1.6 from the flank;
  every ball aimed at a company costs 0.1 (suppression); recovery only after 12 quiet seconds. <30 men slip away, <15 the company routs.
- **Charge shock is per charging company, only inside 45 m, 0.8/s × odds.** It was 30× too strong at first and broke garrisons before contact.
- **Rout contagion is a one-off shock** to neighbours within 150 m, plus a small drain only while fugitives are inside your ranks. A continuous 80 m drain cascaded every rout.
- **AI order dedupe checks the unit's *state* (`Orders.inEffect`), not the last order given.** The old version froze a company forever after a wall halted its advance.
- Attacker whose straight path crosses water marches in column **via a crossing** (`AI.route`), and a column deploys at its **head**.
  Crossings sit on the river centreline; a ford painted beside the channel made the ford scenario a 32-minute stand-off.
- A holding company wheels to face a threat outside its fire cone, **unless it is in cover** (then only past 52°), so a garrison does not leave its wall.

## Drill the user asked for (round 2)

- **Fire by rank** (`byrank`): the front rank fires, then the next after `BYRANK_GAP` — part of the company is always loaded.
- **Column of attack** (`attack` formation): `ATTACK_FILES` wide, deep; advances like a line, only its front two ranks fire,
  takes `ATTACK_EXPOSED`× hits, charges with `ATTACK_SHOCK`× shock. French AI captains attack in it (a third prefer to deploy into line).
  **Tuned so a holding line beats a column ~60% when it holds its volley to ~60 m** (`$TEMP/fl/duel.js`-style duel) — line vs column is the period's core matchup.
- Learned drills (`LEARNED_DRILLS` in orders.js): fire by rank, column of attack, skirmish order. A campaign company learns them at camp; quick battles and AI know all.

## The charge, wind and the road (round 3 — the user found charges too strong)

The user chose: **keep ~1 round/min and fix the charge instead**; a **retreat zone marker** per map; **a sprint toggle** for you (not men pacing you).

- **Breath** (code: `u.wind` — NOT the weather wind, which only moves smoke; the user asked. UI says Breath) (`u.wind`, `B.cmd.wind`, 0..1). Charging men go at QUICK time and only rush inside `CHARGE_RUSH` 40 m; the rush drains ~1/16 per s, fighting 1/30; halted they recover. Wind scales melee, rush speed and charge shock. A blown company (<0.04, not engaged) drops the charge.
  The old 4 m/s from 95 m beat a 60 s reload outright — that was the whole problem.
- **Point-blank**: a line still presented fires on its own when a charge reaches `POINT_BLANK` 30 m.
- **Nerve test** (`Combat.nerve`) once per charge per target at `CHARGE_TEST` 22 m: att = morale·√push vs def = morale·(1+0.6·loaded)·cover; p = att²/(att²+def²). Lose → charge falters (−10, re-forms); win → defender −18.
- **Momentum** (`Combat.momentum`, the user asked for it): numbers × impetus (how fast the charging men are actually moving, `u.impetus`) × the drop (`SLOPE_PUSH` per metre above the defender) × column/grenadier. Downhill rushes are faster (`DOWNHILL_RUSH`), uphill slower (`speedAt`). Weather wind plays NO part — the user checked.
- Column of attack: losses cost `ATTACK_NERVE` 0.7× morale (depth carries it). Duel re-tuned to line 14/24 vs column.
- Steadiness at the clash counts a volley in the last `STEADY_AFTER` 6 s (holding fire pays); a line caught reloading defends at 0.75×. Two charges meeting = ONE test, each side with its own momentum (two tests at once broke companies).
- Charges end at `CHARGE_MAX` 45 s or breath < `CHARGE_BLOWN` with nobody in contact (no 80 s pursuits). AI captains never charge with breath < `AI_CHARGE_BREATH` — before that they re-ordered a dead charge every 2 s.
- **Re-form** (T, Bayonet → Re-form): off the chase, line on the colours, facing the nearest seen enemy.
- **Halt** calls a charge off. **Rally** never did — it is morale + un-rout, in person (fixed in round 5, below).
- **You sprint** at `CMD_SPRINT` 4.6 (faster than the 4.0 rush) for ~14 s, then walk until you rest. Shift (hold), Q / touch-bar Run (toggle).
- **Line of retreat** `B.retreat` (scenario `retreat:{x,r,label}`, default the south edge behind your start). `retire` (X, Move→Retire) marches the line there, no firing, hits count as flank; men inside leave (`m.saved`, `u.saved`). Standing in it you can **Leave the field** (L); with everyone off it ends by itself. Withdrawing anywhere = whoever is formed within `CAPTURE_RANGE` of a formed enemy is **captured** (lost; colours too), the rest walk back.
  ⚠ Saved men must count as present in `Morale.baseline` and the rout rule, or a company filing off the field routs itself.

## Round 5 bugs (user: "rally seems to do nothing", "it just instantly wavers", "slap the captain")

- **Rally** was dead: a broken company that was your last formed unit ended the battle 6 s later, and un-routing needed morale 38 that a routed company took ~45 s to regain. Now: your broken company holds the battle open for `RALLY_WINDOW` 35 s (`Battle.rallyable`) while > a quarter are still on the field; with you among them they recover even under fire and run `RALLY_HOLD`× slower; un-rout at `RALLY_AT` 26 (shout included) **if more than a quarter are within 70 m of you** (else they re-rout at once). A rally that fails says why and can be retried after `RALLY_RETRY` 5 s; on cooldown it says so. AI companies still un-rout at the old 38.
- **Instant falter**: a charge ordered inside `CHARGE_TEST` was nerve-tested 0.6 s in at impetus 0 (80–93% falter from 15 m). The test now waits `CHARGE_TEST_AFTER` 1.5 s. A charge only stops for morale below WAVERING+5 (was: below SHAKEN, silently). A failed player charge says why (`Combat.whyFalter`).
- **Captain-slap exploit**: you, alone with no man of yours within `CMD_ALONE` 7 m, are mobbed by every enemy within `MOB_RANGE` 8 m at `CMD_ALONE_HIT` ×1.0 (×0.6 among your men). Rushing a captain alone: 39/40 kills → ~60% death.

## Cavalry & the square (round 5 — the user: "more varied enemy types… i guess thats where we implement artillery and cav?")

The agreed roadmap for a rewarding progression curve: **cavalry + square first, then enemy guns, then a Major commanding a second company (orders by runner, delayed), then a three-act campaign.** Only the first is built.

- **Horse** = a unit with `arm: 'cav'`, `cav: CAV_TYPES[type]` (factions.js: chasseurs → lancers → cuirassiers; melee / mass / armour / speed / nerve). Men have `m.horse` (= the horse's coat colour), no musket (`m.m = 'none'`, skipped in `Combat.muskets`). Two loose ranks (`CAV_FILE_GAP`, `CAV_RANK_GAP`), a trumpeter (role drummer), no colours.
- **Movement**: order `ride` moves the squadron's frame as a block toward `u.ride` at walk/trot (`Move.unit`); charge = trot, then gallop inside `CAV_GALLOP_AT` 90 m (horse breath `CAV_WIND_GALLOP` ~20 s). `Move.horseGround`: woods/walls/marsh slow horses further. Separation radius is larger for horses.
- **Combat**: momentum × `CAV_MASS`·mass vs foot; shock range 80 m ×1.6 (×0.15 against a formed square); sabre ×2 vs foot; bayonet ×0.5 vs horse (×1.2 from a square); hits on horses × armour; horsemen ride down **fleeing** men (`CAV_PURSUIT`) — the real killer. Squadron morale loss per man ×`CAV_NERVE` 0.6.
- **Nerve test vs horse**: only muskets still *presented* count as steady (a line that just volleyed has bayonets only); flank/rear ×0.55; skirmish ×0.65; cover ×2. **Square**: `Combat.squareReady` 0..1 = min(men in place, time dressed `SQUARE_DRESS`·(1.25−drill) ≈ 8 s); def ×lerp(0.6, `SQUARE_DEF` 8, k³) — a square still forming is worse than a line, a formed one is a wall unless it is shaken. Horses that lose the test **refuse** and sheer off.
- **Square** (`E`, Form → Square): `Unit.squareSlot` — 4 faces × 2 ranks, slot facings outward, colours/drum/captain inside; fires `ready`/at will per face (pickTarget uses `slotFacing`); hits ×`SQUARE_EXPOSED`; Advance/Fall back/Retire/Charge open it into line.
- **Horse AI** (`AI.cavalry`): pick the best mark (`AI.cavMark`: routed 1.4, unformed square 1.2, skirmish 1.15, column 1.05, line 0.55 +flank +empty muskets +shaken; cover/woods ~0) within `CAV_SCOUT`; > `CAV_MARK` → trot to 90 m off it, then charge (trumpet + "Cavalry! … form square (E)!" to the player via `AI.warn`). Else hover `CAV_HOVER` 170 m off the nearest foot. Blown / after a charge (`restUntil` 20 s): draw off ≤160 m toward home. When its own foot are all beaten it rides off the field (so battles still end).
- **Foot AI** (`AI.cavThreat`): seen horse charging, riding at them, or within 120 m, and not in cover/woods → square, fire at will; back to line 8 s after the threat goes.
- **Where**: new small map **The Heath** (always horse); Open Ground (50%) and The Reverse Slope (35%) from campaign level 0.3; the type gets heavier with level. **The Long Ridge** gets two cuirassier squadrons at ~7 min.
- Duels (`$TEMP/fl/cav2.js`): formed square vs cuirassiers ~0–1/10 broken; line in the flank ~9/10 ridden over; ready line facing chasseurs ~50/50; square ordered with the horse at 60 m ~30% caught, at 90 m safe.

## The guns (round 6 — step 2 of the roadmap)

- `artillery.js` (after combat.js). A **battery** is a unit with `arm: 'gun'`, `form.kind: 'battery'`, `u.guns = [{x,y,facing,m,mt,target,shot,taken,takenBy}]` and `GUN_CREW` 5 gunners per piece (role line, `weapon: 'rammer'`, `m.gun` → their piece, re-dealt round the live pieces in `assignSlots`). No colours/drum. Static (no limbering) except `AI.battery`: when its foot are all beaten it leaves, abandoning the guns.
- ⚠ `g.taken` is a **boolean** and `g.takenBy` the team — the player is team 0, so storing the team in `taken` read as "not taken" (bug found by the assault duel).
- Per piece, once a second: best seen target in `GUN_RANGE` with **LOS from the gun** (a crest protects completely) and no friendly company within 16 m of the line of fire; canister inside `CANISTER_RANGE` 140, else roundshot weighted to deep targets (square 2.4, column 2, attack 1.9, horse 1.3, line 1, skirmish 0.25). Traverse `GUN_TRAVERSE` within `GUN_ARC` of the battery's front, only `GUN_SWING` 0.04 rad/s beyond it (flank attacks work). Reload `GUN_RELOAD` 26 s × crew^0.7. First round after 8 s (+5 s per piece).
- **Roundshot**: lateral error `ROUND_SD` 0.006 (laying for line was easy), range error 5%; grazes `ROUND_SHORT` before the fall and skips `ROUND_SKIP` 140 m on; each man within `ROUND_WIDTH` of the path is hit at `ROUND_P` 0.3 (×1.6 in square, ×1.3 column), max 6, if the gun has LOS to him; buildings stop it; trees take half. Every company it passes near loses `ROUND_SCARE`. Measured at 400 m, 2 guns: line ~2/min, column ~4, square ~4.4, skirmish ~0.3.
- **Canister**: 30 balls in ±0.13 rad, each finds the first man in its path at `CANISTER_P`·e^(−d/110), max 6/shot. Two guns at 90 m rout a company. Range was 240 → 160 → **140** so skirmishers firing at will (165 m) can duel the crews from outside it: skirmish order at 150 m kills ~half the gunners in 3 min for ~2 men.
- Capture (`Artillery.capture`): no own gunner within 6 m and an enemy formed man within `GUN_CAPTURE` 8 m. +20 renown per gun.
- Where: **The Guns on the Knoll** (`battery`: 2 guns + a holding company, wood on the left running to ~140 m of the knoll, an attacking ally that draws fire); Open Ground at level ≥0.55 (35%, one gun); **The Long Ridge**: a grand battery of 2×2 guns on the French ridge (the reverse slope is now the point).
- HUD says "Under artillery fire" (`u.shelled`). Sound: `Sound.cannon`. Render: `Render.gun` (recoils), `ball` fx (ball in flight + earth spurts where it grazes), `canister` spray, `gunflash`. `Render.score` paints each ball's furrow + skip scuffs permanently into the baked terrain canvas (the user asked; render-only, flag `f.scored` on the fx).

## Round 6 also: volley-and-charge, your horse, the phone minimap

- **"I tend to want to march them up, shoot, then charge"** (the user): a company with >40% of its men having fired in the last `VOLLEY_CHARGE` 20 s charges at ×`VOLLEY_CHARGE_BONUS` 1.3; a line caught reloading defends at 0.65 (was 0.75; fully loaded still 1.35); a defender that loses the nerve test takes `NERVE_LOST` 22 and **routs at once** if left below SHAKEN+`NERVE_BREAK` (40). Duel `$TEMP/fl/vc.js`: vs a fresh holding line, volley at 40 m then charge ≈ 75% carries, at 60 m ≈ 30%. Line-vs-column duel unchanged (~58%). A faltered charge with no volley first says "close to 40 m and give them a volley first".
- ⚠ A charge ordered from beyond ~140 m fizzles (nobody within `nearestFoe` range → ends after 3 s). Not changed yet; worth a look if the user still finds charging hard.
- **Officer's horse** (user asked): quartermaster `horse` (`HORSE_COST` 30) → `run.commander.horse` → `B.cmd.horse` (coat colour, also makes separation treat you as a horse). Walk 2.4 / gallop 7 (breath lasts ~30 s), voice +20 m, ×2 chance to be picked out (and from 30 m like a rifleman), first hit 60% kills the horse instead (`horseLost` → lost from the run).
- **Minimap on phones** sat under the bottom log bar (it guessed a 12 px inset). `Render.bottomInset` now measures #hud-log / #hud-orders / #touch-bar where they overlap the minimap's column.

## Round 6, from the user's phone playtest

- **Path-finding** (user: "ai has some pathfinding issues with buildings… also on rivers… esp around bridges"): `Path` in field.js = A* on the 4 m ground grid avoiding BUILDING and WATER (fords/bridges open), walls/woods/marsh cost more, no corner-cutting past houses, string-pulled with `Path.clear`, cached per field (12 m key). `AI.route` now uses it for everything (the old named-crossing ±30 m waypoints walked columns into the water wherever the river bent); a leg that meets a ford/bridge gets a stand-off point 14 m before it so the column takes it square on. The scenario `crossings` arrays are now unused by routing.
- **Walls never overwrite a road or bridge** (`Paint.enclosure`): every road through a garden wall is a gateway (the small Village was walled shut across its road).
- **Saddles**: where a road crosses a ridge it dips (`saddle()` in setpieces.js; Long Ridge, finale) — ~10 m lower than the crest beside it.
- **Cover, explained** (the user found the grey wall lines opaque): cover only protects the man IN it — `Field.coverFor(target, shooter)` = the target's ground (woods 0.55, orchard 0.75, wheat 0.9, standing on a wall 0.35) or a wall within 2.5–4.5 m of the target toward the shooter (0.35). Your fire OUT of cover is unaffected. Walls do not block sight; they slow men to 0.35. The HUD now has a line: "Behind a wall — they hit you a third as often / In cover / In the open · they are in cover" (`UI.coverLine`).
- **Quick battle** expanded: skirmishes + set-piece battles + finale; stage (Early/Middle/Late/Waterloo → `level`), company size 24–48, company type, mounted. `Campaign.quickCompany` builds a seasoned company to match (NCOs, rifles, drill).
- **Future topics the user raised (not started):** a points-based battle builder (renown as the budget) as groundwork for PvP; asymmetric factions; runners + bugle for commanding allies; named NCOs leading detachments (e.g. a rifle party) that can be reabsorbed.

## Battle builder (round 7 — the user: "start with battle builder so we can have the sandbox")

The user's reasoning: commanding more than ~2 units needs campaign power-scaling to reach it in time, so a sandbox comes first; it is also the groundwork for a future **PvP** mode (renown-points armies) and **asymmetric factions**.

- `builder.js` (sim, after command.js): `Builder.cost(spec, own)` in renown (foot: size × `QUALITY[q].cost` (+8 for light/line/grenadier); horse: size × `CAV_TYPES[t].price` × quality; guns: 45/gun × quality; your company + 4/rifle + 15 mounted). `QUALITY` raw/trained/veteran/guard → drill, nerve, campaign stage. `BUDGETS` per side (0 = no limit).
- `Builder.deploy(army, sc, field, rng)` returns a scenario-style `{player, allies, enemies}`: ours along the south edge, theirs the north; foot in 110 m slots out from the centre (a second line 75 m back when full), guns between and a little forward, horse on the wings; `Builder.open` nudges every anchor onto open ground. `Battle.create({army})` uses it instead of `sc.deploy`, and **skips headquarters** on set-piece maps (no tasks).
- `Builder.company(own, seed)` = `Campaign.quickCompany` + quality/rifles.
- Horse is per faction now (`CAV_TYPES[k].faction`, `.price`): British **light_dragoons** and **heavy_dragoons** added; British gunners/batteries in factions.js. Allied horse and guns use the same AI as the French.
- UI: title → **Battle builder** (`UI.builder`, `#screen-builder`); the army is saved per viewer in `localStorage['formline.army']` (`App.loadArmy/saveArmy`, try/catch'd). `App.builderBattle`.

## The acts (round 8 — the user: "the campaign still ends on the first big battle… a couple stages a la slay the spire")

- `ACTS` (campaign.js): I The Peninsula 1810 → boss `sp_ridge` "Busaco"; II Spain 1812–13 → `sp_village` "Vitoria"; III The Hundred Days 1815 → `finale` "Waterloo". Each act is its own `MAP_ROWS` **9**-row route (`genMap(rng, act)`; the last row's node type stays `'finale'`, its scenario is the act's boss). `run.act`, `run.winter`.
- `Campaign.level(row, act, rows)` = (act + row/(rows−1)) / 3 — the enemy gets better across the whole campaign, so horse (level ≥0.3) arrives in Act II and guns/cuirassiers in Act III. Act bosses +0.08.
- Win an act's great battle → `run.winter` → `UI.winter` (= the camp screen with a winter header, no Rest): `Campaign.winterQuarters` heals you, sends recruits for half the gap to capacity, drill +0.03; then one camp choice → `Campaign.nextAct` (new map). Lose any act's great battle → the campaign is lost. Saves made during winter resume into winter quarters. Old saves migrate into Act I (the UI sizes the map from `run.map.length`, so an old 11-row map still draws).
- Each act draws its set pieces from its own pool (`ACTS[k].setpieces`: 3 maps, never the act's own boss) **without repeats** (`genMap` → `nextSetpiece`). See *Great battles*.

## Great battles (round 10 — the user picked "more set-piece maps")

`data/greatbattles.js`: six set pieces from the real campaigns, two per act. Each act's pool is the two plus one of the
generic old maps (`ACTS[k].setpieces`: I = Côa, Albuera, Village; II = Arapiles, Maya, Long Ridge; III = Quatre Bras,
Hougoumont, Village). Each battle brings one thing the others don't, built as a general engine hook:

| map | the day | the hook |
|---|---|---|
| `sp_coa` The Bridge on the Côa (1810) | rearguard in walled vineyards; at ~4½–5 min the colonel orders you back over the one bridge, then three columns storm it | **`task.then = {at, task}`**: a timed follow-on order (Command.think step 0). `retire: true` on a hold task makes `AI.toPost` march even with the enemy inside 140 m, until `reached` |
| `sp_albuera` The Hill at Albuera (1811) | attack uphill in a hailstorm; Vistula lancers out of the murk on the right | **`sc.weather = {kind, sight, misfire, until:[a,b], label, clears}`** → `B.weather`; `Battle.sight(B)` replaces `CFG.SIGHT` in fog of war; `Combat.fire` misfires (a flash in the pan costs `MISFIRE_PRIME` of a reload, no shot, no smoke — and that man is not "presented" for the horse nerve test). HUD line + `Render.rain` (mist = pale veil, no streaks) |
| `sp_salamanca` The Arapiles (1812) | **you attack**: four French companies marching west along a road, hidden from you by a fold; Le Marchant's heavy dragoons behind you | allied horse (`horse(..., {team: TEAM_PLAYER, cavType: 'heavy_dragoons'})`); a French company with `arrive` |
| `sp_maya` The Pass at Maya (1813) | mist, a stone breastwork across the col, six French columns; Barnes's brigade marches up at ~7–8 min | **`arrive: t`** on any spec: held in `B.arrivals`, `Battle.arrive` makes the unit at its hour (log names `arriveText`). The enemy is not beaten while French arrivals are still due (`checkEnd`) |
| `sp_quatrebras` The Crossroads (1815) | rye taller than a man; the bank along the Namur road; lancers, then cuirassiers; the Guards arrive | **`f.rye`**: wheat cells add `RYE_BLOCK` to the woods tally in `Field.los` (~90 m hides a man; guns are blinded too. 1.2 / ~55 m made a blind 9-minute stand-off at the French firing distance). **Mounted eyes see over it** (`Field.los(..., mounted)`; visibility passes `!!eye.horse`): without that the French squadrons never found a mark and two battles in six ran to nightfall; it also makes your officer's horse worth having here. Horsemen are still hidden as *targets*. **Heard horses**: `B.heard[team]` = horse at the trot/charge within `HEAR_HORSE` 160 m of any eye, seen or not → `AI.cavThreat` + the player's warning ("Horses! You hear them…") |
| `sp_hougoumont` Hougoumont (1815) | you are the garrison of the garden wall; a wood in front; brigade after brigade; a battery on the right | (wall placement, below) |

Things the sweeps found:
- ⚠ **A wall only covers a man 2.5–4.5 m behind it, on a 4 m grid.** A line's front rank stands ON its post and the rear rank 1.7 m behind, so a garrison post must be **4.5 m below the top of the wall's cell** (wall at y=360 → post 364.5). Posts 15 m back had no cover, so `AI.stepUp` walked them out of the garden into the orchard. Headless checks Hougoumont's line is behind its wall.
- **General advance compared head counts** (`them < us·0.55`): at Quatre Bras the French (two squadrons of cuirassiers + lancers) called our side "spent" at 2½ min. Now it also needs `spent` = their share left of their own peak < 0.55 × ours (`hq.peak`).
- Batteries no longer "join the general advance" (no limbers).
- **Autoplayer captain** (`AI.cmdRoute`): he kept walking his route after the company halted/deployed and died alone in a French column (Albuera 3 of 6 "fell" at ~3 min). Now he stops and stands 6 m behind the centre. This changes tune.js numbers for every map.
  Also: when his company has routed he walks back toward `B.retreat` with his men (he used to stand alone where the line had been and be bayoneted — the Village's "fell" results).
- ⚠ **Holders face and fire at the NEAREST enemy foot (`AI.closestFoe`), not the spread-out target.** `nearestEnemy` adds +90 per friend already on a target (Day of Slaughter's spread — right for attackers choosing whom to go for), so at Quatre Bras a holding line wheeled off its bank toward a company 133 m off at the oblique and judged its volley by it, while a column walked straight up to 30 m outside its fire cone and broke it unfired on. That is general to every holding company on every map.
- **Horse go round houses** (`AI.ride`): if the straight line to the ride target is not `Path.clear`, they ride to `Path.find`'s first waypoint. A squadron leaving the field once trotted on the spot under Gemioncourt's wall until its horses were blown and the battle ran to nightfall.
- Maya's picquet must retire by ~1–1½ min or the columns come out of the mist onto it.

## Sergeants' parties, the bugle and runners (round 9 — the user: "name ncos of some of the vets… assign them some men to split my group… a skirmisher corp with the rifles that i can command seperately but also reabsorb"; "runners for anything complex and maybe a bugle… charge or follow me")

- Campaign: `soldier.party` = a sergeant's soldier id (`Campaign.setParty`), sergeants renamable (`Campaign.rename`); company sheet has a Party column + name inputs. Quartermaster sells a **bugler** (`co.bugler`; light companies always have one) → `B.bugle`.
- `detach.js` (after battle.js): `Detach.split` (order `detach`, Y, or the strip) makes one unit per sergeant with ≥2 party men: `isDetachment`, `parent`, `commanded` (no AI unless autoplayer), leader = the sergeant (role → officer), skirmish order if mostly rifles/light. With no parties set, the riflemen + best shots (to 6) go out under the senior sergeant. `B.selected` / `Detach.commanded(B)` is the unit your orders, drag-to-place, the wheel and the HUD panel act on; pick it on `#unit-strip` (`UI.strip`, redrawn only when its key changes).
- Orders to a party (`Orders.toParty`): **voice** within VOICE_RANGE (+horse) → **bugle** for `BUGLE_CALLS` (no placement) within `BUGLE_RANGE` 350 m, 1.2 s → else a **runner** (`Detach.runner`): `CFG.RUNNERS` 2, `RUNNER_SPEED` 4.2 m/s, returns after 2× the trip; each enemy company within `RUNNER_RISK` 80 m of his path adds `RUNNER_LOSS` 0.3 to the chance he is shot (then the order never arrives and you have one runner fewer). Drawn as a red dot (`runner` fx).
- `recall` (U) / `rejoin` (Follow me to a party) marches the party in column after its sergeant to the company and `Detach.merge`s it back (startSize restored). `Battle.finish` calls `Detach.reabsorbAll` first, so the campaign counts every man.

## Company customization (campaign)

- **Grades**: private → corporal (xp 3, 5 renown) → sergeant (xp 6, 12). Slots scale with rank. In battle a sergeant adds +2 baseline morale (corporal +0.7, cap +8), closes ranks faster, calls stragglers back, and takes up fallen colours first.
  ⚠ The in-battle man uses **`grade`** for this — `m.rank` is already *which rank of the line he stands in*. (They collided once and every sergeant became a private.) Campaign soldiers keep `rank`.
- **Baker rifles**: bought (20), carried by the best shots (or whoever you hand them to); 2× hit falloff, 1.7× reload, reach 280–300 m, hunt officers. Cap 4 (Light 6).
- **Company type** at Captain: Light (skirmish learned, 0.42× hits in skirmish order, +10% speed), Grenadier (melee ×1.2, nerve +6, shock ×1.25), Line (reload ×0.92, volley bonus +0.1, drill +5).
- `Campaign.migrate` upgrades older saves.

**The Village on the Stream was broken** (user: "a 0 win scen"): its garrison posts sat on the houses + north wall, so up to 23/25 men spawned inside buildings, never reached their slots and never fired while the French crossed the bridge. Houses now sit back from the north wall and the garrison lines it; the 95th watches the west ford (the flank that rolled the garrison up); enemy ×0.68. `Battle.unstick` steps anyone spawned in a wall onto open ground, and a headless check covers men + slots on every map. Also: garrisons in cover do not sally with the bayonet unless the enemy is breaking, and holders open at 120 m on a march column (a crossing). 0–4–2 → 4–2.

## Progression (round 4: "we keep losing men and barely make enough to add back")

- The depot sends a **free draft after every battle**: 2 men (4 after a set piece) + recruiters, up to capacity.
- A quartermaster on every odd stage; recruits 5, veterans 12; camp recruiting brings 5.
- Base wounded survival 65% (surgeons 75/84/92).
- **Cannon** is the user's flagged next big topic once this settles.

## Establishment (the user asked: medics and recruiters)

`co.surgeons` and `co.recruiters` (0..3, bought from the quartermaster: 16/26/40 and 18/30/45). Wounded survive at 65/75/84/92%; recruiters bring 1/2/3 raw men after every battle, up to capacity.

## Set pieces

**Round 4 (user):** "why hold on our side of the ridge when we can shoot" → holding companies **step up to the crest** (`AI.stepUp`, up to `CREST_STEP` 75 m off the post, once the enemy is within `CREST_STEP_RANGE`) — viewpoints on sp_ridge are 27–72 m ahead of the posts. Obedience counts that as still holding. Set pieces now come **every other stage** (rows 2/4/6/8 + finale) because the user finds them the fun part; with only two set-piece maps they repeat — more maps is the obvious next content.

The user chose: **you are always one company**, and set pieces come up **a few times per campaign** (rows 4 and 7 + the finale).
HQ is per side and generic (command.js); the scenario only places companies with tasks. Enemy waves are `reserve` tasks with a `wave` time.

## Fun bits that are mechanics, not decoration

- **Drummer** relays your orders beyond shouting range. Lose him and you must walk to your men.
- **Fifer + drummer** play while the company marches (tune per faction, cadence per faction, long roll on the charge), raise baseline morale and speed recovery. You hear French drums over a crest before you see them.
- **Colours**: the ensign carries them. Down → a sergeant picks them up, or an enemy within 2.5 m takes them (−22 morale, renown both ways). You can grab enemy colours yourself.
- **Officers draw fire** (10% of shots near you retarget onto you). You have 3 hits; fall and the run ends.

## Campaign

Renown is score AND purse; **rank follows renown earned** (spending doesn't demote) and caps company size
(24/32/40/48). Soldiers are persistent individuals (name, aim, nerve, xp, kills). After a battle: down
men are 55% wounded-and-back if wounded, stragglers 85% back, survivors gain xp and a little aim.
Save = `localStorage['formline.run']` (per-viewer convenience, try/catch'd); best run in `formline.best`.

## Known gaps / next

- **Never played by a human.** Browser-verified by script (quick battle, volley, charge, victory, report, map, briefing), not by hand.
- Cavalry + square (round 5) and enemy guns (round 6) built; no guns of our own yet. Light-infantry bugle calls don't exist.
- Set pieces are CPU-heavier (~90 ms of sim per battle-second for the finale): fine on desktop at 1×, untested on a phone.
- The autoplayer in `tune.js` is a crude proxy for a human; some scenarios (ridge, ford: 2 enemy companies) are hard for it by design.
- Civil War era = a second pair of factions + tunes. Not built.
