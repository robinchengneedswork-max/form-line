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
  CMD_RUN: 3.8,
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
  RALLY_COOLDOWN: 25,
  RALLY_AT: 38,            // a routed unit can be rallied once morale is back to this
  COLOURS_LOST: 22,
  OFFICER_LOST: 12,

  // ── orders ──
  VOICE_RANGE: 48,         // beyond this the men hear only the drum
  VOICE_DELAY: 0.4,
  DRUM_DELAY: 1.8,
  PLACE_RANGE: 90,         // a dragged line may stand at most this far from where the company is
  PLACE_MIN: 4,            // a stroke shorter than this (metres) is a tap, not a placement

  // ── visibility ──
  SIGHT: 480,
  WOODS_BLOCK: 22,         // metres of woodland a line of sight can cross
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
