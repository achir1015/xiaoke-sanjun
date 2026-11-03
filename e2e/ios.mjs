// iPhone／iPad 版網頁測試：用 Chrome 模擬 iPad Pro 11 吋橫放（觸控、UA 是 Macintosh，和真的 iPad WebView 一樣）
// 以及 iPhone 直放（手機版面），並模擬 iOS App 的橋（window.XiaokeIOS＋webkit.messageHandlers.xks）
// 用法：node scripts/build-mobile.mjs && node e2e/ios.mjs [截圖資料夾]
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';

const outDir = process.argv[2] || 'e2e/out/ios';
fs.mkdirSync(outDir, { recursive: true });
const WWW = path.resolve('mobile/www');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.png': 'image/png' };
const PORT = 8835;
const server = http.createServer((req, res) => {
  const p = path.join(WWW, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!p.startsWith(WWW) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(PORT);

const BRIDGE = () => {
  window.XiaokeIOS = true;
  window.__iosCalls = [];
  window.webkit = { messageHandlers: { xks: { postMessage: (m) => {
    window.__iosCalls.push(m.cmd + ':' + (m.args || [])[0]);
    if (m.cmd === 'begin_save') return Promise.resolve({ status: 'ok', token: 't1', path: m.args[0] });
    if (m.cmd === 'end_save') return Promise.resolve({ status: 'ok', path: 'shared.txt' });
    return Promise.resolve({ status: 'ok' });
  } } } };
};

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };
const browser = await chromium.launch({ channel: 'chrome' });

async function device(label, opts) {
  const ctx = await browser.newContext({ ...opts, hasTouch: true });
  await ctx.addInitScript(BRIDGE);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/404|403/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  const ev = (fn, a) => page.evaluate(fn, a);
  const waitFor = async (fn, arg, ms = 30000) => {
    const t = Date.now();
    for (;;) {
      const v = await page.evaluate(fn, arg).catch(() => false);
      if (v) return v;
      if (Date.now() - t > ms) throw new Error(label + ' 等待逾時：' + fn);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  const shot = (n) => page.screenshot({ path: path.join(outDir, n) });
  // 觸控點 3D 棋子
  const tapSq = async (sq) => {
    const p = await ev((s) => { const b = window.__xkjBoard; const v = b.pieces.get(s).position.clone(); v.y += 0.2; v.project(b.camera); const r = b.renderer.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; }, sq);
    await page.touchscreen.tap(p.x, p.y);
  };
  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForSelector('#startAI', { timeout: 30000 });
  await ev(async () => { window.__xkj.settings = await window.xk.settings.set({ music: { autoplay: false }, profile: { avatar: 'f05', advisor: 'am12' } }); document.querySelectorAll('.modal-back').forEach((b) => b.remove()); });
  return { page, ev, waitFor, shot, tapSq, errors, ctx };
}

async function play(D, label) {
  await D.ev(() => { document.querySelector('.segbtn[data-v="red"]').click(); document.querySelector('#startAI').click(); });
  await D.waitFor(() => window.__xkj.phase === 'layout' && window.__xkj.ready[1]);
  await D.ev(() => document.querySelector('.versus')?.remove());
  await D.page.waitForTimeout(500);
  await D.shot(`${label}-layout.png`);
  const li = await D.ev(() => { const L = window.__xkj.layouts[0]; for (const a of [47, 48, 49, 50, 51]) for (const b of [36, 38, 40, 27, 29]) if (L[a] !== L[b] && window.__xkjJ.canSwap(L, a, b)) return [a, b, L[a], L[b]]; return null; });
  await D.tapSq(await D.ev((x) => window.__xkjJ.sqOfLi(0, x), li[0])); await D.page.waitForTimeout(300);
  await D.tapSq(await D.ev((x) => window.__xkjJ.sqOfLi(0, x), li[1])); await D.page.waitForTimeout(700);
  check(`${label}：觸控互換布陣`, await D.ev((x) => window.__xkj.layouts[0][x[0]] === x[3] && window.__xkj.layouts[0][x[1]] === x[2], li));
  await D.ev(() => document.querySelector('#btnLayoutDone').click());
  await D.waitFor(() => document.querySelector('#turnBanner').textContent === '輪到您下棋' && !window.__xkj.animating);
  const m = await D.ev(() => { const g = window.__xkj.game, J = window.__xkjJ; return g.legalMoves().find((x) => J.rowOf(x & 127) < J.rowOf(x >> 7) && !g.board[x & 127]); });
  await D.tapSq(m >> 7); await D.page.waitForTimeout(300);
  check(`${label}：觸控選子顯示可走位置`, (await D.ev(() => window.__xkjBoard.targets.length)) > 0);
  await D.ev((x) => window.__xkjBoard.onSquareClick(x & 127), m);
  await D.waitFor(() => window.__xkj.game.moves.length >= 2 && !window.__xkj.aiThinking && !window.__xkj.animating);
  check(`${label}：走棋、AI 回應`, true);
  const fit = await D.ev(() => [document.documentElement.scrollWidth <= innerWidth + 1, document.documentElement.scrollHeight <= innerHeight + 1]);
  check(`${label}：畫面不超出螢幕`, fit[0] && fit[1], JSON.stringify(fit));
  await D.shot(`${label}-play.png`);
}

try {
  // ---------- iPad（橫放，電腦版版面＋觸控） ----------
  const P = await device('iPad', { viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)' });
  const cls = await P.ev(() => document.documentElement.className);
  check('iPad：電腦版版面＋觸控', /\btouch\b/.test(cls) && /\bios\b/.test(cls) && !/\bmobile\b/.test(cls), cls);
  check('iPad：系統資訊是 iOS', (await P.ev(() => window.xk.sys.info().then((i) => i.platform))) === 'ios');
  await P.shot('ipad-home.png');
  await play(P, 'ipad');
  await P.ev(() => document.querySelector('#miniMusic').click());
  check('iPad：點一下打開直立音量滑桿', await P.ev(() => document.querySelector('.music-vol').classList.contains('open')));
  // 匯出棋譜：交給 iOS 的分享選單
  await P.ev(() => { window.__xkj.game.resign(0); });
  await P.ev(() => window.xk.games.export('test.txt', 'hello'));
  check('iPad：匯出棋譜走 iOS 分享', await P.ev(() => window.__iosCalls.some((c) => c.startsWith('begin_save')) && window.__iosCalls.some((c) => c.startsWith('end_save'))));
  const upd = await P.ev(() => window.xk.update.check().then((u) => ({ page: u.page, flavor: u.flavor })).catch((e) => ({ error: e.message })));
  check('iPad：檢查更新會開安裝頁', upd.flavor === 'ios' && /xiaoke-sanjun\/ios\//.test(upd.page || ''), JSON.stringify(upd));
  check('iPad：沒有程式錯誤', P.errors.length === 0, P.errors.join('\n'));
  await P.ctx.close();

  // ---------- iPhone（直放，手機版面） ----------
  const I = await device('iPhone', { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' });
  const cls2 = await I.ev(() => document.documentElement.className);
  check('iPhone：手機直立版面', /\bmobile\b/.test(cls2) && /\bios\b/.test(cls2), cls2);
  await I.shot('iphone-home.png');
  await play(I, 'iphone');
  await I.ev(() => document.querySelector('.tab[data-tab="intel"]').click());
  await I.page.waitForTimeout(500);
  check('iPhone：底部抽屜（敵情推算）', await I.ev(() => document.body.classList.contains('sheet-open')));
  await I.shot('iphone-intel.png');
  check('iPhone：沒有程式錯誤', I.errors.length === 0, I.errors.join('\n'));
} catch (e) {
  fail++;
  console.log('✘ 例外：', e.message);
} finally {
  console.log(`\n通過 ${pass} 項，失敗 ${fail} 項`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
}
