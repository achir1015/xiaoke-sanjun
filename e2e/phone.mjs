// 實機測試：透過 adb 連到手機上小柯三軍棋（除錯版 APK）的 WebView，用 DevTools 協定檢查功能；點棋子用 adb 真的觸控螢幕
// 用法：python android/build.py debug install，手機解鎖後執行 node e2e/phone.mjs [手機序號] [截圖資料夾]
import { chromium } from 'playwright-core';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ADB = process.env.ADB || 'E:/小米觸控音箱/tools/android-sdk/platform-tools/adb.exe';
const SERIAL = process.argv[2] || process.env.ANDROID_SERIAL || 'R5CY236CQ3B';
const outDir = process.argv[3] || 'e2e/out/phone';
fs.mkdirSync(outDir, { recursive: true });
const adb = (...a) => execFileSync(ADB, ['-s', SERIAL, ...a], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
const shotPhone = (name) => fs.writeFileSync(path.join(outDir, name), execFileSync(ADB, ['-s', SERIAL, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 }));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };

// 安全守則：只有本 App 在前景、螢幕沒鎖時才操作
const focus = adb('shell', 'dumpsys', 'window');
if (/isKeyguardShowing=true/.test(focus)) { console.log('手機鎖著，請先解鎖'); process.exit(2); }
const fm = focus.match(/mCurrentFocus=[^\r\n]*/g) || [];
if (!fm.some((f) => f.includes('com.achir.xiaokesanjun'))) { console.log('前景不是小柯三軍棋：', fm.join(' ')); process.exit(2); }
const sock = /@?(webview_devtools_remote_\d+)/.exec(adb('shell', 'cat', '/proc/net/unix'));
if (!sock) { console.log('找不到 WebView 偵錯通道（要用 python android/build.py debug 建置）'); process.exit(2); }
execFileSync(ADB, ['-s', SERIAL, 'forward', 'tcp:9335', 'localabstract:' + sock[1]]);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9335');
const page = browser.contexts()[0].pages().find((p) => p.url().includes('appassets')) || browser.contexts()[0].pages()[0];
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const ev = (fn, arg) => page.evaluate(fn, arg);
const waitFor = async (fn, arg, ms = 30000) => {
  const t = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg).catch(() => false);
    if (v) return v;
    if (Date.now() - t > ms) throw new Error('等待逾時：' + fn);
    await new Promise((r) => setTimeout(r, 200));
  }
};
// 3D 棋子在手機螢幕上的實際像素位置，用 adb 真的點下去
const tapSq = async (sq) => {
  const p = await ev((s) => {
    const b = window.__xkjBoard;
    const vec = b.pieces.get(s).position.clone();   // 只點有棋子的格子
    vec.y += 0.2;
    vec.project(b.camera);
    const r = b.renderer.domElement.getBoundingClientRect();
    const top = (screen.height - innerHeight) * devicePixelRatio;
    return { x: (r.left + (vec.x + 1) / 2 * r.width) * devicePixelRatio, y: top + (r.top + (1 - vec.y) / 2 * r.height) * devicePixelRatio };
  }, sq);
  adb('shell', 'input', 'tap', String(Math.round(p.x)), String(Math.round(p.y)));
};
const clickSq = (sq) => ev((s) => window.__xkjBoard.onSquareClick(s), sq);

try {
  // 重新載入，從首頁開始
  await ev(() => { localStorage.removeItem('xksanjun.settings'); location.reload(); });
  await new Promise((r) => setTimeout(r, 2500));
  await waitFor(() => !!window.__xkj && !!document.querySelector('#startAI'));
  const info = await ev(() => ({
    android: !!window.XiaokeAndroid, mobile: document.documentElement.classList.contains('mobile'),
    w: innerWidth, h: innerHeight, dpr: devicePixelRatio, ver: JSON.parse(window.XiaokeAndroid.appInfo()).version,
    webgl: !!document.createElement('canvas').getContext('webgl2'),
  }));
  console.log('  ', JSON.stringify(info));
  check('在 Android App 裡執行（原生橋接、手機版面）', info.android && info.mobile);
  check('版本號 1.0.0', info.ver === '1.0.0', info.ver);
  check('第一次使用要選頭像與軍師', await ev(() => !!document.querySelector('.modal .pf')));
  await shotPhone('p1-profile.png');
  await ev(() => { document.querySelector('.pf-item[data-id="f03"]').click(); document.querySelector('.pf-tab[data-k="advisor"]').click(); document.querySelector('.pf-item[data-id="af14"]').click(); document.querySelector('.modal .pf-ok').click(); });
  await waitFor(() => !document.querySelector('.modal-back'));
  await ev(() => window.xk.settings.set({ music: { autoplay: false } }));
  await new Promise((r) => setTimeout(r, 500));
  await shotPhone('p2-home.png');
  check('首頁三種對戰', (await ev(() => document.querySelectorAll('.mode-card').length)) === 3);
  check('20 首背景音樂', (await ev(() => window.xk.music.list().then((l) => l.length))) === 20);
  check('70 張頭像都載入得到', await ev(async () => { const l = await (await fetch('../../assets/portraits/portraits.json')).json(); const r = await Promise.all(l.map((p) => fetch('../../assets/portraits/' + p.id + '.svg').then((x) => x.ok))); return l.length === 70 && r.every(Boolean); }));
  check('手機有中文語音（教學用）', await ev(() => window.xk.tts.available()), await ev(() => window.xk.tts.voiceName()));

  // ---------- 真人對 AI ----------
  await ev(() => { document.querySelector('.segbtn[data-v="red"]').click(); document.querySelector('#aiLevel').value = '1'; document.querySelector('#aiLevel').dispatchEvent(new Event('change')); document.querySelector('#startAI').click(); });
  await waitFor(() => window.__xkj.phase === 'layout' && window.__xkj.ready[1]);
  await ev(() => document.querySelector('.versus')?.remove());
  await new Promise((r) => setTimeout(r, 800));
  await shotPhone('p3-layout.png');
  check('布陣階段', true);
  // 真的觸控：點兩顆棋子互換
  const li = await ev(() => { const L = window.__xkj.layouts[0]; for (const a of [47, 48, 49, 50, 51]) for (const b of [36, 38, 40, 27, 29]) if (L[a] !== L[b] && window.__xkjJ.canSwap(L, a, b)) return [a, b, L[a], L[b]]; return null; });
  const sa = await ev((x) => window.__xkjJ.sqOfLi(0, x), li[0]), sb = await ev((x) => window.__xkjJ.sqOfLi(0, x), li[1]);
  await tapSq(sa); await new Promise((r) => setTimeout(r, 400));
  await tapSq(sb); await new Promise((r) => setTimeout(r, 900));
  check('觸控：點兩顆棋子互換位置', await ev((x) => window.__xkj.layouts[0][x[0]] === x[3] && window.__xkj.layouts[0][x[1]] === x[2], li));
  await ev(() => document.querySelector('#btnLayoutDone').click());
  await waitFor(() => document.querySelector('#turnBanner').textContent === '輪到您下棋' && !window.__xkj.animating);
  check('開戰，輪到我', true);
  // 用觸控走一步
  const mv = await ev(() => { const g = window.__xkj.game, J = window.__xkjJ; const ms = g.legalMoves().filter((m) => J.rowOf(m & 127) < J.rowOf(m >> 7) && !g.board[m & 127]); return ms[0]; });
  await tapSq(mv >> 7); await new Promise((r) => setTimeout(r, 400));
  const tg = await ev(() => window.__xkjBoard.targets.length);
  check('觸控選子會顯示可走位置', tg > 0, String(tg));
  await ev((m) => window.__xkjBoard.onSquareClick(m & 127), mv);
  await waitFor(() => window.__xkj.game.moves.length >= 2 && !window.__xkj.aiThinking && !window.__xkj.animating, null, 30000);
  check('走一步、AI 回應', true);
  for (let i = 0; i < 4; i++) {
    await waitFor(() => document.querySelector('#turnBanner').textContent === '輪到您下棋' && !window.__xkj.animating && !window.__xkj.aiThinking);
    await ev(() => { const g = window.__xkj.game, J = window.__xkjJ; const ms = g.legalMoves(); const at = ms.filter((m) => g.board[m & 127]); const m = (at.length ? at : ms)[Math.floor(Math.random() * (at.length || ms.length))]; window.__xkjBoard.onSquareClick(m >> 7); window.__xkjBoard.onSquareClick(m & 127); });
    await waitFor((n) => window.__xkj.game.result || window.__xkj.game.moves.length >= n, 4 + i * 2, 30000);
  }
  await new Promise((r) => setTimeout(r, 800));
  await shotPhone('p4-play.png');
  check('連續對戰', await ev(() => window.__xkj.game.moves.length >= 8 || !!window.__xkj.game.result));
  // 抽屜
  await ev(() => document.querySelector('.tab[data-tab="intel"]').click());
  await new Promise((r) => setTimeout(r, 700));
  check('底部抽屜打開：敵情推算', await ev(() => document.body.classList.contains('sheet-open') && document.querySelectorAll('.intel-table tr').length === 21));
  await shotPhone('p5-intel.png');
  await ev(() => document.querySelector('.tab[data-tab="advisor"]').click());
  const nMsg = await ev(() => document.querySelectorAll('.adv-msg').length);
  await ev(() => document.querySelector('.adv-quick button').click());
  await waitFor((n) => { const l = [...document.querySelectorAll('.adv-msg.ai')]; return document.querySelectorAll('.adv-msg').length >= n + 2 && !l[l.length - 1].classList.contains('thinking'); }, nMsg, 30000);
  check('AI 軍師（離線）回答', true);
  await ev(() => window.__xkjBack());
  check('返回鍵先收起抽屜', await ev(() => !document.body.classList.contains('sheet-open')));
  // 音量
  await ev(() => document.querySelector('#miniMusic').click());
  check('點音樂圖示打開直立音量滑桿', await ev(() => document.querySelector('.music-vol').classList.contains('open') && getComputedStyle(document.querySelector('.music-vol .vol-pop')).display !== 'none'));
  await shotPhone('p6-volume.png');
  await ev(() => document.body.click());
  // 匯出存檔需結束：認輸
  await ev(() => { if (!window.__xkj.game.result) { window.__xkj.game.resign(0); } });
  await ev(() => document.querySelector('#btnHome').click());
  await new Promise((r) => setTimeout(r, 500));
  await ev(() => document.querySelectorAll('.modal-back .modal-btns button.primary').forEach((b) => b.click()));
  await waitFor(() => document.querySelector('#scr-home.on'));
  // ---------- 教學語音 ----------
  await ev(() => document.querySelector('#btnGuide').click());
  await waitFor(() => document.querySelector('#scr-guide.on') && document.querySelector('.gd-caption').textContent.length > 5);
  await new Promise((r) => setTimeout(r, 1500));
  await shotPhone('p7-guide.png');
  check('教學畫面（語音解說）', await ev(() => document.querySelector('#gdVoice').textContent.includes('開')), await ev(() => document.querySelector('#gdVoice').textContent));
  await ev(() => window.__guide.open('help'));
  await new Promise((r) => setTimeout(r, 1200));
  await shotPhone('p8-help.png');
  await ev(() => window.__guide.close());
  // ---------- 更新 ----------
  const upd = await ev(() => window.xk.update.check().then((u) => ({ latest: u.latest, newer: u.newer, asset: u.asset && u.asset.name })).catch((e) => ({ error: e.message })));
  check('檢查更新可以連到 GitHub', !!upd.latest, JSON.stringify(upd));
  check('沒有程式錯誤', errors.length === 0, errors.join('\n'));
} catch (e) {
  fail++;
  console.log('✘ 例外：', e.message);
  await shotPhone('p-fail.png').catch(() => {});
  if (errors.length) console.log(errors.join('\n'));
} finally {
  console.log(`\n通過 ${pass} 項，失敗 ${fail} 項`);
  await browser.close().catch(() => {});
  process.exit(fail ? 1 : 0);
}
