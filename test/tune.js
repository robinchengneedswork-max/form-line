'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  TUNE — fights whole battles with the AI driving YOUR company too, and
//  reports what a battle feels like in numbers: how long, who won, how
//  many fell, and the real rate of fire (the anchor: ~1 round a minute).
//
//    node test/tune.js            every scenario × 6 seeds
//    node test/tune.js ridge 20   one scenario, 20 seeds
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const { load } = require('./load');
const { X } = load();
const { Battle, SCENARIOS, BATTLE_POOL, CFG, Campaign, makeRng } = X;

// how YOUR company is played by the autoplayer in each scenario
const PLAYER_DOCTRINE = { plain: 'attack', ridge: 'hold', farm: 'attack', ford: 'hold', woods: 'attack', village: 'attack', lane: 'attack', finale: 'hold', heath: 'hold', battery: 'attack' };

function fight(scenario, seed, level = 0.3) {
  const B = Battle.create({ scenario, seed, level, autoPlayer: true, playerDoctrine: PLAYER_DOCTRINE[scenario],
    company: Campaign.defaultCompany(makeRng(seed + 1)) });
  const dt = CFG.STEP;
  let firstShot = null;
  while (!B.over && B.t < CFG.NIGHTFALL + 5) {
    Battle.step(B, dt);
    if (firstShot === null && B.events.some(e => e.type === 'shot')) firstShot = B.t;
    B.events.length = 0;
  }
  const mine = B.units.filter(u => u.team === 0), theirs = B.units.filter(u => u.team === 1);
  const sum = (us, k) => us.reduce((a, u) => a + u.stats[k], 0);
  const start = us => us.reduce((a, u) => a + u.startSize, 0);
  const fightMins = Math.max(0.5, (B.t - (firstShot || B.t)) / 60);
  return {
    how: B.result ? B.result.how : 'timeout', t: B.t, firstShot,
    myLoss: sum(mine, 'down') / start(mine), theirLoss: sum(theirs, 'down') / start(theirs),
    shotsPerManMin: (sum(mine, 'shots') + sum(theirs, 'shots')) / (start(mine) + start(theirs)) / fightMins,
    hitRate: (sum(mine, 'hits') + sum(theirs, 'hits')) / Math.max(1, sum(mine, 'shots') + sum(theirs, 'shots')),
  };
}

const pct = x => (x * 100).toFixed(0).padStart(3) + '%';
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const [only, nArg] = process.argv.slice(2);
const list = only ? [only] : BATTLE_POOL.concat(X.SETPIECE_POOL, 'finale');
const N = Number(nArg) || 6;
console.log('scenario   won  lost other | length  1st shot | my loss  their loss | rds/man/min  hit%');
for (const sc of list) {
  const rs = [];
  for (let s = 1; s <= N; s++) rs.push(fight(sc, s * 7919));
  const c = h => rs.filter(r => r.how === h).length;
  const avg = k => rs.reduce((a, r) => a + (r[k] || 0), 0) / rs.length;
  console.log(`${sc.padEnd(10)} ${String(c('won')).padStart(3)} ${String(c('lost') + c('fell')).padStart(5)} ${String(N - c('won') - c('lost') - c('fell')).padStart(5)} | ${mmss(avg('t')).padStart(6)}  ${mmss(avg('firstShot')).padStart(7)} | ${pct(avg('myLoss'))}     ${pct(avg('theirLoss'))}      |    ${avg('shotsPerManMin').toFixed(2)}       ${(avg('hitRate') * 100).toFixed(1)}`);
  if (only) for (const r of rs) console.log('   ', r.how.padEnd(9), mmss(r.t), 'my', pct(r.myLoss), 'their', pct(r.theirLoss));
}
