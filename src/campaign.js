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
const MAP_ROWS = 11;

const Campaign = {
  newSoldier(rng, vet = 0) {
    return {
      id: Math.floor(rng() * 1e9),
      name: `${rng.pick(FIRST_NAMES)} ${rng.pick(SURNAMES)}`,
      aim: clamp(1 + rng.gauss() * 0.12 + vet * 0.04, 0.72, 1.4),
      nerve: rng.gauss() * 5 + vet * 2,
      xp: vet ? rng.int(vet, vet + 2) : 0, kills: 0, battles: 0,
      rank: 'pte', weapon: 'musket',
    };
  },

  defaultCompany(rng) {
    const soldiers = [];
    for (let i = 0; i < 24; i++) soldiers.push(Campaign.newSoldier(rng, i < 4 ? 1 : 0));
    return { name: 'No. 4 Company, 1/52nd Foot', drill: 0.35, nerve: 0, drummer: true, fifer: true, colours: true, soldiers,
      type: null,       // chosen at Captain: 'light' | 'grenadier' | 'line'
      drills: [],       // learned drills (see LEARNED_DRILLS in orders.js)
      rifles: 0,        // Baker rifles owned; the best shots carry them
      surgeons: 0,      // surgeon's mates, 0..3: more of the wounded live to march again
      recruiters: 0 };  // a recruiting party, 0..3: raw men come up after every battle
  },

  newRun(seed) {
    const rng = makeRng(seed);
    const run = {
      seed, renown: 0, total: 0, battles: 0, wins: 0, over: null,
      company: Campaign.defaultCompany(rng),
      commander: { hp: 3, maxHp: 3 },
      map: Campaign.genMap(rng), at: null, row: -1, log: [], fallen: [],
      rngN: 1,
    };
    return run;
  },

  // saves from before the company sheet existed
  migrate(run) {
    const co = run.company;
    co.drills = co.drills || []; co.rifles = co.rifles || 0; co.type = co.type || null;
    co.surgeons = co.surgeons || 0; co.recruiters = co.recruiters || 0;
    for (const s of co.soldiers) { s.rank = s.rank || 'pte'; s.weapon = s.weapon || 'musket'; }
    return run;
  },

  rng(run) { run.rngN++; return makeRng((run.seed * 7919 + run.rngN * 104729) >>> 0); },
  rank(run) { let r = RANKS[0]; for (const k of RANKS) if (run.total >= k.renown) r = k; return r; },
  nextRank(run) { return RANKS.find(k => k.renown > run.total) || null; },
  level(row) { return clamp(row / (MAP_ROWS - 1), 0, 1); },

  // ── the route ──
  genMap(rng) {
    const rows = [];
    for (let r = 0; r < MAP_ROWS; r++) {
      const n = r === 0 ? 2 : r === MAP_ROWS - 1 ? 1 : rng.int(2, 4);
      const row = [];
      for (let i = 0; i < n; i++) {
        let type;
        if (r === MAP_ROWS - 1) type = 'finale';
        else if (r === 0) type = 'battle';
        else if (r === MAP_ROWS - 2) type = i === 0 ? 'camp' : rng.pick(['quartermaster', 'camp']);
        else if ((r === 4 || r === 7) && i === 0) type = 'setpiece';   // a big battle every few stages
        else {
          const x = rng();
          type = x < 0.44 ? 'battle' : x < 0.58 ? 'quartermaster' : x < 0.72 ? 'camp' : x < 0.88 ? 'event' : (r >= 3 ? 'elite' : 'battle');
        }
        row.push({
          id: `${r}-${i}`, row: r, x: (i + 0.5) / n + (n > 1 ? rng.range(-0.08, 0.08) : 0), type,
          scenario: type === 'finale' ? 'finale' : type === 'setpiece' ? rng.pick(SETPIECE_POOL) : (type === 'battle' || type === 'elite') ? rng.pick(BATTLE_POOL) : null,
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
      level: Campaign.level(node.row) + (node.type === 'elite' ? 0.18 : 0),
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
      if (m.role === 'drummer' || m.role === 'fifer') {
        if (m.state === 'down' && !(m.wounded && rng() < 0.6)) { co[m.role] = false; rep.lines.push([`Your ${m.role} was killed`, 0]); }
        else if (m.captured) { co[m.role] = false; rep.lines.push([`Your ${m.role} was taken prisoner`, 0]); }
        continue;
      }
      const s = m.src;
      if (!s) continue;
      s.kills += m.kills;
      if (m.captured) { rep.captured++; rep.dead.push(Object.assign({}, s, { captured: true })); continue; }
      if (m.saved) { s.battles++; s.xp += 1; keep.push(s); continue; }
      if (m.state === 'down') {
        if (m.wounded && rng() < Campaign.woundedLive(co)) { rep.wounded++; s.battles++; keep.push(s); }
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
    // the recruiting party has been busy while you fought
    const room = Campaign.capacity(run) - co.soldiers.length, n = Math.min(Math.max(0, room), co.recruiters || 0);
    for (let i = 0; i < n; i++) co.soldiers.push(Campaign.newSoldier(rng));
    rep.recruits = n;
    if (R.coloursLost) co.colours = false;
    const best = U.men.filter(m => m.src && m.state === 'formed').sort((a, b) => b.kills - a.kills)[0];
    if (best && best.kills >= 2) rep.promoted = { name: best.src.name, kills: best.kills };

    run.commander.hp = R.commanderHp;
    run.renown = Math.max(0, run.renown + rep.renown);
    run.total += Math.max(0, rep.renown);
    run.battles++;
    if (R.won) run.wins++;
    node.done = true;
    run.log.push(`${SCENARIOS[node.scenario].name}: ${R.how}`);
    if (R.how === 'fell') run.over = 'fell';
    else if (!co.soldiers.length) run.over = 'destroyed';
    else if (node.type === 'finale') run.over = R.won ? 'victory' : 'defeat';
    return rep;
  },

  // ── between battles ──
  capacity(run) { return Campaign.rank(run).company; },

  // ── the company sheet ──
  RANK_NAMES: { pte: 'Private', cpl: 'Corporal', sgt: 'Sergeant' },
  slots(run) {
    const cap = Campaign.capacity(run), s = run.company.soldiers;
    return { sgt: Math.max(1, Math.floor(cap / 12)), cpl: Math.floor(cap / 6),
      sgtUsed: s.filter(x => x.rank === 'sgt').length, cplUsed: s.filter(x => x.rank === 'cpl').length };
  },
  // [rank to, cost, xp needed]
  promotion(run, s) {
    const sl = Campaign.slots(run);
    if (s.rank === 'pte') return { to: 'cpl', cost: 5, xp: 3, ok: sl.cplUsed < sl.cpl && s.xp >= 3 && run.renown >= 5 };
    if (s.rank === 'cpl') return { to: 'sgt', cost: 12, xp: 6, ok: sl.sgtUsed < sl.sgt && s.xp >= 6 && run.renown >= 12 };
    return null;
  },
  promote(run, id) {
    const s = run.company.soldiers.find(x => x.id === id), p = s && Campaign.promotion(run, s);
    if (!p || !p.ok) return false;
    run.renown -= p.cost; s.rank = p.to;
    return true;
  },
  rifleCap(co) { return co.type === 'light' ? 6 : 4; },
  // the establishment: [cost of level 1, 2, 3]
  ESTAB: {
    surgeons: { name: 'Surgeon\u2019s mate', costs: [16, 26, 40],
      desc: l => `More of the wounded survive the surgeon's table (${Math.round(Campaign.woundedLive({ surgeons: l }) * 100)}% → ${Math.round(Campaign.woundedLive({ surgeons: l + 1 }) * 100)}%).` },
    recruiters: { name: 'Recruiting party', costs: [18, 30, 45],
      desc: l => `A sergeant and a drummer beating up for volunteers: ${l + 1} raw recruit${l ? 's' : ''} join after every battle, if there is room.` },
  },
  woundedLive(co) { return [0.55, 0.68, 0.79, 0.88][co.surgeons || 0]; },
  // the rifles go to the best shots, unless you have handed them out yourself
  armRifles(co) {
    const armed = co.soldiers.filter(s => s.weapon === 'rifle');
    while (armed.length > co.rifles) armed.pop().weapon = 'musket';
    const spare = co.soldiers.filter(s => s.weapon !== 'rifle').sort((a, b) => b.aim - a.aim);
    for (let i = armed.length; i < Math.min(co.rifles, co.soldiers.length); i++) spare[i - armed.length].weapon = 'rifle';
  },
  toggleRifle(run, id) {
    const co = run.company, s = co.soldiers.find(x => x.id === id);
    if (!s) return false;
    if (s.weapon === 'rifle') return false;          // rifles are only ever handed on, never put away
    const armed = co.soldiers.filter(x => x.weapon === 'rifle');
    if (armed.length >= co.rifles) { if (!armed.length) return false; armed.sort((a, b) => a.aim - b.aim)[0].weapon = 'musket'; }
    s.weapon = 'rifle';
    return true;
  },
  TYPES: {
    light: { name: 'Light Company', desc: 'Skirmishers. Skirmish order is learned at once and they are harder to hit in it; quicker on their feet; room for six rifles.' },
    grenadier: { name: 'Grenadier Company', desc: 'The biggest men in the battalion. Better with the bayonet, steadier under fire, and their charge hits harder.' },
    line: { name: 'Battalion (Line) Company', desc: 'The backbone. Faster loading and harder-hitting volleys, and the drill sergeant starts them ahead.' },
  },
  chooseType(run, t) {
    const co = run.company;
    if (co.type || !Campaign.TYPES[t] || Campaign.rank(run).title === 'Lieutenant') return false;
    co.type = t;
    if (t === 'light' && !co.drills.includes('skirmish')) co.drills.push('skirmish');
    if (t === 'line') co.drill = clamp(co.drill + 0.05, 0, 0.95);
    return true;
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
      const room = Campaign.capacity(run) - co.soldiers.length;
      const n = Math.min(3, Math.max(0, room));
      for (let i = 0; i < n; i++) co.soldiers.push(Campaign.newSoldier(rng));
      return n ? `${n} recruits from the depot join the company.` : 'The company is at full strength — the depot sends no one.';
    }
    return '';
  },

  shopItems(run) {
    const co = run.company, room = Campaign.capacity(run) - co.soldiers.length;
    return [
      { key: 'recruit', name: 'Recruit', desc: 'A raw volunteer.', cost: 7, ok: room > 0 },
      { key: 'veteran', name: 'Veteran from another regiment', desc: 'Steadier, a better shot.', cost: 16, ok: room > 0 },
      { key: 'drill', name: 'Drill sergeant', desc: `Faster loading (drill ${Math.round(co.drill * 100)} → ${Math.round(Math.min(0.95, co.drill + 0.06) * 100)}).`, cost: 22, ok: co.drill < 0.95 },
      { key: 'rifle', name: 'Baker rifle', desc: `Twice the reach, half the rate of fire. Goes to your best shot (${co.rifles}/${Campaign.rifleCap(co)}).`, cost: 20, ok: co.rifles < Campaign.rifleCap(co) },
      { key: 'drummer', name: 'Drummer boy', desc: 'Carries your orders beyond shouting range. Steadies the men.', cost: 14, ok: !co.drummer },
      { key: 'fifer', name: 'Fifer', desc: 'Music in the ranks. Morale recovers faster.', cost: 12, ok: !co.fifer },
      { key: 'colours', name: 'New colours', desc: 'The regiment will not forget the old ones.', cost: 30, ok: !co.colours },
      ...Object.entries(Campaign.ESTAB).map(([k, E]) => {
        const l = co[k] || 0;
        return { key: k, name: `${E.name} ${['I', 'II', 'III'][Math.min(l, 2)]}`, desc: l >= 3 ? 'At full establishment.' : E.desc(l), cost: E.costs[Math.min(l, 2)], ok: l < 3 };
      }),
      { key: 'surgeon', name: 'Surgeon', desc: 'Patch up your own wounds (+1).', cost: 9, ok: run.commander.hp < run.commander.maxHp },
    ];
  },
  buy(run, key) {
    const it = Campaign.shopItems(run).find(i => i.key === key);
    if (!it || !it.ok || run.renown < it.cost) return false;
    run.renown -= it.cost;
    const co = run.company, rng = Campaign.rng(run);
    if (key === 'recruit') co.soldiers.push(Campaign.newSoldier(rng));
    if (key === 'veteran') co.soldiers.push(Campaign.newSoldier(rng, 2));
    if (key === 'drill') co.drill = clamp(co.drill + 0.06, 0, 0.95);
    if (key === 'rifle') { co.rifles++; Campaign.armRifles(co); }
    if (key === 'drummer') co.drummer = true;
    if (key === 'fifer') co.fifer = true;
    if (key === 'colours') co.colours = true;
    if (Campaign.ESTAB[key]) co[key] = (co[key] || 0) + 1;
    if (key === 'surgeon') run.commander.hp = Math.min(run.commander.maxHp, run.commander.hp + 1);
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
