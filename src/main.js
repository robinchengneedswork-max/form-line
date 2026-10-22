'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MAIN — wiring, the campaign flow, and the loop.
//  The sim runs at a fixed CFG.STEP; the clock runs more or fewer steps a second.
//  App.speed is sim-seconds per real second: 1, 2 or 4, shown as ½×, 1×, 2× (the user: "set the current 2×
//  as 1 and the current 1 as ½ — that feels more right"). A battle starts at 2 (shown 1×).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const SAVE_KEY = 'formline.run';

const App = {
  mode: 'menu', run: null, node: null, B: null, speed: 2, paused: false, acc: 0, last: 0, quick: false,
  // tapping (or clicking) your own men: 'select' commands them, 'walk' also walks you along with them,
  // 'off' ignores them (a tap on your men walks you there like anywhere else). Per viewer
  tapMode: (() => { try { return localStorage.getItem('formline.tap') || 'select'; } catch (e) { return 'select'; } })(),
  setTapMode(m) { App.tapMode = m; try { localStorage.setItem('formline.tap', m); } catch (e) { /* storage unavailable */ } },

  saveRun() { try { if (App.run && !App.run.over) localStorage.setItem(SAVE_KEY, JSON.stringify(App.run)); else localStorage.removeItem(SAVE_KEY); } catch (e) { /* storage unavailable */ } },
  loadRun() { try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } },

  newCampaign() {
    App.quick = false;
    App.run = Campaign.newRun((Date.now() ^ (Math.random() * 1e9)) >>> 0);
    App.saveRun();
    UI.map(App.run);
  },
  continueCampaign() {
    const r = App.loadRun(); if (!r) return;
    App.quick = false; App.run = Campaign.migrate(r);
    // saved between an act's great battle and the spring
    if (App.run.winter) return UI.winter(App.run, () => { Campaign.nextAct(App.run); App.saveRun(); UI.map(App.run); });
    // the game was closed in the middle of a stage (a battle, the shop…): go back into it. (It used to count
    // as passed — the battle skipped with nothing to show for it)
    const open = App.run.entered && Campaign.node(App.run, App.run.entered);
    if (open && !open.done) return App.openNode(open);
    UI.map(App.run);
  },

  enterNode(id) {
    const run = App.run, n = Campaign.go(run, id);
    run.entered = n.id;
    App.saveRun();
    App.openNode(n);
  },
  openNode(n) {
    const run = App.run;
    App.node = n;
    const back = () => { n.done = true; run.entered = null; App.saveRun(); UI.map(run); };
    if (n.type === 'camp') return UI.camp(run, back);
    if (n.type === 'quartermaster') return UI.shop(run, back);
    if (n.type === 'event') return UI.event(run, Campaign.pickEvent(run), back);
    App.startBattle(Campaign.battleOpts(run, n), n);
  },

  quickBattle(scenario, q = {}) {
    App.quick = true; App.run = null;
    const seed = (Math.random() * 1e9) >>> 0;
    App.startBattle({ scenario, seed, level: q.stage != null ? q.stage : 0.3, company: Campaign.quickCompany(seed, q),
      commander: { name: 'You', hp: 3, maxHp: 3, horse: !!q.horse } }, null);
  },

  // the battle builder's armies, saved per viewer so you can come back to a setup
  builderBattle(army) {
    App.quick = true; App.run = null;
    const seed = (Math.random() * 1e9) >>> 0;
    App.startBattle({ scenario: army.map, seed, army, company: Builder.company(army.mine.own, seed),
      commander: { name: 'You', hp: 3, maxHp: 3, horse: !!army.mine.own.mounted } }, null);
  },
  loadArmy() { try { const a = JSON.parse(localStorage.getItem('formline.army') || 'null'); return a && a.mine && a.theirs && SCENARIOS[a.map] ? a : null; } catch (e) { return null; } },
  saveArmy() { try { localStorage.setItem('formline.army', JSON.stringify(App.army)); } catch (e) { /* storage unavailable */ } },

  startBattle(opts, node) {
    const B = Battle.create(opts);
    UI.brief(B.scenario, B.deploy, node, () => {
      Sound.resume();
      App.B = B; App.mode = 'battle'; UI._stripKey = UI._card = UI._clock = null; App.paused = false; App.acc = 0; App.speed = 2;
      if ($('tb-speed')) $('tb-speed').textContent = UI.speedLabel();
      Render.terrainFor = null;
      Render.cam.x = B.cmd.x; Render.cam.y = B.cmd.y - 30; Render.cam.zoom = 5.5;
      Input.camOff.x = Input.camOff.y = 0;
      $('pause').classList.remove('show');
      showScreen('screen-battle');
      Render.resize();
      UI.markLocked(B);
      App.ended = false;
    });
  },

  afterBattle() {
    const B = App.B;
    App.mode = 'menu'; Sound.stopBattle();
    if (App.quick || !App.run) {
      const rep = Campaign.afterBattle(Campaign.newRun(1), { type: 'battle', scenario: B.scenarioId, row: 3 }, B.result);
      return UI.report(rep, null, () => UI.title());
    }
    const run = App.run;
    const rep = Campaign.afterBattle(run, App.node, B.result);
    run.entered = null;
    App.saveRun();
    UI.report(rep, run, () => {
      if (run.over) {
        try {
          const best = JSON.parse(localStorage.getItem('formline.best') || 'null');
          if (!best || run.total > best.renown) localStorage.setItem('formline.best', JSON.stringify({ renown: run.total, rank: Campaign.rank(run).title, outcome: run.over }));
        } catch (e) { /* storage unavailable */ }
        UI.end(run);
      } else if (run.winter) UI.winter(run, () => { Campaign.nextAct(run); App.saveRun(); UI.map(run); });
      else UI.map(run);
    });
  },

  // something went wrong: say so on the screen (a phone has no console — a screenshot of this is the bug report)
  oops(err) {
    const msg = String(err && (err.stack || err.message) || err).split(/\n/).slice(0, 3).join(' · ');
    console.error(err);
    if (App._oops === msg) return;
    App._oops = msg;
    let el = document.getElementById('oops');
    if (!el) { el = document.createElement('div'); el.id = 'oops'; el.onclick = () => el.remove(); document.body.appendChild(el); }
    el.textContent = 'Something broke — please send a screenshot of this: ' + msg;
  },

  frame(ts) {
    // the next frame is asked for FIRST, so one bad frame cannot stop the game (it used to: the
    // screen froze and every button seemed dead)
    requestAnimationFrame(App.frame);
    try { App.tick(ts); } catch (err) { App.oops(err); }
  },
  tick(ts) {
    const dt = Math.min(0.1, (ts - App.last) / 1000 || 0);
    App.last = ts;
    const B = App.B;
    // rotating a phone: iOS fires 'resize' before the page has its new shape, so the canvas kept its portrait
    // size and the picture came out stretched. Compare every frame (two numbers) and catch up whenever it changes
    const cv = Render.cv;
    if (cv && cv.clientWidth && (cv.clientWidth !== Render.W || cv.clientHeight !== Render.H || (window.devicePixelRatio || 1) !== Render.dpr)) Render.resize();
    if (App.mode === 'battle' && B) {
      if (!App.paused && !B.over) {
        App.acc += dt * App.speed;
        let n = 0;
        while (App.acc >= CFG.STEP && n < 16) { Battle.step(B, CFG.STEP); App.acc -= CFG.STEP; n++; }
        if (n >= 16) App.acc = 0;
      }
      Input.update(B, dt);
      Render.draw(B, { ghost: B.cmd.moving === 0 && !B.player.routed });
      Sound.battle(B);
      UI.hud(B);
      if (B.over && !App.ended) { App.ended = true; UI.battleOver(B, () => App.afterBattle()); }
    }
  },
};

window.addEventListener('error', e => App.oops(e.error || e.message));
window.addEventListener('unhandledrejection', e => App.oops(e.reason));
window.addEventListener('load', () => {
  // each part starts on its own: one that fails must not take the others (or the game loop) with it
  for (const start of [() => Render.init($('field')), () => Input.init($('field')), () => Touch.init($('field')), () => UI.init()]) {
    try { start(); } catch (err) { App.oops(err); }
  }
  window.addEventListener('resize', () => Render.resize());
  window.addEventListener('orientationchange', () => setTimeout(() => Render.resize(), 250));
  requestAnimationFrame(App.frame);
});
