// 打包後的程式冒煙測試：node e2e/packaged.mjs <exe 路徑> [截圖]
import { _electron as electron } from 'playwright-core';
import path from 'path';
import fs from 'fs';
import os from 'os';
const exe = process.argv[2];
const shot = process.argv[3];
fs.rmSync(path.join(process.env.APPDATA || os.homedir(), 'xiaoke-sanjun-e2ePkg'), { recursive: true, force: true });
const app = await electron.launch({ executablePath: exe, args: ['--profile=e2ePkg'] });
const win = await app.firstWindow();
const errors = [];
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
win.on('pageerror', (e) => errors.push(e.message));
await win.waitForSelector('#startAI', { timeout: 30000 });
const pickerShown = await win.evaluate(() => !!document.querySelector('.pf'));
await win.evaluate(async () => { window.__xkj.settings = await window.xk.settings.set({ profile: { avatar: 'm01', advisor: 'af15' }, music: { autoplay: false } }); document.querySelectorAll('.modal-back').forEach((b) => b.remove()); });
const portraitOk = await win.evaluate(() => new Promise((res) => { const i = new Image(); i.onload = () => res(i.naturalWidth > 0); i.onerror = () => res(false); i.src = '../../assets/portraits/af15.svg'; }));
const iconOk = await win.evaluate(() => document.querySelector('.hero-icon')?.naturalWidth > 0);
const tracks = await win.evaluate(() => window.xk.music.list().then((l) => l.length));
await win.click('#startAI');
await win.waitForTimeout(1500);
await win.click('#btnLayoutDone');
const r = await win.evaluate(async () => {
  const S = window.__xkj;
  for (let i = 0; i < 100 && !(S.game && S.phase === 'play'); i++) await new Promise((r) => setTimeout(r, 100));
  const l = S.game.legalMoves();
  window.__xkjBoard.onSquareClick(l[0] >> 7); window.__xkjBoard.onSquareClick(l[0] & 127);
  for (let i = 0; i < 100 && S.game.moves.length < 2; i++) await new Promise((r) => setTimeout(r, 200));
  const a = new Audio('app://local/assets/music/track05.mp3');
  await a.play().catch(() => null);
  await new Promise((r) => setTimeout(r, 1200));
  const info = await window.xk.sys.info();
  return { moves: S.game.moves.length, audio: a.currentTime > 0.3, pieces: window.__xkjBoard.allPieces.size, version: info.version, packaged: info.packaged };
});
let update = null;
try { update = await win.evaluate(() => window.xk.update.check().then((u) => ({ latest: u.latest, newer: u.newer, asset: u.asset && u.asset.name })).catch((e) => ({ error: String(e.message || e) }))); } catch {}
if (shot) await win.screenshot({ path: shot });
console.log({ tracks, pickerShown, portraitOk, iconOk, ...r, update, errors });
await app.close();
