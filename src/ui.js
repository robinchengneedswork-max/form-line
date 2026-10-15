'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  UI — every screen that is not the battlefield, plus the battle HUD.
//  .screen / .screen.active, showScreen(id).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

const NODE_INFO = {
  battle: { glyph: '⚔', name: 'Battle' }, elite: { glyph: '✠', name: 'Hard fight — more renown' },
  camp: { glyph: '▲', name: 'Camp' }, quartermaster: { glyph: '£', name: 'Quartermaster' },
  event: { glyph: '?', name: 'On the road' }, finale: { glyph: '⚑', name: 'The great battle' },
  setpiece: { glyph: '⚜', name: 'A great battle — the whole brigade' },
};

const UI = {
  init() {
    $('btn-new').onclick = () => App.newCampaign();
    $('btn-continue').onclick = () => App.continueCampaign();
    $('btn-builder').onclick = () => UI.builder();
    $('btn-quick').onclick = () => App.quickBattle($('quick-scenario').value, {
      stage: +$('quick-stage').value, size: +$('quick-size').value, type: $('quick-type').value || null, horse: $('quick-horse').checked });
    // the small fields, then the big battles
    $('quick-scenario').innerHTML = `<optgroup label="Skirmishes">${BATTLE_POOL.map(k => `<option value="${k}">${esc(SCENARIOS[k].name)}</option>`).join('')}</optgroup>`
      + `<optgroup label="Battles">${SETPIECE_POOL.concat('finale').map(k => `<option value="${k}">${esc(SCENARIOS[k].name)}</option>`).join('')}</optgroup>`;
    $('btn-resume').onclick = () => UI.togglePause();
    $('btn-withdraw').onclick = () => { UI.togglePause(); Battle.withdraw(App.B); };
    $('btn-leavefield').onclick = () => UI.leaveField();
    $('btn-mute').onclick = () => UI.toggleMute();
    $('btn-help-close').onclick = () => UI.toggleHelp();
    $('hud-orders').innerHTML = ORDER_KEYS.map(o => `<button class="order" data-cmd="${o.cmd}"><kbd>${o.key}</kbd>${esc(o.label)}</button>`).join('');
    $('hud-orders').querySelectorAll('button').forEach(b => b.onclick = () => {
      if (!App.B || App.B.over) return;
      let cmd = b.dataset.cmd;
      if (cmd === 'skirmish' && App.B.player.form.kind === 'skirmish') cmd = 'close';
      Orders.shout(App.B, cmd);
    });
    UI.title();
  },

  title() {
    $('btn-continue').style.display = App.loadRun() ? '' : 'none';
    let best = null; try { best = JSON.parse(localStorage.getItem('formline.best') || 'null'); } catch (e) { best = null; }
    $('title-best').textContent = best ? `Best campaign: ${best.renown} renown — ${best.rank}, ${best.outcome}` : '';
    showScreen('screen-title');
  },

  // ── route map ──
  map(run) {
    const svg = $('route'), rows = run.map, Wd = 520, Ht = 640;
    const pos = n => [40 + n.x * (Wd - 80), Ht - 40 - n.row * ((Ht - 80) / (MAP_ROWS - 1))];
    const choices = new Set(Campaign.choices(run).map(n => n.id));
    let s = '';
    for (const row of rows) for (const n of row) for (const e of n.edges) {
      const m = Campaign.node(run, e), [x1, y1] = pos(n), [x2, y2] = pos(m);
      const walked = n.done && (m.done || run.at === m.id);
      s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="edge ${walked ? 'walked' : ''}"/>`;
    }
    for (const row of rows) for (const n of row) {
      const [x, y] = pos(n), inf = NODE_INFO[n.type];
      const cls = ['node', n.type, n.done ? 'done' : '', choices.has(n.id) && !run.over ? 'choice' : '', run.at === n.id ? 'here' : ''].join(' ');
      const tip = inf.name + (n.scenario ? ' — ' + SCENARIOS[n.scenario].name : '');
      s += `<g class="${cls}" data-id="${n.id}"><title>${esc(tip)}</title><circle cx="${x}" cy="${y}" r="${n.type === 'finale' ? 22 : 16}"/><text x="${x}" y="${y + 6}">${inf.glyph}</text></g>`;
    }
    svg.innerHTML = s;
    svg.querySelectorAll('g.choice').forEach(g => g.onclick = () => App.enterNode(g.dataset.id));
    UI.sidebar(run);
    $('btn-company').onclick = () => UI.company(run, () => UI.map(run));
    showScreen('screen-map');
  },

  sidebar(run) {
    const co = run.company, rk = Campaign.rank(run), nx = Campaign.nextRank(run);
    const hp = '♥'.repeat(run.commander.hp) + '♡'.repeat(run.commander.maxHp - run.commander.hp);
    const sold = co.soldiers.slice().sort((a, b) => b.kills - a.kills || b.xp - a.xp);
    $('side').innerHTML = `
      <h2>${esc(rk.title)}</h2>
      <div class="stat"><span>Renown to spend</span><b>${run.renown}</b></div>
      <div class="stat"><span>Renown earned</span><b>${run.total}${nx ? ` <small>/ ${nx.renown} for ${esc(nx.title)}</small>` : ''}</b></div>
      <div class="stat"><span>Your wounds</span><b class="hp">${hp}</b></div>
      <h3>${esc(co.name)}</h3>
      <div class="stat"><span>Rank and file</span><b>${co.soldiers.length} <small>/ ${rk.company}</small></b></div>
      <div class="stat"><span>Drill</span><b>${Math.round(co.drill * 100)} <small>(~${Math.round(CFG.RELOAD_BASE - CFG.RELOAD_DRILL * co.drill)} s reload)</small></b></div>
      <div class="kit">${co.colours ? '<span>⚑ Colours</span>' : '<span class="lost">⚑ Colours lost</span>'}${co.drummer ? '<span>◉ Drummer</span>' : '<span class="lost">◉ No drummer</span>'}${co.fifer ? '<span>♪ Fifer</span>' : '<span class="lost">♪ No fifer</span>'}</div>
      <button id="btn-company" class="big" style="width:100%">Company sheet${!co.type && rk.title !== 'Lieutenant' ? ' — choose its character!' : ''}</button>
      <details><summary>Muster roll</summary><ol class="roll">${sold.map(s => `<li>${esc(s.name)} <small>${s.battles ? s.battles + ' fights' : 'recruit'}${s.kills ? ' · ' + s.kills + ' down' : ''}</small></li>`).join('')}</ol></details>
      ${run.fallen.length ? `<details><summary>The fallen (${run.fallen.length})</summary><ol class="roll">${run.fallen.map(s => `<li>${esc(s.name)}</li>`).join('')}</ol></details>` : ''}`;
  },

  // ── the company sheet: character, drills, NCOs, rifles ──
  company(run, back) {
    const co = run.company, rk = Campaign.rank(run), sl = Campaign.slots(run), T = Campaign.TYPES;
    const typeBlock = co.type ? `<p class="kicker">${esc(T[co.type].name)}</p><p class="note">${esc(T[co.type].desc)}</p>`
      : rk.title === 'Lieutenant' ? '<p class="note">At Captain you will choose what kind of company this is.</p>'
      : `<h3>Choose its character</h3><div class="cards">${Object.entries(T).map(([k, t]) => `<button class="card" data-type="${k}"><b>${esc(t.name)}</b><span>${esc(t.desc)}</span></button>`).join('')}</div>`;
    const drills = Object.entries(LEARNED_DRILLS).map(([k, n]) => `<span class="chip ${co.drills.includes(k) ? '' : 'locked'}">${esc(n)}${co.drills.includes(k) ? '' : ' — learn at camp'}</span>`).join('');
    const order = { sgt: 0, cpl: 1, pte: 2 };
    const sorted = co.soldiers.slice().sort((a, b) => order[a.rank] - order[b.rank] || b.kills - a.kills || b.xp - a.xp);
    const rows = sorted.map(s => {
      const p = Campaign.promotion(run, s);
      const promo = p ? `<button class="mini" data-promote="${s.id}" ${p.ok ? '' : 'disabled'} title="needs ${p.xp} xp">→ ${Campaign.RANK_NAMES[p.to]} (${p.cost})</button>` : '';
      const rifle = s.weapon === 'rifle' ? '<b class="rifle">Baker rifle</b>' : co.rifles ? `<button class="mini" data-rifle="${s.id}">give rifle</button>` : 'musket';
      return `<tr class="${s.rank}"><td>${esc(s.name)}</td><td>${Campaign.RANK_NAMES[s.rank]}</td><td>${rifle}</td><td>${s.battles}</td><td>${s.kills}</td><td>${s.xp}</td><td>${Math.round(s.aim * 100)}</td><td>${promo}</td></tr>`;
    }).join('');
    $('company').innerHTML = `<h1>${esc(co.name)}</h1>${typeBlock}
      <div class="facts"><span>Drill <b>${Math.round(co.drill * 100)}</b></span><span>Renown <b>${run.renown}</b></span>
        <span>Sergeants <b>${sl.sgtUsed}/${sl.sgt}</b></span><span>Corporals <b>${sl.cplUsed}/${sl.cpl}</b></span>
        <span>Rifles <b>${co.soldiers.filter(s => s.weapon === 'rifle').length}/${co.rifles}</b> <small>(max ${Campaign.rifleCap(co)})</small></span>
        <span>Surgeon's mates <b>${co.surgeons || 0}/3</b></span><span>Recruiting party <b>${co.recruiters || 0}/3</b></span></div>
      <div class="chips">${drills}</div>
      <p class="hint">Sergeants steady the men round them, close the ranks quicker, call back stragglers and take up fallen colours. Corporals help a little. Promotion needs experience: 3 for corporal, 6 for sergeant.</p>
      <div class="tablewrap"><table class="roster"><tr><th>Name</th><th>Rank</th><th>Arms</th><th>Fights</th><th>Down</th><th>XP</th><th>Aim</th><th></th></tr>${rows}</table></div>
      <button id="btn-company-back" class="big">Back to the road</button>`;
    const again = () => { App.saveRun(); UI.company(run, back); };
    $('company').querySelectorAll('[data-type]').forEach(b => b.onclick = () => { Campaign.chooseType(run, b.dataset.type); again(); });
    $('company').querySelectorAll('[data-promote]').forEach(b => b.onclick = () => { Campaign.promote(run, +b.dataset.promote); again(); });
    $('company').querySelectorAll('[data-rifle]').forEach(b => b.onclick = () => { Campaign.toggleRifle(run, +b.dataset.rifle); again(); });
    $('btn-company-back').onclick = back;
    showScreen('screen-company');
  },

  // grey out orders the company has not learned (the order bar; the wheel checks for itself)
  markLocked(B) {
    document.querySelectorAll('#hud-orders .order').forEach(b => b.classList.toggle('locked', !knowsDrill(B.player, b.dataset.cmd)));
  },

  // ── before a battle ──
  brief(sc, dep, node, onGo) {
    const level = node ? Campaign.level(node.row) : 0.3;
    const enemyMen = dep.enemies.reduce((a, e) => a + e.size, 0);
    $('brief').innerHTML = `
      <p class="kicker">${sc.setpiece ? 'The whole brigade' : node && node.type === 'elite' ? 'A hard fight' : 'Battle'} · ${['Morning', 'Midday', 'Afternoon'][Math.min(2, Math.floor(level * 3))]}</p>
      <h1>${esc(sc.name)}</h1>
      <p class="blurb">${esc(sc.blurb)}</p>
      ${dep.note ? `<p class="note">${esc(dep.note)}</p>` : ''}
      <ul class="forces">
        ${dep.player.task ? `<li><b>Your orders:</b> <i>“${esc(dep.player.task.text)}”</i></li>` : ''}
        <li><b>Yours:</b> ${App.run ? App.run.company.soldiers.length : 24} men${dep.allies.length ? ` · with ${dep.allies.length} allied compan${dep.allies.length > 1 ? 'ies' : 'y'}` : ''}</li>
        <li><b>Scouts report:</b> ${dep.enemies.length} French compan${dep.enemies.length > 1 ? 'ies' : 'y'}, perhaps ${Math.round(enemyMen / 5) * 5} bayonets</li>
      </ul>
      <button id="btn-go" class="big">Into the field</button>
      <p class="hint">Press <kbd>H</kbd> in battle for the drill book.</p>`;
    $('btn-go').onclick = onGo;
    showScreen('screen-brief');
  },

  // ── battle HUD ──
  // ── the battle builder ──
  builder() {
    const A = App.army = App.army || App.loadArmy() || Builder.starter();
    const opt = (v, cur, label) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${esc(label)}</option>`;
    const sel = (side, i, k, cur, pairs) => `<select data-side="${side}" data-i="${i}" data-k="${k}">${pairs.map(([v, l]) => opt(v, cur, l)).join('')}</select>`;
    const quals = Object.keys(QUALITY).map(k => [k, QUALITY[k].name]);
    const kinds = Object.keys(FOOT_KINDS).map(k => [k, FOOT_KINDS[k]]);
    const sizes = n => n.map(v => [v, v + (v === 1 ? '' : '')]);
    const row = (side, s, i, faction) => {
      let cells;
      if (s.arm === 'foot') cells = sel(side, i, 'kind', s.kind, kinds) + sel(side, i, 'size', s.size, [16, 24, 32, 40].map(v => [v, v + ' men'])) + sel(side, i, 'quality', s.quality, quals)
        + sel(side, i, 'posture', s.posture, [['attack', 'Attacks'], ['hold', 'Holds']]);
      else if (s.arm === 'cav') cells = sel(side, i, 'type', s.type, Builder.horseFor(faction).map(k => [k, CAV_TYPES[k].name])) + sel(side, i, 'size', s.size, [16, 24, 32].map(v => [v, v + ' troopers'])) + sel(side, i, 'quality', s.quality, quals);
      else cells = `<span class="bl">Battery</span>` + sel(side, i, 'guns', s.guns, [1, 2, 3].map(v => [v, v + (v > 1 ? ' guns' : ' gun')])) + sel(side, i, 'quality', s.quality, quals);
      return `<div class="brow"><span class="arm">${{ foot: 'Foot', cav: 'Horse', gun: 'Guns' }[s.arm]}</span><span class="bcells">${cells}</span><b class="cost">${Builder.cost(s)}</b><button class="mini" data-del="${side}" data-i="${i}" title="Remove">✕</button></div>`;
    };
    const side = (key, title, faction) => {
      const S = A[key], tot = Builder.total(S), over = A.budget && tot > A.budget;
      const own = S.own ? `<div class="brow own"><span class="arm">You</span><span class="bcells">${sel(key, 'own', 'kind', S.own.kind, kinds)}${sel(key, 'own', 'size', S.own.size, [24, 32, 40, 48].map(v => [v, v + ' men']))}${sel(key, 'own', 'quality', S.own.quality, quals.slice(0, 3))}${sel(key, 'own', 'rifles', S.own.rifles, [0, 2, 4, 6].map(v => [v, v + ' rifles']))}<label class="quick-horse"><input type="checkbox" data-side="${key}" data-i="own" data-k="mounted"${S.own.mounted ? ' checked' : ''}> Mounted</label></span><b class="cost">${Builder.cost(S.own, true)}</b></div>` : '';
      return `<div class="bside"><h3>${title}</h3>${own}${S.units.map((s, i) => row(key, s, i, faction)).join('')}
        <div class="badd"><button class="mini" data-add="${key}" data-arm="foot">+ Foot</button><button class="mini" data-add="${key}" data-arm="cav">+ Horse</button><button class="mini" data-add="${key}" data-arm="gun">+ Guns</button></div>
        <p class="btot${over ? ' over' : ''}">${tot}${A.budget ? ` / ${A.budget}` : ''} renown</p></div>`;
    };
    const maps = `<optgroup label="Skirmishes">${BATTLE_POOL.map(k => opt(k, A.map, SCENARIOS[k].name)).join('')}</optgroup><optgroup label="Battles (a bigger field)">${SETPIECE_POOL.concat('finale').map(k => opt(k, A.map, SCENARIOS[k].name)).join('')}</optgroup>`;
    const bad = A.budget && (Builder.total(A.mine) > A.budget || Builder.total(A.theirs) > A.budget);
    $('builder').innerHTML = `<h1>Battle builder</h1>
      <p class="hint">Any field, any armies. Everything costs renown; give both sides the same budget for a fair fight, or none for a sandbox. You command your own company; the rest fight by their own lights.</p>
      <div class="bhead"><label>Field <select id="b-map">${maps}</select></label>
        <label>Budget each <select id="b-budget">${BUDGETS.map(b => opt(b, A.budget, b ? b + ' renown' : 'No limit')).join('')}</select></label></div>
      <div class="bsides">${side('mine', 'Your side', 'british')}${side('theirs', 'The French', 'french')}</div>
      <div class="bfoot"><button id="b-back">Back</button><button id="b-reset" class="mini">Start again</button><button id="b-go" class="big"${bad ? ' disabled' : ''}>${bad ? 'Over budget' : 'Into the field'}</button></div>`;
    const B = $('builder');
    B.onchange = e => {
      const el = e.target;
      if (el.id === 'b-map') A.map = el.value;
      else if (el.id === 'b-budget') A.budget = +el.value;
      else if (el.dataset.side) {
        const S = A[el.dataset.side], u = el.dataset.i === 'own' ? S.own : S.units[+el.dataset.i];
        const v = el.type === 'checkbox' ? el.checked : el.value;
        u[el.dataset.k] = ['size', 'guns', 'rifles'].includes(el.dataset.k) ? +v : v;
      }
      App.saveArmy(); UI.builder();
    };
    B.onclick = e => {
      const el = e.target;
      if (el.dataset.add) {
        const fac = el.dataset.add === 'mine' ? 'british' : 'french', arm = el.dataset.arm;
        A[el.dataset.add].units.push(arm === 'foot' ? { arm, size: 24, kind: 'battalion', quality: 'trained', posture: el.dataset.add === 'mine' ? 'hold' : 'attack' }
          : arm === 'cav' ? { arm, size: 24, type: Builder.horseFor(fac)[0], quality: 'trained' } : { arm, guns: 2, quality: 'trained' });
      } else if (el.dataset.del) A[el.dataset.del].units.splice(+el.dataset.i, 1);
      else if (el.id === 'b-back') return UI.title();
      else if (el.id === 'b-reset') App.army = Builder.starter();
      else if (el.id === 'b-go') return App.builderBattle(A);
      else return;
      App.saveArmy(); UI.builder();
    };
    showScreen('screen-builder');
  },

  // what the ground is doing for your men against the nearest enemy you can see. Cover only ever
  // protects the man IN it: your shots out of it are not affected — but a wall or wood in front of
  // THEM spoils your aim at them exactly the same way
  coverLine(B, u) {
    let E = null, bd = Infinity;
    for (const e of B.units) {
      if (e.team === u.team || !e.formed || e.routed || !B.seen[u.team].has(e.id)) continue;
      const d = dist(u.cx, u.cy, e.cx, e.cy); if (d < bd) { bd = d; E = e; }
    }
    const sx = E ? E.cx : u.cx + Math.cos(u.form.facing) * 150, sy = E ? E.cy : u.cy + Math.sin(u.form.facing) * 150;
    const men = u.men.filter(m => m.role === 'line' && m.state === 'formed');
    if (!men.length) return '';
    const cv = men.map(m => Field.coverFor(B.field, m.x, m.y, sx, sy));
    const wall = cv.filter(c => c <= 0.4).length, wood = cv.filter(c => c > 0.4 && c <= 0.8).length;
    const theirs = E ? E.men.filter(m => m.state === 'formed' && Field.coverFor(B.field, m.x, m.y, u.cx, u.cy) <= 0.8).length / Math.max(1, E.formed) : 0;
    const mine = wall >= men.length * 0.4 ? `Behind a wall — they hit you a third as often`
      : wood + wall >= men.length * 0.4 ? `In cover — they hit you about half as often` : 'In the open';
    return `<div class="row wide"><span>${mine}${theirs > 0.4 ? ' · <b class="warn">they are in cover</b>' : ''}</span></div>`;
  },

  hud(B) {
    const u = B.player, c = B.cmd;
    const loaded = u.men.filter(m => m.role === 'line' && m.state === 'formed' && m.m !== 'reloading').length;
    const pres = u.men.filter(m => m.state === 'formed' && m.m === 'present').length;
    const word = Unit.moraleWord(u);
    const orderWord = { follow: 'In column, following you', hold: u.shelled && B.t - u.shelled < 4 ? (u.form.kind === 'square' ? 'In square — under the guns' : 'Under artillery fire') : u.form.kind === 'skirmish' ? 'Skirmishing' : u.form.kind === 'square' ? 'In square' : u.form.kind === 'column' ? 'Halted in column' : u.form.kind === 'attack' ? 'Halted in column of attack' : 'Halted in line', advance: u.form.kind === 'attack' ? 'Advancing in column of attack' : 'Advancing', fallback: 'Falling back', retire: 'Retiring to the road', charge: 'CHARGING', rout: 'ROUTING' }[u.order] || u.order;
    const windWord = u.wind > 0.7 ? 'Fresh' : u.wind > 0.35 ? 'Puffing' : u.wind > 0.1 ? 'Winded' : 'Blown';
    const fireWord = { hold: 'Shouldered', ready: pres ? `Presented (${pres}) — awaiting FIRE` : 'Making ready', atwill: 'Firing at will', byrank: 'Firing by rank' }[u.fire];
    const dist0 = Math.round(dist(c.x, c.y, u.cx, u.cy));
    const task = u.task ? `<div class="row wide orders">Orders: ${esc(u.task.text)}</div>` : '';
    $('hud-company').innerHTML = `
      <div class="name">${esc(u.name)}</div>
      <div class="bar"><i style="width:${u.morale}%;background:${u.routed ? '#d9a03a' : u.morale < CFG.SHAKEN ? '#d2653b' : u.morale < CFG.STEADY ? '#d8c27a' : '#7fb069'}"></i><span>${word}</span></div>
      <div class="row"><span>Men</span><b>${u.formed}<small> / ${u.startSize}</small></b><span>Loaded</span><b>${loaded}</b></div>
      <div class="row wide"><span>${orderWord}</span></div>
      <div class="row wide"><span>${fireWord}</span></div>
      ${UI.coverLine(B, u)}
      <div class="row wide"><span>Breath</span><b class="${u.wind < 0.35 ? 'warn' : ''}">${windWord}</b>${u.saved ? `<span>Off the field</span><b>${u.saved}</b>` : ''}</div>
      <div class="kit">${Unit.hasRole(u, 'ensign') ? '⚑' : u.coloursLost ? '<s>⚑</s>' : '<s>⚑</s>'} ${Unit.hasRole(u, 'drummer') ? '◉' : '<s>◉</s>'} ${Unit.hasRole(u, 'fifer') ? '♪' : '<s>♪</s>'} <span class="${dist0 > CFG.VOICE_RANGE ? (Unit.hasRole(u, 'drummer') ? 'warn' : 'bad') : ''}">${dist0 > CFG.VOICE_RANGE ? (Unit.hasRole(u, 'drummer') ? 'by drum' : 'out of earshot') : 'in earshot'}</span></div>
      ${task}
      <div class="hp">${'♥'.repeat(Math.max(0, c.hp))}${'♡'.repeat(Math.max(0, c.maxHp - c.hp))}${c.rallyCd > B.t ? ` <small>rally ${Math.ceil(c.rallyCd - B.t)}s</small>` : ''}
        <span class="cwind" title="your breath"><i style="width:${Math.round(c.wind * 100)}%"></i></span>${c.run || c.sprint ? ' <small>sprinting</small>' : ''}</div>`;
    const onRoad = Battle.atRetreat(B, c.x, c.y);
    $('btn-leavefield').classList.toggle('show', onRoad);
    $('tb-run').classList.toggle('on', !!c.sprint);
    const wa = B.wind.a * 180 / Math.PI;
    $('hud-clock').innerHTML = `<b>${Battle.clockText(B)}</b> <span class="speed">${App.paused ? 'PAUSED' : App.speed + '×'}</span> <span class="wind" title="wind"><i style="transform:rotate(${wa}deg)">➜</i></span>`;
    const dp = B.dispatch;
    const showD = dp && B.t - dp.t < 9;
    $('dispatch').classList.toggle('show', !!showD);
    if (showD && $('dispatch').dataset.t !== String(dp.t)) {
      $('dispatch').dataset.t = String(dp.t);
      $('dispatch').innerHTML = `<small>${dp.first ? 'Your orders' : 'A galloper from'} — ${esc(B.colonel)}</small><div>“${esc(dp.text)}”</div>`;
    }
    const log = B.messages.slice(-5);
    const sig = log.map(m => m.t).join(',');
    if (sig !== UI._logSig) {
      UI._logSig = sig;
      $('hud-log').innerHTML = log.map(m => `<div class="${m.tone}">${esc(m.text)}</div>`).join('');
    }
  },

  // you are on the road: go, and whoever is not with you takes his chances
  leaveField() {
    const B = App.B;
    if (!B || B.over || App.paused || !Battle.atRetreat(B, B.cmd.x, B.cmd.y)) return;
    Battle.withdraw(B);
  },

  togglePause() {
    if (App.mode !== 'battle' || !App.B || App.B.over) return;
    App.paused = !App.paused;
    $('pause').classList.toggle('show', App.paused);
  },
  toggleHelp() { $('help').classList.toggle('show'); },
  toggleMute() { Sound.setMuted(!Sound.muted); $('btn-mute').textContent = Sound.muted ? 'Sound: off' : 'Sound: on'; },
  cycleSpeed() { App.speed = App.speed === 1 ? 2 : App.speed === 2 ? 4 : 1; },

  battleOver(B, onContinue) {
    const R = B.result;
    const head = { won: 'The field is yours', lost: 'Your company is broken', fell: 'You have fallen', nightfall: 'Nightfall', withdrew: 'You withdraw from the field' }[R.how];
    const sub = { won: `The ${R.enemyRouted > 1 ? 'enemy companies are' : 'enemy is'} in flight.`, lost: 'The men are streaming to the rear.', fell: 'A ball found you. The company fights on without its captain — for a while.', nightfall: 'Darkness ends it. Neither side gives way.', withdrew: R.captured ? `${R.captured} of your men could not get away.` : 'Better to lose a field than a company.' }[R.how];
    $('end-banner').innerHTML = `<h1>${head}</h1><p>${sub}</p><button id="btn-after" class="big">Continue</button>`;
    $('end-banner').classList.add('show');
    $('btn-after').onclick = () => { $('end-banner').classList.remove('show'); onContinue(); };
  },

  report(rep, run, onNext) {
    const dead = rep.dead.filter(d => !d.deserted && !d.captured), des = rep.dead.filter(d => d.deserted), cap = rep.dead.filter(d => d.captured);
    $('report').innerHTML = `
      <h1>${{ won: 'Victory', lost: 'Defeat', fell: 'Struck down', nightfall: 'Nightfall', withdrew: 'Withdrawal' }[rep.how]}</h1>
      <table class="renown">${rep.lines.map(([w, n]) => `<tr><td>${esc(w)}</td><td>${n > 0 ? '+' : ''}${n || ''}</td></tr>`).join('')}
        <tr class="total"><td>Renown</td><td>${rep.renown >= 0 ? '+' : ''}${rep.renown}</td></tr></table>
      <p>${rep.wounded ? `${rep.wounded} wounded will march again. ` : ''}${rep.horseLost ? 'Your horse was killed under you. ' : ''}${rep.recruits ? `A draft of ${rep.recruits} recruit${rep.recruits > 1 ? 's' : ''} came up from the depot. ` : ''}${rep.stragglers ? `${rep.stragglers} stragglers came back to the colours. ` : ''}</p>
      ${dead.length ? `<p class="dead"><b>Killed:</b> ${dead.map(d => esc(d.name)).join(', ')}</p>` : '<p>Nobody was killed.</p>'}
      ${des.length ? `<p class="dead"><b>Missing:</b> ${des.map(d => esc(d.name)).join(', ')}</p>` : ''}
      ${cap.length ? `<p class="dead"><b>Taken prisoner:</b> ${cap.map(d => esc(d.name)).join(', ')}</p>` : ''}
      ${rep.orders != null ? `<p class="note">${rep.orders >= 0.6 ? 'The colonel was pleased with you.' : rep.orders < 0.3 ? 'The colonel will remember that you went your own way.' : 'The colonel had no complaint.'}</p>` : ''}
      ${rep.promoted ? `<p class="note">${esc(rep.promoted.name)} accounted for ${rep.promoted.kills} of the enemy, and is mentioned in despatches.</p>` : ''}
      <button id="btn-next" class="big">${run && run.over ? 'The end of it' : 'On'}</button>`;
    $('btn-next').onclick = onNext;
    showScreen('screen-report');
  },

  camp(run, onDone) {
    const opts = [['rest', 'Rest', 'Heal your wounds fully.'], ['drill', 'Drill', 'Platoon exercise: faster loading.'], ['recruit', 'Send to the depot', 'Up to 3 raw recruits, if there is room.']];
    const learn = Campaign.unlearned(run);
    if (learn.length) opts.push(['learn', 'Learn a drill', learn.map(k => LEARNED_DRILLS[k]).join(' · ')]);
    $('camp').innerHTML = `<h1>Camp</h1><p class="blurb">A night with no enemy in sight. One thing, properly done.</p>
      <div class="cards">${opts.map(([k, n, d]) => `<button class="card" data-k="${k}"><b>${n}</b><span>${d}</span></button>`).join('')}</div><p id="camp-out" class="note"></p>`;
    $('camp').querySelectorAll('.card').forEach(b => b.onclick = () => {
      if (b.dataset.k === 'learn') {
        // a second choice: which drill
        $('camp').querySelector('.cards').innerHTML = learn.map(k => `<button class="card" data-k="learn:${k}"><b>${esc(LEARNED_DRILLS[k])}</b></button>`).join('');
        $('camp').querySelectorAll('.card').forEach(c => c.onclick = () => {
          $('camp-out').textContent = Campaign.camp(run, c.dataset.k);
          $('camp').querySelectorAll('.card').forEach(x => x.disabled = true);
          setTimeout(onDone, 1600);
        });
        return;
      }
      $('camp-out').textContent = Campaign.camp(run, b.dataset.k);
      $('camp').querySelectorAll('.card').forEach(x => x.disabled = true);
      setTimeout(onDone, 1400);
    });
    showScreen('screen-camp');
  },

  shop(run, onDone) {
    const draw = () => {
      $('camp').innerHTML = `<h1>The Quartermaster</h1><p class="blurb">Renown buys favours. You have <b>${run.renown}</b>.</p>
        <div class="shop">${Campaign.shopItems(run).map(it => `<button class="item" data-k="${it.key}" ${!it.ok || run.renown < it.cost ? 'disabled' : ''}><b>${esc(it.name)}</b><span>${esc(it.desc)}</span><em>${it.cost}</em></button>`).join('')}</div>
        <p class="note">${run.company.soldiers.length} / ${Campaign.capacity(run)} men</p>
        <button id="btn-leave" class="big">March on</button>`;
      $('camp').querySelectorAll('.item').forEach(b => b.onclick = () => { Campaign.buy(run, b.dataset.k); draw(); });
      $('btn-leave').onclick = onDone;
    };
    draw();
    showScreen('screen-camp');
  },

  event(run, ev, onDone) {
    $('camp').innerHTML = `<h1>${esc(ev.title)}</h1><p class="blurb">${esc(ev.text)}</p>
      <div class="cards">${ev.options.map(([l], i) => `<button class="card" data-i="${i}"><b>${esc(l)}</b></button>`).join('')}</div><p id="camp-out" class="note"></p>`;
    $('camp').querySelectorAll('.card').forEach(b => b.onclick = () => {
      const out = ev.options[+b.dataset.i][1](run, Campaign.rng(run));
      $('camp-out').textContent = out;
      $('camp').querySelectorAll('.card').forEach(x => x.disabled = true);
      const go = document.createElement('button'); go.className = 'big'; go.textContent = 'March on'; go.onclick = onDone;
      $('camp').appendChild(go);
    });
    showScreen('screen-camp');
  },

  end(run) {
    const rk = Campaign.rank(run);
    const head = { victory: 'The campaign is won', defeat: 'The campaign is lost', fell: 'Killed in action', destroyed: 'The company is no more' }[run.over];
    $('endscreen').innerHTML = `<h1>${head}</h1>
      <p class="blurb">${run.battles} battles, ${run.wins} won. ${run.total} renown earned. You ended it a ${esc(rk.title)}.</p>
      ${run.fallen.length ? `<h3>Roll of honour</h3><ol class="roll cols">${run.fallen.map(s => `<li>${esc(s.name)}${s.kills ? ` <small>${s.kills} down</small>` : ''}</li>`).join('')}</ol>` : ''}
      <button id="btn-again" class="big">Another campaign</button>`;
    $('btn-again').onclick = () => UI.title();
    showScreen('screen-end');
  },
};
