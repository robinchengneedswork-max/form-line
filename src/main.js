'use strict';
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MAIN — wiring, the campaign flow, and the loop.
//  The sim runs at a fixed CFG.STEP; the 2×/4× clock runs more steps.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const SAVE_KEY = 'formline.run';

const App = {
  mode: 'menu', run: null, node: null, B: null, speed: 1, paused: false, acc: 0, last: 0, quick: false,

  saveRun() { try { if (App.run && !App.run.over) localStorage.setItem(SAVE_KEY, JSON.stringify(App.run)); else localStorage.removeItem(SAVE_KEY); } catch (e) { /* storage unavailable */ } },
  loadRun() { try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } },

  newCampaign() {
    App.quick = false;
    App.run = Campaign.newRun((Date.now() ^ (Math.random() * 1e9)) >>> 0);
    App.saveRun();
    UI.map(App.run);
  },
  continueCampaign() { const r = App.loadRun(); if (!r) return; App.quick = false; App.run = Campaign.migrate(r); UI.map(App.run); },

  enterNode(id) {
    const run = App.run, n = Campaign.go(run, id);
    App.node = n;
    App.saveRun();
    const back = () => { n.done = true; App.saveRun(); UI.map(run); };
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
      App.B = B; App.mode = 'battle'; App.paused = false; App.acc = 0; App.speed = 1;
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
    App.saveRun();
    UI.report(rep, run, () => {
      if (run.over) {
        try {
          const best = JSON.parse(localStorage.getItem('formline.best') || 'null');
          if (!best || run.total > best.renown) localStorage.setItem('formline.best', JSON.stringify({ renown: run.total, rank: Campaign.rank(run).title, outcome: run.over }));
        } catch (e) { /* storage unavailable */ }
        UI.end(run);
      } else UI.map(run);
    });
  },

  frame(ts) {
    const dt = Math.min(0.1, (ts - App.last) / 1000 || 0);
    App.last = ts;
    const B = App.B;
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
    requestAnimationFrame(App.frame);
  },
};

window.addEventListener('load', () => {
  Render.init($('field'));
  Input.init($('field'));
  Touch.init($('field'));
  UI.init();
  window.addEventListener('resize', () => Render.resize());
  requestAnimationFrame(App.frame);
});
