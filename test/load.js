'use strict';
// Loads the sim modules into a vm context in index.html order. Top-level const
// is not a property of a vm context, so we append an export line.
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');
const SIM_FILES = [
  'config.js', 'rng.js', 'data/factions.js', 'data/tunes.js', 'field.js', 'data/scenarios.js',
  'unit.js', 'move.js', 'combat.js', 'morale.js', 'orders.js', 'ai.js', 'battle.js', 'campaign.js',
];
const EXPORTS = ['CFG', 'T', 'TERRAIN', 'Field', 'Paint', 'makeField', 'makeRng', 'SCENARIOS', 'BATTLE_POOL',
  'FACTIONS', 'TUNES', 'CADENCES', 'DRUM_CALLS', 'noteFreq', 'Unit', 'makeUnit', 'Move', 'Combat', 'Smoke',
  'Morale', 'Colours', 'Orders', 'AI', 'Battle', 'Campaign', 'EVENTS', 'RANKS', 'MAP_ROWS', 'TEAM_PLAYER', 'TEAM_ENEMY',
  'dist', 'angDiff'];

function load(extraFiles = [], sandbox = {}) {
  const ctx = vm.createContext(Object.assign({ Math, console, JSON, Date, Set, Map, Array, Object, Number, String,
    Float32Array, Uint8Array, Infinity, NaN, isNaN, parseInt, parseFloat }, sandbox));
  let code = '';
  for (const f of SIM_FILES.concat(extraFiles)) code += fs.readFileSync(path.join(SRC, f), 'utf8') + '\n;\n';
  code += `globalThis.__x = { ${EXPORTS.join(', ')} };`;
  vm.runInContext(code, ctx, { filename: 'form-line-bundle.js' });
  return { ctx, X: ctx.__x };
}
module.exports = { load, SIM_FILES };
