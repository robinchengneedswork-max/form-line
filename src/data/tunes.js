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
  grenadiers: { bpm: 108, melody: [
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
  skirmish: ['x', 'x', 'X', '.', 'x', 'x', 'X'],
  close:    ['X', '.', 'X', 'x', 'X', '.'],
  rally:    ['r', 'X', 'r', 'X', 'r', 'X'],
};

const NOTE_INDEX = { C: -9, 'C#': -8, D: -7, 'D#': -6, E: -5, F: -4, 'F#': -3, G: -2, 'G#': -1, A: 0, 'A#': 1, B: 2 };
function noteFreq(name) {
  const m = /^([A-G]#?)(\d)$/.exec(name);
  if (!m) return 0;
  return 440 * Math.pow(2, (NOTE_INDEX[m[1]] + (Number(m[2]) - 4) * 12) / 12);
}
