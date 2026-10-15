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
node test/headless.js        # 124 checks: musket, ground, orders+drum, morale+colours, campaign, page boots
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
| `morale.js` | loss shock, suppression, baseline, wavering, rout, rally; `Colours` (drop / pick up / capture) |
| `orders.js` | `shout` (player: voice ≤48 m, else only via a living drummer, 1.8 s late), `give` (AI), `apply` |
| `ai.js` | every non-player captain (enemy AND allied): doctrines attack / hold / skirmish. Several ideas borrowed from DoDoCat's *Day of Slaughter* NW AI mod (spread targets, march until the centres can see each other, a firing distance kills push in and losses push out, sideways realignment with a deadzone, troop-ratio retreat/charge) |
| `command.js` | brigade **headquarters** for set pieces: every company has a task (hold / reserve / attack); waves, reserves committed to retake a lost post, general advance; YOUR task arrives as a dispatch and obedience is scored |
| `data/setpieces.js` | the big battles (bigger `size`, `setpiece: true`): The Long Ridge, The Village on the Stream, and the finale |
| `place.js` | **drag to place** (the user asked for it): a stroke gives centre (midpoint) + alignment; the company faces across it toward the nearest enemy you can see, else away from you; at most `PLACE_RANGE` from where it stands. Mouse = left-drag (keeps the current shape); touch = Form → Line/Skirmish/Column arms it, the next drag places, a tap forms on the spot, a hold re-opens the wheel. Pure `plan()` is in the headless sim |
| `touch.js` | phone controls: tap = walk, hold = two-level order wheel (Fire up / Bayonet right / Form down / Move left), drag = look, pinch = zoom |
| `battle.js` | create / fixed-step tick / per-team fog of war / end check. Pure: emits `events` (sound) + `fx` (picture) |
| `campaign.js` | route map (11 rows, StS-style), renown, rank, roster persistence, camp/shop/events |
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
- **Halt** calls a charge off. **Rally** never did — it is morale + un-rout, in person.
- **You sprint** at `CMD_SPRINT` 4.6 (faster than the 4.0 rush) for ~14 s, then walk until you rest. Shift (hold), Q / touch-bar Run (toggle).
- **Line of retreat** `B.retreat` (scenario `retreat:{x,r,label}`, default the south edge behind your start). `retire` (X, Move→Retire) marches the line there, no firing, hits count as flank; men inside leave (`m.saved`, `u.saved`). Standing in it you can **Leave the field** (L); with everyone off it ends by itself. Withdrawing anywhere = whoever is formed within `CAPTURE_RANGE` of a formed enemy is **captured** (lost; colours too), the rest walk back.
  ⚠ Saved men must count as present in `Morale.baseline` and the rout rule, or a company filing off the field routs itself.

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
- No cavalry, so no square. Skirmish order exists; light-infantry bugle calls don't.
- Set pieces are CPU-heavier (~90 ms of sim per battle-second for the finale): fine on desktop at 1×, untested on a phone.
- The autoplayer in `tune.js` is a crude proxy for a human; some scenarios (ridge, ford: 2 enemy companies) are hard for it by design.
- Civil War era = a second pair of factions + tunes. Not built.
