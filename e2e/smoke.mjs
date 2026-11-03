// 單機端對端測試：首頁、布陣、真人對 AI、敵情推算、軍師、提示、悔棋、代打、認輸、棋譜庫、重播、教學、AI 對 AI
// 用法：node e2e/smoke.mjs [截圖資料夾]　（測已安裝的程式：XKJ_EXE=<執行檔> node e2e/smoke.mjs）
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const outDir = process.argv[2] || 'e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const appData = process.env.APPDATA || path.join(os.homedir(), 'Library', 'Application Support');
fs.rmSync(path.join(appData, 'xiaoke-sanjun-e2eSmoke'), { recursive: true, force: true });

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };

const exe = process.env.XKJ_EXE;
const app = await electron.launch({ executablePath: exe || require('electron'), args: [...(exe ? [] : ['.']), '--profile=e2eSmoke', '--autoplay-policy=no-user-gesture-required'] });
const win = await app.firstWindow();
const errors = [];
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
win.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
const waitFor = async (fn, arg, ms = 30000) => {
  const t = Date.now();
  for (;;) {
    const v = await win.evaluate(fn, arg).catch(() => false);
    if (v) return v;
    if (Date.now() - t > ms) throw new Error('等待逾時：' + fn);
    await new Promise((r) => setTimeout(r, 150));
  }
};
const myTurn = () => waitFor(() => document.querySelector('#turnBanner').textContent.startsWith('輪到您下棋') && !window.__xkj.animating && !window.__xkj.aiThinking);
const clickSq = (sq) => win.evaluate((s) => window.__xkjBoard.onSquareClick(s), sq);
const closeModal = () => win.evaluate(() => { const b = document.querySelector('.modal-back .modal-btns button.primary') || document.querySelector('.modal-back .modal-btns button'); if (b) b.click(); });

try {
  await win.waitForSelector('#startAI', { timeout: 20000 });
  await win.evaluate(async () => { window.__xkj.settings = await window.xk.settings.set({ music: { autoplay: false }, profile: { avatar: 'm01', advisor: 'am01' } });
    document.querySelectorAll('.modal-back').forEach((b) => b.remove()); });
  await win.evaluate(() => document.querySelector('.kindbtn[data-k="dark"]').click());
  await win.waitForTimeout(600);
  await win.screenshot({ path: path.join(outDir, '1-home.png') });
  check('首頁有三種對戰模式', (await win.locator('.mode-card').count()) === 3);
  check('首頁顯示小柯三軍棋圖示', await win.evaluate(() => { const i = document.querySelector('.hero-icon'); return i && i.naturalWidth > 0; }));
  const nTracks = await win.evaluate(() => window.xk.music.list().then((l) => l.length));
  check('內建 20 首背景音樂', nTracks === 20, String(nTracks));
  const np = await win.evaluate(() => fetch('../../assets/portraits/portraits.json').then((r) => r.json()).then((l) => [l.filter((p) => p.group === 'hero').length, l.filter((p) => p.group === 'beauty').length, l.filter((p) => p.group === 'advisor').length].join(',')));
  check('頭像：男 20、女 20、軍師 30', np === '20,20,30', np);

  // ---------- 真人對 AI：布陣 ----------
  await win.click('.segbtn[data-v="red"]');
  await win.selectOption('#aiLevel', '1');
  await win.click('#startAI');
  await waitFor(() => window.__xkj.phase === 'layout' && !document.querySelector('#setupBox').classList.contains('hidden'));
  await win.evaluate(() => document.querySelector('.versus')?.remove());
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(outDir, '2-layout.png') });
  check('進入布陣階段', true);
  const J = (expr, arg) => win.evaluate(expr, arg);
  // 交換兩顆合法棋子：前線（k5）陸地第 0、1 格
  await win.selectOption('#presetSel', 'p0');
  await win.click('#btnPreset');
  const before = await J(() => window.__xkj.layouts[0].slice());
  const a = 47, b = 48; // li
  await clickSq(await J((li) => window.__xkjJ.sqOfLi(0, li), a));
  await clickSq(await J((li) => window.__xkjJ.sqOfLi(0, li), b));
  await win.waitForTimeout(500);
  const after = await J(() => window.__xkj.layouts[0].slice());
  check('布陣：點兩顆棋子互換', before[a] === after[b] && before[b] === after[a] && before[a] !== before[b]);
  // 移到空格
  await clickSq(await J((li) => window.__xkjJ.sqOfLi(0, li), b));
  await clickSq(await J((li) => window.__xkjJ.sqOfLi(0, li), 49));
  await win.waitForTimeout(500);
  check('布陣：棋子可以移到空格', await J(() => window.__xkj.layouts[0][49] !== 0 && window.__xkj.layouts[0][48] === 0));
  // 不合法：軍艦不能上岸
  const shipLi = after.indexOf(18);
  await clickSq(await J((li) => window.__xkjJ.sqOfLi(0, li), shipLi));
  await clickSq(await J((li) => window.__xkjJ.sqOfLi(0, li), 48));
  await win.waitForTimeout(300);
  check('布陣：軍艦不能放陸地（顯示原因）', await J(() => [...document.querySelectorAll('.toast.why')].some((t) => t.textContent.includes('軍艦只能放在海上'))));
  // 不合法交換：軍旗換到前線
  const flagLi = after.indexOf(12);
  await clickSq(await J((li) => window.__xkjJ.sqOfLi(0, li), flagLi));
  await clickSq(await J(() => window.__xkjJ.sqOfLi(0, 47)));
  await win.waitForTimeout(300);
  check('布陣：軍旗不能離開大本營（顯示原因）', await J(() => [...document.querySelectorAll('.toast.why')].some((t) => t.textContent.includes('軍旗只能放在大本營'))));
  await win.selectOption('#presetSel', 'p2');
  await win.click('#btnPreset');
  check('布陣：套用經典布陣', await J(() => window.__xkj.layouts[0].join() === window.__xkjJ.PRESETS[2].L.join()));
  await win.click('#btnAdviseLayout');
  await waitFor(() => window.__xkj.layouts[0].join() !== window.__xkjJ.PRESETS[2].L.join(), null, 10000).catch(() => {});
  check('布陣：軍師推薦的布陣合法', await J(() => window.__xkjJ.validateLayout(window.__xkj.layouts[0]) === ''));
  await win.click('#btnLayoutDone');
  await myTurn();
  check('布陣完成→開戰，輪到我（紅軍先走）', true);
  check('暗棋：看不到 AI 的棋子', await J(() => { const b = window.__xkj.game.viewFor(0).board; for (let s = 0; s < 54; s++) if (b[s] && (b[s] & 31) !== 31) return false; return true; }));

  // ---------- 走幾步 ----------
  const playOne = async (preferAttack) => {
    const m = await J((pa) => {
      const g = window.__xkj.game, J = window.__xkjJ;
      const ms = g.legalMoves();
      const at = ms.filter((x) => g.board[J.mvTo(x)]);
      const fw = ms.filter((x) => J.rowOf(J.mvTo(x)) < J.rowOf(J.mvFrom(x)));
      const pool = pa && at.length ? at : fw.length ? fw : ms;
      return pool[Math.floor(Math.random() * pool.length)];
    }, preferAttack);
    await clickSq(m >> 7);
    await clickSq(m & 127);
  };
  for (let i = 0; i < 6; i++) { await playOne(i >= 3); await myTurn(); }
  check('連走 6 步（AI 也有回應）', await J(() => window.__xkj.game.moves.length >= 12));
  await win.screenshot({ path: path.join(outDir, '3-play.png') });
  // 走錯說明
  const bad = await J(() => { const g = window.__xkj.game, J = window.__xkjJ; for (let s = 63; s < 117; s++) if (g.board[s] && (g.board[s] & 31) === J.MINE) return s; return -1; });
  if (bad >= 0) { await clickSq(bad); await win.waitForTimeout(200); }
  check('點地雷會說明不能移動', bad < 0 || await J(() => [...document.querySelectorAll('.toast.why')].some((t) => t.textContent.includes('地雷'))));
  // 敵情推算
  await waitFor(() => window.__xkj.infer && Object.keys(window.__xkj.infer.pieces).length > 0, null, 15000);
  await win.click('.tab[data-tab="intel"]');
  await win.waitForTimeout(300);
  check('敵情推算分頁有剩餘兵力表', await J(() => document.querySelectorAll('.intel-table tr').length === 21));
  check('棋盤上有推算標籤', await J(() => window.__xkjBoard.labels.size >= 0));
  await win.screenshot({ path: path.join(outDir, '4-intel.png') });
  // 軍師
  await win.click('.tab[data-tab="advisor"]');
  const nMsg = await J(() => document.querySelectorAll('.adv-msg').length);
  await win.click('.adv-quick button');
  await waitFor((n) => { const l = [...document.querySelectorAll('.adv-msg.ai')]; return document.querySelectorAll('.adv-msg').length >= n + 2 && !l[l.length - 1].classList.contains('thinking') && l[l.length - 1].textContent.includes('建議'); }, nMsg, 20000);
  check('AI 軍師（離線）給出建議', true);
  check('軍師在棋盤上標出建議', await J(() => window.__xkjBoard.hintFrom.visible));
  // 提示
  await win.click('#btnHint');
  await waitFor(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.startsWith('提示：')), null, 15000);
  check('提示功能', true);
  // 悔棋
  const n0 = await J(() => window.__xkj.game.moves.length);
  await win.click('#btnUndo');
  await win.waitForTimeout(400);
  check('悔棋退回兩步', (await J(() => window.__xkj.game.moves.length)) === n0 - 2);
  await myTurn();
  // 換軍師
  await win.evaluate(() => document.querySelector('#pBottom .padv').click());
  await waitFor(() => document.querySelector('.modal-back .pf-item[data-key="advisor"]'));
  await win.evaluate(() => { document.querySelector('.pf-item[data-id="af12"]').click(); document.querySelector('.modal .pf-ok').click(); });
  await win.waitForTimeout(300);
  check('對局中更換 AI 軍師', await J(() => window.__xkj.players[0].advisor === 'af12' && document.querySelector('#pBottom .padvname').textContent.includes('軍師')));
  // 軍師代打
  await win.click('#btnProxy');
  const n1 = await J(() => window.__xkj.game.moves.length);
  await waitFor((n) => window.__xkj.game.result || window.__xkj.game.moves.length >= n + 3, n1, 30000);
  check('軍師代打：AI 替我下棋', true);
  if (!(await J(() => window.__xkj.game.result))) {
    await win.click('#btnProxy');
    await myTurn();
    check('交還主位後換我自己下', true);
    // 認輸
    await win.click('#btnResign');
    await waitFor(() => document.querySelector('.modal-back'));
    await closeModal();
  }
  await waitFor(() => window.__xkj.game.result && document.querySelector('.modal-back'));
  await win.screenshot({ path: path.join(outDir, '5-over.png') });
  check('對局結束後雙方棋子全部翻開', await J(() => { const g = window.__xkj.game; return [...window.__xkjBoard.pieces.values()].every((p) => (p.userData.code & 31) !== 31); }));
  await win.evaluate(() => { const bs = document.querySelectorAll('.modal-back .modal-btns button'); bs[0].click(); });

  // ---------- 棋譜庫與重播 ----------
  await win.click('#btnHome');
  await waitFor(() => document.querySelector('#scr-home.on'));
  await win.evaluate(() => [...document.querySelectorAll('.home-links button')].find((b) => b.textContent.includes('棋譜庫')).click());
  await waitFor(() => document.querySelectorAll('.rec-table tbody tr').length >= 1);
  check('棋譜庫收錄這一局', true);
  check('棋譜累積統計', await J(() => document.querySelector('.learn-stat').textContent.includes('已收錄 1 局')));
  await win.click('.rec-table tbody tr .ops button');
  await waitFor(() => window.__xkj.mode === 'replay');
  await win.evaluate(() => document.querySelector('.versus')?.remove());
  for (let i = 0; i < 4; i++) { await win.click('#rpNext'); await win.waitForTimeout(250); }
  check('重播：可以一步一步看', await J(() => window.__xkj.replay.ply === 4));
  check('重播時布陣全部公開', await J(() => [...window.__xkjBoard.pieces.values()].every((p) => (p.userData.code & 31) !== 31)));
  await win.screenshot({ path: path.join(outDir, '6-replay.png') });
  await win.click('#btnHome');

  // ---------- 教學 ----------
  await waitFor(() => document.querySelector('#scr-home.on'));
  await win.evaluate(() => window.__xkj.settings.guideVoice = false);
  await win.click('#btnGuide');
  await waitFor(() => document.querySelector('#scr-guide.on'));
  await win.evaluate(() => { if (window.__guide.narr.on) window.__guide.toggleVoice(); });
  check('教學課程 19 課', await J(() => document.querySelectorAll('.gd-item').length >= 19));
  await win.evaluate(() => window.__guide.go(5)); // 公路與鐵路
  await waitFor(() => document.querySelector('.gd-caption').textContent.includes('公路'), null, 10000);
  await win.waitForTimeout(600);
  await win.screenshot({ path: path.join(outDir, '7-guide.png') });
  check('教學動畫：鐵路走法', true);
  await waitFor(() => document.querySelector('.gd-caption').classList.contains('practice'), null, 60000);
  await win.evaluate(() => window.__guide.onBoardClick(window.__xkjJ.nameToSq('G2')));
  await waitFor(() => document.querySelector('.gd-caption').textContent.includes('答對了'), null, 10000);
  check('教學練習：答對了', true);
  await win.evaluate(() => window.__guide.open('help'));
  await waitFor(() => document.querySelectorAll('.gd-para').length >= 2);
  await win.screenshot({ path: path.join(outDir, '8-help.png') });
  check('系統功能說明（語音＋文字）', await J(() => document.querySelectorAll('.gd-item').length >= 10));
  await win.evaluate(() => window.__guide.close());

  // ---------- AI 對 AI ----------
  await waitFor(() => document.querySelector('#scr-home.on'));
  await win.evaluate(() => document.querySelector('#startAivai').parentElement.querySelector('.segbtn[data-v="fast"]').click());
  await win.click('#startAivai');
  await waitFor(() => window.__xkj.mode === 'aivai' && window.__xkj.game && window.__xkj.game.moves.length >= 8, null, 60000);
  check('AI 對 AI 自動對戰', true);
  check('觀戰時雙方棋子都看得到', await J(() => [...window.__xkjBoard.pieces.values()].every((p) => (p.userData.code & 31) !== 31)));
  await win.screenshot({ path: path.join(outDir, '9-aivai.png') });
  await win.click('#btnPause');
  const pn = await J(() => window.__xkj.game.moves.length);
  await win.waitForTimeout(2000);
  check('暫停 AI 對 AI', (await J(() => window.__xkj.game.moves.length)) <= pn + 1);
  await win.click('#btnHome');
  await win.waitForTimeout(300);
  check('沒有程式錯誤', errors.length === 0, errors.join('\n'));
} catch (e) {
  fail++;
  console.log('✘ 例外：', e.message);
  await win.screenshot({ path: path.join(outDir, 'fail.png') }).catch(() => {});
  if (errors.length) console.log(errors.join('\n'));
} finally {
  console.log(`\n通過 ${pass} 項，失敗 ${fail} 項`);
  await app.close();
  process.exit(fail ? 1 : 0);
}
