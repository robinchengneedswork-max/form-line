'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TUNES & CADENCES — written down BY EAR. They are recognisable rather
//  than scholarly; correct a note here and the fife plays it.
//
//  melody: [note, beats]   'R' = rest.  Played an octave up on the fife.
//  cadence: one bar of eighth-notes. X accent · x tap · f flam · r ruff · . rest
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const TUNES = {
  // "Some talk of Alexander, and some of Hercules…"
  grenadiers: { bpm: 108, fife: true, name: 'The British Grenadiers', about: 'The one every fifer knows.', melody: [
    ['G4', 1],
    ['C5', 1], ['C5', 1], ['D5', 1], ['D5', 1], ['E5', 1], ['F5', 1], ['G5', 1], ['E5', 1],
    ['F5', 1], ['E5', 1], ['D5', 1], ['C5', 1], ['B4', 2], ['G4', 1], ['G4', 1],
    ['C5', 1], ['C5', 1], ['D5', 1], ['D5', 1], ['E5', 1], ['F5', 1], ['G5', 1], ['E5', 1],
    ['F5', 1], ['D5', 1], ['B4', 1], ['G4', 1], ['C5', 3], ['G5', 1],
    ['G5', 1], ['E5', 1], ['C5', 1], ['E5', 1], ['G5', 1], ['E5', 1], ['C5', 1], ['E5', 1],
    ['F5', 1], ['D5', 1], ['B4', 1], ['D5', 1], ['G5', 2], ['R', 1], ['G4', 1],
    ['C5', 1], ['C5', 1], ['D5', 1], ['D5', 1], ['E5', 1], ['F5', 1], ['G5', 1], ['E5', 1],
    ['F5', 1], ['E5', 1], ['D5', 1], ['B4', 1], ['C5', 3], ['R', 1],
  ] },
  // "Allons enfants de la Patrie…"
  marseillaise: { bpm: 100, melody: [
    ['D4', 0.75], ['D4', 0.25], ['D4', 1], ['G4', 1], ['G4', 1], ['A4', 1], ['A4', 1],
    ['D5', 1.5], ['B4', 0.5], ['G4', 0.75], ['G4', 0.25], ['B4', 0.75], ['G4', 0.25],
    ['E4', 1], ['C5', 2], ['A4', 0.75], ['F#4', 0.25], ['G4', 3], ['R', 1],
    ['G4', 0.75], ['A4', 0.25], ['B4', 1], ['B4', 1], ['B4', 1], ['C5', 0.75], ['B4', 0.25],
    ['B4', 1], ['A4', 2], ['R', 1], ['A4', 0.75], ['B4', 0.25], ['C5', 1], ['C5', 1], ['C5', 1],
    ['D5', 0.75], ['C5', 0.25], ['B4', 3], ['R', 1],
  ] },

  // ── bought for your fifer (the user: "same fifer gets old") ──
  // "I'm lonesome since I crossed the hill…" — played as a regiment marched out of a garrison town
  girl: { bpm: 112, fife: true, name: 'The Girl I Left Behind Me', about: 'Played whenever a regiment marches out of a town.', melody: [
    ['B4', 0.5], ['A4', 0.5],
    ['G4', 0.5], ['A4', 0.5], ['B4', 0.5], ['D5', 0.5], ['E5', 0.5], ['D5', 0.5], ['B4', 0.5], ['G4', 0.5],
    ['A4', 0.5], ['G4', 0.5], ['A4', 0.5], ['B4', 0.5], ['A4', 0.5], ['G4', 0.5], ['E4', 0.5], ['D4', 0.5],
    ['G4', 0.5], ['A4', 0.5], ['B4', 0.5], ['D5', 0.5], ['E5', 0.5], ['D5', 0.5], ['B4', 0.5], ['G4', 0.5],
    ['A4', 0.5], ['G4', 0.5], ['A4', 0.5], ['B4', 0.5], ['G4', 1], ['B4', 0.5], ['C5', 0.5],
    ['D5', 0.5], ['G5', 0.5], ['G5', 0.5], ['E5', 0.5], ['D5', 0.5], ['B4', 0.5], ['G4', 0.5], ['B4', 0.5],
    ['C5', 0.5], ['E5', 0.5], ['E5', 0.5], ['C5', 0.5], ['B4', 0.5], ['G4', 0.5], ['G4', 0.5], ['A4', 0.5],
    ['B4', 0.5], ['D5', 0.5], ['G5', 0.5], ['D5', 0.5], ['E5', 0.5], ['D5', 0.5], ['B4', 0.5], ['G4', 0.5],
    ['A4', 0.5], ['G4', 0.5], ['A4', 0.5], ['B4', 0.5], ['G4', 1.5], ['R', 0.5],
  ] },
  // the redcoats' joke at the Americans' expense, before the Americans took it for their own
  yankee: { bpm: 120, fife: true, name: 'Yankee Doodle', about: 'An old army joke at the Americans’ expense.', melody: [
    ['G4', 0.5], ['G4', 0.5], ['A4', 0.5], ['B4', 0.5], ['G4', 0.5], ['B4', 0.5], ['A4', 0.5], ['D4', 0.5],
    ['G4', 0.5], ['G4', 0.5], ['A4', 0.5], ['B4', 0.5], ['G4', 1], ['F#4', 1],
    ['G4', 0.5], ['G4', 0.5], ['A4', 0.5], ['B4', 0.5], ['C5', 0.5], ['B4', 0.5], ['A4', 0.5], ['G4', 0.5],
    ['F#4', 0.5], ['D4', 0.5], ['E4', 0.5], ['F#4', 0.5], ['G4', 1], ['G4', 1],
    ['E4', 0.75], ['F#4', 0.25], ['E4', 0.5], ['D4', 0.5], ['E4', 0.5], ['F#4', 0.5], ['G4', 1],
    ['D4', 0.75], ['E4', 0.25], ['D4', 0.5], ['C4', 0.5], ['B3', 1], ['D4', 1],
    ['E4', 0.75], ['F#4', 0.25], ['E4', 0.5], ['D4', 0.5], ['E4', 0.5], ['F#4', 0.5], ['G4', 0.5], ['E4', 0.5],
    ['D4', 0.5], ['G4', 0.5], ['F#4', 0.5], ['A4', 0.5], ['G4', 1], ['G4', 1],
  ] },

  // ── the pipes (a piper, bought): played as written, over a drone. "Scotland the Brave" is later than
  // Waterloo (c. 1900) — it is here because everyone knows it ──
  scotland: { bpm: 84, pipes: true, drone: ['D3', 'A3'], name: 'Scotland the Brave', melody: [
    ['D4', 1], ['D4', 0.75], ['E4', 0.25], ['F#4', 0.75], ['D4', 0.25], ['F#4', 0.75], ['A4', 0.25],
    ['B4', 1], ['A4', 0.75], ['B4', 0.25], ['A4', 0.75], ['F#4', 0.25], ['D4', 0.75], ['F#4', 0.25],
    ['E4', 1], ['E4', 0.75], ['F#4', 0.25], ['E4', 0.75], ['D4', 0.25], ['B3', 0.75], ['D4', 0.25],
    ['E4', 2], ['R', 1], ['A3', 1],
    ['D4', 1], ['D4', 0.75], ['E4', 0.25], ['F#4', 0.75], ['D4', 0.25], ['F#4', 0.75], ['A4', 0.25],
    ['B4', 1], ['A4', 0.75], ['B4', 0.25], ['D5', 0.75], ['A4', 0.25], ['F#4', 0.75], ['D4', 0.25],
    ['E4', 1], ['E4', 0.75], ['F#4', 0.25], ['A4', 0.75], ['F#4', 0.25], ['E4', 0.75], ['F#4', 0.25],
    ['D4', 2], ['R', 2],
  ] },
};

const CADENCES = {
  quickstep:      { bpm: 108, bar: ['X', 'x', 'f', 'x', 'X', 'x', 'r', 'x'] },
  'pas-de-charge': { bpm: 100, bar: ['X', '.', 'x', 'x', 'X', '.', 'r', 'x'] },
  longroll:       { bpm: 120, bar: ['r', 'r', 'r', 'r', 'r', 'r', 'r', 'X'] },
};

// Drum signals that carry an order down the line (one-shot, eighth-notes)
const DRUM_CALLS = {
  follow:   ['X', 'x', 'X', '.'],
  line:     ['X', '.', 'X', 'x', 'X', '.'],
  advance:  ['X', 'x', 'x', 'X', 'x', 'x', 'X'],
  halt:     ['X', '.', '.', 'X'],
  ready:    ['f', 'f', 'X'],
  fire:     ['X'],
  atwill:   ['r', 'X', 'r', 'X'],
  cease:    ['X', '.', 'X', '.', 'X'],
  charge:   ['r', 'r', 'r', 'r', 'X', 'X'],
  fallback: ['X', '.', '.', 'x', 'X', '.', '.', 'x'],
  retire:   ['X', '.', '.', '.', 'X', '.', '.', '.', 'X'],
  reform:   ['X', 'x', 'X', '.', 'X', 'x', 'X'],
  square:   ['r', 'r', 'X', '.', 'r', 'r', 'X', '.', 'X'],
  skirmish: ['x', 'x', 'X', '.', 'x', 'x', 'X'],
  close:    ['X', '.', 'X', 'x', 'X', '.'],
  byrank:   ['X', 'x', '.', 'X', 'x', '.'],
  attackcol: ['f', 'x', 'f', 'x', 'X', 'X'],
  rally:    ['r', 'X', 'r', 'X', 'r', 'X'],
  screen:   ['x', 'x', 'X', 'x', 'x', 'X', '.', 'X'],
};

const NOTE_INDEX = { C: -9, 'C#': -8, D: -7, 'D#': -6, E: -5, F: -4, 'F#': -3, G: -2, 'G#': -1, A: 0, 'A#': 1, B: 2 };
function noteFreq(name) {
  const m = /^([A-G]#?)(\d)$/.exec(name);
  if (!m) return 0;
  return 440 * Math.pow(2, (NOTE_INDEX[m[1]] + (Number(m[2]) - 4) * 12) / 12);
}
