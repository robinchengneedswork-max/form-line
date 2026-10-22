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
      stage: +$('quick-stage').value, size: +$('quick-size').value, type: $('quick-type').value || null, horse: $('quick-horse').checked,
      gun: !!($('quick-gun') && $('quick-gun').checked), troop: !!($('quick-troop') && $('quick-troop').checked), ally: $('quick-ally') && $('quick-ally').checked ? 'rifles' : null });
    // the small fields, then the big battles
    $('quick-scenario').innerHTML = `<optgroup label="Skirmishes">${BATTLE_POOL.map(k => `<option value="${k}">${esc(SCENARIOS[k].name)}</option>`).join('')}</optgroup>`
      + `<optgroup label="Battles">${SETPIECE_POOL.concat('finale').map(k => `<option value="${k}">${esc(SCENARIOS[k].name)}</option>`).join('')}</optgroup>`;
    $('btn-resume').onclick = () => UI.togglePause();
    $('btn-withdraw').onclick = () => { UI.togglePause(); Battle.withdraw(App.B); };
    $('btn-leavefield').onclick = () => UI.leaveField();
    $('btn-mute').onclick = () => UI.toggleMute();
    const tapWords = { select: 'Tap your men: command them', walk: 'Tap your men: command them and walk with them', off: 'Tap your men: just walk there' };
    const tapBtn = $('btn-tap');
    if (tapBtn) {
      tapBtn.textContent = tapWords[App.tapMode] || tapWords.select;
      tapBtn.onclick = () => { App.setTapMode({ select: 'walk', walk: 'off', off: 'select' }[App.tapMode] || 'select'); tapBtn.textContent = tapWords[App.tapMode]; };
    }
    $('btn-help-close').onclick = () => UI.toggleHelp();
    $('hud-orders').innerHTML = ORDER_KEYS.map(o => `<button class="order" data-cmd="${o.cmd}"><kbd>${o.key}</kbd>${esc(o.label)}</button>`).join('');
    // the strip of your units: tap one to command it; detach / recall
    $('unit-strip').onclick = e => {
      const B = App.B, el = e.target.closest('button'); if (!B || B.over || !el) return;
      if (el.dataset.unit) B.selected = B.units.find(u => u.id === +el.dataset.unit) || B.player;
      else if (el.dataset.cmd) Orders.shout(B, el.dataset.cmd);
      UI.strip(B, true);
    };
    // the card: tap for more (or less); the 📜 button in the clock: orders and what has happened
    // (null-safe: a page and scripts from two different releases must not stop the game starting)
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    on('hud-company', () => { UI._cardOpen = !UI._cardOpen; });
    on('btn-orders', () => UI.toggleOrders());
    on('btn-orders-close', () => UI.toggleOrders());
    $('hud-orders').querySelectorAll('button').forEach(b => b.onclick = () => {
      if (!App.B || App.B.over) return;
      let cmd = b.dataset.cmd;
      if (cmd === 'skirmish' && Detach.commanded(App.B).form.kind === 'skirmish') cmd = 'close';
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
    const pos = n => [40 + n.x * (Wd - 80), Ht - 40 - n.row * ((Ht - 80) / (rows.length - 1))];
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
      const tip = (n.type === 'finale' ? `${Campaign.act(run).bossName}: the great battle of the act` : inf.name) + (n.scenario ? ' — ' + SCENARIOS[n.scenario].name : '');
      s += `<g class="${cls}" data-id="${n.id}"><title>${esc(tip)}</title><circle cx="${x}" cy="${y}" r="${n.type === 'finale' ? 22 : 16}"/><text x="${x}" y="${y + 6}">${inf.glyph}</text></g>`;
    }
    svg.innerHTML = s;
    if ($('map-title')) $('map-title').textContent = Campaign.act(run).road;
    svg.querySelectorAll('g.choice').forEach(g => g.onclick = () => App.enterNode(g.dataset.id));
    UI.sidebar(run);
    $('btn-company').onclick = () => UI.company(run, () => UI.map(run));
    showScreen('screen-map');
  },

  sidebar(run) {
    const co = run.company, rk = Campaign.rank(run), nx = Campaign.nextRank(run);
    const hp = '♥'.repeat(run.commander.hp) + '♡'.repeat(run.commander.maxHp - run.commander.hp);
    $('side').innerHTML = `
      <p class="kicker">${esc(Campaign.act(run).name)}</p>
      <h2>${esc(rk.title)}</h2>
      <div class="stat"><span>Renown to spend</span><b>${run.renown}</b></div>
      <div class="stat"><span>Renown earned</span><b>${run.total}${nx ? ` <small>/ ${nx.renown} for ${esc(nx.title)}</small>` : ''}</b></div>
      <div class="stat"><span>Your wounds</span><b class="hp">${hp}</b></div>
      <h3>${esc(co.name)}</h3>
      <div class="stat"><span>Rank and file</span><b>${co.soldiers.length} <small>/ ${rk.company}</small></b></div>
      <div class="stat"><span>Drill</span><b>${Math.round(co.drill * 100)} <small>(~${Math.round(CFG.RELOAD_BASE - CFG.RELOAD_DRILL * co.drill)} s reload)</small></b></div>
      <div class="kit">${co.colours ? '<span>⚑ Colours</span>' : '<span class="lost">⚑ Colours lost</span>'}${co.drummer ? '<span>◉ Drummer</span>' : '<span class="lost">◉ No drummer</span>'}${co.fifer ? '<span>♪ Fifer</span>' : '<span class="lost">♪ No fifer</span>'}</div>
      <button id="btn-company" class="big" style="width:100%">Muster roll${co.soldiers.some(s => { const p = Campaign.promotion(run, s); return p && p.ok; }) ? ' ★' : ''}</button>
      ${run.fallen.length ? `<details><summary>The fallen (${run.fallen.length})</summary><ol class="roll">${run.fallen.map(s => `<li>${esc(s.name)}</li>`).join('')}</ol></details>` : ''}`;
  },

  // ── the company sheet: the muster roll, one man to a line with what he has done; tap him for the rest ──
  // (the user: "can we still have the stats on what each soldier has done? I'd like to promote the ones that are
  // more valorous" and "clean up the muster roll even more — busy on the phone". The old nine-column table
  // hid the record on a phone)
  company(run, back) {
    const co = run.company, sl = Campaign.slots(run);
    UI._open = UI._open || new Set();
    const traits = Campaign.traitNames(co);
    const drills = Object.entries(LEARNED_DRILLS).map(([k, n]) => `<span class="chip ${co.drills.includes(k) ? '' : 'locked'}">${esc(n)}${co.drills.includes(k) ? '' : ' — learn at camp'}</span>`).join('');
    const order = { sgt: 0, cpl: 1, pte: 2 };
    const carried = co.soldiers.filter(s => s.weapon === 'rifle').length, stored = co.riflesStored || 0;
    const sgts = co.soldiers.filter(x => x.rank === 'sgt');
    const sorted = co.soldiers.slice().sort((a, b) => order[a.rank] - order[b.rank] || b.xp - a.xp || b.kills - a.kills);
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    const rows = sorted.map(s => {
      const p = Campaign.promotion(run, s), open = UI._open.has(s.id);
      const ready = p && p.ok;
      const badge = { sgt: 'Sgt', cpl: 'Cpl', pte: '' }[s.rank];
      const party = s.party && sgts.find(g => g.id === s.party);
      // the one line: name, then his record in a few marks
      const rec = [s.kills ? `⚔ ${s.kills}` : '', s.mentions ? `✠ ${s.mentions}` : '', s.colours ? `⚑ ${s.colours}` : '', s.wounds ? `✚ ${s.wounds}` : ''].filter(Boolean).join(' ');
      const head = `<button class="man ${s.rank}${open ? ' open' : ''}${ready ? ' ready' : ''}" data-man="${s.id}">
        <span class="badge">${badge}</span><span class="who">${esc(s.name)}${s.weapon === 'rifle' ? ' <i class="rifle" title="carries a rifle">●</i>' : ''}${ready ? ' <i class="star" title="ready for promotion">★</i>' : ''}</span>
        <span class="rec">${rec}</span><span class="xp" title="experience">${s.xp}</span></button>`;
      if (!open) return head;
      const deeds = [s.battles ? plural(s.battles, 'fight') : 'a recruit', s.kills ? `${s.kills} of the enemy down` : '', s.mentions ? `mentioned in despatches ${s.mentions === 1 ? 'once' : s.mentions + ' times'}` : '',
        s.colours ? `took ${s.colours === 1 ? 'a' : s.colours} French colour${s.colours === 1 ? '' : 's'}` : '', s.wounds ? `wounded ${s.wounds === 1 ? 'once' : s.wounds + ' times'}` : '', `aim ${Math.round(s.aim * 100)}`].filter(Boolean).join(' · ');
      const promo = p ? `<button class="mini" data-promote="${s.id}" ${p.ok ? '' : 'disabled'}>Make him ${Campaign.RANK_NAMES[p.to].toLowerCase()}${p.cost ? ` (${p.cost})` : ''}</button>
        ${p.ok ? '' : `<small>${s.xp < p.xp ? `needs ${p.xp} experience (has ${s.xp})` : !p.room ? `no ${Campaign.RANK_NAMES[p.to].toLowerCase()}'s place free — stand one down or rise in rank` : `needs ${p.cost} renown`}</small>`}` : '';
      const demote = s.rank !== 'pte' ? `<button class="mini" data-demote="${s.id}">Stand him down</button>` : '';
      const rifle = s.weapon === 'rifle' ? `<button class="mini rifle on" data-rifle="${s.id}">Take his rifle</button>` : stored ? `<button class="mini rifle" data-rifle="${s.id}">Give him a rifle</button>` : '';
      const partySel = s.rank !== 'sgt' && sgts.length ? `<label class="mini">Party <select class="mini" data-party="${s.id}"><option value="">—</option>${sgts.map(g => `<option value="${g.id}"${s.party === g.id ? ' selected' : ''}>Sgt ${esc(Campaign.callName(co, g))}</option>`).join('')}</select></label>` : '';
      const lead = s.rank === 'sgt' ? `<small>leads ${co.soldiers.filter(x => x.party === s.id).length} in his party</small>` : party ? `<small>in Sgt ${esc(Campaign.callName(co, party))}'s party</small>` : '';
      const rename = s.rank === 'sgt' ? `<input class="rename" data-rename="${s.id}" value="${esc(s.name)}" maxlength="28" title="Rename your sergeant">` : '';
      return head + `<div class="man-more"><p>${deeds}</p>${rename}<div class="acts">${promo}${demote}${rifle}${partySel}${lead}</div></div>`;
    }).join('');
    const al = (co.allies || []).map(a => `<span>${esc(a.name)} <b>${a.size}</b> <small>${esc(a.officer)}, ${esc(a.temper)}</small></span>`).join('');
    $('company').innerHTML = `<h1>${esc(co.name)}</h1>
      ${traits.length ? `<div class="chips">${traits.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="facts"><span>Drill <b>${Math.round(co.drill * 100)}</b></span><span>Renown <b>${run.renown}</b></span>
        <span>Sergeants <b>${sl.sgtUsed}/${sl.sgt}</b></span><span>Corporals <b>${sl.cplUsed}/${sl.cpl}</b></span>
        <span>Rifles <b>${carried}</b>${stored ? ` (+${stored} in store)` : ''}${co.rifles ? ' <button class="mini" id="btn-issue">to the best shots</button>' : ''}</span>
        ${co.battery ? `<span>Guns <b>${co.battery.pieces}</b></span>` : ''}${co.troop ? `<span>${co.troop.type === 'heavy_dragoons' ? 'Dragoons' : 'Light dragoons'} <b>${co.troop.size}</b></span>` : ''}${al}</div>
      <div class="chips">${drills}</div>
      <h3>Muster roll <small class="legend">⚔ enemy down · ✠ in despatches · ⚑ colours taken · ✚ wounds · ★ ready for a stripe · last: experience</small></h3>
      <div class="muster">${rows}</div>
      <details class="how"><summary>How promotion and parties work</summary>
        <p class="hint">A man earns experience by being there (1 a fight, 2 a victory), by every two of the enemy he drops, by being mentioned in despatches (+2) and by taking colours (+3). <b>Corporal at ${CFG.PROMOTE_CPL[1]}, sergeant at ${CFG.PROMOTE_SGT[1]}</b>; the places grow with your rank, and you can stand a man down to make room for a better one. Sergeants steady the men round them, close the ranks quicker, call back stragglers and take up fallen colours; corporals help a little.</p>
        <p class="hint"><b>Parties:</b> put men in a sergeant's party and in battle <kbd>Y</kbd> sends every party out under its sergeant, a unit you command on its own (tap it on the rail); <kbd>U</kbd> recalls them; <b>Follow me</b> brings them after you. Orders reach a party by your voice, your bugler (simple calls) or a runner.</p></details>
      <button id="btn-company-back" class="big">Back to the road</button>`;
    const again = () => { App.saveRun(); UI.company(run, back); };
    const C = $('company');
    C.querySelectorAll('[data-man]').forEach(b => b.onclick = () => { const id = +b.dataset.man; if (UI._open.has(id)) UI._open.delete(id); else UI._open.add(id); UI.company(run, back); });
    C.querySelectorAll('[data-promote]').forEach(b => b.onclick = () => { Campaign.promote(run, +b.dataset.promote); again(); });
    C.querySelectorAll('[data-demote]').forEach(b => b.onclick = () => { Campaign.demote(run, +b.dataset.demote); again(); });
    C.querySelectorAll('[data-rifle]').forEach(b => b.onclick = () => { Campaign.toggleRifle(run, +b.dataset.rifle); again(); });
    if ($('btn-issue')) $('btn-issue').onclick = () => { Campaign.issueRifles(run); again(); };
    C.querySelectorAll('[data-party]').forEach(sl => sl.onchange = () => { Campaign.setParty(run, +sl.dataset.party, sl.value === '' ? null : +sl.value); again(); });
    C.querySelectorAll('[data-rename]').forEach(inp => inp.onchange = () => { Campaign.rename(run, +inp.dataset.rename, inp.value); again(); });
    $('btn-company-back').onclick = back;
    showScreen('screen-company');
  },

  // grey out orders the company has not learned (the order bar; the wheel checks for itself)
  markLocked(B) {
    const u = Detach.commanded(B);
    document.querySelectorAll('#hud-orders .order').forEach(b => {
      b.classList.toggle('locked', !knowsDrill(u, b.dataset.cmd));
      b.classList.toggle('hide', !armAllows(u, b.dataset.cmd));
    });
  },

  // ── before a battle ──
  brief(sc, dep, node, onGo) {
    const level = node && App.run ? Campaign.level(node.row, App.run.act || 0, App.run.map.length) : 0.3;
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
    const wet = B.weather ? `<div class="row wide"><span>${esc(B.weather.label)} — you see ${B.weather.sight} m; ${Math.round(B.weather.misfire * 100)}% of muskets flash in the pan</span></div>` : '';
    return `<div class="row wide"><span>${mine}${theirs > 0.4 ? ' · <b class="warn">they are in cover</b>' : ''}</span></div>${wet}`;
  },

  // the rail of your units, down the left under the card: tap a chip to command that unit.
  // Redrawn only when something on it changes
  strip(B, force) {
    const mine = Detach.mine(B), sel = Detach.commanded(B), parties = !mine.some(u => u.isDetachment) && Detach.parties(B).length;
    const glyph = u => u.routed ? '⇣' : u.order === 'charge' ? '⚔' : u.form.kind === 'square' ? '■' : u.order === 'follow' ? '⋯' : u.limber ? '⇢' : u.holdFire ? '✋' : '';
    const sent = u => B.pending.some(p => p.unit === u);
    const key = mine.map(u => u.id + Unit.moraleWord(u) + u.formed + glyph(u) + sent(u)).join() + sel.id + parties + (B.runnersOut || 0);
    if (!force && key === UI._stripKey) return;
    UI._stripKey = key;
    UI.markLocked(B);
    const short = u => Detach.tag(B, u);
    const runners = B.runners != null ? B.runners : CFG.RUNNERS;
    $('unit-strip').innerHTML = (mine.length > 1 ? mine.map(u => `<button data-unit="${u.id}" class="chip ${u === sel ? 'sel' : ''}"><i style="background:${UI.moraleCol(u)}"></i>${esc(short(u))} <small>${u.formed}</small>${glyph(u) ? ` <b>${glyph(u)}</b>` : ''}${sent(u) ? ' <span title="an order is on its way">🏃</span>' : ''}</button>`).join('') : '')
      + (parties ? '<button data-cmd="detach" class="act">＋ Detach parties <kbd>Y</kbd></button>' : '')
      + (mine.length > 1 ? `<button data-cmd="recall" class="act">↩ Recall <kbd>U</kbd></button><span class="runners" title="runners free · bugle">${'🏃'.repeat(Math.max(0, runners - (B.runnersOut || 0)))}${B.bugle ? ' 📯' : ''}</span>` : '');
    $('unit-strip').classList.toggle('show', !!(mine.length > 1 || parties));
  },
  moraleCol(u) { return u.routed ? '#d9a03a' : u.morale < CFG.SHAKEN ? '#d2653b' : u.morale < CFG.STEADY ? '#d8c27a' : '#7fb069'; },
  // "No. 4 Company, 1/52nd Foot" → "No. 4 Coy, 1/52nd"
  cardName(u) { return u.name.replace(/Company/, 'Coy').replace(/ Foot$/, ''); },

  // the card of the unit you command: what you need at a glance; tap it for the rest
  hud(B) {
    UI.strip(B);
    const u = Detach.commanded(B), c = B.cmd;
    const loaded = u.men.filter(m => m.role === 'line' && m.state === 'formed' && m.m !== 'reloading').length;
    const pres = u.men.filter(m => m.state === 'formed' && m.m === 'present').length;
    const word = Unit.moraleWord(u);
    const orderWord = { follow: 'In column, following you', hold: u.shelled && B.t - u.shelled < 4 ? (u.form.kind === 'square' ? 'In square — under the guns' : 'Under artillery fire') : u.form.kind === 'skirmish' ? 'Skirmishing' : u.form.kind === 'square' ? 'In square' : u.form.kind === 'column' ? 'Halted in column' : u.form.kind === 'attack' ? 'Halted in column of attack' : 'Halted in line', advance: u.form.kind === 'attack' ? 'Advancing in column of attack' : 'Advancing', fallback: 'Falling back', retire: 'Retiring to the road', charge: 'CHARGING', rout: 'ROUTING' }[u.order] || u.order;
    const gunWord = u.arm === 'gun' ? (u.limber ? { limber: 'Limbering up', move: 'On the move', unlimber: 'Unlimbering' }[u.limber.phase] : u.holdFire ? 'Holding fire' : `In action — ${Artillery.live(u).length} gun${Artillery.live(u).length === 1 ? '' : 's'}`) : null;
    const horseWord = u.arm === 'cav' ? (u.order === 'charge' ? 'CHARGING' : u.order === 'ride' ? 'Riding' : u.routed ? 'ROUTING' : 'Waiting for your call') : null;
    const windWord = u.wind > 0.7 ? 'Fresh' : u.wind > 0.35 ? 'Puffing' : u.wind > 0.1 ? 'Winded' : 'Blown';
    const fireWord = { hold: 'Shouldered', ready: pres ? `Presented (${pres}) — awaiting FIRE` : 'Making ready', atwill: 'Firing at will', byrank: `By rank — presented (${pres}); each By rank! fires one rank` }[u.fire];
    const fireShort = u.fire === 'ready' ? (pres ? `<b class="gold">${pres} presented — FIRE!</b>` : 'making ready') : u.fire === 'atwill' ? 'at will' : u.fire === 'byrank' ? (u.rankCalls > 0 ? '<b class="gold">by rank — firing</b>' : `by rank · ${pres} presented`) : '';
    const dist0 = Math.round(dist(c.x, c.y, u.cx, u.cy));
    const reach = dist0 > CFG.VOICE_RANGE ? (Unit.hasRole(u, 'drummer') ? '<span class="warn">by drum</span>' : '<span class="bad">out of earshot</span>') : 'in earshot';
    const cover = UI.coverWord(B, u);
    const open = UI._cardOpen;
    const kit = u.isDetachment ? '' : `${Unit.hasRole(u, 'ensign') ? '⚑' : '<s>⚑</s>'} ${Unit.hasRole(u, 'drummer') ? '◉' : '<s>◉</s>'} ${Unit.hasRole(u, 'fifer') ? '♪' : '<s>♪</s>'}`;
    // rewritten only when it changes: iOS drops a tap whose element is replaced under the finger
    const card = `
      <div class="name"><span>${esc(UI.cardName(u))}</span><span class="hp">${'♥'.repeat(Math.max(0, c.hp))}${'♡'.repeat(Math.max(0, c.maxHp - c.hp))}</span></div>
      <div class="bar"><i style="width:${u.morale}%;background:${UI.moraleCol(u)}"></i><span>${word}${u.disorder > 0.25 ? ` · ${u.disorder > 0.6 ? 'in disorder' : 'ragged'}` : ''}</span></div>
      <div class="row"><b>${u.formed}<small>/${u.startSize}</small></b><span>loaded ${loaded}</span>${fireShort ? `<span>${fireShort}</span>` : ''}</div>
      <div class="row wide"><span>${gunWord || horseWord || orderWord}${cover && u.arm === 'foot' ? ` · ${cover}` : ''}</span></div>
      <div class="kit">${kit} <span>${reach}</span>${u.wind < 0.7 ? ` <span class="${u.wind < 0.35 ? 'warn' : ''}">· ${windWord.toLowerCase()}</span>` : ''}${c.rallyCd > B.t ? ` <span>· rally ${Math.ceil(c.rallyCd - B.t)}s</span>` : ''}${c.run || c.sprint ? ' <span>· sprinting</span>' : ''}${c.attach && B.units.includes(c.attach) ? ` <span>· with ${esc(Detach.tag(B, c.attach).toLowerCase())}</span>` : ''}</div>
      ${open ? `<div class="more">
        <div class="row wide"><span>${fireWord}</span></div>
        ${UI.coverLine(B, u)}
        <div class="row wide"><span>Breath</span><b class="${u.wind < 0.35 ? 'warn' : ''}">${windWord}</b>${u.saved ? `<span>Off the field</span><b>${u.saved}</b>` : ''}</div>
        <div class="row wide"><span>Your breath</span><span class="cwind"><i style="width:${Math.round(c.wind * 100)}%"></i></span></div>
      </div>` : ''}
      <div class="toggle">${open ? '▴ less' : '▾ more'}</div>`;
    if (card !== UI._card) { UI._card = card; $('hud-company').innerHTML = card; }
    const onRoad = Battle.atRetreat(B, c.x, c.y);
    $('btn-leavefield').classList.toggle('show', onRoad);
    $('tb-run').classList.toggle('on', !!c.sprint);
    const wa = B.wind.a * 180 / Math.PI;
    const clock = `<b>${Battle.clockText(B)}</b> <span class="speed">${App.paused ? 'PAUSED' : UI.speedLabel()}</span> <span class="wind" title="wind"><i style="transform:rotate(${wa}deg)">➜</i></span>`;
    if (clock !== UI._clock) { UI._clock = clock; ($('clock-text') || $('hud-clock')).innerHTML = clock; }
    const ob = $('btn-orders'), wet = !!B.weather;
    if (ob && ob.classList.contains('wet') !== wet) { ob.classList.toggle('wet', wet); ob.textContent = wet ? '📜 ☂' : '📜'; }
    const dp = B.dispatch;
    const showD = dp && (B.t - dp.t < 9 || performance.now() < (UI._dispatchUntil || 0));
    $('dispatch').classList.toggle('show', !!showD);
    if (showD && $('dispatch').dataset.t !== String(dp.t)) {
      $('dispatch').dataset.t = String(dp.t);
      $('dispatch').innerHTML = `<small>${dp.first ? 'Your orders' : 'A galloper from'} — ${esc(B.colonel)}</small><div>“${esc(dp.text)}”</div>`;
    }
    // the log: only what is fresh, and not the colonel's words again (they are in the dispatch and under 📜)
    const fresh = B.messages.filter(m => m.tone !== 'order' && B.t - m.t < CFG.LOG_FRESH).slice(-(Touch.active ? 2 : 4));
    const sig = fresh.map(m => m.t).join(',');
    if (sig !== UI._logSig) {
      UI._logSig = sig;
      $('hud-log').innerHTML = fresh.map(m => `<div class="${m.tone}">${esc(m.text)}</div>`).join('');
    }
  },
  // one or two words for the card; the sentence is under "more"
  coverWord(B, u) {
    const men = u.men.filter(m => m.role === 'line' && m.state === 'formed');
    if (!men.length) return '';
    let E = null, bd = Infinity;
    for (const e of B.units) {
      if (e.team === u.team || !e.formed || e.routed || !B.seen[u.team].has(e.id)) continue;
      const d = dist(u.cx, u.cy, e.cx, e.cy); if (d < bd) { bd = d; E = e; }
    }
    const sx = E ? E.cx : u.cx + Math.cos(u.form.facing) * 150, sy = E ? E.cy : u.cy + Math.sin(u.form.facing) * 150;
    const cv = men.map(m => Field.coverFor(B.field, m.x, m.y, sx, sy));
    if (cv.filter(c => c <= 0.4).length >= men.length * 0.4) return 'behind a wall';
    if (cv.filter(c => c <= 0.8).length >= men.length * 0.4) return 'in cover';
    return '';
  },

  // 📜 — the colonel's orders, the weather, and everything that has happened, with the clock
  toggleOrders() {
    const B = App.B;
    if (App.mode !== 'battle' || !B || B.over) return;
    const el = $('orders-sheet'), open = !el.classList.contains('show');
    if (open) {
      UI._ordersPaused = !App.paused; App.paused = true;
      const t = B.player.task, when = s => { const m = CFG.START_HOUR * 60 + s / 60; return `${Math.floor(m / 60)}:${String(Math.floor(m % 60)).padStart(2, '0')}`; };
      $('orders-body').innerHTML = `<h1>Orders</h1>`
        + (t && B.colonel ? `<p class="kicker">${esc(B.colonel)}</p><p class="blurb">“${esc(t.text)}”</p>` : `<p class="blurb">No orders from above. It is your fight.</p>`)
        + (B.weather ? `<p>${esc(B.weather.label)}: you see ${B.weather.sight} m, and ${Math.round(B.weather.misfire * 100)}% of muskets flash in the pan.</p>` : '')
        + `<h3>What has happened</h3><div class="loglist">${B.messages.slice().reverse().map(m => `<div class="${m.tone}"><small>${when(m.t)}</small> ${esc(m.text)}</div>`).join('')}</div>`;
    } else if (UI._ordersPaused) App.paused = false;
    el.classList.toggle('show', open);
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
  cycleSpeed() { App.speed = App.speed === 1 ? 2 : App.speed === 2 ? 4 : 1; if ($('tb-speed')) $('tb-speed').textContent = UI.speedLabel(); },
  speedLabel() { return ({ 1: '½', 2: '1', 4: '2' }[App.speed] || App.speed / 2) + '×'; },

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

  // between acts: what the winter did, then one camp choice, then the next act's road
  winter(run, onDone) {
    const lines = Campaign.winterQuarters(run), next = ACTS[(run.act || 0) + 1];
    UI.camp(run, onDone, {
      title: 'Winter quarters',
      blurb: `${lines.join(' ')} In the spring: <b>${esc(next.name)}</b>. ${esc(next.blurb)}`,
    });
  },

  camp(run, onDone, head) {
    const opts = [...(head ? [] : [['rest', 'Rest', 'Heal your wounds fully.']]), ['drill', 'Drill', 'Platoon exercise: faster loading.'], ['recruit', 'Send to the depot', 'Up to 3 raw recruits, if there is room.']];
    const learn = Campaign.unlearned(run);
    if (learn.length) opts.push(['learn', 'Learn a drill', learn.map(k => LEARNED_DRILLS[k]).join(' · ')]);
    $('camp').innerHTML = `<h1>${head ? head.title : 'Camp'}</h1><p class="blurb">${head ? head.blurb : 'A night with no enemy in sight. One thing, properly done.'}</p>
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
      // by shelf; what you cannot buy (owned, no room) is left off rather than greyed, so the list stays short
      const items = Campaign.shopItems(run).filter(it => it.ok);
      const shelves = Object.entries(Campaign.SHELVES).map(([k, title]) => {
        const its = items.filter(it => it.cat === k);
        return its.length ? `<h3 class="shelf">${esc(title)}</h3>` + its.map(it => `<button class="item" data-k="${it.key}" ${run.renown < it.cost ? 'disabled' : ''}><b>${esc(it.name)}</b><span>${esc(it.desc)}</span><em>${it.cost}</em></button>`).join('') : '';
      }).join('');
      $('camp').innerHTML = `<h1>The Quartermaster</h1><p class="blurb">Renown buys favours. You have <b>${run.renown}</b>.</p>
        <div class="shop">${shelves}</div>
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
