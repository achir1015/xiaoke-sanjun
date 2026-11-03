// 線上版（GitHub Pages）測試：照網站的實際路徑排好（/xiaoke-sanjun/ 首頁、/xiaoke-sanjun/online/ 遊戲），用 Chrome 測試
// 電腦瀏覽器、手機瀏覽器、兩個分頁遠端對戰（本機配對伺服器）。
// 用法：node scripts/build-mobile.mjs && node e2e/web.mjs [網址，預設本機]
import { chromium } from 'playwright-core';
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const outDir = 'e2e/out/web';
fs.mkdirSync(outDir, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.png': 'image/png', '.plist': 'application/xml' };
const PORT = 8836, PEER = 9142;
let BASE = process.argv[2];
let server, peer;
if (!BASE) {
  const map = (u) => {
    const rel = decodeURIComponent(u.split('?')[0]).replace(/^\/xiaoke-sanjun\/?/, '');
    if (rel.startsWith('online')) return path.join(path.resolve('mobile/www'), rel.slice(6).replace(/^\/+/, '') || 'index.html');
    return path.join(path.resolve('docs'), rel || 'index.html');
  };
  server = http.createServer((req, res) => {
    let p = map(req.url);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  }).listen(PORT);
  BASE = `http://localhost:${PORT}/xiaoke-sanjun/`;
}
const local = BASE.includes('localhost');
if (local) { const { PeerServer } = require('peer'); peer = PeerServer({ port: PEER, path: '/' }); }

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });

async function open(label, opts, url) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [], missing = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/403|rate limit/i.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('response', (r) => { if (r.status() === 404) missing.push(r.url()); });
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
  await page.goto(url);
  return { ctx, page, ev, waitFor, errors, missing, shot: (n) => page.screenshot({ path: path.join(outDir, n) }) };
}
const setup = (X, name, avatar) => X.ev(async ({ name, avatar, local, PEER }) => {
  await window.xk.settings.set({ playerName: name, music: { autoplay: false }, profile: { avatar, advisor: 'af07' }, ...(local ? { server: { mode: 'custom', host: 'localhost', port: PEER, path: '/', secure: false } } : {}) });
  window.__xkj.settings = await window.xk.settings.get();
  document.querySelectorAll('.modal-back').forEach((b) => b.remove());
}, { name, avatar, local, PEER });

try {
  // ---------- 首頁 ----------
  const H = await open('首頁', { viewport: { width: 1280, height: 860 } }, BASE);
  await H.page.waitForSelector('a.play');
  check('網站首頁：線上版入口與四個平台下載', (await H.ev(() => document.querySelectorAll('.card a.dl').length)) >= 6);
  await H.page.waitForTimeout(1500);
  check('網站首頁：下載連結指向最新版檔案', await H.ev(() => [...document.querySelectorAll('a[data-asset]')].every((a) => /releases\/(latest|download)/.test(a.href))));
  await H.shot('site-home.png');
  await H.page.click('a.play');
  await H.page.waitForURL(/online\//);
  await H.page.waitForSelector('#startAI', { timeout: 30000 });
  check('按「開始玩」進入線上版', true);
  await H.ctx.close();

  // ---------- 電腦瀏覽器 ----------
  const D = await open('電腦', { viewport: { width: 1440, height: 900 } }, BASE + 'online/');
  await D.page.waitForSelector('#startAI', { timeout: 30000 });
  check('電腦瀏覽器：第一次要選頭像', await D.ev(() => !!document.querySelector('.modal .pf')));
  check('電腦瀏覽器：網頁版版面（不是手機版）', await D.ev(() => document.documentElement.classList.contains('webapp') && !document.documentElement.classList.contains('mobile')));
  await setup(D, '小明', 'm03');
  await D.page.waitForTimeout(300);
  check('圖示載入', await D.ev(() => document.querySelector('.hero-icon').naturalWidth > 0));
  check('20 首背景音樂', (await D.ev(() => window.xk.music.list().then((l) => l.length))) === 20);
  check('70 張頭像都載入得到', await D.ev(async () => { const l = await (await fetch('assets/portraits/portraits.json')).json(); const r = await Promise.all(l.map((p) => fetch('assets/portraits/' + p.id + '.svg').then((x) => x.ok))); return l.length === 70 && r.every(Boolean); }));
  check('背景音樂可以播放', await D.ev(async () => { const l = await window.xk.music.list(); const a = new Audio(l[3].url); await a.play().catch(() => null); await new Promise((r) => setTimeout(r, 1500)); const ok = a.currentTime > 0.3; a.pause(); return ok; }));
  check('版本資訊是線上版', (await D.ev(() => window.xk.sys.info().then((i) => i.platform + ' ' + i.version))) === 'web 1.0.0');
  await D.shot('web-home.png');
  await D.ev(() => { document.querySelector('.segbtn[data-v="red"]').click(); document.querySelector('#startAI').click(); });
  await D.waitFor(() => window.__xkj.phase === 'layout' && window.__xkj.ready[1]);
  await D.ev(() => { document.querySelector('.versus')?.remove(); document.querySelector('#btnLayoutDone').click(); });
  await D.waitFor(() => document.querySelector('#turnBanner').textContent === '輪到您下棋' && !window.__xkj.animating);
  for (let i = 0; i < 3; i++) {
    await D.waitFor(() => document.querySelector('#turnBanner').textContent === '輪到您下棋' && !window.__xkj.animating && !window.__xkj.aiThinking);
    await D.ev(() => { const g = window.__xkj.game; const ms = g.legalMoves(); const m = ms[Math.floor(Math.random() * ms.length)]; window.__xkjBoard.onSquareClick(m >> 7); window.__xkjBoard.onSquareClick(m & 127); });
    await D.waitFor((n) => window.__xkj.game.result || window.__xkj.game.moves.length >= n, (i + 1) * 2, 30000);
  }
  check('電腦瀏覽器：和 AI 對戰', true);
  await D.waitFor(() => window.__xkj.infer, null, 15000);
  check('敵情推算（背景執行緒）', true);
  await D.page.waitForTimeout(600);
  await D.shot('web-play.png');
  if (!(await D.ev(() => window.__xkj.game.result))) {
    await D.ev(() => document.querySelector('#btnResign').click());
    await D.waitFor(() => document.querySelector('.modal-back'));
    await D.ev(() => document.querySelector('.modal-back .modal-btns button.primary').click());
  }
  await D.waitFor(() => window.__xkj.saved && document.querySelector('.modal-back'));
  await D.ev(() => document.querySelectorAll('.modal-back .modal-btns button').forEach((b) => b.click()));
  // 棋譜存在瀏覽器（IndexedDB），重新整理後還在
  await D.page.reload();
  await D.page.waitForSelector('#startAI');
  check('棋譜存在瀏覽器，重新整理後還在', (await D.ev(() => window.xk.games.list().then((l) => l.length))) >= 1);
  check('教學語音（瀏覽器語音）', await D.ev(() => new Promise((r) => { const go = () => r(speechSynthesis.getVoices().some((v) => /^zh/i.test(v.lang))); if (speechSynthesis.getVoices().length) go(); else { speechSynthesis.onvoiceschanged = go; setTimeout(go, 3000); } })));
  check('電腦瀏覽器：沒有缺檔', D.missing.length === 0, D.missing.join('\n'));
  check('電腦瀏覽器：沒有程式錯誤', D.errors.length === 0, D.errors.join('\n'));

  // ---------- 手機瀏覽器 ----------
  const M = await open('手機', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-S9380) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36' }, BASE + 'online/');
  await M.page.waitForSelector('#startAI', { timeout: 30000 });
  check('手機瀏覽器：直立手機版面', await M.ev(() => document.documentElement.classList.contains('mobile')));
  await setup(M, '阿華', 'f08');
  await M.shot('web-phone-home.png');

  // ---------- 兩個分頁遠端對戰 ----------
  if (local) {
    await D.page.reload(); await D.page.waitForSelector('#startAI');
    await D.page.selectOption('#hostSide', 'red');
    await D.page.click('#btnHost');
    const code = (await D.waitFor(() => document.querySelector('.room-code')?.textContent)).replace(/\s/g, '');
    await M.page.fill('#joinCode', code);
    await M.page.click('#btnJoin');
    await D.waitFor(() => window.__xkj.phase === 'layout');
    await M.waitFor(() => window.__xkj.phase === 'layout');
    await D.ev(() => { document.querySelector('.versus')?.remove(); document.querySelector('#btnLayoutDone').click(); });
    await M.ev(() => { document.querySelector('.versus')?.remove(); document.querySelector('#btnLayoutDone').click(); });
    await D.waitFor(() => document.querySelector('#turnBanner').textContent === '輪到您下棋');
    await D.ev(() => { const g = window.__xkj.game; const m = g.legalMoves()[0]; window.__xkjBoard.onSquareClick(m >> 7); window.__xkjBoard.onSquareClick(m & 127); });
    await M.waitFor(() => window.__xkj.game && window.__xkj.game.moves.length === 1 && document.querySelector('#turnBanner').textContent === '輪到您下棋', null, 20000);
    check('線上版：電腦與手機瀏覽器遠端對戰', true);
    await M.page.waitForTimeout(600);
    await M.shot('web-phone-net.png');
  }
  check('手機瀏覽器：沒有程式錯誤', M.errors.length === 0, M.errors.join('\n'));
} catch (e) {
  fail++;
  console.log('✘ 例外：', e.message);
} finally {
  console.log(`\n通過 ${pass} 項，失敗 ${fail} 項`);
  await browser.close();
  server && server.close();
  peer && peer.close?.();
  process.exit(fail ? 1 : 0);
}
