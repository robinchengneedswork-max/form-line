'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  FORM LINE — tuning. The sim works in METRES and SECONDS throughout;
//  only render.js knows about pixels.
//
//  The anchor the user set: "about 1 round per minute for each infantry".
//  An average company (drill 0.35) reloads in ~60 s; veterans ~45 s,
//  raw recruits ~70 s. Everything else is tuned so a firefight at 80-120 m
//  lasts a few deliberate minutes before one side's nerve goes.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const CFG = {
  FIELD_W: 720, FIELD_H: 560, CELL: 4,

  // ── drill geometry ──
  FILE_GAP: 1.25,          // shoulder to shoulder, a little generous so the sprites read
  RANK_GAP: 1.7,
  SKIRMISH_GAP: 5,
  COLUMN_FILES: 4,         // march column (follow me)
  ATTACK_FILES: 6,         // column of attack: narrow and deep, built for the charge
  ATTACK_NERVE: 0.7,       // morale cost per man lost while in column of attack (it takes ATTACK_EXPOSED more hits)
  ATTACK_SHOCK: 1.25,      // charge shock from a column of attack
  ATTACK_EXPOSED: 1.4,     // hits on a column of attack (a ball that misses the front rank finds the next)
  BYRANK_GAP: 5,           // fire by rank: seconds between one rank's volley and the next
  SLOT_FORMED: 2.2,        // within this of his slot a man counts as "in the ranks"

  // ── pace (m/s) ──
  WALK: 1.3,               // ordinary time, 75 paces a minute
  QUICK: 2.0,              // quick time, used to catch up to a slot
  CATCH_UP: 2.6,
  CHARGE: 4.0,
  FLEE: 3.4,
  CMD_WALK: 1.7,
  CMD_SPRINT: 4.6,         // you, running flat out — faster than a charge, for a little while
  CMD_WIND_DRAIN: 1 / 14,  // a full sprint lasts ~14 s
  CMD_WIND_REST: 1 / 30,
  // your horse (bought from the quartermaster): you ride, you are seen
  HORSE_WALK: 2.4,
  HORSE_GALLOP: 7.0,
  HORSE_WIND_DRAIN: 1 / 30, // a gallop lasts ~30 s
  HORSE_VOICE: 20,         // a mounted officer is heard this much further off
  HORSE_TARGETED: 2,       // …and every skirmisher picks him out (× the officer-targeting chance)
  HORSE_TAKES_HIT: 0.6,    // a ball that finds you finds the horse instead this often (once)
  HORSE_COST: 30,
  SLOPE_PENALTY: 0.06,     // speed lost per % of uphill grade

  // ── the musket ──
  RELOAD_BASE: 72,         // reload seconds = BASE - DRILL * drill, ±15 % per man
  RELOAD_DRILL: 34,
  PRESENT_TIME: 1.8,       // shoulder → present
  AIM_TIME: [0.6, 2.8],    // fire-at-will: how long a man dwells on his mark
  VOLLEY_RIPPLE: 0.35,     // a volley is never quite one sound
  RANGE_MAX: 220,
  RANGE_ATWILL: 165,       // men firing at will won't waste powder beyond this
  HIT_P0: 0.4,             // hit chance at the muzzle, falling off exponentially
  HIT_FALLOFF: 60,         //   → ~12 % at 70 m, ~7.5 % at 100 m, ~3 % at 150 m for an average shot
  FIRE_CONE: 0.62,         // radians either side of the formation front
  VOLLEY_BONUS: 1.15,
  FIRST_FIRE: 1.2,         // the first round, loaded with care before the battle, flies truest
  FIRING_RANKS: 2,         // a third rank cannot fire past the two in front of it
  OFFICER_TARGETED: 0.1,   // chance a shot near an officer is aimed at him instead

  // ── melee ──
  MELEE_REACH: 1.6,
  MELEE_KILL: 0.16,        // per second, per engaged man, before modifiers
  CHARGE_SHOCK: 0.8,       // morale/s drained from a unit being charged (× odds, per charging coy)
  CHARGE_RANGE: 45,        // within this the charge is "coming home"
  // the charge goes in at the double and only RUSHES the last stretch (period practice: the men
  // would be blown otherwise). Wind (0..1) is a company's breath: rushing spends it fast.
  CHARGE_RUSH: 40,         // men break into the run only this close to their man
  WIND_RUSH: 1 / 16,       // per second while rushing: ~16 s of full tilt, ~60 m
  WIND_QUICK: 1 / 150,     // quick time costs a little
  WIND_FIGHT: 1 / 30,      // so does hand-to-hand
  WIND_REST: 1 / 35,       // halted, they get it back
  WIND_WALK: 1 / 90,
  POINT_BLANK: 30,         // a line still presented when a charge reaches this lets fly on its own
  CHARGE_TEST: 22,
  NERVE_LOST: 22,          // a defender that loses the nerve test loses this…
  NERVE_BREAK: 10,         // …and gives way at once if that leaves it below SHAKEN + this
  VOLLEY_CHARGE: 20,       // charge within this many seconds of a volley…
  VOLLEY_CHARGE_BONUS: 1.3, // …and it carries this much more (the British "volley and charge")
  STEADY_AFTER: 6,
  AI_CHARGE_BREATH: 0.6,
  CREST_STEP: 75,          // a holding company will step this far off its post to see over a crest
  CREST_STEP_RANGE: 200,   // …once the enemy is this close
  CHARGE_BLOWN: 0.2,       // below this breath, with nobody in contact, a charge (or a pursuit) is over
  CHARGE_MAX: 45,          // seconds; nobody chases a beaten enemy across the county
  // MOMENTUM: a charge's push is how fast the men are going when it lands (wind, slope and ground
  // all slow them) plus the drop: charging down onto a line is terrifying, up into one is murder
  DOWNHILL_RUSH: 0.012,    // rush speed gained per % of downhill grade (cap +18%)
  SLOPE_PUSH: 0.05,        // push per metre the charger stands above the defender (±8 m)
  CAPTURE_RANGE: 150,      // left on the field this near a formed enemy when you withdraw = taken prisoner

  // ── cavalry & the square ──
  // Horse beats foot in the open — a line caught reloading or in the flank, skirmishers, anyone running.
  // A formed square stops horse cold (the horses will not ride onto the bayonets), but it is slow,
  // fires a quarter of its muskets each way, and is the densest target on the field.
  CAV_FILE_GAP: 1.7,
  CAV_RANK_GAP: 3.6,
  CAV_WALK: 1.8,
  CAV_TROT: 3.6,
  CAV_GALLOP: 7.5,
  CAV_FLEE: 6.5,
  CAV_GALLOP_AT: 80,       // they only open out into the gallop this close (the charge's rush); a canter before.
                           // At 120 m the horses were blown 20 m short and the charge called off every time
  CAV_CANTER: 5.2,         // closing on a mark: faster than the trot, slower than the gallop
  CAV_CLOSE: 100,          // foot form square for horse this close even if it is not charging (yet)
  CAV_LAUNCH: 135,         // they close to this at the trot, quietly, then the trumpet: ~15 s to form square
  CAV_BUSY: 130,           // a company with enemy foot this close is busy in a firefight — a mark for horse
  CAV_WIND_GALLOP: 1 / 22, // ~20 s of gallop and the horses are blown
  CAV_WIND_TROT: 1 / 300,
  CAV_REACH: 2.3,          // a sabre from the saddle reaches further than a bayonet on foot
  CAV_MASS: 2.0,           // push of a horseman at the gallop against a man on foot
  CAV_HIT: 1.0,            // a horse is a bigger mark, but a hit horse often carries on
  CAV_SABRE: 2.0,          // a horseman's melee against foot outside a square
  CAV_PURSUIT: 0.9,        // per second: a horseman riding down a fleeing man
  CAV_VS_HORSE: 0.5,       // a foot soldier's bayonet against a man on a horse (in a square: ×1.2 instead)
  CAV_SHOCK: 1.6,          // charge shock from horse against foot (× CHARGE_SHOCK)
  CAV_CHARGE_RANGE: 80,    // the ground shakes this far out
  CAV_SCOUT: 340,          // horsemen look for a mark this far off
  CAV_HOVER: 170,          // …and hang about this far off, so you have to stand in square
  CAV_MARK: 0.8,           // how inviting a target must look before they go in
  CAV_WARN: 250,           // infantry form square when horsemen come on this close
  CAV_NERVE: 0.6,          // morale cost per trooper down (× the usual)
  SQUARE_DEF: 16,           // a formed square's nerve against horse (a shaken one can still be broken)
  SQUARE_DRESS: 9,         // seconds to dress a square and close its corners (× 1.25 − drill)
  SQUARE_EXPOSED: 1.35,    // muskets (and guns) into a square: every ball finds somebody
  SQUARE_FORMED: 0.7,

  // ── artillery ──
  // A field gun fired two rounds a minute to a musket's one, and reached three times as far.
  // Roundshot is what makes a square (or a column) a terrible place to stand; canister is what
  // makes walking up to a battery a terrible idea. A crest between you and the guns is everything.
  GUN_CREW: 5,
  GUN_RELOAD: 26,          // seconds, full crew (fewer hands, slower)
  GUN_RANGE: 650,
  GUN_TRAVERSE: 0.25,      // radians per second to lay the piece across the battery's front (handspikes on the trail)
  GUN_ARC: 0.4,            // …beyond this either side of the front the trail must be dragged round:
  GUN_SWING: 0.04,         // radians per second — come at a battery from the flank
  GUN_GAP: 16,             // metres between pieces in a battery
  ROUND_SD: 0.006,         // left/right error, radians, for an average crew (laying for line was easy; range was the hard part)
  ROUND_LONG_SD: 0.05,     // over/short error, × range
  ROUND_SHORT: 25,         // first graze this far short of the fall of shot…
  ROUND_SKIP: 140,         // …and it skips on this far beyond
  ROUND_SKIP_H: 1.0,       // after its graze the ball skips about this high (m) above the graze point…
  ROUND_SINK: 0.004,       // …losing this much height per metre: over a crest the ground falls away and it passes overhead
  ROUND_WIDTH: 0.55,       // a man this close to its path is hit
  ROUND_KILLS: 6,
  ROUND_P: 0.3,            // a man in its path is hit (the rest of the time it bounds over him, or he sees it coming)
  ROUND_SCARE: 0.7,        // morale lost by a company a ball passes through or near, hit or miss
  BALL_SPEED: 260,         // m/s, for the picture
  CANISTER_RANGE: 140,     // about a musket's reach: skirmishers can duel the crews from just outside it
  CANISTER_SPREAD: 0.13,   // radians either side
  CANISTER_BALLS: 30,
  CANISTER_FALLOFF: 110,
  CANISTER_P: 0.4,         // most of a tin went high, low or into the ground
  CANISTER_KILLS: 6,
  GUN_CAPTURE: 8,          // no gunner of its own within 6 m and an enemy this close: the piece is taken
  GUN_LOST: 15,      // share of men in their places before a square counts as formed

  // ── morale (0..100) ──
  MORALE_BASE: 58,
  STEADY: 55, SHAKEN: 30, WAVERING: 15,
  LOSS_SHOCK: 120,         // morale lost per man down, divided by unit's starting size
  SUDDEN_MULT: 1.6,        // 3+ men down within 3 s: a volley, not attrition
  FLANK_MULT: 1.6,         // shot from beyond 60° off the front
  REGEN: 0.3,              // morale/s recovered once nobody has fallen for QUIET seconds
  QUIET: 12,
  SUPPRESS: 0.1,           // morale lost per ball aimed at the company, hit or miss
  LEFT_WEIGHT: 60,         // baseline lost as the ranks thin (x fraction gone)
  COMMANDER_AURA: 32,      // metres — your presence steadies the men
  RALLY_RANGE: 38,
  RALLY_BOOST: 12,
  RALLY_COOLDOWN: 20,
  RALLY_RETRY: 5,          // a rally that does not take can be tried again this soon
  RALLY_AT: 26,            // a routed unit can be rallied once morale (with the shout) is back to this
  RALLY_WINDOW: 35,        // seconds your broken company stays on the field to be rallied before the day is lost
  RALLY_HOLD: 0.45,        // fleeing men with you among them run this much slower (you are grabbing them)
  CHARGE_TEST_AFTER: 1.5,  // the nerve test waits this long into a charge, so a short dash still gets its run-up
  CMD_ALONE: 7,            // no man of yours within this: you are alone among them
  MOB_RANGE: 8,            // …and every enemy this close comes for you
  CMD_ALONE_HIT: 1.0,      // bayonet odds against a lone officer (0.6 with your men about you)
  COLOURS_LOST: 22,
  OFFICER_LOST: 12,

  // ── orders ──
  VOICE_RANGE: 48,         // beyond this the men hear only the drum
  VOICE_DELAY: 0.4,
  DRUM_DELAY: 1.8,
  BUGLE_RANGE: 350,        // your bugler's calls reach any party of yours this far off…
  BUGLE_DELAY: 1.2,
  RUNNERS: 2,              // …anything else to a party out of earshot goes by runner
  RUNNER_SPEED: 4.2,       // m/s
  RUNNER_RISK: 80,         // a runner passing this close to a company of theirs may be shot…
  RUNNER_LOSS: 0.3,        // …this likely, per company he passes
  PLACE_RANGE: 90,         // a dragged line may stand at most this far from where the company is
  PLACE_MIN: 4,            // a stroke shorter than this (metres) is a tap, not a placement

  // ── visibility ──
  SIGHT: 480,
  LOG_FRESH: 12,
  // your own guns (bought): they limber up, move at a walk, and unlimber before they fire again
  GUN_LIMBER: 12,          // seconds to limber up (and again to unlimber)
  GUN_MOVE: 1.5,           // m/s, horse-drawn at a walk
  TROOP_SIZE: 12,          // a troop of light dragoons when bought
  TROOP_RETURN: 6,         // s after a charge before your troop walks back to where you put it
  // the French have more behind the hill (the user: "lots of these maps we win if I do nothing"): as their
  // companies break, fresh ones come up — a pool per battle of BASE + LV × level (+1 in a great battle)
  FR_RESERVE_BASE: 1,
  FR_RESERVE_LV: 2,
  FR_RESERVE_DELAY: 70,    // seconds after a company breaks before its replacement marches on (±25%)
  FR_RESERVE_SIZE: 0.8,    // × a fresh company's usual strength
  // a routed AI company rallies on a steady, well-drilled company of its own side that its men run past
  RALLY_FRIEND_R: 35,      // metres from that company's centre
  RALLY_FRIEND_DRILL: 0.5,
  RALLY_FRIEND_RATE: 1.2,  // morale/s while they are among them           // seconds a report stays in the battle log on screen (all of it is under 📜)
  WOODS_BLOCK: 22,
  HEAR_HORSE: 160,         // horse at the trot or gallop is heard this far off, seen or not (the rye at Quatre Bras)
  RYE_BLOCK: 0.75,         // tall rye (a map sets f.rye): per 3 m of it, so ~90 m hides a man — and a squadron until it breaks into the gallop.
                           // 1.2 (~55 m) was a 9-minute blind stand-off: the French halted at their firing distance and nobody could see to shoot
  MISFIRE_PRIME: 0.35,     // a flash in the pan (wet powder) costs this share of a reload: clear the vent, prime again         // metres of woodland a line of sight can cross
  EYE: 1.8,

  // ── smoke ──
  SMOKE_LIFE: 34,
  SMOKE_CELL: 8,
  SMOKE_K: 0.55,           // hit chance × exp(-K × density along the line)

  // ── battle ──
  NIGHTFALL: 32 * 60,      // a battle that runs this long is a draw
  STEP: 1 / 30,            // fixed sim step; time-scale runs more steps
  START_HOUR: 10,
};

const TEAM_PLAYER = 0, TEAM_ENEMY = 1;
