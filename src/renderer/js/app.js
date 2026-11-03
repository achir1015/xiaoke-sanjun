// 小柯機器人三軍棋遊戲：主控流程（布陣 → 對戰；與 AI、與真人、AI 對 AI、棋譜重播）
import { $, $$, h, toast, modal, sleep, errMsg, fmtDate, uid } from './util.js';
import * as J from './sanjun.js';
import { LEVELS } from './ai.js';
import { buildLearned } from './learn.js';
import { maskText } from './belief.js';
import { Board3D } from './board3d.js';
import { GameLink, PROTOCOL } from './net.js';
import { MusicPlayer } from './music.js';
import { AdvisorPanel } from './advisor-ui.js';
import { sfx, setSfx, setSfxVolume, sfxVolume } from './sfx.js';
import { loadPortraits, portraitUrl, labelOf, validProfile, randomProfile, pickProfile } from './portraits.js';
import { Guide } from './guide.js';

const { SIDE_NAME, NAMES } = J;
const CREDIT = '遊戲開發：吳玉柱 先生 與 Claude AI Opus 5.5';
const SPEEDS = [['fast', '快（0.4 秒）', 400], ['normal', '一般（1 秒）', 1000], ['slow', '慢（2 秒）', 2000]];
const KIND_NAME = { dark: '暗棋（裁判制）', open: '明棋（全部公開）' };

// ---------------- AI 背景執行緒 ----------------
class EngineClient {
  constructor() {
    this.w = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
    this.seq = 0;
    this.pending = new Map();
    this.w.onmessage = (e) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      e.data.ok ? p.resolve(e.data.r) : p.reject(new Error(e.data.e));
    };
    this.w.onerror = (e) => console.error('ai worker', e);
  }
  req(cmd, view, opts) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.w.postMessage({ id, cmd, view, opts }); });
  }
  move(view, level, learned) { return this.req('move', view, { level, learned }); }
  analyze(view, level, learned, top = 3) { return this.req('analyze', view, { level, learned, top }); }
  infer(view, learned, n = 160) { return this.req('infer', view, { learned, n }); }
  layout(level, learned) { return this.req('layout', null, { level, learned }); }
}

const S = {
  settings: null,
  info: null,
  screen: 'home',
  kind: 'dark',
  mode: null,          // ai | net | aivai | replay | idle
  phase: 'idle',       // layout | play | over
  game: null,
  mySide: 0,
  layouts: [null, null],
  ready: [false, false],
  first: 0,
  swapSel: -1,
  selected: -1,
  aiThinking: false,
  animating: false,
  paused: false,
  aivaiLevels: [2, 2],
  aivaiDelay: 1000,
  gameId: '',
  saved: false,
  names: ['紅軍', '藍軍'],
  players: [null, null],
  proxy: [false, false],
  link: null,
  netStatus: '',
  netStarted: false,
  oppName: '',
  oppProfile: null,
  curStart: null,
  replay: null,
  clocks: [0, 0],
  clockSide: 0,
  clockStart: 0,
  voice: { call: null, mic: null },
  levelIdx: 2,
  learned: null,
  infer: null,
  inferSeq: 0,
  lastHintTimer: 0,
};

let board, music, advisor, engineAI, engineAna;
const newGameId = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + uid().slice(-6);
const learnedPlain = () => (S.settings.learnFromGames !== false && S.learned ? S.learned.plain() : null);
const myProfile = () => S.settings.profile;
const isPlayer = () => S.mode === 'ai' || S.mode === 'net';
// 看棋盤的人：自己下棋時只看得到自己；觀戰、重播看得到全部
const viewer = () => (isPlayer() ? S.mySide : null);

// ---------------- 啟動 ----------------
async function init() {
  S.settings = await xk.settings.get();
  S.info = await xk.sys.info();
  setSfx(S.settings.sfx);
  S.levelIdx = S.settings.level ?? 2;
  S.kind = S.settings.gameKind === 'open' ? 'open' : 'dark';
  engineAI = new EngineClient();
  engineAna = new EngineClient();
  await rebuildLearned();
  await loadPortraits();

  board = new Board3D($('#board'), { onSquareClick });
  board.setPosition(new Int8Array(J.NSQ));
  setView(S.settings.view || 'tilt', false);

  music = new MusicPlayer($('#musicPanel'), S.settings, (patch) => saveSettings(patch));
  await music.load();
  if (S.settings.music.autoplay && S.settings.music.enabled !== false) {
    const start = () => { music.play(); document.removeEventListener('pointerdown', start); };
    document.addEventListener('pointerdown', start);
  }
  music.renderState();
  initVolumeControls();
  tickDateTime();
  setInterval(tickDateTime, 1000);

  advisor = new AdvisorPanel($('#advisorPanel'), () => ({
    game: S.game,
    view: currentView(),
    mySide: isPlayer() ? S.mySide : (S.game ? S.game.turn : 0),
    phase: S.phase,
    kind: S.kind,
    analyze: (view) => engineAna.analyze(view, 3, learnedPlain(), 3),
    infer: (view) => engineAna.infer(view, learnedPlain(), 160),
    showHint: (m) => showHint(m),
  }));
  advisor.setHasKey(S.settings.advisor.hasKey);

  bindUI();
  if (document.documentElement.classList.contains('mobile')) setupMobile();
  else if (document.documentElement.classList.contains('touch')) setupTouch();
  renderHome();
  showScreen('home');
  if (!validProfile(S.settings.profile)) ensureProfile();
  setInterval(tickClock, 500);
  document.addEventListener('pointerdown', () => sfx.resume(), { once: true });
  window.__xkj = S; // 方便自動化測試
  window.__xkjBoard = board;
  window.__xkjJ = J;
  if (S.settings.autoUpdate !== false && S.info.packaged && !S.info.profile) setTimeout(() => checkUpdate(false), 5000);
}

async function saveSettings(patch) {
  S.settings = await xk.settings.set(patch);
  return S.settings;
}

async function rebuildLearned() {
  const all = await xk.games.all();
  S.learned = buildLearned(all);
  renderLearnStat();
}

function renderLearnStat() {
  const l = S.learned;
  const t = `棋譜累積：已收錄 ${l.games} 局、${l.moves} 步、${l.attacks} 次交戰；學到 ${l.goodLayouts.length} 套致勝布陣`;
  $$('.learn-stat').forEach((el) => { el.textContent = t; });
}

// ---------------- 畫面切換 ----------------
function showScreen(name) {
  S.screen = name;
  $$('.screen').forEach((el) => el.classList.toggle('on', el.id === 'scr-' + name));
  if (name === 'game') setTimeout(() => board.resize(), 30);
  if (name === 'records') renderRecords();
}

function bindUI() {
  $('#btnHome').onclick = () => leaveGame();
  $('#viewTilt').onclick = () => setView('tilt');
  $('#viewTop').onclick = () => setView('top');
  $('#viewLow').onclick = () => setView('low');
  $('#btnFlip').onclick = () => board.setOrientation(board.orientation ^ 1);
  $('#btnUndo').onclick = () => requestUndo();
  $('#btnDraw').onclick = () => offerDraw();
  $('#btnResign').onclick = () => resign();
  $('#btnHint').onclick = () => hint();
  $('#btnPause').onclick = () => togglePause();
  $('#btnProxy').onclick = () => toggleProxy();
  $('#btnNew').onclick = () => newGameSameMode();
  $('#btnExport').onclick = () => exportCurrent();
  $('#miniMusic').onclick = () => { selectTab('music'); music.toggle(); };
  $$('.tab').forEach((t) => { t.onclick = () => selectTab(t.dataset.tab); });
  $('#chatSend').onclick = () => sendChat();
  $('#chatInput').onkeydown = (e) => { if (e.key === 'Enter') sendChat(); };
  $('#btnVoice').onclick = () => toggleVoice();
  $('#btnMute').onclick = () => toggleMute();
  $('#rpFirst').onclick = () => replayGo(0);
  $('#rpPrev').onclick = () => replayGo(S.replay.ply - 1);
  $('#rpNext').onclick = () => replayGo(S.replay.ply + 1);
  $('#rpLast').onclick = () => replayGo(S.replay.game.moves.length);
  $('#rpPlay').onclick = () => replayAuto();
  $('#rpExport').onclick = () => exportCurrent();
  // 布陣
  $('#btnPreset').onclick = () => applyPreset($('#presetSel').value);
  $('#btnRandomLayout').onclick = () => setMyLayout(J.randomLayout(), '隨機布陣');
  $('#btnAdviseLayout').onclick = () => adviseLayout();
  $('#btnSaveLayout').onclick = () => saveMyLayout();
  $('#btnLayoutDone').onclick = () => layoutDone();
  document.addEventListener('keydown', (e) => {
    if (S.mode !== 'replay' || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.key === 'ArrowLeft') replayGo(S.replay.ply - 1);
    if (e.key === 'ArrowRight') replayGo(S.replay.ply + 1);
  });
}

function selectTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
  $$('.tabpane').forEach((p) => p.classList.toggle('on', p.id === 'pane-' + name));
  if (name === 'chat') $('.tab[data-tab="chat"]').classList.remove('ping');
  if (name === 'intel') renderIntel();
}

function setView(v, save = true) {
  board.setView(v);
  $$('.viewbtn').forEach((b) => b.classList.toggle('on', b.id === 'view' + v[0].toUpperCase() + v.slice(1)));
  if (save) saveSettings({ view: v });
}

// ---------------- 首頁 ----------------
function seg(options, value, onPick) {
  const el = h('div', { class: 'seg' }, ...options.map(([v, l]) => h('button', { class: 'segbtn' + (v === value ? ' on' : ''), 'data-v': v, onclick: () => { $$('.segbtn', el).forEach((b) => b.classList.toggle('on', b.dataset.v === v)); el.dataset.v = v; onPick && onPick(v); } }, l)));
  el.dataset.v = value;
  return el;
}

function renderHome() {
  const home = $('#homeBody');
  home.innerHTML = '';
  const kind = S.kind;
  const nameInput = h('input', { class: 'name-in', value: S.settings.playerName, maxLength: 16, onchange: (e) => saveSettings({ playerName: e.target.value.trim() || '棋友' }) });
  const kindSel = h('div', { class: 'kind-tabs' },
    ...[['dark', '暗棋（裁判制）', '看不到對方棋子，由裁判判定勝負'], ['open', '明棋（全部公開）', '雙方棋子都翻開，適合練習']].map(([k, t, sub]) =>
      h('button', { class: 'kindbtn' + (k === kind ? ' on' : ''), 'data-k': k, onclick: () => { S.kind = k; saveSettings({ gameKind: k }); renderHome(); } }, h('b', {}, t), h('span', {}, sub))));

  const sideOpts = [['red', '我執紅軍（先走）'], ['blue', '我執藍軍（後走）'], ['random', '隨機']];
  const savedSide = ['red', 'blue', 'random'].includes(S.settings.aiSide) ? S.settings.aiSide : 'red';
  const sideSel = seg(sideOpts.map(([v, l]) => [v, l.replace('我執', '').replace('（先走）', '').replace('（後走）', '')]), savedSide);
  const lvSel = h('select', { class: 'lv', id: 'aiLevel', onchange: (e) => { S.levelIdx = Number(e.target.value); saveSettings({ level: S.levelIdx }); } },
    LEVELS.map((l, i) => h('option', { value: i, selected: i === S.levelIdx }, l.name)));
  const cardAI = h('div', { class: 'card mode-card' },
    h('div', { class: 'card-icon' }, '🤖'),
    h('h2', {}, 'A　真人對 AI'),
    h('p', { class: 'muted' }, kind === 'dark' ? '不需要網路。AI 跟您一樣看不到對方的棋子，只能靠裁判公布的勝負推算，絕不偷看。' : '不需要網路。雙方棋子全部公開，適合練習與學習戰術。'),
    h('label', {}, '我方：'), sideSel,
    h('label', {}, '難度：'), lvSel,
    h('p', { class: 'learn-stat small muted' }),
    h('button', { class: 'primary big', id: 'startAI', onclick: () => startAIGame(sideSel.dataset.v) }, '開始布陣'));

  const hostOpts = [['random', '隨機分配紅藍'], ['red', '我執紅軍（先走）'], ['blue', '我執藍軍（後走）']];
  const hostSideSel = h('select', { class: 'lv', id: 'hostSide' }, hostOpts.map(([v, l]) => h('option', { value: v }, l)));
  const codeIn = h('input', { class: 'code-in', id: 'joinCode', placeholder: '輸入 6 位數房號', maxLength: 7, inputMode: 'numeric' });
  const cardNet = h('div', { class: 'card mode-card' },
    h('div', { class: 'card-icon' }, '🌐'),
    h('h2', {}, 'B　真人對真人'),
    h('p', { class: 'muted' }, '邀請遠端棋友連線對戰，可以文字或語音聊天；AI 軍師全程陪同，需要時還能代打。'),
    h('div', { class: 'net-row' }, hostSideSel, h('button', { class: 'primary', id: 'btnHost', onclick: () => hostRoom(hostSideSel.value) }, '建立房間')),
    h('div', { class: 'net-or' }, '或'),
    h('div', { class: 'net-row' }, codeIn, h('button', { class: 'primary', id: 'btnJoin', onclick: () => joinRoom(codeIn.value) }, '加入房間')),
    h('p', { class: 'small muted' }, '加入房間時會自動使用房主選的暗棋或明棋。'),
    h('div', { id: 'netWait', class: 'net-wait hidden' }));

  const av = S.settings.aivai || {};
  const aLv = (key, def) => h('select', { class: 'lv', id: key }, LEVELS.map((l, i) => h('option', { value: i, selected: i === (av[key] ?? def) }, l.name)));
  const lvA = aLv('aivaiA', 2), lvB = aLv('aivaiB', 3);
  const speedSel = seg(SPEEDS.map(([v, l]) => [v, l.split('（')[0]]), av.speed || 'normal');
  const cardAivai = h('div', { class: 'card mode-card' },
    h('div', { class: 'card-icon' }, '🎬'),
    h('h2', {}, 'C　AI 對 AI'),
    h('p', { class: 'muted' }, '坐下來觀戰，兩個 AI 各自推算對方暗子。觀戰時雙方棋子都看得到，可以暫停、請軍師講解。'),
    h('div', { class: 'two-col' },
      h('div', {}, h('label', {}, '紅軍 AI：'), lvA),
      h('div', {}, h('label', {}, '藍軍 AI：'), lvB)),
    h('label', {}, '每步速度：'), speedSel,
    h('button', { class: 'primary big', id: 'startAivai', onclick: () => {
      const cfg = { levels: [Number(lvA.value), Number(lvB.value)], speed: speedSel.dataset.v };
      saveSettings({ aivai: { aivaiA: cfg.levels[0], aivaiB: cfg.levels[1], speed: cfg.speed } });
      startAIvAI(cfg);
    } }, '開始觀戰'));

  home.append(
    h('div', { class: 'home-hero' },
      h('img', { class: 'hero-icon', src: '../../assets/icon-256.png', alt: '' }),
      h('div', {}, h('h1', {}, '小柯機器人三軍棋遊戲'), h('p', { class: 'muted' }, '3D 立體陸海空三軍棋．暗棋裁判制．AI 推算敵情')),
      myProfileCard(),
      h('div', { class: 'hero-name' }, h('label', {}, '我的暱稱'), nameInput)),
    kindSel,
    h('div', { class: 'mode-grid' }, cardAI, cardNet, cardAivai),
    h('div', { class: 'home-links' },
      h('button', { onclick: () => showScreen('records') }, '📜 棋譜庫'),
      h('button', { onclick: () => openSettings() }, '⚙ 設定'),
      h('button', { onclick: () => { selectTab('music'); showScreen('game'); enterIdleBoard(); } }, '♫ 背景音樂'),
      h('button', { id: 'btnGuide', class: 'guide-btn', onclick: () => openGuide('rules') }, '📖 三軍棋教學'),
      h('button', { id: 'btnHelp', class: 'guide-btn', onclick: () => openGuide('help') }, '🔊 系統功能說明'),
      h('button', { id: 'btnAbout', onclick: () => openAbout() }, 'ℹ 關於與更新')),
    h('div', { class: 'credit muted small' }, `v${S.info.version}　${CREDIT}`),
  );
  renderLearnStat();
}

// ---------------- 手機版（直立）----------------
// 戰況紀錄、軍師、敵情、對話、音樂收進底部的抽屜；點分頁打開、再點一次收起
function setupMobile() {
  document.body.classList.add('is-mobile');
  const tabs = $('.right .tabs');
  tabs.prepend(h('button', { class: 'tab', 'data-tab': 'moves' }, '📜 戰況'));
  const pane = h('div', { id: 'pane-moves', class: 'tabpane' });
  pane.append($('.movebox'));
  $('#pane-advisor').before(pane);
  $$('.tab').forEach((t) => {
    t.onclick = () => {
      const open = document.body.classList.contains('sheet-open');
      const same = t.classList.contains('on');
      selectTab(t.dataset.tab);
      document.body.classList.toggle('sheet-open', !(open && same));
    };
  });
  setupTouch();
  $('.board-tip').textContent = '點棋子選子走棋．兩指旋轉縮放';
  // 返回鍵：先關對話框、抽屜、音量，再回上一頁
  window.__xkjBack = () => {
    const m = $('.modal-back');
    if (m) { const btns = m.querySelectorAll('.modal-btns button'); (btns[0] || btns[btns.length - 1]).click(); return true; }
    if (document.body.classList.contains('sheet-open')) { document.body.classList.remove('sheet-open'); return true; }
    if ($$('.vol.open').length) { $$('.vol.open').forEach((x) => x.classList.remove('open')); return true; }
    if (S.screen === 'game') { leaveGame(); return true; }
    if (S.screen === 'guide') { guide && guide.close(); return true; }
    if (S.screen === 'records') { showScreen('home'); return true; }
    return false;
  };
}

// iPad 等觸控螢幕
function setupTouch() {
  const toggleVol = (btn) => (e) => {
    e.stopPropagation();
    const v = btn.closest('.vol');
    const was = v.classList.contains('open');
    $$('.vol.open').forEach((x) => x.classList.remove('open'));
    if (!was) v.classList.add('open');
    $('#musicPlay').textContent = music.playing ? '暫停' : '播放';
  };
  $('#btnSfx').onclick = toggleVol($('#btnSfx'));
  $('#miniMusic').onclick = toggleVol($('#miniMusic'));
  $('#sfxMute').onclick = (e) => { e.stopPropagation(); $('#btnSfx').dispatchEvent(new CustomEvent('mute')); };
  $('#musicPlay').onclick = (e) => { e.stopPropagation(); music.toggle(); $('#musicPlay').textContent = music.playing ? '暫停' : '播放'; };
  $$('.vol-pop').forEach((p) => p.addEventListener('click', (e) => e.stopPropagation()));
  document.addEventListener('click', () => $$('.vol.open').forEach((x) => x.classList.remove('open')));
  $('.board-tip').textContent = '點棋子選子走棋．兩指拖曳旋轉．兩指捏合縮放';
}

// ---------------- 日期時間、音量 ----------------
function tickDateTime() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const el = $('#clock');
  if (el) el.textContent = `西元 ${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日（星期${'日一二三四五六'[d.getDay()]}）${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function initVolumeControls() {
  const sv = $('#sfxVol'), svv = $('#sfxVolVal');
  let lastSfx = S.settings.sfxVolume > 0 ? S.settings.sfxVolume : 0.8;
  const applySfx = (v, save = true) => {
    setSfxVolume(v);
    sv.value = Math.round(v * 100);
    svv.textContent = Math.round(v * 100);
    $('#btnSfx').textContent = v > 0 ? '🔔 音效' : '🔕 音效';
    if (v > 0) lastSfx = v;
    if (save) { clearTimeout(applySfx.t); applySfx.t = setTimeout(() => saveSettings({ sfxVolume: v }), 400); }
  };
  applySfx(S.settings.sfxVolume ?? 0.8, false);
  let lastPreview = 0;
  sv.oninput = () => {
    applySfx(sv.value / 100);
    if (Date.now() - lastPreview > 180) { lastPreview = Date.now(); sfx.resume(); sfx.move(); }
  };
  const muteToggle = () => { applySfx(sfxVolume() > 0 ? 0 : lastSfx); if (sfxVolume() > 0) { sfx.resume(); sfx.move(); } };
  $('#btnSfx').onclick = muteToggle;
  $('#btnSfx').addEventListener('mute', muteToggle);
  const mv = $('#musicVol'), mvv = $('#musicVolVal');
  const showMusic = (v) => { mv.value = Math.round(v * 100); mvv.textContent = Math.round(v * 100); };
  showMusic(music.cfg.volume);
  music.onVolume = showMusic;
  mv.oninput = () => music.setVolume(mv.value / 100);
}

function myProfileCard() {
  const pr = S.settings.profile;
  if (!validProfile(pr)) return h('button', { class: 'my-profile empty', id: 'btnProfile', onclick: () => ensureProfile(true) }, '選擇頭像與 AI 軍師');
  return h('button', { class: 'my-profile', id: 'btnProfile', title: '更換頭像與 AI 軍師', onclick: () => ensureProfile(true) },
    h('img', { class: 'mp-main', src: portraitUrl(pr.avatar) }),
    h('div', { class: 'mp-text' }, h('b', {}, labelOf(pr.avatar)), h('span', {}, '陪同參賽的 AI 軍師'),
      h('div', { class: 'mp-adv' }, h('img', { src: portraitUrl(pr.advisor) }), h('span', {}, labelOf(pr.advisor)))),
    h('span', { class: 'mp-change' }, '更換'));
}

async function ensureProfile(force = false) {
  const cur = S.settings.profile;
  if (!force && validProfile(cur)) return true;
  const required = !validProfile(cur);
  const r = await pickProfile(cur, { required });
  if (r) {
    await saveSettings({ profile: r });
    if (S.screen === 'home') renderHome();
    return true;
  }
  return validProfile(S.settings.profile);
}

// 對局中更換陪同的 AI 軍師
async function changeAdvisor() {
  const r = await pickProfile(myProfile(), { advisorOnly: true });
  if (!r) return;
  await saveSettings({ profile: r });
  if (isPlayer() && S.players[S.mySide]) {
    S.players[S.mySide] = { ...S.players[S.mySide], advisor: r.advisor };
    if (S.mode === 'net') S.link?.send({ t: 'advisor', advisor: r.advisor });
    chatSys(`改由 AI 軍師「${labelOf(r.advisor)}」陪同`);
  }
  updateAdvisorHead();
  updateGameUI();
  toast(`AI 軍師換成「${labelOf(r.advisor)}」`, 'ok');
}

function enterIdleBoard() {
  if (S.mode && S.mode !== 'idle') return;
  S.mode = 'idle';
  S.phase = 'idle';
  S.game = null;
  S.names = ['紅軍', '藍軍'];
  S.clocks = [0, 0];
  S.layouts = [J.PRESETS[0].L.slice(), J.PRESETS[1].L.slice()];
  board.setPosition(layoutBoard(true));
  board.setLastMove(-1, -1); board.setHint(-1); board.setSelected(-1); board.setTargets([]); board.setZone(null); board.setLabels(null);
  board.setInteractive(false);
  document.body.classList.remove('phase-layout');
  updateGameUI();
}

// ---------------- 對局共用 ----------------
function currentView() {
  if (S.mode === 'replay') return S.replay ? S.replay.game.viewFor(null) : null;
  if (!S.game) return null;
  return S.game.viewFor(viewer());
}

// 布陣階段的棋盤：自己看得到自己的棋子，對方是暗子
function layoutBoard(all = false) {
  const b = new Int8Array(J.NSQ);
  for (const side of [0, 1]) {
    const L = S.layouts[side];
    if (!L) {
      // 對方還沒布陣：先用暗子表示
      J.PRESETS[0].L.forEach((t, li) => { if (t) b[J.sqOfLi(side, li)] = J.mk(side, J.UNK); });
      continue;
    }
    const show = all || viewer() == null || side === S.mySide;
    for (let li = 0; li < J.LSIZE; li++) if (L[li]) b[J.sqOfLi(side, li)] = J.mk(side, show ? L[li] : J.UNK);
  }
  return b;
}

function displayBoard() {
  if (S.phase === 'layout') return layoutBoard();
  const v = currentView();
  return v ? v.board : new Int8Array(J.NSQ);
}

function setupGame(mode, mySide, names, opts = {}) {
  S.mode = mode;
  S.kind = opts.kind === 'open' ? 'open' : opts.kind === 'dark' ? 'dark' : S.kind;
  S.mySide = mySide;
  S.names = names;
  S.players = opts.players || [randomProfile(), randomProfile()];
  S.proxy = [false, false];
  S.selected = -1;
  S.swapSel = -1;
  S.aiThinking = false;
  S.animating = false;
  S.paused = false;
  S.saved = false;
  S.game = null;
  S.infer = null;
  S.first = opts.first ?? 0;
  S.gameId = opts.gameId || newGameId();
  S.layouts = [null, null];
  S.ready = [false, false];
  S.clocks = [0, 0]; S.clockSide = S.first; S.clockStart = Date.now();
  board.setOrientation(mode === 'aivai' || mode === 'replay' ? 0 : mySide);
  board.setLastMove(-1, -1); board.setHint(-1); board.setSelected(-1); board.setTargets([]); board.setLabels(null); board.setSwapMark(-1);
  advisor.reset();
  for (const m of ['net', 'ai', 'aivai', 'replay']) document.body.classList.toggle('mode-' + m, mode === m);
  document.body.classList.toggle('kind-open', S.kind === 'open');
  $('#chatLog').innerHTML = '';
  $('#aiInfo').textContent = '';
  showScreen('game');
  selectTab(mode === 'net' ? 'chat' : 'advisor');
  updateAdvisorHead();
}

// 進入布陣階段（自己的布陣先用上次的）
function enterLayout() {
  S.phase = 'layout';
  document.body.classList.add('phase-layout');
  const last = S.settings.lastLayout;
  S.layouts[S.mySide] = Array.isArray(last) && !J.validateLayout(last) ? last.slice() : J.PRESETS[0].L.slice();
  renderPresetSel();
  board.setPosition(layoutBoard());
  board.setZone(S.mySide);
  board.setInteractive(true);
  updateGameUI();
  showVersus();
  if (S.proxy[S.mySide]) autoLayoutForProxy();
}

function renderPresetSel() {
  const sel = $('#presetSel');
  sel.innerHTML = '';
  sel.append(h('optgroup', { label: '經典布陣' }, J.PRESETS.map((p, i) => h('option', { value: 'p' + i }, `${p.name}：${p.desc}`))));
  const mine = S.settings.myLayouts || [];
  if (mine.length) sel.append(h('optgroup', { label: '我的布陣' }, mine.map((p, i) => h('option', { value: 'm' + i }, p.name))));
  const good = S.learned ? S.learned.goodLayouts.slice(0, 5) : [];
  if (good.length) sel.append(h('optgroup', { label: '棋譜中打贏過的布陣' }, good.map((p, i) => h('option', { value: 'g' + i }, `致勝布陣 ${i + 1}（${p.w} 勝 ${p.l} 負）`))));
}

function applyPreset(v) {
  let L = null, name = '';
  if (v[0] === 'p') { const p = J.PRESETS[Number(v.slice(1))]; L = p.L; name = p.name; }
  else if (v[0] === 'm') { const p = (S.settings.myLayouts || [])[Number(v.slice(1))]; if (p) { L = p.L; name = p.name; } }
  else if (v[0] === 'g') { const p = S.learned.goodLayouts[Number(v.slice(1))]; if (p) { L = p.L; name = '致勝布陣'; } }
  if (L && !J.validateLayout(L)) setMyLayout(L.slice(), name);
}

function setMyLayout(L, name) {
  if (S.phase !== 'layout' || S.ready[S.mySide]) return;
  S.layouts[S.mySide] = L;
  S.swapSel = -1;
  board.setSwapMark(-1);
  board.setPosition(layoutBoard());
  sfx.swap();
  if (name) toast(`已套用：${name}`, 'ok', 1800);
}

async function adviseLayout() {
  const adv = labelOf(S.players[S.mySide]?.advisor) || '小柯軍師';
  const L = await engineAna.layout(3, learnedPlain());
  setMyLayout(L, `${adv}推薦的布陣`);
  const fl = L.indexOf(J.FLAG);
  advisor.say('ai', `我替您排了一套布陣：軍旗放在${fl === 3 ? '左' : '右'}邊的大本營，旁邊用地雷保護；炸彈放在中後方，等對方大子靠近再換掉它；高射炮守在後方防空，砲艦看住港口。滿意的話按「布陣完成」就開戰！`);
}

async function saveMyLayout() {
  const L = S.layouts[S.mySide];
  if (!L) return;
  const inp = h('input', { value: `我的布陣 ${(S.settings.myLayouts || []).length + 1}`, maxLength: 20 });
  const ok = await modal('儲存布陣', h('div', {}, h('p', {}, '幫這套布陣取個名字：'), inp), [{ label: '取消', value: false }, { label: '儲存', value: true, primary: true }]);
  if (!ok) return;
  const list = (S.settings.myLayouts || []).slice(0, 19);
  list.unshift({ name: inp.value.trim() || '我的布陣', L: L.slice() });
  await saveSettings({ myLayouts: list });
  renderPresetSel();
  toast('布陣已儲存', 'ok');
}

// 布陣時點兩顆棋子互換
function layoutClick(sq) {
  if (S.ready[S.mySide]) { toast('已經布陣完成，等待對方…', 'info', 1800); return; }
  if (J.halfOf(sq) !== S.mySide) { showWhy('這是對方的陣地，只能調整自己這一邊'); return; }
  const li = J.liOf(S.mySide, sq);
  if (J.liIsCamp(li)) { showWhy('行營一開始要空著，不能放棋子'); return; }
  if (!J.canPlace(0, li)) return;
  const L = S.layouts[S.mySide];
  if (S.swapSel < 0) {
    if (!L[li]) { showWhy('請先點選要移動的棋子，再點空格或另一顆棋子'); return; }
    S.swapSel = li;
    board.setSwapMark(sq);
    sfx.select();
    return;
  }
  const a = S.swapSel;
  S.swapSel = -1;
  board.setSwapMark(-1);
  if (a === li) return;
  if (L[a] === L[li]) return;
  if (!J.canSwap(L, a, li)) {
    sfx.illegal();
    const bad = !J.canPlace(L[a], li) ? L[a] : L[li];
    showWhy(J.placeRule(bad));
    return;
  }
  [L[a], L[li]] = [L[li], L[a]];
  sfx.swap();
  board.animateSwap(J.sqOfLi(S.mySide, a), sq);
}

async function layoutDone() {
  if (S.phase !== 'layout' || S.ready[S.mySide]) return;
  const L = S.layouts[S.mySide];
  const err = J.validateLayout(L);
  if (err) { toast('布陣不合規則：' + err, 'err'); return; }
  S.ready[S.mySide] = true;
  S.swapSel = -1;
  board.setSwapMark(-1);
  saveSettings({ lastLayout: L.slice() });
  if (S.mode === 'net') S.link.send({ t: 'layout', L: L.slice(), gameId: S.gameId });
  sfx.turn();
  updateGameUI();
  tryBeginPlay();
}

function autoLayoutForProxy() {
  if (S.phase !== 'layout' || S.ready[S.mySide]) return;
  engineAna.layout(S.settings.proxyLevel ?? 3, learnedPlain()).then((L) => {
    if (S.phase !== 'layout' || S.ready[S.mySide] || !S.proxy[S.mySide]) return;
    S.layouts[S.mySide] = L;
    board.setPosition(layoutBoard());
    layoutDone();
  });
}

function tryBeginPlay() {
  if (S.phase !== 'layout' || !S.ready[0] || !S.ready[1] || !S.layouts[0] || !S.layouts[1]) { updateGameUI(); return; }
  beginPlay();
}

function beginPlay(moves = []) {
  S.game = new J.SanjunGame({ layouts: S.layouts, first: S.first, kind: S.kind });
  for (const s of moves) { const m = J.strMove(s); if (m >= 0 && S.game.isLegal(m)) S.game.play(m); }
  S.phase = 'play';
  document.body.classList.remove('phase-layout');
  board.setZone(null);
  board.setPosition(displayBoard());
  const last = S.game.log[S.game.log.length - 1];
  board.setLastMove(last ? last.from : -1, last ? last.to : -1);
  board.setInteractive(canMove());
  S.clocks = [0, 0]; S.clockSide = S.game.turn; S.clockStart = Date.now();
  if (!moves.length) {
    popText('開戰！', 'start');
    sfx.start();
    if (isPlayer()) {
      const mine = S.game.turn === S.mySide;
      chatSys(`布陣完成，開戰！您是${SIDE_NAME[S.mySide]}，${mine ? '請先走' : '對方先走'}。`);
      if (mine && S.mode === 'net') xk.win.attention('開戰', '輪到您下棋');
    }
  }
  updateGameUI();
  refreshInfer();
  maybeAutoMove();
}

// 軍師面板顯示我的軍師（觀戰時顯示輪到那一方的軍師）
function updateAdvisorHead() {
  const idx = isPlayer() ? S.mySide : (S.game ? S.game.turn : 0);
  const pr = S.players[idx];
  advisor.setAdvisor(pr ? labelOf(pr.advisor) : '小柯軍師', pr ? portraitUrl(pr.advisor) : '', isPlayer() ? () => changeAdvisor() : null);
}

function showVersus() {
  const side = (idx) => {
    const pr = S.players[idx];
    if (!pr) return h('div');
    return h('div', { class: 'vs-side ' + (idx === 0 ? 'red' : 'blue') },
      h('img', { class: 'vs-main', src: portraitUrl(pr.avatar) }),
      h('div', { class: 'vs-name' }, S.names[idx] || ''),
      h('div', { class: 'vs-tag' }, `${SIDE_NAME[idx]}．${labelOf(pr.avatar)}`),
      h('div', { class: 'vs-adv' }, h('img', { src: portraitUrl(pr.advisor) }), h('span', {}, `軍師 ${labelOf(pr.advisor)}`)));
  };
  const el = h('div', { class: 'versus', onclick: () => el.remove() }, side(0), h('div', { class: 'vs-mid' }, 'VS'), side(1));
  $('#boardWrap').append(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3200);
}

function canMove() {
  const g = S.game;
  if (S.phase !== 'play' || !g || g.result || S.animating) return false;
  if (S.proxy[S.mySide]) return false;
  if (S.mode === 'ai') return !S.aiThinking && g.turn === S.mySide;
  if (S.mode === 'net') return !!(S.link && S.link.connected) && g.turn === S.mySide && S.netStarted;
  return false;
}

function onSquareClick(sq) {
  if (!isPlayer()) return;
  if (S.phase === 'layout') { layoutClick(sq); return; }
  const g = S.game;
  if (!g) return;
  if (!canMove()) {
    if (!g.result && S.proxy[S.mySide]) toast('目前由 AI 軍師代打，按「交還主位」就能自己下', 'info', 2500);
    else if (!g.result && g.turn !== S.mySide) { flashBanner(); sfx.illegal(); }
    return;
  }
  const c = g.board[sq];
  if (c && (c >> 5) === S.mySide) {
    const t = c & 31;
    const list = g.targets(sq);
    if (!list.length) {
      showWhy(t === J.FLAG ? '軍旗不能移動' : t === J.MINE ? '地雷埋好就不能移動' : J.isHQ(sq) ? '進了大本營的棋子就不能再移動' : '這顆棋子現在沒有路可以走');
      sfx.illegal();
      S.selected = -1; board.setSelected(-1); board.setTargets([]);
      return;
    }
    S.selected = sq;
    board.setSelected(sq);
    board.setTargets(list, displayBoard());
    sfx.select();
    return;
  }
  if (S.selected >= 0) {
    const m = J.MV(S.selected, sq);
    if (g.isLegal(m)) { localMove(m); return; }
    sfx.illegal();
    showWhy(J.explainIllegal(g.board, S.selected, sq));
  } else if (c) showWhy('這是對方的棋子，請先點選自己的棋子');
}

function showWhy(text) {
  if (!text) return;
  $$('.toast.why').forEach((t) => t.remove());
  toast('✕ ' + text, 'why', 3200);
}

async function localMove(m) {
  if (S.mode === 'net') S.link.send({ t: 'move', ply: S.game.moves.length, mv: J.moveStr(m) });
  await applyMove(m);
}

const OUT_POP = { win: ['吃掉！', 'win'], lose: ['陣亡…', 'lose'], tie: ['同歸於盡！', 'tie'], flag: ['奪下軍旗！', 'flag'], scout: ['偵察！', 'scout'] };

async function applyMove(m) {
  const g = S.game;
  S.selected = -1;
  board.setSelected(-1);
  board.setTargets([]);
  board.setHint(-1);
  const mover = g.turn;
  S.clocks[mover] += Date.now() - S.clockStart;
  S.clockStart = Date.now();
  const before = displayBoard();
  const ev = g.play(m);
  S.clockSide = g.turn;
  S.animating = true;
  updateGameUI();
  const ply = g.moves.length;
  const isTie = ev.out === 'tie';
  const bomb = isTie && (ev.at === J.BOMB || ev.dt === J.BOMB);
  await board.animateMove(ev.from, ev.to, ev.out, { attackerCode: before[ev.from], defenderCode: ev.out === 'scout' ? displayBoard()[ev.to] : before[ev.to], stay: ev.stay });
  S.animating = false;
  if (S.game !== g || g.moves.length !== ply) { updateGameUI(); return; }
  board.setLastMove(ev.from, ev.to);
  if (ev.out === 'move') sfx.move();
  else if (ev.out === 'scout') sfx.select();
  else if (ev.out === 'flag') sfx.fanfare();
  else if (bomb) sfx.boom();
  else if (isTie) sfx.clash();
  else sfx.capture();
  if (ev.out !== 'move') {
    const v = viewer();
    let [text, cls] = OUT_POP[ev.out];
    if (v != null) {
      // 以自己的角度說
      const mine = ev.side === v;
      if (ev.out === 'win') text = mine ? (ev.stay ? '擊毀敵子！' : '吃掉敵子！') : '我方棋子被吃';
      if (ev.out === 'scout') text = mine ? `偵察到：${NAMES[ev.dt]}` : `我方${NAMES[ev.dt]}被敵機偵察`;
      if (ev.out === 'lose') text = mine ? '我方陣亡' : '擋下敵軍！';
      if (ev.out === 'win' && !mine && ev.dt === J.MINE) text = '地雷被挖掉了';
      if (ev.out === 'lose' && !mine && ev.dt === J.MINE) text = '敵軍誤觸地雷！';
      if (ev.out === 'flag') text = mine ? '奪下敵軍軍旗！' : '軍旗被奪…';
    } else if (bomb) text = '炸彈引爆，同歸於盡！';
    else if (ev.out === 'scout') text = `偵察：${NAMES[ev.dt]}`;
    popText(text, cls);
  }
  if (ev.cmdDead.length) {
    board.updateCodes(displayBoard());
    setTimeout(() => popText(`${ev.cmdDead.map((s) => SIDE_NAME[s]).join('、')}總司令陣亡，亮出軍旗！`, 'flag'), 700);
    chatSys(`${ev.cmdDead.map((s) => SIDE_NAME[s]).join('、')}總司令陣亡，依規則亮出軍旗位置。`);
  }
  updateGameUI();
  refreshInfer();
  if (g.result) await onGameOver();
  else {
    if (S.mode === 'net' && g.turn === S.mySide && !S.proxy[S.mySide]) { sfx.turn(); xk.win.attention('輪到您下棋', J.noteOf(ev, S.mySide)); }
    maybeAutoMove();
  }
}

// 玩家卡片：上方是對方（或藍軍），下方是自己（或紅軍）
const slotSide = (slot) => (slot === 'bottom' ? board.orientation : board.orientation ^ 1);

function deadOf(side) {
  const g = S.mode === 'replay' ? S.replay?.game : S.game;
  if (!g) return [];
  return g.pieces.filter((p) => p.side === side && !p.alive);
}

function updateGameUI() {
  const g = S.mode === 'replay' ? S.replay?.game : S.game;
  for (const slot of ['bottom', 'top']) {
    const side = slotSide(slot);
    const card = $(slot === 'bottom' ? '#pBottom' : '#pTop');
    card.querySelector('.pname').textContent = S.names[side] || SIDE_NAME[side];
    card.querySelector('.ptag').textContent = isPlayer() && side === S.mySide ? '（我）' : '';
    const pr = S.players[side];
    const proxied = !!S.proxy[side];
    card.classList.toggle('proxy', proxied);
    const img = card.querySelector('.pimg');
    const want = pr ? portraitUrl(proxied ? pr.advisor : pr.avatar) : '';
    if (img.getAttribute('src') !== want) img.setAttribute('src', want);
    img.classList.toggle('hidden', !pr);
    const advImg = card.querySelector('.padvimg');
    const advWant = pr ? portraitUrl(proxied ? pr.avatar : pr.advisor) : '';
    if (advImg.getAttribute('src') !== advWant) advImg.setAttribute('src', advWant);
    card.querySelector('.padv').classList.toggle('hidden', !pr);
    card.querySelector('.padvname').textContent = pr ? (proxied ? `主位暫離：${labelOf(pr.avatar)}` : `軍師 ${labelOf(pr.advisor)}`) : '';
    card.querySelector('.padv').title = isPlayer() && side === S.mySide ? '按一下更換陪同的 AI 軍師' : '';
    card.querySelector('.padv').onclick = isPlayer() && side === S.mySide ? () => changeAdvisor() : null;
    card.title = pr ? `${labelOf(pr.avatar)}．軍師 ${labelOf(pr.advisor)}` : '';
    card.querySelector('.pchip').textContent = side === 0 ? '紅' : '藍';
    card.classList.toggle('red', side === 0);
    card.classList.toggle('blue', side === 1);
    const active = S.phase === 'play' && g && !g.result && g.turn === side && S.mode !== 'replay' && S.mode !== 'idle';
    card.classList.toggle('active', !!active);
    card.classList.toggle('ready', S.phase === 'layout' && S.ready[side]);
    const caps = card.querySelector('.pcaps');
    caps.innerHTML = '';
    if (S.phase === 'layout') caps.append(h('span', { class: 'muted small' }, S.ready[side] ? '✔ 布陣完成' : '布陣中…'));
    else {
      const dead = deadOf(side);
      const v = viewer();
      if (dead.length) {
        if (v == null || side === v || S.kind === 'open') for (const p of dead.sort((a, b) => b.type - a.type)) caps.append(h('span', { class: 'pcap ' + (side === 0 ? 'r' : 'b') }, J.SHORT[p.type]));
        else caps.append(h('span', { class: 'muted small' }, `已陣亡 ${dead.length} 顆`));
      }
    }
  }
  // 戰況紀錄
  const list = $('#moveList');
  list.innerHTML = '';
  if (g) {
    const v = S.mode === 'replay' ? null : viewer();
    const cur = S.mode === 'replay' ? S.replay.ply : g.log.length;
    g.log.forEach((e, i) => {
      list.append(h('div', { class: 'mv-row one' + (e.out !== 'move' ? ' fight' : '') },
        h('span', { class: 'mv-no' }, `${i + 1}.`),
        h('span', { class: 'mv ' + (e.side === 0 ? 'red' : 'blue') + (cur === i + 1 ? ' cur' : ''), onclick: () => S.mode === 'replay' && replayGo(i + 1) }, J.noteOf(e, S.kind === 'open' ? null : v))));
    });
    list.scrollTop = list.scrollHeight;
  }
  $('#kindName').textContent = KIND_NAME[S.kind] || '';
  // 輪次提示
  const banner = $('#turnBanner');
  let text = '', cls = '';
  if (S.mode === 'replay') { text = `棋譜重播　第 ${S.replay.ply} / ${S.replay.game.moves.length} 步`; cls = 'replay'; }
  else if (S.mode === 'idle') { text = '請回首頁選擇對局模式'; cls = 'watch'; }
  else if (S.mode === 'net' && !(S.link && S.link.connected)) { text = S.netStatus || '等待對手連線…'; cls = 'watch'; }
  else if (S.phase === 'layout') {
    if (!S.ready[S.mySide]) { text = '請先布陣'; cls = 'mine'; }
    else { text = S.mode === 'net' ? '布陣完成，等待對方布陣…' : 'AI 布陣中…'; cls = 'watch'; }
  }
  else if (!g) { text = '準備中…'; cls = 'watch'; }
  else if (g.result) { text = resultText(g.result); cls = 'over'; }
  else if (S.mode === 'aivai') {
    text = S.paused ? `AI 對 AI．已暫停（輪到${SIDE_NAME[g.turn]}）` : `AI 對 AI．${SIDE_NAME[g.turn]}（${LEVELS[S.aivaiLevels[g.turn]].name}）推算中…`;
    cls = 'watch';
  }
  else if (S.mode === 'net' && !S.netStarted) { text = '對手已連線，準備開局…'; cls = 'watch'; }
  else if (g.turn === S.mySide && S.proxy[S.mySide]) { text = `${labelOf(S.players[S.mySide]?.advisor)}代打中`; cls = 'proxy'; }
  else if (g.turn === S.mySide) { text = '輪到您下棋'; cls = 'mine'; }
  else if (S.mode === 'net' && S.proxy[g.turn]) { text = '換您觀棋（對方由 AI 軍師代打）'; cls = 'watch'; }
  else { text = S.mode === 'ai' ? '換您觀棋（AI 推算中…）' : '換您觀棋（對方思考中）'; cls = 'watch'; }
  banner.textContent = text;
  banner.className = 'turn-banner ' + cls;
  board.setInteractive(S.phase === 'layout' ? isPlayer() && !S.ready[S.mySide] : canMove());
  // 布陣面板
  const setup = S.phase === 'layout' && isPlayer();
  $('#setupBox').classList.toggle('hidden', !setup);
  if (setup) {
    const done = S.ready[S.mySide];
    for (const id of ['#btnPreset', '#btnRandomLayout', '#btnAdviseLayout', '#btnLayoutDone', '#presetSel']) $(id).disabled = done;
    $('#setupState').textContent = done ? (S.mode === 'net' ? (S.ready[S.mySide ^ 1] ? '雙方完成' : '等待對方…') : '') : '';
  }
  // 按鈕
  const playing = isPlayer() && S.phase === 'play' && g && !g.result;
  $('#btnUndo').disabled = !playing || !g.moves.length || S.animating || (S.mode === 'ai' && S.aiThinking);
  $('#btnDraw').disabled = !playing || S.mode !== 'net';
  $('#btnResign').disabled = !playing;
  $('#btnHint').disabled = !playing || g.turn !== S.mySide || S.proxy[S.mySide];
  const proxyBtn = $('#btnProxy');
  proxyBtn.classList.toggle('hidden', !isPlayer());
  proxyBtn.disabled = !(isPlayer() && (S.phase === 'layout' || playing)) || (S.mode === 'net' && !(S.link && S.link.connected && S.netStarted));
  proxyBtn.textContent = S.proxy[S.mySide] ? '↩ 交還主位' : '🧙 軍師代打';
  proxyBtn.classList.toggle('on', !!S.proxy[S.mySide]);
  $('#btnPause').textContent = S.paused ? '▶ 繼續' : '⏸ 暫停';
  $('#btnPause').disabled = S.mode !== 'aivai' || !g || !!g.result;
  $('#btnNew').textContent = S.mode === 'net' ? '再來一局' : '新局';
  $('#btnNew').disabled = S.mode === 'replay' || S.mode === 'idle' || (S.mode === 'net' && !(g && g.result));
  $('#btnExport').disabled = !(g && g.moves.length);
  renderClocks();
}

function renderClocks() {
  for (const slot of ['bottom', 'top']) {
    const side = slotSide(slot);
    let ms = S.clocks[side] || 0;
    const g = S.game;
    if (g && !g.result && S.phase === 'play' && S.clockSide === side && (S.mode === 'ai' || S.mode === 'aivai' || (S.mode === 'net' && S.netStarted))) ms += Date.now() - S.clockStart;
    const s = Math.floor(ms / 1000);
    $(slot === 'bottom' ? '#pBottom' : '#pTop').querySelector('.pclock').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
}
function tickClock() { if (S.screen === 'game') renderClocks(); }

function flashBanner() {
  const b = $('#turnBanner');
  b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash');
}

function popText(text, cls = '') {
  const el = h('div', { class: 'pop ' + cls }, text);
  $('#boardWrap').append(el);
  setTimeout(() => el.remove(), 1700);
}

function resultText(r) {
  if (!r) return '';
  if (r.winner == null) return `和棋（${r.reason}）`;
  const mine = isPlayer() ? r.winner === S.mySide : null;
  return `${SIDE_NAME[r.winner]}勝${mine == null ? '' : mine ? '　🎉 您贏了！' : '　您輸了'}（${r.reason}）`;
}

async function onGameOver() {
  const g = S.game;
  const r = g.result;
  S.phase = 'over';
  board.setInteractive(false);
  board.setLabels(null);
  board.updateCodes(g.board); // 結束後全部翻開
  if (!isPlayer() || r.winner === S.mySide) sfx.win(); else if (r.winner != null) sfx.lose(); else sfx.move();
  await saveGame();
  updateGameUI();
  renderIntel();
  const btns = S.mode === 'ai' ? [{ label: '檢視棋盤', value: 'stay' }, { label: '再下一局', value: 'again', primary: true }]
    : S.mode === 'aivai' ? [{ label: '檢視棋盤', value: 'stay' }, { label: '再看一局', value: 'again', primary: true }]
    : [{ label: '知道了', value: 'stay', primary: true }];
  const title = !isPlayer() ? (r.winner == null ? '和棋' : '對局結束') : r.winner == null ? '和棋' : r.winner === S.mySide ? '恭喜獲勝！' : '這局輸了';
  const v = await modal(title, h('div', {},
    h('p', {}, resultText(r)),
    h('p', { class: 'muted small' }, '雙方棋子已全部翻開。本局棋譜已存入棋譜庫，AI 會學習對手的布陣習慣與打贏的布陣。')), btns);
  if (v === 'again') newGameSameMode();
}

function recordMeta() {
  return {
    id: S.gameId,
    mode: S.mode,
    red: S.names[0], blue: S.names[1],
    mySide: S.mode === 'aivai' ? '' : S.mySide === 0 ? 'red' : 'blue',
    level: S.mode === 'ai' ? LEVELS[S.levelIdx].name : S.mode === 'aivai' ? `${LEVELS[S.aivaiLevels[0]].name} 對 ${LEVELS[S.aivaiLevels[1]].name}` : '',
    players: S.players,
  };
}

async function saveGame() {
  if (S.saved || !S.game || !S.game.moves.length) return;
  if (!['ai', 'net', 'aivai'].includes(S.mode)) return;
  S.saved = true;
  const rec = S.game.toRecord(recordMeta());
  try {
    await xk.games.save(rec);
    if (rec.result !== '*') { S.learned.addRecord(rec); renderLearnStat(); }
  } catch (e) { toast('棋譜儲存失敗：' + errMsg(e), 'err'); }
}

async function saveUnfinished() {
  if (S.saved || !S.game || S.game.result || S.game.moves.length < 2) return;
  if (!['ai', 'net', 'aivai'].includes(S.mode)) return;
  S.saved = true;
  const rec = S.game.toRecord({ ...recordMeta(), reason: '未完成' });
  try { await xk.games.save(rec); } catch {}
}

async function leaveGame() {
  if (isPlayer() && S.game && !S.game.result && S.game.moves.length) {
    const ok = await modal('離開對局', S.mode === 'net' ? '離開會中斷與對手的連線，確定要離開嗎？' : '這局還沒下完，確定要離開嗎？（棋譜會保留）', [{ label: '繼續下棋', value: false }, { label: '離開', value: true, primary: true }]);
    if (!ok) return;
  }
  await saveUnfinished();
  closeNet();
  S.mode = null;
  S.phase = 'idle';
  S.game = null;
  stopReplayAuto();
  board.setZone(null); board.setLabels(null);
  document.body.classList.remove('mode-net', 'mode-ai', 'mode-replay', 'mode-aivai', 'kind-open', 'phase-layout');
  renderHome();
  showScreen('home');
}

function newGameSameMode() {
  if (S.mode === 'ai') startAIGame(S.lastAIChoice || 'red');
  else if (S.mode === 'aivai') startAIvAI(S.lastAivai);
  else if (S.mode === 'net') requestRematch();
}

// ---------------- 真人對 AI ----------------
async function startAIGame(choice) {
  if (!(await ensureProfile())) return;
  S.lastAIChoice = choice;
  const me = choice === 'blue' ? 1 : choice === 'red' ? 0 : (Math.random() < 0.5 ? 0 : 1);
  saveSettings({ aiSide: choice });
  const aiName = `小柯 AI（${LEVELS[S.levelIdx].name}）`;
  const myName = S.settings.playerName || '我';
  const mine = myProfile(), ai = randomProfile([mine.avatar, mine.advisor]);
  setupGame('ai', me, me === 0 ? [myName, aiName] : [aiName, myName], { players: me === 0 ? [mine, ai] : [ai, mine], first: 0 });
  enterLayout();
  // AI 同時布陣
  const g0 = S.gameId;
  const L = await engineAI.layout(S.levelIdx, learnedPlain());
  if (S.gameId !== g0) return;
  S.layouts[me ^ 1] = L;
  S.ready[me ^ 1] = true;
  board.setPosition(layoutBoard());
  if (S.swapSel >= 0) board.setSwapMark(J.sqOfLi(S.mySide, S.swapSel));
  updateGameUI();
  tryBeginPlay();
}

// ---------------- AI 對 AI ----------------
async function startAIvAI(cfg) {
  if (!(await ensureProfile())) return;
  cfg = cfg || { levels: [2, 3], speed: 'normal' };
  S.lastAivai = cfg;
  const names = [`紅軍 AI（${LEVELS[cfg.levels[0]].name}）`, `藍軍 AI（${LEVELS[cfg.levels[1]].name}）`];
  const p0 = randomProfile(), p1 = randomProfile([p0.avatar, p0.advisor]);
  setupGame('aivai', 0, names, { players: [p0, p1], first: 0 });
  S.aivaiLevels = cfg.levels.slice();
  S.aivaiDelay = (SPEEDS.find(([v]) => v === cfg.speed) || SPEEDS[1])[2];
  S.phase = 'layout';
  updateGameUI();
  showVersus();
  const g0 = S.gameId;
  const [L0, L1] = await Promise.all([engineAI.layout(cfg.levels[0], learnedPlain()), engineAna.layout(cfg.levels[1], learnedPlain())]);
  if (S.gameId !== g0) return;
  S.layouts = [L0, L1];
  S.ready = [true, true];
  await sleep(1200);
  if (S.gameId !== g0) return;
  beginPlay();
}

function togglePause() {
  if (S.mode !== 'aivai' || !S.game || S.game.result) return;
  S.paused = !S.paused;
  updateGameUI();
  if (!S.paused) maybeAutoMove();
}

function isAITurn() {
  const g = S.game;
  if (S.phase !== 'play' || !g || g.result || S.animating) return false;
  if (S.mode === 'aivai') return !S.paused;
  if (S.mode === 'ai') return g.turn !== S.mySide || !!S.proxy[S.mySide];
  if (S.mode === 'net') return g.turn === S.mySide && !!S.proxy[S.mySide] && !!(S.link && S.link.connected) && S.netStarted;
  return false;
}

function maybeAutoMove() { if (isAITurn() && !S.aiThinking) aiMove(); }

const proxyLevel = () => Math.min(S.settings.proxyLevel ?? 3, LEVELS.length - 1);

async function aiMove() {
  const g = S.game;
  if (!isAITurn() || S.aiThinking) return;
  const mode = S.mode;
  const turn = g.turn;
  const isProxy = mode !== 'aivai' && turn === S.mySide;
  S.aiThinking = true;
  updateGameUI();
  const t0 = Date.now();
  const levelIdx = mode === 'aivai' ? S.aivaiLevels[turn] : isProxy ? proxyLevel() : S.levelIdx;
  let move, info;
  try {
    // AI 只拿到自己那一方看得到的局面
    ({ move, info } = await engineAI.move(g.viewFor(turn), levelIdx, learnedPlain()));
  } catch (e) { console.error(e); move = g.legalMoves()[0]; info = '備用著法'; }
  const minWait = mode === 'aivai' ? S.aivaiDelay : isProxy ? 700 : 500;
  const wait = minWait - (Date.now() - t0);
  if (wait > 0) await sleep(wait);
  S.aiThinking = false;
  if (S.game !== g || S.mode !== mode || g.turn !== turn || !isAITurn()) { updateGameUI(); maybeAutoMove(); return; }
  const who = mode === 'aivai' ? S.names[turn] : isProxy ? `軍師 ${labelOf(S.players[turn]?.advisor)}` : 'AI';
  $('#aiInfo').textContent = `${who}：${info}`;
  if (move != null && move >= 0 && g.isLegal(move)) {
    if (mode === 'net') S.link.send({ t: 'move', ply: g.moves.length, mv: J.moveStr(move), proxy: true });
    await applyMove(move);
  } else updateGameUI();
}

function toggleProxy() {
  if (!isPlayer()) return;
  const g = S.game;
  if (g && g.result) return;
  const on = !S.proxy[S.mySide];
  S.proxy[S.mySide] = on;
  const adv = labelOf(S.players[S.mySide]?.advisor);
  if (S.mode === 'net') S.link.send({ t: 'proxy', on, advisor: S.players[S.mySide]?.advisor });
  if (on) { popText(`AI 軍師「${adv}」接手`, 'proxy'); chatSys(`您暫時離開，由 AI 軍師「${adv}」代打`); }
  else { popText('主位回來了', 'proxy'); chatSys('您已交還主位，換回自己下棋'); }
  updateGameUI();
  updateAdvisorHead();
  if (on && S.phase === 'layout') autoLayoutForProxy();
  maybeAutoMove();
}

// ---------------- 敵情推算 ----------------
async function refreshInfer() {
  const v = viewer();
  if (S.phase !== 'play' || v == null || S.kind === 'open' || !S.game) { S.infer = null; board.setLabels(null); renderIntel(); return; }
  const seq = ++S.inferSeq;
  const g = S.game;
  try {
    const r = await engineAna.infer(g.viewFor(v), learnedPlain(), 160);
    if (seq !== S.inferSeq || S.game !== g) return;
    S.infer = r;
    applyInferLabels();
    renderIntel();
  } catch (e) { console.warn(e); }
}

function applyInferLabels() {
  const g = S.game;
  if (!g || !S.infer || S.settings.showInfer === false || S.phase !== 'play') { board.setLabels(null); return; }
  const map = new Map();
  const v = viewer();
  for (let sq = 0; sq < J.NSQ; sq++) {
    const id = g.pid[sq];
    if (id < 0 || g.pieces[id].side === v) continue;
    const info = S.infer.pieces[id];
    if (!info) continue;
    if (g.flagShown[v ^ 1] && g.pieces[id].type === J.FLAG) continue;
    const exact = info.pTop >= 0.999;
    if (!exact && info.pTop < 0.3) continue;
    const text = exact ? NAMES[info.top] : `${J.SHORT[info.top]}？${Math.round(info.pTop * 100)}%`;
    map.set(sq, { text, color: exact ? '#ffd54f' : info.pTop >= 0.6 ? '#ffe082' : '#e0e0e0' });
  }
  board.setLabels(map);
}

function renderIntel() {
  const box = $('#intelPanel');
  if (!box) return;
  box.innerHTML = '';
  const g = S.mode === 'replay' ? S.replay?.game : S.game;
  const v = viewer();
  if (!g || v == null || S.kind === 'open') {
    box.append(h('p', { class: 'muted' }, S.kind === 'open' ? '明棋模式：雙方棋子都看得到，不需要推算。' : '觀戰與重播時雙方棋子全部公開。'));
    if (g) box.append(countTable(g, null));
    return;
  }
  const chk = h('input', { type: 'checkbox', checked: S.settings.showInfer !== false, onchange: async (e) => { await saveSettings({ showInfer: e.target.checked }); applyInferLabels(); } });
  box.append(
    h('div', { class: 'intel-head' }, h('b', {}, '🔍 敵情推算'), h('label', { class: 'chk small' }, chk, ' 在棋盤上標示')),
    h('p', { class: 'muted small' }, '根據對方棋子的起始位置、走過的路線、每次交戰裁判公布的勝負，以及偵察機翻開的結果，推算每顆暗子最可能是什麼（AI 也是用同樣的資訊，不會偷看）。'));
  if (!S.infer) { box.append(h('p', { class: 'muted' }, S.phase === 'play' ? '推算中…' : '開戰後開始推算。')); return; }
  box.append(countTable(g, v));
  // 確定或高機率的敵子
  const rows = [];
  for (let sq = 0; sq < J.NSQ; sq++) {
    const id = g.pid[sq];
    if (id < 0 || g.pieces[id].side === v) continue;
    const info = S.infer.pieces[id];
    if (!info) continue;
    const top3 = info.p.map((p, t) => [t, p]).filter(([, p]) => p > 0.04).sort((a, b) => b[1] - a[1]).slice(0, 3);
    rows.push({ sq, info, top3 });
  }
  rows.sort((a, b) => b.info.pTop - a.info.pTop);
  box.append(h('div', { class: 'intel-list' }, rows.slice(0, 25).map(({ sq, info, top3 }) => h('div', { class: 'intel-row' + (info.pTop >= 0.999 ? ' exact' : '') },
    h('span', { class: 'intel-sq' }, J.sqName(sq)),
    h('span', { class: 'intel-range' }, maskText(info.mask)),
    h('span', { class: 'intel-top' }, top3.map(([t, p]) => `${J.SHORT[t]} ${Math.round(p * 100)}%`).join('　'))))));
}

// 剩餘兵力表
function countTable(g, v) {
  const en = v == null ? null : v ^ 1;
  const table = h('table', { class: 'intel-table' });
  table.append(h('tr', {}, h('th', {}, '棋子'), h('th', {}, '數量'), en == null ? h('th', {}, '紅軍剩') : h('th', {}, '我方剩'), en == null ? h('th', {}, '藍軍剩') : h('th', {}, '敵方剩（推算）')));
  for (const t of J.ALL_TYPES) {
    const alive = (s) => g.pieces.filter((p) => p.side === s && p.alive && p.type === t).length;
    let enemyCell;
    if (en == null) enemyCell = String(alive(1));
    else {
      const exp = S.infer ? S.infer.remain[t] : null;
      enemyCell = exp == null ? '？' : (Math.abs(exp - Math.round(exp)) < 0.05 ? String(Math.round(exp)) : exp.toFixed(1));
    }
    table.append(h('tr', {}, h('td', {}, NAMES[t]), h('td', {}, String(J.COUNT[t])), h('td', {}, String(alive(en == null ? 0 : v))), h('td', {}, enemyCell)));
  }
  return table;
}

// ---------------- 悔棋、和棋、認輸、提示 ----------------
async function requestUndo() {
  const g = S.game;
  if (!g || g.result || !g.moves.length || S.animating) return;
  const n = g.turn === S.mySide ? 2 : 1;
  if (S.mode === 'ai') {
    if (S.aiThinking) return;
    doUndo(Math.min(n, g.moves.length));
    return;
  }
  if (S.mode === 'net') {
    if (n > g.moves.length) return;
    S.link.send({ t: 'undo-req', n, ply: g.moves.length });
    toast('已向對方提出悔棋請求…');
  }
}

function doUndo(n) {
  const g = S.game;
  if (!g) return;
  for (let i = 0; i < n; i++) g.undo();
  board.setPosition(displayBoard());
  const last = g.log[g.log.length - 1];
  board.setLastMove(last ? last.from : -1, last ? last.to : -1);
  board.setHint(-1);
  S.clockSide = g.turn;
  updateGameUI();
  refreshInfer();
  maybeAutoMove();
}

async function offerDraw() {
  if (S.mode !== 'net' || !S.game || S.game.result) return;
  S.link.send({ t: 'draw-req' });
  toast('已向對方提出和棋…');
}

async function resign() {
  const g = S.game;
  if (!g || g.result) return;
  const ok = await modal('認輸', '確定要認輸嗎？', [{ label: '取消', value: false }, { label: '認輸', value: true, primary: true }]);
  if (!ok) return;
  if (S.mode === 'net') S.link.send({ t: 'resign', ply: g.moves.length });
  g.resign(S.mySide);
  if (S.mode === 'ai') S.aiThinking = false;
  await onGameOver();
}

async function hint() {
  const g = S.game;
  if (!g || g.result || g.turn !== S.mySide) return;
  $('#btnHint').disabled = true;
  try {
    const list = await engineAna.analyze(g.viewFor(S.mySide), 3, learnedPlain(), 1);
    if (list[0] && S.game === g && g.turn === S.mySide) {
      showHint(list[0].move);
      const p = g.board[J.mvFrom(list[0].move)];
      toast(`提示：${NAMES[p & 31]} ${J.sqName(J.mvFrom(list[0].move))}→${J.sqName(J.mvTo(list[0].move))}`, 'ok');
    }
  } finally { updateGameUI(); }
}

function showHint(m) {
  if (m == null || m < 0) return;
  board.setHint(J.mvFrom(m), J.mvTo(m));
  clearTimeout(S.lastHintTimer);
  S.lastHintTimer = setTimeout(() => board.setHint(-1), 12000);
}

// ---------------- 真人對真人（遠端） ----------------
function netWait(el) {
  const w = $('#netWait');
  if (!w) return;
  w.classList.toggle('hidden', !el);
  w.innerHTML = '';
  if (el) w.append(el);
}

async function hostRoom(sideChoice) {
  if (!(await ensureProfile())) return;
  closeNet();
  S.hostSide = sideChoice;
  S.hostKind = S.kind;
  netWait(h('span', {}, '正在建立房間…'));
  const link = new GameLink(S.settings);
  S.link = link;
  try {
    const code = await link.host();
    netWait(h('div', {},
      h('div', { class: 'room-code' }, code.replace(/(\d{3})(\d{3})/, '$1 $2')),
      h('div', {}, `${KIND_NAME[S.kind]}房間已建立，請把房號告訴對方，對方在「加入房間」輸入即可。`),
      h('div', { class: 'net-row' },
        h('button', { onclick: () => { navigator.clipboard.writeText(code); toast('已複製房號', 'ok'); } }, '複製房號'),
        h('button', { onclick: () => { closeNet(); netWait(null); } }, '取消')),
      h('div', { class: 'muted small spin' }, '等待對手加入…')));
    bindLink(link);
  } catch (e) {
    netWait(h('span', { class: 'err' }, '建立房間失敗：' + errMsg(e)));
    S.link = null;
  }
}

async function joinRoom(code) {
  if (!(await ensureProfile())) return;
  closeNet();
  netWait(h('span', {}, '正在連線…'));
  const link = new GameLink(S.settings);
  S.link = link;
  bindLink(link);
  try { await link.join(code); }
  catch (e) {
    netWait(h('span', { class: 'err' }, errMsg(e)));
    S.link = null;
    link.close();
  }
}

function bindLink(link) {
  link.on('connected', () => {
    S.netStarted = false;
    link.send({ t: 'hello', name: S.settings.playerName || '棋友', ver: PROTOCOL, profile: myProfile() });
  });
  link.on('msg', (m) => onNetMsg(link, m));
  link.on('lost', (reason) => {
    if (S.link !== link) return;
    S.netStatus = '⚠ ' + reason + '，對局暫停';
    endVoice(false);
    if (S.screen === 'game' && S.mode === 'net') {
      chatSys(reason);
      updateGameUI();
      if (S.game && !S.game.result) toast('與對手的連線中斷了', 'err', 6000);
    } else netWait(h('span', { class: 'err' }, reason));
  });
  link.on('call', (call) => onVoiceCall(call));
}

function makeStart(hostSide) {
  const me = S.settings.playerName || '棋友';
  const names = hostSide === 0 ? [me, S.oppName] : [S.oppName, me];
  const opp = validProfile(S.oppProfile) ? S.oppProfile : randomProfile([myProfile().avatar]);
  const players = hostSide === 0 ? [myProfile(), opp] : [opp, myProfile()];
  return { t: 'start', kind: S.hostKind || S.kind, hostSide, gameId: newGameId(), names, players, first: 0 };
}

function startNetGame(m) {
  const mySide = S.link.role === 'host' ? m.hostSide : m.hostSide ^ 1;
  setupGame('net', mySide, m.names, { kind: m.kind, first: m.first || 0, gameId: m.gameId, players: Array.isArray(m.players) && m.players.length === 2 ? m.players.map((p) => (validProfile(p) ? p : randomProfile())) : null });
  if (Array.isArray(m.proxy)) S.proxy = m.proxy.map(Boolean);
  S.netStarted = true;
  S.netStatus = '';
  S.curHostSide = m.hostSide;
  S.curStart = { ...m, layouts: undefined, moves: undefined, ready: undefined };
  netWait(null);
  if (Array.isArray(m.layouts) && m.layouts.every((L) => L && !J.validateLayout(L))) {
    // 斷線重連：直接回到對局
    S.layouts = m.layouts.map((L) => L.slice());
    S.ready = [true, true];
    beginPlay(m.moves || []);
    chatSys('已重新連線，回到對局');
    return;
  }
  enterLayout();
  if (Array.isArray(m.ready)) {
    // 重連時對方可能已經布陣完成
    m.ready.forEach((r, s) => { if (r && m.oppLayouts && m.oppLayouts[s]) { S.layouts[s] = m.oppLayouts[s]; S.ready[s] = true; } });
  }
  chatSys(`${KIND_NAME[S.kind]}對局！您是${SIDE_NAME[mySide]}${mySide === 0 ? '（先走）' : '（後走）'}，請先布陣。`);
  updateGameUI();
  xk.win.attention('對局開始', `請布陣，您是${SIDE_NAME[mySide]}`);
}

async function onNetMsg(link, m) {
  const g = S.game;
  switch (m.t) {
    case 'busy':
      netWait(h('span', { class: 'err' }, '這個房間已經有人在下棋了'));
      link.close(); S.link = null;
      break;
    case 'old':
      netWait(h('span', { class: 'err' }, m.text || '版本不相容'));
      toast(m.text || '版本不相容', 'err', 8000);
      break;
    case 'hello':
      S.oppName = String(m.name || '對手').slice(0, 16);
      S.oppProfile = validProfile(m.profile) ? { avatar: m.profile.avatar, advisor: m.profile.advisor } : null;
      if (link.role === 'host') {
        if (S.mode === 'net' && S.curStart && (S.phase === 'play' || S.phase === 'layout') && !(g && g.result)) {
          // 斷線重連：把目前狀態送給對方
          const msg = { ...S.curStart, proxy: S.proxy };
          if (S.phase === 'play') { msg.layouts = S.layouts; msg.moves = g.moves.map(J.moveStr); }
          else { msg.ready = S.ready; msg.oppLayouts = S.ready.map((r, s) => (r && s === S.mySide ? S.layouts[s] : null)); }
          link.send(msg);
          S.netStatus = '';
          chatSys('對手已重新連線');
          updateGameUI();
        } else {
          const hostSide = S.hostSide === 'red' ? 0 : S.hostSide === 'blue' ? 1 : (Math.random() < 0.5 ? 0 : 1);
          const start = makeStart(hostSide);
          link.send(start);
          startNetGame(start);
        }
      }
      break;
    case 'start':
      if (link.role === 'guest') startNetGame(m);
      break;
    case 'layout': {
      if (S.mode !== 'net' || !Array.isArray(m.L) || J.validateLayout(m.L)) return;
      if (m.gameId && m.gameId !== S.gameId) return;
      const opp = S.mySide ^ 1;
      if (S.phase === 'layout') {
        S.layouts[opp] = m.L.slice();
        S.ready[opp] = true;
        board.setPosition(layoutBoard());
        if (S.swapSel >= 0) board.setSwapMark(J.sqOfLi(S.mySide, S.swapSel));
        chatSys(`${S.oppName || '對方'}布陣完成`);
        tryBeginPlay();
      }
      break;
    }
    case 'move': {
      if (!g || S.mode !== 'net' || g.result) return;
      if (m.ply !== g.moves.length || g.turn === S.mySide) { link.send({ t: 'sync-req' }); return; }
      const mv = J.strMove(m.mv);
      if (mv < 0 || !g.isLegal(mv)) { link.send({ t: 'sync-req' }); return; }
      await applyMove(mv);
      break;
    }
    case 'sync-req':
      if (g && S.curStart) link.send({ t: 'sync', layouts: S.layouts, moves: g.moves.map(J.moveStr) });
      break;
    case 'sync':
      if (link.role === 'guest' && S.curStart && Array.isArray(m.layouts)) {
        S.layouts = m.layouts.map((L) => L.slice());
        S.ready = [true, true];
        S.game = null;
        beginPlay(m.moves || []);
      }
      break;
    case 'proxy': {
      const oppIdx = S.mySide ^ 1;
      S.proxy[oppIdx] = !!m.on;
      const pr = S.players[oppIdx];
      const adv = labelOf(m.advisor || pr?.advisor);
      if (m.on) {
        popText(`對方換由 AI 軍師「${adv}」代打`, 'proxy');
        chatSys(`${S.oppName || '對方'} 暫時離開，主位換由 AI 軍師「${adv}」代打`);
      } else {
        popText(`${S.oppName || '對方'} 回到主位`, 'proxy');
        chatSys(`${S.oppName || '對方'} 回來了，換回「${labelOf(pr?.avatar)}」親自下棋`);
      }
      xk.win.attention('主位換人', m.on ? `對方改由 AI 軍師「${adv}」代打` : '對方回到主位');
      updateGameUI();
      break;
    }
    case 'advisor': {
      const oppIdx = S.mySide ^ 1;
      if (S.players[oppIdx] && validProfile({ avatar: S.players[oppIdx].avatar, advisor: m.advisor })) {
        S.players[oppIdx] = { ...S.players[oppIdx], advisor: m.advisor };
        chatSys(`${S.oppName || '對方'} 改由 AI 軍師「${labelOf(m.advisor)}」陪同`);
        updateGameUI();
      }
      break;
    }
    case 'undo-req': {
      if (!g || g.result) return;
      if (S.proxy[S.mySide]) { link.send({ t: 'undo-no' }); link.send({ t: 'chat', text: '（AI 軍師代打中，主位暫時離開，無法回覆悔棋）' }); return; }
      const ok = await modal('悔棋請求', `${S.oppName} 想要悔棋（退回 ${m.n} 步），同意嗎？`, [{ label: '不同意', value: false }, { label: '同意', value: true, primary: true }], { timeout: 30000, timeoutValue: false });
      if (ok && S.game === g && g.moves.length === m.ply) { link.send({ t: 'undo-ok', n: m.n }); doUndo(m.n); chatSys(`同意對方悔棋 ${m.n} 步`); }
      else link.send({ t: 'undo-no' });
      break;
    }
    case 'undo-ok': if (g) { doUndo(m.n); toast('對方同意悔棋', 'ok'); chatSys(`悔棋 ${m.n} 步`); } break;
    case 'undo-no': toast('對方不同意悔棋'); break;
    case 'draw-req': {
      if (!g || g.result) return;
      if (S.proxy[S.mySide]) { link.send({ t: 'draw-no' }); return; }
      const ok = await modal('和棋提議', `${S.oppName} 提議和棋，同意嗎？`, [{ label: '繼續下', value: false }, { label: '同意和棋', value: true, primary: true }], { timeout: 30000, timeoutValue: false });
      if (ok && !g.result) { link.send({ t: 'draw-ok' }); g.agreeDraw(); await onGameOver(); }
      else link.send({ t: 'draw-no' });
      break;
    }
    case 'draw-ok': if (g && !g.result) { g.agreeDraw(); await onGameOver(); } break;
    case 'draw-no': toast('對方不同意和棋，繼續下棋'); break;
    case 'resign':
      if (g && !g.result) { g.resign(S.mySide ^ 1); await onGameOver(); }
      break;
    case 'rematch-req': {
      if (S.proxy[S.mySide]) { link.send({ t: 'rematch-no' }); break; }
      const ok = await modal('再來一局', `${S.oppName} 想再下一局（紅藍交換），同意嗎？`, [{ label: '不要', value: false }, { label: '好啊', value: true, primary: true }], { timeout: 45000, timeoutValue: false });
      if (!ok) { link.send({ t: 'rematch-no' }); break; }
      if (link.role === 'host') startRematchAsHost();
      else link.send({ t: 'rematch-ok' });
      break;
    }
    case 'rematch-ok': if (link.role === 'host') startRematchAsHost(); break;
    case 'rematch-no': toast('對方暫時不想再下'); break;
    case 'chat': chatLine('opp', String(m.text || '').slice(0, 500)); if (S.screen === 'game' && !$('#pane-chat').classList.contains('on')) $('.tab[data-tab="chat"]').classList.add('ping'); break;
    case 'voice-end': endVoice(true); break;
    case 'voice-reject': toast('對方沒有接聽語音'); endVoice(false); break;
  }
}

function requestRematch() {
  if (!S.link || !S.link.connected) { toast('對手已離線', 'err'); return; }
  S.link.send({ t: 'rematch-req' });
  toast('已邀請對方再下一局…');
}

async function startRematchAsHost() {
  await saveUnfinished();
  const start = makeStart((S.curHostSide ?? 0) ^ 1);
  S.link.send(start);
  startNetGame(start);
}

function closeNet() {
  endVoice(false, true);
  if (S.link) { S.link.close(); S.link = null; }
  S.netStarted = false;
  S.curStart = null;
}

// ---------------- 文字聊天 ----------------
function chatLine(who, text) {
  const log = $('#chatLog');
  log.append(h('div', { class: 'chat-msg ' + who }, h('b', {}, who === 'me' ? '我' : (S.oppName || '對手')), h('span', {}, text)));
  log.scrollTop = log.scrollHeight;
}
function chatSys(text) {
  const log = $('#chatLog');
  log.append(h('div', { class: 'chat-msg sys' }, text));
  log.scrollTop = log.scrollHeight;
}
function sendChat() {
  const inp = $('#chatInput');
  const text = inp.value.trim();
  if (!text || !S.link || !S.link.connected) return;
  S.link.send({ t: 'chat', text });
  chatLine('me', text);
  inp.value = '';
}

// ---------------- 語音通話 ----------------
async function getMic() {
  await xk.sys.askMicrophone();
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
}

function setVoiceUI(state) {
  $('#voiceState').textContent = { off: '語音：未通話', calling: '語音：撥號中…', on: '🟢 語音通話中' }[state];
  $('#btnVoice').textContent = state === 'off' ? '🎤 語音通話' : '⏹ 結束通話';
  $('#btnMute').classList.toggle('hidden', state !== 'on');
  $('#voiceBar').classList.toggle('on', state === 'on');
  music.setDuck(state === 'on');
}

async function toggleVoice() {
  if (S.voice.call || S.voice.mic) { endVoice(false, true); return; }
  if (!S.link || !S.link.connected) { toast('尚未連線到對手', 'err'); return; }
  try {
    S.voice.mic = await getMic();
    setVoiceUI('calling');
    setupCall(S.link.call(S.voice.mic));
  } catch (e) { toast('無法開啟麥克風：' + errMsg(e), 'err'); endVoice(false); }
}

async function onVoiceCall(call) {
  if (S.voice.call) { call.close(); return; }
  xk.win.attention('語音通話邀請', `${S.oppName || '對手'} 邀請您語音通話`);
  const ok = await modal('語音通話邀請', `${S.oppName || '對手'} 邀請您語音通話，要接聽嗎？`, [{ label: '拒絕', value: false }, { label: '接聽', value: true, primary: true }], { timeout: 45000, timeoutValue: false });
  if (!ok) { call.close(); S.link && S.link.send({ t: 'voice-reject' }); return; }
  try {
    S.voice.mic = await getMic();
    call.answer(S.voice.mic);
    setupCall(call);
  } catch (e) { toast('無法開啟麥克風：' + errMsg(e), 'err'); call.close(); S.link && S.link.send({ t: 'voice-reject' }); }
}

function setupCall(call) {
  S.voice.call = call;
  call.on('stream', (s) => { const a = $('#remoteAudio'); a.srcObject = s; a.play().catch(() => {}); setVoiceUI('on'); chatSys('語音通話已接通'); });
  call.on('close', () => { if (S.voice.call === call) endVoice(false); });
  call.on('error', () => { if (S.voice.call === call) endVoice(false); });
}

function toggleMute() {
  if (!S.voice.mic) return;
  const t = S.voice.mic.getAudioTracks()[0];
  t.enabled = !t.enabled;
  $('#btnMute').textContent = t.enabled ? '🔇 靜音' : '🔈 取消靜音';
}

function endVoice(remote, notify) {
  const had = !!(S.voice.call || S.voice.mic);
  if (notify && S.link) S.link.send({ t: 'voice-end' });
  if (S.voice.call) { try { S.voice.call.close(); } catch {} S.voice.call = null; }
  if (S.voice.mic) { S.voice.mic.getTracks().forEach((t) => t.stop()); S.voice.mic = null; }
  const a = $('#remoteAudio'); if (a) a.srcObject = null;
  if (music) setVoiceUI('off');
  if (had && S.screen === 'game') chatSys(remote ? '對方結束了語音通話' : '語音通話已結束');
}

// ---------------- 棋譜庫 ----------------
const MODE_NAME = { ai: '真人對 AI', net: '真人對真人', aivai: 'AI 對 AI', import: '匯入' };
const RESULT_NAME = { red: '紅軍勝', blue: '藍軍勝', draw: '和棋' };
async function renderRecords() {
  const body = $('#recordsBody');
  body.innerHTML = '';
  const list = await xk.games.list();
  body.append(h('div', { class: 'rec-head' },
    h('div', {}, h('h2', {}, '📜 棋譜庫'), h('p', { class: 'learn-stat muted' })),
    h('div', { class: 'rec-actions' },
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: S.settings.learnFromGames !== false, onchange: async (e) => { await saveSettings({ learnFromGames: e.target.checked }); toast(e.target.checked ? 'AI 會參考棋譜庫' : 'AI 不再參考棋譜庫'); } }), ' AI 參考棋譜庫'),
      h('button', { onclick: importRecords }, '匯入棋譜'),
      h('button', { onclick: () => showScreen('home') }, '返回首頁'))));
  if (!list.length) {
    body.append(h('div', { class: 'empty' }, '還沒有棋譜。每下完一局都會自動收錄在這裡；AI 會從棋譜中學習對手的布陣習慣與打贏過的布陣，越下越聰明。也可以「匯入棋譜」（本程式匯出的文字檔或 JSON）。'));
  } else {
    const table = h('table', { class: 'rec-table' },
      h('thead', {}, h('tr', {}, ...['日期', '模式', '類型', '紅軍', '藍軍', '結果', '步數', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, list.map((g) => h('tr', {},
        h('td', {}, fmtDate(g.date)),
        h('td', {}, g.kind === 'open' ? '明棋' : '暗棋'),
        h('td', {}, MODE_NAME[g.mode] || (g.source === 'import' ? '匯入' : g.mode || '')),
        h('td', {}, g.red || ''), h('td', {}, g.blue || ''),
        h('td', { class: 'res', title: g.reason || '' }, (RESULT_NAME[g.result] || '未完成') + (g.reason && g.result !== '*' ? `（${g.reason}）` : '')),
        h('td', {}, String(g.plies)),
        h('td', { class: 'ops' },
          h('button', { onclick: () => openReplay(g.id) }, '重播'),
          h('button', { onclick: () => exportRecord(g.id) }, '匯出'),
          h('button', { class: 'danger', onclick: async () => { if (await modal('刪除棋譜', '確定刪除這份棋譜？', [{ label: '取消', value: false }, { label: '刪除', value: true, primary: true }])) { await xk.games.delete(g.id); await rebuildLearned(); renderRecords(); } } }, '刪除'))))));
    body.append(h('div', { class: 'rec-wrap' }, table));
  }
  renderLearnStat();
}

// 布陣文字：54 個字（空格、行營用「．」；每 9 個字一列，從底線往前）
const LCH = J.LAYOUT_CHARS;
const layoutText = (L) => L.map((t) => LCH[t] || '．').join('');
const parseLayoutText = (s) => { const chars = [...String(s).replace(/\s/g, '')]; if (chars.length !== J.LSIZE) return null; const L = chars.map((ch) => (ch === '.' ? 0 : LCH.indexOf(ch))); return L.some((x) => x < 0) || J.validateLayout(L) ? null : L; };

function recordText(rec) {
  const g = J.replayRecord(rec);
  const lines = ['[小柯機器人三軍棋遊戲 棋譜]', `日期：${fmtDate(rec.date)}`, `紅軍：${rec.red || ''}`, `藍軍：${rec.blue || ''}`, `類型：${rec.kind === 'open' ? '明棋' : '暗棋'}`,
    `結果：${RESULT_NAME[rec.result] || '未完成'}${rec.reason ? '（' + rec.reason + '）' : ''}`,
    `紅軍布陣：${layoutText(rec.layouts[0])}`, `藍軍布陣：${layoutText(rec.layouts[1])}`, `先走：${SIDE_NAME[rec.first || 0]}`, ''];
  g.log.forEach((e, i) => lines.push(`${i + 1}. ${SIDE_NAME[e.side][0]} ${J.noteOf(e, null)}`));
  lines.push('', `著法：${(rec.moves || []).join(' ')}`);
  return lines.join('\r\n');
}

async function importRecords() {
  const files = await xk.games.pickImport();
  if (!files.length) return;
  let ok = 0, bad = 0;
  for (const f of files) {
    if (f.error) { bad++; continue; }
    try {
      const t = f.text.trim();
      let recs = [];
      if (t.startsWith('{') || t.startsWith('[')) {
        const j = JSON.parse(t);
        recs = (Array.isArray(j) ? j : [j]).map((r) => ({ ...r, id: undefined }));
      } else {
        const L0 = parseLayoutText((/紅軍布陣[:：]\s*(\S+)/.exec(t) || [])[1]);
        const L1 = parseLayoutText((/藍軍布陣[:：]\s*(\S+)/.exec(t) || [])[1]);
        const mv = /著法[:：]\s*([^\r\n]*)/.exec(t);
        if (!L0 || !L1) { bad++; continue; }
        const r = { layouts: [L0, L1], moves: mv ? mv[1].trim().split(/\s+/).filter(Boolean) : [], kind: /類型[:：]\s*明棋/.test(t) ? 'open' : 'dark', first: /先走[:：]\s*藍軍/.test(t) ? 1 : 0 };
        r.red = ((/紅軍[:：]\s*(.+)/.exec(t) || [])[1] || '').trim().slice(0, 20);
        r.blue = ((/藍軍[:：]\s*(.+)/.exec(t) || [])[1] || '').trim().slice(0, 20);
        recs = [r];
      }
      for (const r of recs) {
        if (!Array.isArray(r.layouts) || r.layouts.some((L) => J.validateLayout(L))) { bad++; continue; }
        const g = J.replayRecord(r);
        const rec = g.toRecord({ mode: 'import', source: 'import', red: r.red || f.name, blue: r.blue || '' });
        if (r.result && rec.result === '*') { rec.result = r.result; rec.reason = r.reason || ''; }
        await xk.games.save(rec);
        ok++;
      }
    } catch { bad++; }
  }
  await rebuildLearned();
  toast(`匯入 ${ok} 份棋譜${bad ? `，${bad} 份無法辨識` : ''}`, ok ? 'ok' : 'err');
  renderRecords();
}

async function exportRecord(id) {
  const rec = await xk.games.get(id);
  if (!rec) return;
  const clean = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '');
  const p = await xk.games.export(`三軍棋棋譜_${clean(rec.red) || '紅軍'}_vs_${clean(rec.blue) || '藍軍'}_${(rec.id || '').slice(0, 8)}.txt`, recordText(rec));
  if (p) toast('已匯出：' + p, 'ok', 5000);
}

async function exportCurrent() {
  if (S.mode === 'replay') return exportRecord(S.replay.rec.id);
  const g = S.game;
  if (!g || !g.moves.length) return;
  if (isPlayer() && S.kind === 'dark' && !g.result) { toast('對局結束後才能匯出（避免洩漏雙方布陣）', 'info'); return; }
  const rec = g.toRecord(recordMeta());
  const p = await xk.games.export(`三軍棋棋譜_${S.gameId.slice(0, 8)}.txt`, recordText(rec));
  if (p) toast('已匯出：' + p, 'ok', 5000);
}

// ---------------- 棋譜重播 ----------------
async function openReplay(id) {
  const rec = await xk.games.get(id);
  if (!rec || !Array.isArray(rec.layouts)) return;
  const full = J.replayRecord(rec);
  const recPlayers = Array.isArray(rec.players) && rec.players.length === 2 && rec.players.every(validProfile) ? rec.players : null;
  setupGame('replay', 0, [rec.red || '紅軍', rec.blue || '藍軍'], { kind: rec.kind, players: recPlayers, first: rec.first || 0 });
  S.replay = { rec, full, game: J.replayRecord(rec, 0), ply: 0, timer: 0 };
  S.phase = 'play';
  replayGo(0);
  if (full.result) toast(resultText(full.result));
}

function replayGo(ply) {
  const r = S.replay;
  if (!r) return;
  ply = Math.max(0, Math.min(r.full.moves.length, ply));
  const forwardOne = ply === r.ply + 1;
  const prev = r.game;
  const g = J.replayRecord(r.rec, ply);
  r.ply = ply;
  r.game = g;
  if (forwardOne) {
    const ev = g.log[ply - 1];
    const before = prev.viewFor(null).board;
    board.animateMove(ev.from, ev.to, ev.out, { attackerCode: before[ev.from], defenderCode: before[ev.to], stay: ev.stay });
    if (ev.out === 'move' || ev.out === 'scout') sfx.move(); else if (ev.out === 'flag') sfx.fanfare(); else if (ev.out === 'tie') sfx.boom(); else sfx.capture();
  } else board.setPosition(g.viewFor(null).board);
  const last = g.log[g.log.length - 1];
  board.setLastMove(last ? last.from : -1, last ? last.to : -1);
  if (ply === r.full.moves.length && r.full.result) g.result = r.full.result;
  updateGameUI();
}

function replayAuto() {
  const r = S.replay;
  if (!r) return;
  if (r.timer) { stopReplayAuto(); return; }
  $('#rpPlay').textContent = '⏸';
  r.timer = setInterval(() => {
    if (r.ply >= r.full.moves.length) { stopReplayAuto(); return; }
    replayGo(r.ply + 1);
  }, 1300);
}
function stopReplayAuto() {
  if (S.replay && S.replay.timer) { clearInterval(S.replay.timer); S.replay.timer = 0; }
  const b = $('#rpPlay'); if (b) b.textContent = '▶';
}

// ---------------- 遊戲說明 ----------------
let guide = null;
function openGuide(which = 'rules') {
  if (!guide) guide = new Guide($('#guideBody'), { settings: S.settings, save: (p) => saveSettings(p), onBack: () => showScreen('home') });
  showScreen('guide');
  guide.open(which);
  window.__guide = guide;
}

// ---------------- 關於與版本更新 ----------------
async function openAbout() {
  const status = h('div', { class: 'upd-status muted' }, '正在檢查是否有新版本…');
  const body = h('div', { class: 'about' },
    h('div', { class: 'about-head' }, h('img', { class: 'about-icon', src: '../../assets/icon-256.png' }),
      h('div', {}, h('h2', {}, '小柯機器人三軍棋遊戲'), h('div', { class: 'muted' }, `版本 v${S.info.version}　（${S.info.platform === 'darwin' ? 'macOS' : S.info.platform === 'win32' ? 'Windows' : S.info.platform === 'ios' ? 'iPad／iPhone' : S.info.platform === 'android' ? 'Android' : S.info.platform === 'web' ? '線上版（網頁）' : S.info.platform}）`))),
    h('p', { class: 'credit-line' }, CREDIT),
    h('p', { class: 'muted small' }, '3D 陸海空三軍棋：陸軍、海軍、空軍共 33 顆棋子；暗棋裁判制與明棋；真人對 AI、真人對真人（遠端連線＋語音）、AI 對 AI；AI 推算敵情、棋譜累積學習；動畫語音教學；20 首原創背景音樂；70 位頭像與 AI 軍師。'),
    h('p', { class: 'muted small' }, '規則參考：github.com/code-fans/kriegspiel（陸軍棋規則）＋台灣傳統三軍棋'),
    h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: S.settings.autoUpdate !== false, onchange: (e) => saveSettings({ autoUpdate: e.target.checked }) }), ' 開啟程式時自動檢查新版本'),
    status);
  const p = modal('關於與更新', body, [{ label: '關閉', value: false, primary: true }]);
  checkUpdate(true, status);
  await p;
}

async function checkUpdate(manual, statusEl) {
  let info;
  try { info = await xk.update.check(); }
  catch (e) {
    if (statusEl) statusEl.textContent = '無法檢查更新：' + errMsg(e);
    return;
  }
  if (!info.newer) {
    if (statusEl) statusEl.textContent = `✅ 已經是最新版本（v${info.current}）`;
    return;
  }
  const go = () => startUpdate(info);
  if (statusEl) {
    statusEl.innerHTML = '';
    statusEl.append(h('span', {}, `🔔 有新版本 v${info.latest}（目前 v${info.current}）　`),
      h('button', { class: 'primary', id: 'btnDoUpdate', onclick: () => { $$('.modal-back').forEach((b) => b.remove()); go(); } }, '立即更新'));
    return;
  }
  const v = await modal(`發現新版本 v${info.latest}`, h('div', {},
    h('p', {}, `目前版本 v${info.current}，要更新到 v${info.latest} 嗎？`),
    info.notes ? h('pre', { class: 'upd-notes' }, info.notes) : null), [{ label: '稍後再說', value: false }, { label: '立即更新', value: true, primary: true }]);
  if (v) go();
}

async function startUpdate(info) {
  if (!info.canInstall) {
    const v = await modal('下載新版本', h('p', {}, info.flavor === 'dev' ? '目前是開發版，請到 GitHub 下載安裝檔。' : info.flavor === 'ios' ? (info.asset ? '會用 Safari 開啟安裝頁，按「安裝」即可更新，棋譜與設定都會保留。' : '這一版還沒有 iPad／iPhone 安裝檔，請稍後再檢查。') : '找不到這個平台的安裝檔，請到 GitHub 下載。'), [{ label: '取消', value: false }, { label: '開啟下載頁', value: true, primary: true }]);
    if (v) xk.update.openPage();
    return;
  }
  const bar = h('div', { class: 'upd-bar' }, h('div', { class: 'upd-fill' }));
  const txt = h('div', { class: 'muted small' }, '準備下載…');
  const box = h('div', { class: 'upd-box' }, h('b', {}, `正在下載 v${info.latest}`), bar, txt);
  document.body.append(box);
  const off = xk.update.onProgress(({ got, total }) => {
    const pct = total ? Math.floor((got / total) * 100) : 0;
    bar.firstChild.style.width = pct + '%';
    txt.textContent = `${(got / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB（${pct}%）`;
  });
  try {
    const file = await xk.update.download();
    off();
    if (S.game && ['ai', 'net', 'aivai'].includes(S.mode)) await saveUnfinished();
    txt.textContent = info.flavor === 'mac' ? '下載完成，正在開啟安裝檔…' : info.flavor === 'android' ? '下載完成，正在開啟安裝畫面…' : '下載完成，正在安裝，程式會自動重新開啟…';
    const r = await xk.update.install(file);
    if (r.manual) {
      box.remove();
      await modal('請完成安裝', h('div', {},
        h('p', {}, info.flavor === 'android' ? '新版 APK 已下載。' : '新版安裝檔已開啟（也放在「下載」資料夾）。'),
        h('p', {}, info.flavor === 'mac' ? '請先結束本程式，再把「小柯機器人三軍棋遊戲」拖到「應用程式」資料夾覆蓋舊版。'
          : info.flavor === 'android' ? '請在手機跳出的安裝畫面按「更新」。如果出現「為了安全，手機不允許安裝」，請按「設定」允許本 App 安裝，再回來按一次更新。' : '請依照畫面指示完成安裝。')));
    }
  } catch (e) {
    off();
    box.remove();
    toast('更新失敗：' + errMsg(e), 'err', 8000);
  }
}

// ---------------- 設定 ----------------
async function openSettings() {
  const s = S.settings;
  const f = {};
  const row = (label, el, tip) => h('div', { class: 'set-row' }, h('label', {}, label), el, tip ? h('div', { class: 'muted small' }, tip) : null);
  f.name = h('input', { value: s.playerName });
  f.sfx = h('input', { type: 'checkbox', checked: s.sfx });
  f.autoplay = h('input', { type: 'checkbox', checked: s.music.autoplay });
  f.autoUpdate = h('input', { type: 'checkbox', checked: s.autoUpdate !== false });
  f.showInfer = h('input', { type: 'checkbox', checked: s.showInfer !== false });
  f.proxyLevel = h('select', {}, LEVELS.map((l, i) => h('option', { value: i, selected: i === (s.proxyLevel ?? 3) }, l.name)));
  f.key = h('input', { type: 'password', placeholder: s.advisor.hasKey ? '（已設定，留空表示不變更）' : 'sk-ant-…' });
  f.model = h('select', {}, ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].map((m) => h('option', { value: m, selected: s.advisor.model === m }, m)));
  f.effort = h('select', {}, [['low', '快速（low）'], ['medium', '一般（medium）'], ['high', '深入（high）']].map(([v, l]) => h('option', { value: v, selected: s.advisor.effort === v }, l)));
  f.srvMode = h('select', {}, h('option', { value: 'public', selected: s.server.mode !== 'custom' }, '公用配對伺服器（PeerJS Cloud）'), h('option', { value: 'custom', selected: s.server.mode === 'custom' }, '自架伺服器'));
  f.host = h('input', { value: s.server.host, placeholder: '例如 peer.example.com' });
  f.port = h('input', { value: s.server.port, type: 'number', style: { width: '90px' } });
  f.path = h('input', { value: s.server.path, style: { width: '90px' } });
  f.secure = h('input', { type: 'checkbox', checked: s.server.secure });
  f.stun = h('textarea', { rows: 2, value: s.stun });
  f.turnUrls = h('input', { value: s.turn.urls, placeholder: 'turn:turn.example.com:3478' });
  f.turnUser = h('input', { value: s.turn.username, placeholder: '帳號' });
  f.turnPass = h('input', { type: 'password', value: s.turn.credential, placeholder: '密碼' });
  const testOut = h('div', { class: 'muted small' });
  const updStatus = h('div', { class: 'upd-status muted small', id: 'setUpdStatus' }, '按「檢查更新」查詢 GitHub 上的最新版本');
  const body = h('div', { class: 'settings' },
    h('h4', {}, '一般'),
    row('我的暱稱', f.name),
    row('音效', h('label', { class: 'chk' }, f.sfx, ' 走棋、交戰、爆炸音效')),
    row('背景音樂', h('label', { class: 'chk' }, f.autoplay, ' 開啟程式後自動播放')),
    row('敵情推算', h('label', { class: 'chk' }, f.showInfer, ' 在棋盤上標示對方暗子最可能是什麼')),
    row('版本更新', h('label', { class: 'chk' }, f.autoUpdate, ' 開啟程式時自動檢查新版本')),
    row(`目前版本 v${S.info.version}`, h('div', { class: 'inline' },
      h('button', { id: 'btnCheckUpdate', onclick: () => { updStatus.textContent = '正在檢查是否有新版本…'; checkUpdate(true, updStatus); } }, '🔄 檢查更新'),
      updStatus)),
    row('頭像與 AI 軍師', h('button', { onclick: async () => { await ensureProfile(true); } }, '更換頭像與軍師')),
    row('軍師代打的棋力', f.proxyLevel, '暫時離開時，AI 軍師用這個難度替您下棋（也會替您布陣）。'),
    h('h4', {}, 'AI 軍師（Claude）'),
    row('Anthropic API 金鑰', f.key, s.advisor.envKey && !s.advisor.hasKey ? '已偵測到環境變數 ANTHROPIC_API_KEY。' : '金鑰會加密存在本機，只用來呼叫 Claude。沒有金鑰時軍師仍會提供本機 AI 的建議與推算。'),
    row('模型', f.model),
    row('思考深度', f.effort),
    h('div', { class: 'set-row' }, h('label', {}, ''), h('button', { onclick: async () => { testOut.textContent = '測試中…'; await applySettings(f); const r = await xk.advisor.test(); testOut.textContent = r.ok ? `✅ ${r.text}` : `❌ ${r.error}`; } }, '測試金鑰'), testOut),
    h('h4', {}, '遠端對戰連線'),
    row('配對伺服器', f.srvMode),
    row('自架伺服器', h('div', { class: 'inline' }, f.host, f.port, f.path, h('label', { class: 'chk' }, f.secure, ' HTTPS'))),
    row('STUN', f.stun),
    row('TURN（跨網路連不上時）', h('div', { class: 'inline' }, f.turnUrls, f.turnUser, f.turnPass)),
    h('p', { class: 'credit-line small' }, `小柯機器人三軍棋遊戲 v${S.info.version}．${CREDIT}`),
  );
  const ok = await modal('設定', body, [{ label: '取消', value: false }, { label: '儲存', value: true, primary: true }]);
  if (ok) { await applySettings(f); toast('設定已儲存', 'ok'); renderHome(); applyInferLabels(); }
}

async function applySettings(f) {
  const patch = {
    playerName: f.name.value.trim() || '棋友',
    sfx: f.sfx.checked,
    autoUpdate: f.autoUpdate.checked,
    showInfer: f.showInfer.checked,
    proxyLevel: Number(f.proxyLevel.value),
    music: { autoplay: f.autoplay.checked },
    advisor: { model: f.model.value, effort: f.effort.value },
    server: { mode: f.srvMode.value, host: f.host.value.trim(), port: Number(f.port.value) || 9000, path: f.path.value.trim() || '/', secure: f.secure.checked },
    stun: f.stun.value,
    turn: { urls: f.turnUrls.value.trim(), username: f.turnUser.value.trim(), credential: f.turnPass.value },
  };
  if (f.key.value.trim()) patch.advisor.apiKey = f.key.value.trim();
  await saveSettings(patch);
  f.key.value = '';
  setSfx(S.settings.sfx);
  advisor.setHasKey(S.settings.advisor.hasKey);
}

window.addEventListener('beforeunload', () => { closeNet(); });
init().catch((e) => { console.error(e); document.body.append(h('pre', { class: 'fatal' }, '啟動失敗：' + (e.stack || e))); });
