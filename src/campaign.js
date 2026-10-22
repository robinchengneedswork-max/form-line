'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CAMPAIGN — the roguelike run. A branching route of eleven stages
//  (Slay-the-Spire style) ending in a great battle. Between fights:
//  camps, the quartermaster, and the odd event.
//
//  RENOWN is both the score and the purse. Spending it does not lower
//  your RANK, which follows renown EARNED and sets how many men you may
//  lead. Your men are individuals: they gain experience, keep their kill
//  tallies, and die. If you fall, or your company is gone, the run ends.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const MAP_ROWS = 9;    // stages in one act's route, the last being the act's great battle

// THE ACTS — like Slay the Spire's: each its own route, ending in a great battle, then winter quarters.
// The enemy gets better across the whole campaign (Campaign.level), so horse turns up in Act II and
// guns and cuirassiers in earnest in Act III.
const ACTS = [
  { name: 'Act I — The Peninsula, 1810', short: 'The Peninsula', road: 'The Road to Busaco', boss: 'sp_ridge', bossName: 'Busaco', setpieces: ['sp_coa', 'sp_albuera', 'sp_village'],
    blurb: 'Masséna is coming into Portugal. Wellington means to stand on a ridge and let him come.' },
  { name: 'Act II — Spain, 1812–13', short: 'Spain', road: 'The Road to Vitoria', boss: 'sp_village', bossName: 'Vitoria', setpieces: ['sp_salamanca', 'sp_maya', 'sp_ridge'],
    blurb: 'The army is going forward at last. The French have horse now, and they know how to use it.' },
  { name: 'Act III — The Hundred Days, 1815', short: 'The Hundred Days', road: 'The Road to Brussels', boss: 'finale', bossName: 'Waterloo', setpieces: ['sp_quatrebras', 'sp_hougoumont', 'sp_village'],
    blurb: 'He is back from Elba. One more battle, the biggest of them all.' },
];

const Campaign = {
  // a new man. Given the company, he gets a surname nobody in it has yet (when the list allows): two
  // Harrises in one company made the sergeants' party list and the muster unreadable
  newSoldier(rng, vet = 0, co = null) {
    const taken = new Set(co ? co.soldiers.map(Campaign.surname) : []);
    let sur = rng.pick(SURNAMES);
    for (let k = 0; k < 40 && taken.has(sur); k++) sur = rng.pick(SURNAMES);
    return {
      id: Math.floor(rng() * 1e9),
      name: `${rng.pick(FIRST_NAMES)} ${sur}`,
      aim: clamp(1 + rng.gauss() * 0.12 + vet * 0.04, 0.72, 1.4),
      nerve: rng.gauss() * 5 + vet * 2,
      xp: vet ? rng.int(vet, vet + 2) : 0, kills: 0, battles: 0,
      wounds: 0, mentions: 0,
      rank: 'pte', weapon: 'musket',
    };
  },
  // a man into the company, with a surname of his own
  enlist(co, rng, vet = 0) { const s = Campaign.newSoldier(rng, vet, co); co.soldiers.push(s); return s; },
  surname(s) { return s.name.split(' ').slice(-1)[0]; },
  // what the company calls him: his surname, or "J. Harris" when there are two Harrises
  callName(co, s) {
    const sur = Campaign.surname(s);
    const same = co.soldiers.filter(x => x !== s && Campaign.surname(x) === sur);
    if (!same.length) return sur;
    const ini = s.name[0];
    return same.some(x => x.name[0] === ini) ? s.name : `${ini}. ${sur}`;
  },

  defaultCompany(rng) {
    const co = { soldiers: [] };
    for (let i = 0; i < 24; i++) Campaign.enlist(co, rng, i < 4 ? 1 : 0);
    return { name: 'No. 4 Company, 1/52nd Foot', drill: 0.35, nerve: 0, drummer: true, fifer: true, colours: true, soldiers: co.soldiers,
      traits: {},       // bought from the quartermaster: light / grenadier / line (Campaign.TRAITS)
      tunes: ['grenadiers'],   // what the fifer can play: he goes through them in turn
      piper: false,     // pipes: he marches out with the first sergeant's party
      allies: [],       // other companies that follow you, under their own officers (bought from Act II)
      drills: [],       // learned drills (see LEARNED_DRILLS in orders.js)
      rifles: 0,        // Baker rifles owned; the best shots carry them
      surgeons: 0,      // surgeon's mates, 0..3: more of the wounded live to march again
      recruiters: 0,    // a recruiting party, 0..3: raw men come up after every battle
      battery: null,    // your own guns: { pieces, name, drill } — they stay with you until the French take them
      troop: null };    // your own horse: { size, type, name } — the troopers who fall are gone
  },

  // a company for a quick battle: as big and as seasoned as the chosen point in a campaign would make it
  quickCompany(seed, q = {}) {
    const rng = makeRng(seed ^ 0x51ed), stage = q.stage != null ? q.stage : 0.3, size = q.size || 24;
    const co = Campaign.defaultCompany(rng);
    co.soldiers = [];
    for (let i = 0; i < size; i++) Campaign.enlist(co, rng, rng() < 0.15 + stage * 0.5 ? 2 : rng() < 0.4 ? 1 : 0);
    // NCOs: a sergeant per twelve men, a corporal per eight, from the most experienced
    const best = co.soldiers.slice().sort((a, b) => b.xp - a.xp);
    best.slice(0, Math.floor(size / 12)).forEach(s => { s.rank = 'sgt'; });
    best.slice(Math.floor(size / 12), Math.floor(size / 12) + Math.floor(size / 8)).forEach(s => { s.rank = 'cpl'; });
    co.drill = clamp(0.3 + stage * 0.35, 0, 0.9);
    co.drills = Object.keys(LEARNED_DRILLS);
    co.traits = q.type ? { [q.type]: true } : {};
    if (co.traits.line) co.drill = clamp(co.drill + 0.05, 0, 0.95);
    co.rifles = co.traits.light ? 4 : stage >= 0.45 ? 2 : 0;
    Campaign.armRifles(co);
    // try your own gun and horse without a campaign
    if (q.gun) co.battery = { pieces: 1, name: 'Your gun, RA', drill: 0.55 };
    if (q.troop) co.troop = { size: CFG.TROOP_SIZE, type: 'light_dragoons', name: 'A Troop, 16th Light Dragoons' };
    if (q.ally) co.allies = [Campaign.newAlly(co, rng, q.ally)];
    return co;
  },

  newRun(seed) {
    const rng = makeRng(seed);
    const run = {
      seed, renown: 0, total: 0, battles: 0, wins: 0, over: null,
      company: Campaign.defaultCompany(rng),
      commander: { hp: 3, maxHp: 3 },
      act: 0, winter: false,
      map: Campaign.genMap(rng, 0), at: null, row: -1, log: [], fallen: [],
      rngN: 1,
    };
    return run;
  },

  // saves from before the company sheet existed
  migrate(run) {
    const co = run.company;
    co.drills = co.drills || []; co.rifles = co.rifles || 0; co.riflesStored = co.riflesStored || 0;
    // the company "character" chosen at Captain is now a trait bought from the quartermaster
    co.traits = co.traits || {};
    if (co.type) { co.traits[co.type] = true; co.type = null; }
    co.tunes = co.tunes || ['grenadiers']; co.piper = !!co.piper; co.allies = co.allies || [];
    co.battery = co.battery || null; co.troop = co.troop || null;
    co.surgeons = co.surgeons || 0; co.recruiters = co.recruiters || 0;
    run.act = run.act || 0; run.winter = !!run.winter;
    for (const s of co.soldiers) { s.rank = s.rank || 'pte'; s.weapon = s.weapon || 'musket'; s.wounds = s.wounds || 0; s.mentions = s.mentions || 0; }
    return run;
  },

  rng(run) { run.rngN++; return makeRng((run.seed * 7919 + run.rngN * 104729) >>> 0); },
  rank(run) { let r = RANKS[0]; for (const k of RANKS) if (run.total >= k.renown) r = k; return r; },
  nextRank(run) { return RANKS.find(k => k.renown > run.total) || null; },
  // how good the enemy is: climbs across the whole campaign, not just one act
  level(row, act = 0, rows = MAP_ROWS) { return clamp((act + row / (rows - 1)) / ACTS.length, 0, 1); },
  act(run) { return ACTS[Math.min(run.act || 0, ACTS.length - 1)]; },

  // ── the route ──
  genMap(rng, act = 0) {
    const rows = [];
    // each act has its own great battles: drawn without repeats until the act's pool runs dry
    const pool = ACTS[act].setpieces || SETPIECE_POOL;
    let left = [];
    const nextSetpiece = () => { if (!left.length) left = pool.slice(); return left.splice(Math.floor(rng() * left.length), 1)[0]; };
    const rollType = r => { const x = rng(); return x < 0.44 ? 'battle' : x < 0.58 ? 'quartermaster' : x < 0.72 ? 'camp' : x < 0.88 ? 'event' : (r >= 3 ? 'elite' : 'battle'); };
    for (let r = 0; r < MAP_ROWS; r++) {
      const n = r === 0 ? 2 : r === MAP_ROWS - 1 ? 1 : rng.int(2, 4);
      // the row's kinds first, then dealt out across it in a random order. (They used to be placed by
      // position: the big battle was always the left-most node and the quartermaster the right-most, so
      // every route ran great battles down the left and shops down the right — the user spotted it)
      const types = [];
      for (let i = 0; i < n; i++) {
        let type;
        if (r === MAP_ROWS - 1) type = 'finale';
        else if (r === 0) type = 'battle';
        else if (r === MAP_ROWS - 2) type = i === 0 ? 'camp' : rng.pick(['quartermaster', 'camp']);
        else if (r % 2 === 0 && i === 0) type = 'setpiece';           // a big battle every other stage
        else if (r % 2 === 1 && i === 0) type = 'quartermaster';      // and the quartermaster's cart is never far
        else type = rollType(r);
        types.push({ type, rolled: !(r === MAP_ROWS - 1 || r === 0 || r === MAP_ROWS - 2 || i === 0) });
      }
      for (let i = types.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [types[i], types[j]] = [types[j], types[i]]; }
      const row = [];
      for (let i = 0; i < n; i++) {
        const { type, rolled } = types[i];
        row.push({ rolled,
          id: `${r}-${i}`, row: r, x: (i + 0.5) / n + (n > 1 ? rng.range(-0.08, 0.08) : 0), type,
          scenario: type === 'finale' ? ACTS[act].boss : type === 'setpiece' ? nextSetpiece() : (type === 'battle' || type === 'elite') ? rng.pick(BATTLE_POOL) : null,
          seed: Math.floor(rng() * 1e9), edges: [], done: false,
        });
      }
      rows.push(row);
    }
    for (let r = 0; r < MAP_ROWS - 1; r++) {
      const a = rows[r], b = rows[r + 1];
      for (const n of a) {
        const sorted = b.slice().sort((p, q) => Math.abs(p.x - n.x) - Math.abs(q.x - n.x));
        n.edges.push(sorted[0].id);
        if (sorted[1] && rng() < 0.45) n.edges.push(sorted[1].id);
      }
      for (const m of b) {
        if (a.some(n => n.edges.includes(m.id))) continue;
        a.slice().sort((p, q) => Math.abs(p.x - m.x) - Math.abs(q.x - m.x))[0].edges.push(m.id);
      }
    }
    // Slay the Spire's rule: no shop straight after a shop, nor camp after camp, on any one road. A rolled
    // node that would repeat its parent's kind becomes a fight instead
    // (when the child's kind is fixed — the quartermaster rows, the camp before the great battle — the parent gives way)
    const fight = n => { n.type = 'battle'; n.scenario = rng.pick(BATTLE_POOL); n.rolled = false; };
    for (let r = 1; r < MAP_ROWS; r++) for (const m of rows[r]) for (const n of rows[r - 1]) {
      if (!n.edges.includes(m.id) || n.type !== m.type || !['quartermaster', 'camp', 'event'].includes(m.type)) continue;
      if (m.rolled) fight(m); else if (n.rolled) fight(n);
    }
    for (const row of rows) for (const m of row) delete m.rolled;
    return rows;
  },
  node(run, id) { for (const row of run.map) for (const n of row) if (n.id === id) return n; return null; },
  choices(run) {
    if (run.at === null) return run.map[0];
    return Campaign.node(run, run.at).edges.map(id => Campaign.node(run, id));
  },
  go(run, id) { const n = Campaign.node(run, id); run.at = id; run.row = n.row; return n; },

  // what a battle node hands to Battle.create
  battleOpts(run, node) {
    Campaign.armRifles(run.company);
    return {
      scenario: node.scenario, seed: node.seed,
      level: Campaign.level(node.row, run.act || 0, run.map.length) + (node.type === 'elite' ? 0.18 : node.type === 'finale' ? 0.08 : 0),
      company: run.company, commander: run.commander,
    };
  },

  // ── after the smoke clears ──
  afterBattle(run, node, R) {
    const rng = Campaign.rng(run);
    const co = run.company;
    const rep = { how: R.how, orders: R.orders, lines: [], renown: 0, dead: [], wounded: 0, returned: 0, stragglers: 0, promoted: null, captured: 0, saved: R.saved || 0 };
    const add = (n, why) => { if (!n) return; rep.renown += n; rep.lines.push([why, n]); };
    if (R.won) add(node.type === 'elite' ? 35 : node.type === 'finale' ? 60 : node.type === 'setpiece' ? 40 : 20, 'Victory');
    if (R.orders != null) {
      if (R.orders >= 0.6) add(15, 'You carried out the colonel\u2019s orders');
      else if (R.orders < 0.3) add(-10, 'The colonel noted that you ignored his orders');
    }
    add(R.enemyDown, `${R.enemyDown} of the enemy shot or bayoneted`);
    add(Math.round(R.enemyFled * 0.4), `${R.enemyFled} of the enemy scattered`);
    add(R.enemyRouted * 6, `${R.enemyRouted} enemy compan${R.enemyRouted === 1 ? 'y' : 'ies'} broken`);
    add(R.coloursTaken * 25, `${R.coloursTaken} enemy colour${R.coloursTaken === 1 ? '' : 's'} taken`);
    add((R.gunsTaken || 0) * 20, `${R.gunsTaken} gun${R.gunsTaken === 1 ? '' : 's'} taken`);
    add(R.commanderKills * 2, 'Your own sword');
    if (R.coloursLost) add(-20, 'Your colours lost');
    if (R.how === 'withdrew') {
      rep.lines.push(['You withdrew from the field', 0]);
      if (R.captured) rep.lines.push([`${R.captured} men left behind and taken prisoner`, 0]);
      else if (R.saved >= Math.max(4, R.player.startSize * 0.5)) add(6, 'The company brought off in good order');
    }

    // the men
    const U = R.player;
    const keep = [];
    for (const m of U.men) {
      if (isMusician(m)) {
        if (m.state === 'down' && !(m.wounded && rng() < 0.6)) { co[m.role] = false; rep.lines.push([`Your ${m.role} was killed`, 0]); }
        else if (m.captured) { co[m.role] = false; rep.lines.push([`Your ${m.role} was taken prisoner`, 0]); }
        continue;
      }
      const s = m.src;
      if (!s) continue;
      s.kills += m.kills;
      // valour counts: every man he drops is experience, on top of having been there
      s.xp += Math.floor(m.kills / 2) + (m.kills % 2 && rng() < 0.5 ? 1 : 0);
      if (m.colours) { s.colours = (s.colours || 0) + m.colours; s.xp += 3 * m.colours; }
      if (m.captured) { rep.captured++; rep.dead.push(Object.assign({}, s, { captured: true })); continue; }
      if (m.saved) { s.battles++; s.xp += 1; keep.push(s); continue; }
      if (m.state === 'down') {
        if (m.wounded && rng() < Campaign.woundedLive(co)) { rep.wounded++; s.battles++; s.wounds = (s.wounds || 0) + 1; keep.push(s); }
        else { rep.dead.push(s); run.fallen.push({ name: s.name, kills: s.kills, battles: s.battles + 1 }); }
      } else if (m.state === 'gone' || m.state === 'fleeing') {
        if (rng() < 0.85) { rep.stragglers++; s.battles++; keep.push(s); } else rep.dead.push(Object.assign({}, s, { deserted: true }));
      } else {
        s.battles++; s.xp += R.won ? 2 : 1;
        s.aim = clamp(s.aim + 0.015, 0.7, 1.45);
        keep.push(s);
      }
    }
    co.soldiers = keep;
    // the regiment's depot sends a draft after every battle (a bigger one after a great battle),
    // and your own recruiting party adds to it
    const draft = (node.type === 'setpiece' || node.type === 'finale' ? 4 : 2) + (co.recruiters || 0);
    const room = Campaign.capacity(run) - Campaign.mustered(co), n = Math.min(Math.max(0, room), draft);
    for (let i = 0; i < n; i++) Campaign.enlist(co, rng);
    rep.recruits = n;
    if (R.coloursLost) co.colours = false;
    const A = R.attached || {};
    if (A.guns && co.battery) {
      if (A.guns.lost) rep.lines.push([`${A.guns.lost} of your guns taken by the French`, 0]);
      co.battery.pieces -= A.guns.lost;
      if (co.battery.pieces <= 0) co.battery = null;
    }
    if (A.troop && co.troop) {
      if (A.troop.lost) rep.lines.push([`${A.troop.lost} of your dragoons fell`, 0]);
      co.troop.size = A.troop.alive;
      if (co.troop.size < 3) { co.troop = null; rep.lines.push(['What is left of the troop is broken up', 0]); }
    }
    // the companies that follow you: the fallen are gone (half the wounded come back); too few and it is broken up
    for (const a of A.allies || []) {
      const al = (co.allies || []).find(x => x.id === a.id);
      if (!al) continue;
      if (a.lost) rep.lines.push([`${al.name} lost ${a.lost} men`, 0]);
      al.size = a.alive;
      if (a.mentioned) rep.lines.push([`${al.officer} is mentioned in despatches`, 0]);
      if (al.size < CFG.ALLY_MIN) { co.allies.splice(co.allies.indexOf(al), 1); rep.lines.push([`What is left of ${al.name} is sent back to its regiment`, 0]); }
    }
    // mentioned in despatches: the man who did most (two or more of the enemy down) — it is worth experience
    const best = U.men.filter(m => m.src && m.state === 'formed').sort((a, b) => b.kills - a.kills)[0];
    if (best && best.kills >= 2) {
      rep.promoted = { name: best.src.name, kills: best.kills };
      best.src.mentions = (best.src.mentions || 0) + 1; best.src.xp += 2;
    }

    run.commander.hp = R.commanderHp;
    if (R.horseLost) { run.commander.horse = false; rep.horseLost = true; }
    run.renown = Math.max(0, run.renown + rep.renown);
    run.total += Math.max(0, rep.renown);
    run.battles++;
    if (R.won) run.wins++;
    node.done = true;
    run.log.push(`${SCENARIOS[node.scenario].name}: ${R.how}`);
    if (R.how === 'fell') run.over = 'fell';
    else if (!co.soldiers.length) run.over = 'destroyed';
    else if (node.type === 'finale') {
      // an act's great battle: lose it and the campaign is lost; win it and it is winter quarters (or victory)
      if (!R.won) run.over = 'defeat';
      else if ((run.act || 0) < ACTS.length - 1) run.winter = true;
      else run.over = 'victory';
    }
    return rep;
  },

  // winter quarters between acts: wounds heal, the depot fills half the gap in the ranks, the men drill
  winterQuarters(run) {
    const co = run.company, rng = Campaign.rng(run), lines = [];
    run.commander.hp = run.commander.maxHp;
    lines.push('Your wounds have closed over the winter.');
    const room = Campaign.capacity(run) - Campaign.mustered(co), n = Math.max(0, Math.ceil(room / 2));
    for (let i = 0; i < n; i++) Campaign.enlist(co, rng);
    if (n) lines.push(`The depot sends ${n} recruit${n > 1 ? 's' : ''} to fill the ranks.`);
    co.drill = clamp(co.drill + 0.03, 0, 0.95);
    lines.push('A winter of drill: the men load a little faster.');
    return lines;
  },
  nextAct(run) {
    run.act = (run.act || 0) + 1; run.winter = false;
    run.map = Campaign.genMap(Campaign.rng(run), run.act); run.at = null; run.row = -1;
  },

  // ── between battles ──
  capacity(run) { return Campaign.rank(run).company; },
  // the men who count against the company's numbers (attached riflemen of the 95th do not)
  mustered(co) { return co.soldiers.filter(s => !s.attached).length; },

  // ── the company sheet ──
  RANK_NAMES: { pte: 'Private', cpl: 'Corporal', sgt: 'Sergeant' },
  slots(run) {
    const cap = Campaign.capacity(run), s = run.company.soldiers;
    return { sgt: Math.max(1, Math.floor(cap / 12)), cpl: Math.floor(cap / 6),
      sgtUsed: s.filter(x => x.rank === 'sgt').length, cplUsed: s.filter(x => x.rank === 'cpl').length };
  },
  // [rank to, cost, xp needed]. Promotion is earned by the man (experience: battles, the enemy he has
  // dropped, being mentioned in despatches), not bought with your renown — the user: "promoting people
  // should be based on their xp, not as much my renown". A stripe costs a token sum
  promotion(run, s) {
    const sl = Campaign.slots(run);
    if (s.rank === 'pte') return { to: 'cpl', cost: CFG.PROMOTE_CPL[0], xp: CFG.PROMOTE_CPL[1], room: sl.cplUsed < sl.cpl,
      ok: sl.cplUsed < sl.cpl && s.xp >= CFG.PROMOTE_CPL[1] && run.renown >= CFG.PROMOTE_CPL[0] };
    if (s.rank === 'cpl') return { to: 'sgt', cost: CFG.PROMOTE_SGT[0], xp: CFG.PROMOTE_SGT[1], room: sl.sgtUsed < sl.sgt,
      ok: sl.sgtUsed < sl.sgt && s.xp >= CFG.PROMOTE_SGT[1] && run.renown >= CFG.PROMOTE_SGT[0] };
    return null;
  },
  // a corporal can be stood down to make room for a better man (a sergeant first goes back to corporal)
  demote(run, id) {
    const s = run.company.soldiers.find(x => x.id === id);
    if (!s || s.rank === 'pte') return false;
    if (s.rank === 'sgt') for (const x of run.company.soldiers) if (x.party === s.id) x.party = null;
    s.rank = s.rank === 'sgt' ? 'cpl' : 'pte';
    return true;
  },
  // a man into a sergeant's party (or out of it, with sgtId null)
  setParty(run, id, sgtId) {
    const co = run.company, s = co.soldiers.find(x => x.id === id), g = sgtId == null ? null : co.soldiers.find(x => x.id === sgtId && x.rank === 'sgt');
    if (!s || s.rank === 'sgt' || (sgtId != null && !g)) return false;
    s.party = g ? g.id : null;
    return true;
  },
  rename(run, id, name) {
    const s = run.company.soldiers.find(x => x.id === id), n = String(name || '').replace(/[<>]/g, '').trim().slice(0, 28);
    if (!s || !n) return false;
    s.name = n; return true;
  },

  promote(run, id) {
    const s = run.company.soldiers.find(x => x.id === id), p = s && Campaign.promotion(run, s);
    if (!p || !p.ok) return false;
    run.renown -= p.cost; s.rank = p.to;
    return true;
  },
  // no cap on rifles: each costs more than the last (the user asked why they were gated; their rule is
  // that price is the only limit). A Light company gets them cheaper
  rifleCost(co) { return Math.round((20 + 5 * (co.rifles || 0)) * (co.traits && co.traits.light ? 0.8 : 1)); },
  // the establishment: [cost of level 1, 2, 3]
  ESTAB: {
    surgeons: { name: 'Surgeon\u2019s mate', costs: [16, 26, 40],
      desc: l => `More of the wounded survive the surgeon's table (${Math.round(Campaign.woundedLive({ surgeons: l }) * 100)}% → ${Math.round(Campaign.woundedLive({ surgeons: l + 1 }) * 100)}%).` },
    recruiters: { name: 'Recruiting party', costs: [18, 30, 45],
      desc: l => `A sergeant and a drummer beating up for volunteers: ${l + 1} more raw recruit${l ? 's' : ''} on top of the depot's draft after every battle.` },
  },
  woundedLive(co) { return [0.65, 0.75, 0.84, 0.92][co.surgeons || 0]; },
  // A rifle is carried, or in the STORE (put there by you, on the muster screen), or spare (just bought, or its
  // man has fallen): spare ones go to the best shots who have not had theirs taken away
  armRifles(co) {
    co.riflesStored = clamp(co.riflesStored || 0, 0, co.rifles);
    const armed = co.soldiers.filter(s => s.weapon === 'rifle');
    while (armed.length > co.rifles - co.riflesStored) armed.pop().weapon = 'musket';
    const free = co.rifles - co.riflesStored - armed.length;
    const cand = co.soldiers.filter(s => s.weapon !== 'rifle' && !s.noRifle).sort((a, b) => b.aim - a.aim);
    for (let i = 0; i < Math.min(free, cand.length); i++) cand[i].weapon = 'rifle';
  },
  // the muster: take this man's rifle into the store, or hand him one from it
  toggleRifle(run, id) {
    const co = run.company, s = co.soldiers.find(x => x.id === id);
    if (!s) return false;
    if (s.weapon === 'rifle') { s.weapon = 'musket'; s.noRifle = true; co.riflesStored = (co.riflesStored || 0) + 1; return true; }
    if (!(co.riflesStored > 0)) return false;
    s.weapon = 'rifle'; s.noRifle = false; co.riflesStored--;
    return true;
  },
  // every rifle to the best shots, the store emptied
  issueRifles(run) {
    const co = run.company;
    co.riflesStored = 0;
    for (const s of co.soldiers) { s.noRifle = false; s.weapon = 'musket'; }
    Campaign.armRifles(co);
  },
  // the company's character, bought a piece at a time from the quartermaster (it used to be one choice made at
  // Captain; the user found that redundant next to the shop). Any or all of them; the price is the limit
  TRAITS: {
    light: { name: 'Light-infantry training', short: 'Light', cost: 40, desc: 'Skirmish order learned at once and harder to hit in it; quicker on their feet; rifles come cheaper; a bugle-horn for the calls.' },
    grenadier: { name: 'Grenadier drafts', short: 'Grenadiers', cost: 45, desc: 'Big men from the grenadier company: better with the bayonet, steadier under fire, and the charge hits harder.' },
    line: { name: 'Battalion drill', short: 'Line', cost: 40, desc: 'Faster loading and harder-hitting volleys, and the drill sergeant starts them ahead.' },
  },
  addTrait(co, t) {
    if (!Campaign.TRAITS[t] || co.traits[t]) return false;
    co.traits[t] = true;
    if (t === 'light' && !co.drills.includes('skirmish')) co.drills.push('skirmish');
    if (t === 'line') co.drill = clamp(co.drill + 0.05, 0, 0.95);
    return true;
  },
  traitNames(co) { return Object.keys(Campaign.TRAITS).filter(k => co.traits && co.traits[k]).map(k => Campaign.TRAITS[k].short); },

  // other companies that follow you (the user, of the old "rifleman of the 95th" item that went over the
  // company's numbers: "pick up other regiments to follow us like we pick up cav, each led by some dude, with a lot
  // more autonomy"). From Act II. Each has its own officer, who has a temper of his own
  ALLY_KINDS: {
    rifles: { name: 'A company of the 95th Rifles', size: 16, cost: 110, drill: 0.6, desc: 'Riflemen in green who skirmish ahead of you on their own account and pick off officers.' },
    highland: { name: 'A Highland company', size: 24, cost: 100, drill: 0.5, desc: 'Steady men with a piper of their own. They hold a flank and go in with the bayonet when they see their chance.' },
    line: { name: 'A company of the line', size: 24, cost: 85, drill: 0.45, desc: 'Redcoats of another battalion, who stand on your flank and fight their own fight.' },
  },
  TEMPERS: {
    dashing: 'Dashing: goes in with the bayonet sooner, sometimes too soon.',
    steady: 'Steady: his men stand longer under fire.',
    obedient: 'Obedient: does what you tell him, and keeps doing it.',
  },
  allyCost(co, k) { return Campaign.ALLY_KINDS[k].cost + 40 * (co.allies || []).length; },
  allyName(rng, k) {
    const n = rng.pick(['No. 2', 'No. 3', 'No. 5', 'No. 6', 'No. 7', 'No. 8']);
    if (k === 'rifles') return `${rng.pick(['1st', '2nd', '3rd'])} Coy, ${rng.pick(['1', '2', '3'])}/95th Rifles`;
    if (k === 'highland') return `${n} Coy, ${rng.pick(['1/42nd', '1/71st', '1/79th', '1/92nd'])} Highlanders`;
    return `${n} Coy, ${rng.pick(['1/28th', '1/29th', '2/31st', '1/48th', '1/57th', '2/83rd', '1/88th'])} Foot`;
  },
  newAlly(co, rng, k) {
    const K = Campaign.ALLY_KINDS[k];
    return { id: Math.floor(rng() * 1e9), kind: k, size: K.size, est: K.size, drill: K.drill, name: Campaign.allyName(rng, k),
      officer: `${rng.pick(['Capt.', 'Capt.', 'Lt.'])} ${rng.pick(SURNAMES)}`, temper: rng.pick(Object.keys(Campaign.TEMPERS)) };
  },
  unlearned(run) { return Object.keys(LEARNED_DRILLS).filter(k => !run.company.drills.includes(k)); },

  camp(run, choice) {
    const co = run.company, rng = Campaign.rng(run);
    if (choice === 'rest') { run.commander.hp = run.commander.maxHp; return 'You sleep under a cart for the first time in a week. Wounds closed.'; }
    if (choice === 'drill') { co.drill = clamp(co.drill + 0.07, 0, 0.95); return 'Three days of platoon exercise. The men load faster.'; }
    if (choice && choice.startsWith('learn:')) {
      const k = choice.slice(6);
      if (!LEARNED_DRILLS[k] || co.drills.includes(k)) return '';
      co.drills.push(k);
      return `A week of drill on the parade ground. The company has learned ${LEARNED_DRILLS[k].toLowerCase()}.`;
    }
    if (choice === 'recruit') {
      const room = Campaign.capacity(run) - Campaign.mustered(co);
      const n = Math.min(5, Math.max(0, room));
      for (let i = 0; i < n; i++) Campaign.enlist(co, rng);
      return n ? `${n} recruits from the depot join the company.` : 'The company is at full strength — the depot sends no one.';
    }
    return '';
  },

  // what the quartermaster has, by shelf (the shop screen heads each one)
  SHELVES: { men: 'Men', character: 'The company’s character', arms: 'Arms and kit', music: 'Music', support: 'Guns and horse', allies: 'Companies to follow you', you: 'Yourself' },
  shopItems(run) {
    const co = run.company, room = Campaign.capacity(run) - Campaign.mustered(co);
    const T = Campaign.TRAITS, AK = Campaign.ALLY_KINDS;
    return [
      { cat: 'men', key: 'recruit', name: 'Recruit', desc: 'A raw volunteer.', cost: 5, ok: room > 0 },
      { cat: 'men', key: 'veteran', name: 'Veteran from another regiment', desc: 'Steadier, a better shot.', cost: 12, ok: room > 0 },
      { cat: 'men', key: 'drill', name: 'Drill sergeant', desc: `Faster loading (drill ${Math.round(co.drill * 100)} → ${Math.round(Math.min(0.95, co.drill + 0.06) * 100)}).`, cost: 22, ok: co.drill < 0.95 },
      ...Object.entries(Campaign.ESTAB).map(([k, E]) => {
        const l = co[k] || 0;
        return { cat: 'men', key: k, name: `${E.name} ${['I', 'II', 'III'][Math.min(l, 2)]}`, desc: l >= 3 ? 'At full establishment.' : E.desc(l), cost: E.costs[Math.min(l, 2)], ok: l < 3 };
      }),
      ...Object.entries(T).map(([k, t]) => ({ cat: 'character', key: 'trait:' + k, name: t.name, desc: co.traits[k] ? 'They have it.' : t.desc, cost: t.cost, ok: !co.traits[k] })),
      { cat: 'arms', key: 'rifle', name: 'Baker rifle', desc: `Twice the reach, half the rate of fire. Goes to your best shot (you have ${co.rifles}; each costs more than the last).`, cost: Campaign.rifleCost(co), ok: true },
      { cat: 'arms', key: 'drummer', name: 'Drummer boy', desc: 'Carries your orders beyond shouting range. Steadies the men.', cost: 14, ok: !co.drummer },
      { cat: 'arms', key: 'bugler', name: 'Bugler', desc: 'Sounds the simple calls — advance, halt, skirmish, charge, square, the recall — to your sergeants’ parties up to 350 m off. Without one, a runner must go.', cost: 12, ok: !co.bugler && !co.traits.light },
      { cat: 'arms', key: 'colours', name: 'New colours', desc: 'The regiment will not forget the old ones.', cost: 30, ok: !co.colours },
      { cat: 'music', key: 'fifer', name: 'Fifer', desc: 'Music in the ranks. Morale recovers faster.', cost: 12, ok: !co.fifer },
      ...Object.keys(TUNES).filter(k => TUNES[k].fife && !co.tunes.includes(k)).map(k => ({ cat: 'music', key: 'tune:' + k, name: `A tune: “${TUNES[k].name}”`, desc: `${TUNES[k].about} The fifer works it into what he plays on the march.`, cost: 6, ok: co.fifer })),
      { cat: 'music', key: 'piper', name: 'A piper', desc: 'The pipes. He marches out with your first sergeant’s party, so the skirmishers go forward to their own music; with no party out he plays with the company.', cost: 18, ok: !co.piper },
      // your own guns and horse (the user: "more stuff to spend money on — my own cannon or cav"). No caps: the price is the limit
      { cat: 'support', key: 'gun', name: co.battery ? 'Another 6-pounder' : 'A 6-pounder and its crew', desc: `Your own gun${co.battery ? ` (you have ${co.battery.pieces})` : ''}. It picks its own targets; drag to send it where you want it — it limbers up, moves at a walk and unlimbers again. If the French take it, it is gone.`, cost: 70 + 35 * (co.battery ? co.battery.pieces : 0), ok: true },
      co.troop ? { cat: 'support', key: 'remounts', name: 'Remounts for the troop', desc: `Four more troopers and their horses (the troop is ${co.troop.size}).`, cost: 16 + co.troop.size, ok: true }
        : { cat: 'support', key: 'troop', name: 'A troop of light dragoons', desc: `${CFG.TROOP_SIZE} troopers who wait where you put them and charge when you call Charge! — by voice, bugle or runner. The men who fall are gone.`, cost: 60, ok: true },
      { cat: 'support', key: 'heavies', name: 'Heavy horses for the troop', desc: 'Re-horse your dragoons as heavies: they hit harder and stand firmer.', cost: 45, ok: !!co.troop && co.troop.type !== 'heavy_dragoons' },
      // whole companies under their own officers, from Act II
      ...((run.act || 0) >= CFG.ALLY_ACT ? Object.entries(AK).map(([k, K]) => ({ cat: 'allies', key: 'ally:' + k, name: K.name, desc: `${K.size} men under an officer of their own. ${K.desc} They follow you from field to field and fight by their own lights; your orders reach them like a party's, and they do as you say for a while. The men who fall are gone.`, cost: Campaign.allyCost(co, k), ok: true })) : []),
      ...(co.allies || []).filter(al => al.size < al.est).map(al => ({ cat: 'allies', key: 'draft:' + al.id, name: `A draft for ${al.name}`, desc: `Up to six men to fill its ranks (${al.size} of ${al.est}).`, cost: 18, ok: true })),
      { cat: 'you', key: 'surgeon', name: 'Surgeon', desc: 'Patch up your own wounds (+1).', cost: 9, ok: run.commander.hp < run.commander.maxHp },
      { cat: 'you', key: 'horse', name: 'A horse', desc: 'You ride: faster about the field, a gallop that lasts, and your voice carries further. The first ball that finds you may find the horse instead — but every skirmisher on the field picks out a mounted officer.', cost: CFG.HORSE_COST, ok: !run.commander.horse },
    ];
  },
  buy(run, key) {
    const it = Campaign.shopItems(run).find(i => i.key === key);
    if (!it || !it.ok || run.renown < it.cost) return false;
    run.renown -= it.cost;
    const co = run.company, rng = Campaign.rng(run);
    const [kind, arg] = key.split(':');
    if (key === 'recruit') Campaign.enlist(co, rng);
    if (key === 'veteran') Campaign.enlist(co, rng, 2);
    if (key === 'drill') co.drill = clamp(co.drill + 0.06, 0, 0.95);
    if (kind === 'trait') Campaign.addTrait(co, arg);
    if (key === 'rifle') { co.rifles++; Campaign.armRifles(co); }
    if (key === 'gun') { if (co.battery) co.battery.pieces++; else co.battery = { pieces: 1, name: `Lt. ${rng.pick(SURNAMES)}’s guns, RA`, drill: 0.55 }; }
    if (key === 'troop') co.troop = { size: CFG.TROOP_SIZE, type: 'light_dragoons', name: `${rng.pick(['A', 'B', 'C', 'D'])} Troop, ${rng.pick(['13th', '14th', '16th', '23rd'])} Light Dragoons` };
    if (key === 'remounts') co.troop.size += 4;
    if (key === 'heavies') { co.troop.type = 'heavy_dragoons'; co.troop.name = co.troop.name.replace('Light Dragoons', 'Dragoons'); }
    if (kind === 'ally') co.allies.push(Campaign.newAlly(co, rng, arg));
    if (kind === 'draft') { const al = co.allies.find(x => x.id === +arg); if (al) al.size = Math.min(al.est, al.size + 6); }
    if (kind === 'tune') co.tunes.push(arg);
    if (key === 'piper') co.piper = true;
    if (key === 'drummer') co.drummer = true;
    if (key === 'bugler') co.bugler = true;
    if (key === 'fifer') co.fifer = true;
    if (key === 'colours') co.colours = true;
    if (Campaign.ESTAB[key]) co[key] = (co[key] || 0) + 1;
    if (key === 'surgeon') run.commander.hp = Math.min(run.commander.maxHp, run.commander.hp + 1);
    if (key === 'horse') run.commander.horse = true;
    return true;
  },

  pickEvent(run) { return EVENTS[Campaign.rng(run)() * EVENTS.length | 0]; },
};

// small choices on the road. Each option: [label, fn(run, rng) → text]
const EVENTS = [
  { title: 'A Wine Cellar', text: 'Your men have found a cellar under a burnt-out quinta. Forty casks.',
    options: [
      ['Let them drink', (run) => { run.company.nerve += 3; run.company.drill = Math.max(0, run.company.drill - 0.04); return 'A long night. They will march badly and fight like lions.'; }],
      ['Stave in the casks', (run) => { run.renown += 6; run.total += 6; return 'The colonel hears of it. (+6 renown)'; }],
    ] },
  { title: 'A Deserter', text: 'A French conscript walks into your picket line with his hands up. He wants to change coats.',
    options: [
      ['Take him on', (run, rng) => { const s = Campaign.newSoldier(rng, 1); s.name = rng.pick(['Jean', 'Pierre', 'Louis']) + ' ' + rng.pick(['Lefèvre', 'Moreau', 'Girard']); s.nerve -= 4; run.company.soldiers.push(s); return `${s.name} joins the company. Nobody trusts him yet.`; }],
      ['Send him to the rear', (run) => { run.renown += 5; run.total += 5; return 'He tells the intelligence officers everything he knows. (+5 renown)'; }],
    ] },
  { title: 'Forced March', text: 'Orders: be at the bridge by dawn. It is thirty miles.',
    options: [
      ['Push on through the night', (run, rng) => { const lost = Math.min(2, run.company.soldiers.length - 1); for (let i = 0; i < lost; i++) run.company.soldiers.splice(rng.int(0, run.company.soldiers.length - 1), 1); run.renown += 14; run.total += 14; return `You arrive first. ${lost} men fell out on the road and were not seen again. (+14 renown)`; }],
      ['March by the book', () => 'You arrive late and in good order. Nobody mentions it.'],
    ] },
  { title: 'Letters from Home', text: 'The mail has caught up with the army for the first time in two months.',
    options: [
      ['Read them out by the fire', (run) => { run.company.nerve += 2; return 'Even the hard men are quiet tonight.'; }],
    ] },
  { title: 'Fever in the Lines', text: 'The camp by the river was a mistake. Men are shaking with fever.',
    options: [
      ['Pay the surgeon for bark (12 renown)', (run) => { if (run.renown < 12) return 'You cannot afford it. Three men die.' + Campaign._lose(run, 3); run.renown -= 12; return 'Quinine bark, at a price. Everyone lives.'; }],
      ['Move camp and hope', (run) => 'You move to higher ground.' + Campaign._lose(run, 2)],
    ] },
  { title: "The Colonel's Table", text: 'You are asked to dine with the colonel — on the night your company has no rations.',
    options: [
      ['Dine with the colonel', (run) => { run.renown += 8; run.total += 8; return 'Excellent claret. He remembers your name. (+8 renown)'; }],
      ['Share the men’s hunger', (run) => { run.company.nerve += 3; return 'They notice. They will follow you a little further.'; }],
    ] },
];
Campaign._lose = (run, n) => {
  const s = run.company.soldiers;
  const k = Math.min(n, s.length - 1);
  const gone = s.splice(s.length - k, k).map(x => x.name);
  return gone.length ? ` Lost: ${gone.join(', ')}.` : '';
};
