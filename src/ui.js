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
};

const UI = {
  init() {
    $('btn-new').onclick = () => App.newCampaign();
    $('btn-continue').onclick = () => App.continueCampaign();
    $('btn-quick').onclick = () => App.quickBattle($('quick-scenario').value);
    $('quick-scenario').innerHTML = BATTLE_POOL.concat('finale').map(k => `<option value="${k}">${esc(SCENARIOS[k].name)}</option>`).join('');
    $('btn-resume').onclick = () => UI.togglePause();
    $('btn-withdraw').onclick = () => { UI.togglePause(); Battle.withdraw(App.B); };
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
      <details><summary>Muster roll</summary><ol class="roll">${sold.map(s => `<li>${esc(s.name)} <small>${s.battles ? s.battles + ' fights' : 'recruit'}${s.kills ? ' · ' + s.kills + ' down' : ''}</small></li>`).join('')}</ol></details>
      ${run.fallen.length ? `<details><summary>The fallen (${run.fallen.length})</summary><ol class="roll">${run.fallen.map(s => `<li>${esc(s.name)}</li>`).join('')}</ol></details>` : ''}`;
  },

  // ── before a battle ──
  brief(sc, dep, node, onGo) {
    const level = node ? Campaign.level(node.row) : 0.3;
    const enemyMen = dep.enemies.reduce((a, e) => a + e.size, 0);
    $('brief').innerHTML = `
      <p class="kicker">${node && node.type === 'elite' ? 'A hard fight' : node && node.type === 'finale' ? 'The great battle' : 'Battle'} · ${['Morning', 'Midday', 'Afternoon'][Math.min(2, Math.floor(level * 3))]}</p>
      <h1>${esc(sc.name)}</h1>
      <p class="blurb">${esc(sc.blurb)}</p>
      ${dep.note ? `<p class="note">${esc(dep.note)}</p>` : ''}
      <ul class="forces">
        <li><b>Yours:</b> ${App.run ? App.run.company.soldiers.length : 24} men${dep.allies.length ? ` · with ${dep.allies.length} allied compan${dep.allies.length > 1 ? 'ies' : 'y'}` : ''}</li>
        <li><b>Scouts report:</b> ${dep.enemies.length} French compan${dep.enemies.length > 1 ? 'ies' : 'y'}, perhaps ${Math.round(enemyMen / 5) * 5} bayonets</li>
      </ul>
      <button id="btn-go" class="big">Into the field</button>
      <p class="hint">Press <kbd>H</kbd> in battle for the drill book.</p>`;
    $('btn-go').onclick = onGo;
    showScreen('screen-brief');
  },

  // ── battle HUD ──
  hud(B) {
    const u = B.player, c = B.cmd;
    const loaded = u.men.filter(m => m.role === 'line' && m.state === 'formed' && m.m !== 'reloading').length;
    const pres = u.men.filter(m => m.m === 'present').length;
    const word = Unit.moraleWord(u);
    const orderWord = { follow: 'In column, following you', hold: u.form.kind === 'skirmish' ? 'Skirmishing' : u.form.kind === 'column' ? 'Halted in column' : 'Halted in line', advance: 'Advancing', fallback: 'Falling back', charge: 'CHARGING', rout: 'ROUTING' }[u.order] || u.order;
    const fireWord = { hold: 'Shouldered', ready: pres ? `Presented (${pres}) — awaiting FIRE` : 'Making ready', atwill: 'Firing at will' }[u.fire];
    const dist0 = Math.round(dist(c.x, c.y, u.cx, u.cy));
    $('hud-company').innerHTML = `
      <div class="name">${esc(u.name)}</div>
      <div class="bar"><i style="width:${u.morale}%;background:${u.routed ? '#d9a03a' : u.morale < CFG.SHAKEN ? '#d2653b' : u.morale < CFG.STEADY ? '#d8c27a' : '#7fb069'}"></i><span>${word}</span></div>
      <div class="row"><span>Men</span><b>${u.formed}<small> / ${u.startSize}</small></b><span>Loaded</span><b>${loaded}</b></div>
      <div class="row wide"><span>${orderWord}</span></div>
      <div class="row wide"><span>${fireWord}</span></div>
      <div class="kit">${Unit.hasRole(u, 'ensign') ? '⚑' : u.coloursLost ? '<s>⚑</s>' : '<s>⚑</s>'} ${Unit.hasRole(u, 'drummer') ? '◉' : '<s>◉</s>'} ${Unit.hasRole(u, 'fifer') ? '♪' : '<s>♪</s>'} <span class="${dist0 > CFG.VOICE_RANGE ? (Unit.hasRole(u, 'drummer') ? 'warn' : 'bad') : ''}">${dist0 > CFG.VOICE_RANGE ? (Unit.hasRole(u, 'drummer') ? 'by drum' : 'out of earshot') : 'in earshot'}</span></div>
      <div class="hp">${'♥'.repeat(Math.max(0, c.hp))}${'♡'.repeat(Math.max(0, c.maxHp - c.hp))}${c.rallyCd > B.t ? ` <small>rally ${Math.ceil(c.rallyCd - B.t)}s</small>` : ''}</div>`;
    const wa = B.wind.a * 180 / Math.PI;
    $('hud-clock').innerHTML = `<b>${Battle.clockText(B)}</b> <span class="speed">${App.paused ? 'PAUSED' : App.speed + '×'}</span> <span class="wind" title="wind"><i style="transform:rotate(${wa}deg)">➜</i></span>`;
    const log = B.messages.slice(-5);
    const sig = log.map(m => m.t).join(',');
    if (sig !== UI._logSig) {
      UI._logSig = sig;
      $('hud-log').innerHTML = log.map(m => `<div class="${m.tone}">${esc(m.text)}</div>`).join('');
    }
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
    const sub = { won: `The ${R.enemyRouted > 1 ? 'enemy companies are' : 'enemy is'} in flight.`, lost: 'The men are streaming to the rear.', fell: 'A ball found you. The company fights on without its captain — for a while.', nightfall: 'Darkness ends it. Neither side gives way.', withdrew: 'Better to lose a field than a company.' }[R.how];
    $('end-banner').innerHTML = `<h1>${head}</h1><p>${sub}</p><button id="btn-after" class="big">Continue</button>`;
    $('end-banner').classList.add('show');
    $('btn-after').onclick = () => { $('end-banner').classList.remove('show'); onContinue(); };
  },

  report(rep, run, onNext) {
    const dead = rep.dead.filter(d => !d.deserted), des = rep.dead.filter(d => d.deserted);
    $('report').innerHTML = `
      <h1>${{ won: 'Victory', lost: 'Defeat', fell: 'Struck down', nightfall: 'Nightfall', withdrew: 'Withdrawal' }[rep.how]}</h1>
      <table class="renown">${rep.lines.map(([w, n]) => `<tr><td>${esc(w)}</td><td>${n > 0 ? '+' : ''}${n || ''}</td></tr>`).join('')}
        <tr class="total"><td>Renown</td><td>${rep.renown >= 0 ? '+' : ''}${rep.renown}</td></tr></table>
      <p>${rep.wounded ? `${rep.wounded} wounded will march again. ` : ''}${rep.stragglers ? `${rep.stragglers} stragglers came back to the colours. ` : ''}</p>
      ${dead.length ? `<p class="dead"><b>Killed:</b> ${dead.map(d => esc(d.name)).join(', ')}</p>` : '<p>Nobody was killed.</p>'}
      ${des.length ? `<p class="dead"><b>Missing:</b> ${des.map(d => esc(d.name)).join(', ')}</p>` : ''}
      ${rep.promoted ? `<p class="note">${esc(rep.promoted.name)} accounted for ${rep.promoted.kills} of the enemy, and is mentioned in despatches.</p>` : ''}
      <button id="btn-next" class="big">${run && run.over ? 'The end of it' : 'On'}</button>`;
    $('btn-next').onclick = onNext;
    showScreen('screen-report');
  },

  camp(run, onDone) {
    const opts = [['rest', 'Rest', 'Heal your wounds fully.'], ['drill', 'Drill', 'Platoon exercise: faster loading.'], ['recruit', 'Send to the depot', 'Up to 3 raw recruits, if there is room.']];
    $('camp').innerHTML = `<h1>Camp</h1><p class="blurb">A night with no enemy in sight. One thing, properly done.</p>
      <div class="cards">${opts.map(([k, n, d]) => `<button class="card" data-k="${k}"><b>${n}</b><span>${d}</span></button>`).join('')}</div><p id="camp-out" class="note"></p>`;
    $('camp').querySelectorAll('.card').forEach(b => b.onclick = () => {
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
