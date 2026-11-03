// 真人對真人端對端測試：本機配對伺服器＋兩個程式實例（房主 A、加入者 B）
// 布陣交換、暗棋互不可見、輪流走棋、聊天、軍師代打、悔棋、斷線重連、認輸、再來一局
// 用法：node e2e/net.mjs [截圖資料夾]
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const { PeerServer } = require('peer');
const outDir = process.argv[2] || 'e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const PORT = 9141;
const appData = process.env.APPDATA || path.join(os.homedir(), 'Library', 'Application Support');
for (const p of ['e2eA', 'e2eB']) fs.rmSync(path.join(appData, 'xiaoke-sanjun-' + p), { recursive: true, force: true });
const server = PeerServer({ port: PORT, path: '/' });

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };

async function launch(profile, name) {
  const app = await electron.launch({ executablePath: require('electron'), args: ['.', '--profile=' + profile, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const win = await app.firstWindow();
  const errors = [];
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  win.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  await win.waitForSelector('#btnHost', { timeout: 20000 });
  await win.evaluate(async ({ port, name }) => {
    window.__xkj.settings = await window.xk.settings.set({ playerName: name, server: { mode: 'custom', host: '127.0.0.1', port, path: '/', secure: false }, music: { autoplay: false }, profile: name === '小明' ? { avatar: 'm05', advisor: 'am01' } : { avatar: 'f02', advisor: 'af13' } });
    document.querySelectorAll('.modal-back').forEach((b) => b.remove());
  }, { port: PORT, name });
  const waitFor = async (fn, arg, ms = 25000) => {
    const t = Date.now();
    for (;;) {
      const v = await win.evaluate(fn, arg).catch(() => false);
      if (v) return v;
      if (Date.now() - t > ms) throw new Error(profile + ' 等待逾時：' + fn);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  return { app, win, errors, waitFor, ev: (fn, arg) => win.evaluate(fn, arg) };
}

const A = await launch('e2eA', '小明');
const B = await launch('e2eB', '阿華');
const banner = (X) => X.ev(() => document.querySelector('#turnBanner').textContent);
const idle = (X) => X.waitFor(() => !window.__xkj.animating);
// 由輪到的一方走一步（優先往前）
async function stepBy(X) {
  const m = await X.ev(() => {
    const g = window.__xkj.game, J = window.__xkjJ;
    const ms = g.legalMoves();
    const side = window.__xkj.mySide;
    const fw = ms.filter((x) => (side === 0 ? J.rowOf(J.mvTo(x)) < J.rowOf(J.mvFrom(x)) : J.rowOf(J.mvTo(x)) > J.rowOf(J.mvFrom(x))));
    const pool = fw.length ? fw : ms;
    const m = pool[Math.floor(Math.random() * pool.length)];
    window.__xkjBoard.onSquareClick(m >> 7);
    window.__xkjBoard.onSquareClick(m & 127);
    return m;
  });
  return m;
}

try {
  await A.win.selectOption('#hostSide', 'red');
  await A.win.click('#btnHost');
  const code = (await A.waitFor(() => document.querySelector('.room-code')?.textContent)).replace(/\s/g, '');
  check('建立房間取得 6 位數房號', /^\d{6}$/.test(code), code);
  await B.win.fill('#joinCode', code);
  await B.win.click('#btnJoin');
  await A.waitFor(() => window.__xkj.netStarted && window.__xkj.phase === 'layout');
  await B.waitFor(() => window.__xkj.netStarted && window.__xkj.phase === 'layout');
  check('雙方進入布陣', true);
  check('A 紅軍、B 藍軍', (await A.ev(() => window.__xkj.mySide)) === 0 && (await B.ev(() => window.__xkj.mySide)) === 1);
  check('雙方名稱互通', (await B.ev(() => window.__xkj.names.join('/'))) === '小明/阿華', await B.ev(() => window.__xkj.names.join('/')));
  check('雙方頭像互通', (await A.ev(() => window.__xkj.players[1].avatar)) === 'f02');
  // A 先完成布陣
  await A.ev(() => document.querySelectorAll('.versus').forEach((x) => x.remove()));
  await A.win.click('#btnLayoutDone');
  await B.waitFor(() => window.__xkj.ready[0]);
  check('B 看到 A 布陣完成', true);
  check('A 等待對方布陣', (await banner(A)).includes('等待對方'), await banner(A));
  await B.ev(() => document.querySelectorAll('.versus').forEach((x) => x.remove()));
  await B.win.click('#btnRandomLayout');
  await B.win.click('#btnLayoutDone');
  await A.waitFor(() => window.__xkj.phase === 'play');
  await B.waitFor(() => window.__xkj.phase === 'play');
  check('雙方布陣完成→開戰', true);
  check('A（紅軍）先走', (await banner(A)) === '輪到您下棋', await banner(A));
  check('B 換您觀棋', (await banner(B)).startsWith('換您觀棋'), await banner(B));
  check('暗棋：A 看不到 B 的棋子', await A.ev(() => [...window.__xkjBoard.pieces.entries()].filter(([sq]) => sq < 54).every(([, g]) => (g.userData.code & 31) === 31)));
  check('暗棋：B 看不到 A 的棋子', await B.ev(() => [...window.__xkjBoard.pieces.entries()].filter(([sq]) => sq >= 63).every(([, g]) => (g.userData.code & 31) === 31)));
  check('B 的棋盤方向是藍軍在下方', await B.ev(() => window.__xkjBoard.orientation === 1));
  await A.win.screenshot({ path: path.join(outDir, 'net-A-play.png') });
  await B.win.screenshot({ path: path.join(outDir, 'net-B-play.png') });

  // 輪流走 6 步
  for (let i = 0; i < 6; i++) {
    const X = i % 2 ? B : A, Y = i % 2 ? A : B;
    await X.waitFor(() => document.querySelector('#turnBanner').textContent === '輪到您下棋' && !window.__xkj.animating);
    await stepBy(X);
    await Y.waitFor((n) => window.__xkj.game.moves.length === n, i + 1);
    await idle(Y);
  }
  check('輪流走 6 步，雙方同步', (await A.ev(() => window.__xkj.game.moves.join())) === (await B.ev(() => window.__xkj.game.moves.join())));
  check('雙方棋盤一致', (await A.ev(() => Array.from(window.__xkj.game.board).join())) === (await B.ev(() => Array.from(window.__xkj.game.board).join())));
  // 對方回合不能動
  const before = await B.ev(() => window.__xkj.game.moves.length);
  await B.ev(() => { const g = window.__xkj.game; const ms = g.legalMoves(1); if (ms.length) { window.__xkjBoard.onSquareClick(ms[0] >> 7); window.__xkjBoard.onSquareClick(ms[0] & 127); } });
  await B.win.waitForTimeout(300);
  check('不是自己回合時不能走', (await B.ev(() => window.__xkj.game.moves.length)) === before);

  // 聊天
  await B.win.click('.tab[data-tab="chat"]');
  await B.win.fill('#chatInput', '你好，加油！');
  await B.win.press('#chatInput', 'Enter');
  await A.waitFor(() => [...document.querySelectorAll('.chat-msg.opp')].some((e) => e.textContent.includes('你好，加油')));
  check('文字聊天', true);

  // 悔棋：A 走一步後請求悔棋，B 同意
  await A.waitFor(() => document.querySelector('#turnBanner').textContent === '輪到您下棋' && !window.__xkj.animating);
  await stepBy(A);
  await B.waitFor(() => window.__xkj.game.moves.length === 7);
  await idle(A);
  await A.win.click('#btnUndo');
  await B.waitFor(() => document.querySelector('.modal-back') && document.querySelector('.modal h3').textContent === '悔棋請求');
  await B.ev(() => document.querySelector('.modal .modal-btns button.primary').click());
  await A.waitFor(() => window.__xkj.game.moves.length === 6);
  await B.waitFor(() => window.__xkj.game.moves.length === 6);
  check('悔棋（對方同意）', true);

  // B 讓軍師代打
  await A.waitFor(() => document.querySelector('#turnBanner').textContent === '輪到您下棋' && !window.__xkj.animating);
  await B.win.click('#btnProxy');
  await A.waitFor(() => window.__xkj.proxy[1] === true);
  check('A 看到 B 換軍師代打', (await A.ev(() => document.querySelector('#pTop').classList.contains('proxy'))));
  await stepBy(A);
  await A.waitFor(() => window.__xkj.game.moves.length >= 8, null, 30000);
  check('B 的軍師自動回應一步', true);
  await B.win.click('#btnProxy');
  await A.waitFor(() => window.__xkj.proxy[1] === false);
  check('B 交還主位', true);

  // 斷線重連：B 重新整理頁面後重新加入同一房間
  await idle(A); await idle(B);
  const movesBefore = await A.ev(() => window.__xkj.game.moves.length);
  await B.ev(() => window.__xkj.link.close());
  await A.waitFor(() => document.querySelector('#turnBanner').textContent.includes('連線'), null, 25000).catch(() => {});
  await B.ev(() => { window.__xkj.mode = null; });
  await B.win.click('#btnHome').catch(() => {});
  await B.waitFor(() => document.querySelector('#scr-home.on'));
  await B.win.fill('#joinCode', code);
  await B.win.click('#btnJoin');
  await B.waitFor((n) => window.__xkj.phase === 'play' && window.__xkj.game && window.__xkj.game.moves.length === n, movesBefore, 30000);
  const bb = await B.ev(() => (window.__xkj.game ? Array.from(window.__xkj.game.board).join() : 'B:null ' + window.__xkj.phase + ' ' + window.__xkj.mode));
  const ab = await A.ev(() => (window.__xkj.game ? Array.from(window.__xkj.game.board).join() : 'A:null ' + window.__xkj.phase + ' ' + window.__xkj.mode));
  check('斷線後重新加入，回到原本的棋局', bb === ab, bb.slice(0, 40) + ' / ' + ab.slice(0, 40));

  // 認輸
  await B.win.click('#btnResign');
  await B.waitFor(() => document.querySelector('.modal-back'));
  await B.ev(() => document.querySelector('.modal .modal-btns button.primary').click());
  await A.waitFor(() => window.__xkj.game.result && window.__xkj.game.result.winner === 0);
  check('B 認輸，A 獲勝', true);
  await A.win.screenshot({ path: path.join(outDir, 'net-A-over.png') });
  await A.ev(() => document.querySelectorAll('.modal-back').forEach((b) => b.remove()));
  await B.ev(() => document.querySelectorAll('.modal-back').forEach((b) => b.remove()));

  // 再來一局（紅藍交換）
  await A.win.click('#btnNew');
  await B.waitFor(() => document.querySelector('.modal h3')?.textContent === '再來一局');
  await B.ev(() => document.querySelector('.modal .modal-btns button.primary').click());
  await A.waitFor(() => window.__xkj.phase === 'layout' && window.__xkj.mySide === 1);
  await B.waitFor(() => window.__xkj.phase === 'layout' && window.__xkj.mySide === 0);
  check('再來一局：紅藍交換', true);
  check('雙方棋譜都有收錄', (await A.ev(() => window.xk.games.list().then((l) => l.length))) >= 1 && (await B.ev(() => window.xk.games.list().then((l) => l.length))) >= 1);
  check('沒有程式錯誤', !A.errors.length && !B.errors.length, [...A.errors, ...B.errors].join('\n'));
} catch (e) {
  fail++;
  console.log('✘ 例外：', e.message);
  await A.win.screenshot({ path: path.join(outDir, 'net-fail-A.png') }).catch(() => {});
  await B.win.screenshot({ path: path.join(outDir, 'net-fail-B.png') }).catch(() => {});
  console.log([...A.errors, ...B.errors].join('\n'));
} finally {
  console.log(`\n通過 ${pass} 項，失敗 ${fail} 項`);
  await A.app.close();
  await B.app.close();
  server.close?.();
  process.exit(fail ? 1 : 0);
}
