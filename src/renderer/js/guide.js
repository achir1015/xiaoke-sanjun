// 三軍棋教學（動畫小棋盤＋語音講解＋練習）與系統功能說明（語音＋文字）
import { $$, h, sleep } from './util.js';
import * as J from './sanjun.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of kids) el.append(c);
  return el;
};
// 「R師:E5 B?:E6 B主:A9」→ Map sq → code（? 表示暗子）
export function parsePieces(spec) {
  const map = new Map();
  if (spec === 'preset') {
    J.PRESETS[0].L.forEach((t, li) => { if (t) map.set(J.sqOfLi(0, li), J.mk(0, t)); });
    J.PRESETS[1].L.forEach((t, li) => { if (t) map.set(J.sqOfLi(1, li), J.mk(1, J.UNK)); });
    return map;
  }
  for (const tok of String(spec || '').trim().split(/\s+/)) {
    const m = /^([RB])(.):([A-I]\d{1,2})$/.exec(tok);
    if (!m) continue;
    const side = m[1] === 'R' ? 0 : 1;
    const t = m[2] === '?' ? J.UNK : J.SHORT.indexOf(m[2]);
    const sq = J.nameToSq(m[3]);
    if (sq >= 0 && t > 0) map.set(sq, J.mk(side, t));
  }
  return map;
}
// 交戰結果文字（教學與練習共用）
export function outOf(a, d) {
  if (!d) return { out: 'move', stay: false };
  const r = J.fight(a & 31, d & 31);
  const out = r === 3 ? 'scout' : r === 2 ? 'flag' : r === 1 ? 'win' : r === -1 ? 'lose' : 'tie';
  return { out, stay: false };
}

// ---------------- 小棋盤（SVG） ----------------
const CXp = 64, RZp = 44, GAPp = 62, OX = 44, OY = 34;
const PX = (sq) => OX + J.colOf(sq) * CXp;
const PYr = (r) => OY + r * RZp + (r >= 6 ? GAPp - RZp : 0) + (r >= 7 ? GAPp - RZp : 0);
const PY = (sq) => PYr(J.rowOf(sq));
const BWp = OX * 2 + 8 * CXp, BHp = PYr(12) + OY;

class MiniBoard {
  constructor(host, onClick) {
    this.host = host;
    this.onClick = onClick;
    this.pieces = new Map();
    this.build();
  }

  build() {
    this.host.innerHTML = '';
    this.svg = svg('svg', { viewBox: `0 0 ${BWp} ${BHp}`, class: 'gb-svg' });
    this.svg.append(svg('rect', { x: 2, y: 2, width: BWp - 4, height: BHp - 4, rx: 16, class: 'gb-sea' }));
    // 外海航道
    for (const c of [0, 8]) this.svg.append(svg('rect', { x: OX + c * CXp - 20, y: 8, width: 40, height: BHp - 16, rx: 12, class: 'gb-lane' }));
    // 陸地
    const lx0 = OX + 2 * CXp - 34, lx1 = OX + 6 * CXp + 34;
    for (const [r0, r1] of [[0, 5], [7, 12]]) this.svg.append(svg('rect', { x: lx0, y: PYr(r0) - 26, width: lx1 - lx0, height: PYr(r1) - PYr(r0) + 52, rx: 14, class: 'gb-land' }));
    this.zones = svg('g');
    this.grid = svg('g', { class: 'gb-grid' });
    this.marks = svg('g');
    this.layer = svg('g');
    this.top = svg('g');
    this.svg.append(this.zones, this.grid, this.marks, this.layer, this.top);
    const N = J.NSQ;
    // 海路
    for (let a = 0; a < N; a++) for (const b of J.SADJ[a]) if (b > a) this.grid.append(svg('line', { x1: PX(a), y1: PY(a), x2: PX(b), y2: PY(b), class: 'gb-searoute' }));
    // 公路（含鐵橋）
    for (let a = 0; a < N; a++) for (const b of J.ADJ[a]) if (b > a && !J.RAILN[a].includes(b)) this.grid.append(svg('line', { x1: PX(a), y1: PY(a), x2: PX(b), y2: PY(b), class: J.isBridge(a) || J.isBridge(b) ? 'gb-bridge' : 'gb-road' }));
    // 鐵路
    for (let a = 0; a < N; a++) for (const b of J.RAILN[a]) if (b > a) {
      this.grid.append(svg('line', { x1: PX(a), y1: PY(a), x2: PX(b), y2: PY(b), class: 'gb-rail' }));
      this.grid.append(svg('line', { x1: PX(a), y1: PY(a), x2: PX(b), y2: PY(b), class: 'gb-rail2' }));
    }
    // 各種兵站
    const text = (x, y, t, cls) => this.grid.append(svg('text', { x, y, class: cls }, t));
    for (let sq = 0; sq < N; sq++) {
      const x = PX(sq), y = PY(sq), k = J.KIND[sq], side = J.halfOf(sq);
      if (k === J.CAMP) this.grid.append(svg('circle', { cx: x, cy: y, r: 18, class: 'gb-camp' }));
      else if (k === J.HQ) { this.grid.append(svg('rect', { x: x - 27, y: y - 16, width: 54, height: 32, rx: 10, class: 'gb-hq ' + (side ? 'b' : 'r') })); text(x, y + 5, '大本營', 'gb-hqt'); }
      else if (k === J.HARBOR) { this.grid.append(svg('rect', { x: x - 24, y: y - 14, width: 48, height: 28, rx: 6, class: 'gb-harbor' })); text(x, y + 5, '⚓港', 'gb-hqt'); }
      else if (k === J.POST) this.grid.append(svg('rect', { x: x - 22, y: y - 13, width: 44, height: 26, rx: 6, class: 'gb-post' }));
      else if (k === J.BRIDGE) { this.grid.append(svg('rect', { x: x - 20, y: y - 20, width: 40, height: 40, rx: 4, class: 'gb-bridgebox' })); text(x, y + 5, '橋', 'gb-hqt'); }
      else if (k === J.SEA || k === J.LANE) this.grid.append(svg('ellipse', { cx: x, cy: y, rx: 20, ry: 12, class: 'gb-seapt' }));
      else if (k === J.AIRFIELD) { this.grid.append(svg('rect', { x: x - 26, y: y - 15, width: 52, height: 30, rx: 5, class: 'gb-air ' + (side ? 'b' : 'r') })); text(x, y + 5, '✈機場', 'gb-airt'); }
    }
    text(OX + 3 * CXp, PYr(6) + 7, '海峽', 'gb-river');
    text(OX + 5 * CXp, PYr(6) + 7, '海峽', 'gb-river');
    for (let c = 0; c < 9; c++) text(OX + c * CXp, BHp - 8, 'ABCDEFGHI'[c], 'gb-coord');
    for (let r = 0; r < 13; r++) text(14, PYr(r) + 5, String(13 - r), 'gb-coord');
    this.svg.addEventListener('click', (e) => {
      const pt = this.svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const p = pt.matrixTransform(this.svg.getScreenCTM().inverse());
      let best = -1, bd = 1e9;
      for (let sq = 0; sq < N; sq++) { if (!J.isNode(sq)) continue; const d = ((p.x - PX(sq)) / 32) ** 2 + ((p.y - PY(sq)) / 21) ** 2; if (d < bd) { bd = d; best = sq; } }
      if (bd < 1.4 && this.onClick) this.onClick(best);
    });
    this.host.append(this.svg);
  }

  pieceEl(code) {
    const side = code >> 5, t = code & 31;
    const dom = t === J.UNK ? '' : J.isShip(t) ? ' ship' : J.isAir(t) ? ' plane' : '';
    const g = svg('g', { class: 'gp ' + (side ? 'b' : 'r') + (t === J.UNK ? ' down' : '') + dom });
    const rx = dom === ' ship' ? 15 : 6;
    g.append(svg('rect', { x: -27, y: -15, width: 54, height: 30, rx, class: 'gp-shadow' }), svg('rect', { x: -27, y: -16, width: 54, height: 30, rx, class: 'gp-body' }));
    const name = t === J.UNK ? '★' : J.NAMES[t];
    g.append(svg('text', { y: 6, class: 'gp-ch', 'font-size': name.length >= 3 ? 15 : 19 }, name));
    return g;
  }

  setPieces(map) {
    this.layer.innerHTML = '';
    this.pieces.clear();
    for (const [sq, code] of map) this.addPiece(sq, code);
  }

  addPiece(sq, code) {
    const g = this.pieceEl(code);
    g.style.transform = `translate(${PX(sq)}px, ${PY(sq)}px)`;
    this.layer.append(g);
    this.pieces.set(sq, { g, code });
  }

  reveal(sq, code) {
    const p = this.pieces.get(sq);
    if (!p) return;
    const ng = this.pieceEl(code);
    ng.style.transform = p.g.style.transform;
    p.g.replaceWith(ng);
    this.pieces.set(sq, { g: ng, code });
  }

  clearMarks() { this.marks.innerHTML = ''; this.top.innerHTML = ''; this.zones.innerHTML = ''; }

  select(sq) { if (sq >= 0) this.marks.append(svg('rect', { x: PX(sq) - 31, y: PY(sq) - 20, width: 62, height: 40, rx: 9, class: 'gm-sel' })); }

  legal(list) {
    for (const sq of list) {
      const cap = this.pieces.has(sq);
      this.marks.append(cap ? svg('rect', { x: PX(sq) - 30, y: PY(sq) - 19, width: 60, height: 38, rx: 9, class: 'gm-cap' }) : svg('circle', { cx: PX(sq), cy: PY(sq), r: 8, class: 'gm-ok' }));
    }
  }

  bad(list) {
    for (const [sq, why] of list) {
      const x = PX(sq), y = PY(sq), s = 9;
      const g = svg('g', { class: 'gm-bad' });
      g.append(svg('circle', { cx: x, cy: y, r: s + 7 }), svg('path', { d: `M${x - s} ${y - s} L${x + s} ${y + s} M${x + s} ${y - s} L${x - s} ${y + s}` }));
      if (why) g.append(svg('title', {}, why));
      this.top.append(g);
    }
  }

  arrow(from, to) {
    const x1 = PX(from), y1 = PY(from), x2 = PX(to), y2 = PY(to);
    const ang = Math.atan2(y2 - y1, x2 - x1), len = Math.hypot(x2 - x1, y2 - y1) - 22;
    const ex = x1 + Math.cos(ang) * len, ey = y1 + Math.sin(ang) * len;
    this.top.append(svg('path', { d: `M${x1} ${y1} L${ex} ${ey}`, class: 'gm-arrow' }),
      svg('path', { d: `M${ex} ${ey} l${-13 * Math.cos(ang - 0.45)} ${-13 * Math.sin(ang - 0.45)} M${ex} ${ey} l${-13 * Math.cos(ang + 0.45)} ${-13 * Math.sin(ang + 0.45)}`, class: 'gm-arrow' }));
  }

  // 一連串格子畫成路線（工兵轉彎）
  path(list) {
    const d = list.map((sq, i) => `${i ? 'L' : 'M'}${PX(sq)} ${PY(sq)}`).join(' ');
    this.top.append(svg('path', { d, class: 'gm-path' }));
  }

  zone(name) {
    const add = (sq, cls = 'gz') => this.zones.append(svg('rect', { x: PX(sq) - 32, y: PY(sq) - 21, width: 64, height: 42, rx: 10, class: cls }));
    for (let sq = 0; sq < J.NSQ; sq++) {
      if (!J.isNode(sq)) continue;
      const k = J.kOf(sq), mine = J.halfOf(sq) === 0, kind = J.KIND[sq];
      const land = J.isLandSq(sq) && !J.isBridge(sq);
      if (name === 'rail' && J.isRail(sq)) add(sq);
      if (name === 'camp' && kind === J.CAMP) add(sq);
      if (name === 'hq' && kind === J.HQ) add(sq);
      if (name === 'harbor' && kind === J.HARBOR) add(sq);
      if (name === 'bridge' && kind === J.BRIDGE) add(sq);
      if (name === 'airfield' && kind === J.AIRFIELD) add(sq);
      if (name === 'lane' && kind === J.LANE) add(sq);
      if (name === 'sea' && (kind === J.SEA || kind === J.LANE)) add(sq, 'gz b');
      if (name === 'land' && land) add(sq);
      if (name === 'red' && mine) add(sq);
      if (name === 'blue' && J.halfOf(sq) === 1) add(sq, 'gz b');
      if (name === 'redsea' && mine && (kind === J.SEA || kind === J.LANE)) add(sq, 'gz b');
      if (name === 'back2' && mine && land && k <= 1) add(sq);
      if (name === 'front' && mine && land && k === 5) add(sq, 'gz bad');
    }
  }

  // stay：遠距攻擊（砲擊、防空）贏了也留在原地；scout：偵察後飛回原位
  async move(from, to, out = 'move', stay = false) {
    const p = this.pieces.get(from);
    if (!p) return sleep(10);
    const victim = this.pieces.get(to);
    const home = p.g.style.transform;
    p.g.classList.add('lift');
    if (out === 'scout' || stay) {
      const mx = (PX(from) * 0.3 + PX(to) * 0.7), my = (PY(from) * 0.3 + PY(to) * 0.7);
      if (stay) this.shot(from, to);
      else p.g.style.transform = `translate(${mx}px, ${my}px)`;
      await sleep(stay ? 520 : 700);
      this.flash(to, out === 'scout' ? 'gm-good' : out === 'tie' ? 'gm-boom' : 'gm-hit');
      p.g.style.transform = home;
      p.g.classList.remove('lift');
      if (out === 'win' && victim) { victim.g.classList.add('gone'); this.pieces.delete(to); setTimeout(() => victim.g.remove(), 500); }
      if (out === 'lose') { p.g.classList.add('gone'); this.pieces.delete(from); setTimeout(() => p.g.remove(), 500); }
      if (out === 'tie' && victim) { p.g.classList.add('gone'); victim.g.classList.add('gone'); this.pieces.delete(from); this.pieces.delete(to); setTimeout(() => { p.g.remove(); victim.g.remove(); }, 500); }
      await sleep(550);
      return;
    }
    this.pieces.delete(from);
    p.g.style.transform = `translate(${PX(to)}px, ${PY(to)}px)`;
    await sleep(700);
    p.g.classList.remove('lift');
    if (out === 'move' || !victim) { this.pieces.set(to, p); return; }
    this.flash(to, out === 'tie' ? 'gm-boom' : 'gm-hit');
    if (out === 'win' || out === 'flag') { victim.g.classList.add('gone'); this.pieces.set(to, p); setTimeout(() => victim.g.remove(), 500); }
    else if (out === 'lose') { p.g.classList.add('gone'); this.pieces.set(to, victim); setTimeout(() => p.g.remove(), 500); }
    else { p.g.classList.add('gone'); victim.g.classList.add('gone'); this.pieces.delete(to); setTimeout(() => { p.g.remove(); victim.g.remove(); }, 500); }
    await sleep(550);
  }

  // 砲彈
  shot(from, to) {
    const c = svg('circle', { cx: PX(from), cy: PY(from), r: 6, class: 'gm-shell' });
    this.top.append(c);
    c.animate([{ transform: 'translate(0,0)' }, { transform: `translate(${PX(to) - PX(from)}px, ${PY(to) - PY(from)}px)` }], { duration: 480, easing: 'ease-in' });
    setTimeout(() => c.remove(), 470);
  }

  flash(sq, cls) {
    const c = svg('circle', { cx: PX(sq), cy: PY(sq), r: 30, class: cls });
    this.top.append(c);
    setTimeout(() => c.remove(), 900);
  }
}

// ---------------- 語音 ----------------
class Narrator {
  constructor() {
    this.on = true;
    this.rate = 1;
    this.voice = null;
    this.onReady = null;
    this.pick();
    if ('speechSynthesis' in window) {
      speechSynthesis.addEventListener('voiceschanged', () => { this.pick(); if (this.onReady) this.onReady(); });
      let n = 0;
      const poll = () => { if (this.voice || ++n > 30) { if (this.onReady) this.onReady(); return; } this.pick(); setTimeout(poll, 200); };
      poll();
    }
  }
  pick() {
    if (!('speechSynthesis' in window)) return;
    const vs = speechSynthesis.getVoices();
    const pref = [/Yating/i, /Hanhan/i, /Mei-?Jia/i, /Zhiwei/i];
    this.voice = pref.map((re) => vs.find((v) => re.test(v.name))).find(Boolean)
      || vs.find((v) => /zh[-_]TW/i.test(v.lang)) || vs.find((v) => /zh[-_]HK/i.test(v.lang)) || vs.find((v) => /^zh/i.test(v.lang)) || null;
  }
  get native() { return window.xk && window.xk.tts && window.xk.tts.available() ? window.xk.tts : null; }
  get available() { if (this.native) return true; if (!this.voice) this.pick(); return 'speechSynthesis' in window && !!this.voice; }
  get voiceName() { return this.native ? this.native.voiceName() : this.voice ? this.voice.name : ''; }
  stop() { if (this.native) this.native.stop(); else if ('speechSynthesis' in window) speechSynthesis.cancel(); }
  pause() { if (this.native) this.native.stop(); else if ('speechSynthesis' in window) speechSynthesis.pause(); }
  resume() { if (!this.native && 'speechSynthesis' in window) speechSynthesis.resume(); }
  speak(text) {
    const plain = String(text).replace(/[「」（）()→]/g, ' ');
    const est = 700 + plain.length * 210 / this.rate;
    if (!this.on || !this.available) return sleep(Math.min(9000, 900 + plain.length * 95));
    if (this.native) { this.native.stop(); return this.native.speak(plain, this.rate); }
    return new Promise((resolve) => {
      this.stop();
      const u = new SpeechSynthesisUtterance(plain);
      u.voice = this.voice; u.lang = this.voice.lang; u.rate = this.rate; u.pitch = 1;
      let done = false;
      const fin = () => { if (!done) { done = true; clearTimeout(t); resolve(); } };
      const t = setTimeout(fin, est * 2 + 4000);
      u.onend = fin; u.onerror = fin;
      speechSynthesis.speak(u);
    });
  }
}

// ---------------- 課程 ----------------
// 步驟：pieces 擺子、say 解說、zones 標示、sel 選子、legal 顯示可走位置、bad 錯誤位置（自動說明原因）、
// arrow 箭頭、path 路線、move 動畫（交戰時依規則判定）、reveal 翻開暗子、practice 練習 { piece, goal? }
export const LESSONS = [
  { title: '認識棋盤', steps: [
    { pieces: '', zones: ['red'], say: '歡迎來到三軍棋！棋盤分成上下兩半，下面是紅軍、上面是藍軍，中間隔著一道海峽。每一方有陸軍、海軍、空軍，共三十三顆棋子。' },
    { zones: ['land'], say: '中間黃色的是陸地，有兵站、鐵路、公路、行營和大本營。陸軍只能在陸地上走。' },
    { zones: ['sea'], say: '兩邊藍色的是海洋，軍艦只能在海上航行。最外側的 A 行和 I 行是外海航道，可以一口氣直航。' },
    { zones: ['airfield'], say: '每一方底線的兩個角落是飛機場。偵察機和戰鬥機從這裡起飛，可以飛越陸地和海洋。' },
    { zones: ['harbor'], say: '陸地邊上有港口，軍艦可以開進港口，和陸軍在這裡交戰。' },
    { zones: ['bridge'], say: '海峽上有三座鐵橋，陸軍只能從鐵橋過海，而且過橋時一定要在橋上停一步。' },
  ] },
  { title: '陸軍官階', steps: [
    { pieces: 'R司:C2 R軍:D2 R師:E2 R旅:F2 R團:G2 R營:C3 R連:E3 R排:G3 R工:C4', say: '陸軍的軍官由大到小是：總司令、軍長、師長、旅長、團長、營長、連長、排長，最小的是工兵。' },
    { pieces: 'R師:E5 B旅:E6', arrow: ['E5', 'E6'], move: ['E5', 'E6'], say: '兩顆棋子相碰叫做交戰，官大的吃掉官小的。師長比旅長大，所以師長贏了。' },
    { pieces: 'R連:C5 B連:C6', move: ['C5', 'C6'], say: '一樣大的棋子相碰，兩顆會同歸於盡，一起拿下棋盤。' },
    { pieces: 'R排:G5 B團:G6', move: ['G5', 'G6'], say: '小的去碰大的，自己就陣亡了。所以攻擊前要先想清楚。' },
  ] },
  { title: '炸彈', steps: [
    { pieces: 'R炸:E5 B司:E6', say: '炸彈很特別：不論碰到陸軍、軍艦還是飛機，都會和對方同歸於盡。' },
    { pieces: 'R炸:E5 B司:E6', move: ['E5', 'E6'], say: '用一顆炸彈換掉對方的總司令，是非常划算的交換！' },
    { pieces: 'R司:E5 B炸:E6', move: ['E5', 'E6'], say: '反過來，如果大子不小心撞到對方的炸彈，也會一起陣亡。' },
    { pieces: 'R炸:D12 B旗:D13', move: ['D12', 'D13'], say: '不過炸彈不能奪旗，撞到軍旗只會自己報銷。' },
    { pieces: '', zones: ['front'], say: '布陣時，炸彈不能放在陸地的第一排，也就是最靠近海峽的那一排。' },
  ] },
  { title: '地雷與工兵', steps: [
    { pieces: 'B團:C3 R雷:C2', say: '地雷埋在陣地裡不能移動。一般棋子碰到地雷，會和地雷同歸於盡。' },
    { pieces: 'B團:C3 R雷:C2', move: ['C3', 'C2'], say: '對方的團長踩到了地雷，和地雷一起被炸掉。' },
    { pieces: 'B工:C3 R雷:C2', move: ['C3', 'C2'], say: '工兵會拆地雷，工兵碰到地雷，地雷就被安全地挖掉了。' },
    { pieces: 'B戰:C4 R雷:C2', move: ['C4', 'C2'], say: '戰鬥機也能從空中把地雷炸掉，而且自己毫髮無傷。' },
    { pieces: '', zones: ['back2'], say: '布陣時，兩顆地雷只能放在陸地的最後兩排。' },
  ] },
  { title: '軍旗與大本營', steps: [
    { pieces: 'R旗:D1 R雷:C1 R雷:E1 R高:D2', zones: ['hq'], say: '軍旗只能放在大本營，旗子和地雷一樣不能移動。通常會用地雷把軍旗圍起來保護。' },
    { pieces: 'R旗:D1 B工:D2', arrow: ['D2', 'D1'], say: '只要攻進對方放軍旗的大本營，奪下軍旗，就贏得這盤棋！陸軍軍官、工兵和軍艦都能奪旗。' },
    { pieces: 'R旗:D1 B工:D2', move: ['D2', 'D1'], say: '奪旗成功，這一方獲勝。' },
    { pieces: 'B師:F1', sel: 'F1', legal: true, say: '注意：任何棋子進了大本營，就不能再移動了，所以不要隨便把大子走進大本營。' },
    { pieces: 'R司:E5 B司:E6 B?:D13 B?:F13', move: ['E5', 'E6'], say: '還有一條規則：總司令陣亡的那一方，要把軍旗的位置亮出來給對方看。' },
  ] },
  { title: '公路與鐵路', steps: [
    { pieces: 'R團:D4', sel: 'D4', legal: true, say: '在公路上，棋子一次只能往前、後、左、右走一步。' },
    { pieces: 'R團:E3', sel: 'E3', legal: true, bad: ['E5', 'D2'], say: '公路不能斜著走，也不能一次走兩步。斜走只能用在進出行營。' },
    { pieces: 'R師:C2', sel: 'C2', legal: true, say: '在鐵路上，只要前面沒有棋子擋住，可以沿著直線一口氣走到底。' },
    { pieces: 'R師:C2 R排:C4', sel: 'C2', legal: true, bad: ['C6'], say: '鐵路上中間有棋子擋住，就不能越過去。' },
    { pieces: 'R師:C2', sel: 'C2', bad: ['G6'], say: '除了工兵以外，其他棋子在鐵路上只能走直線，不能轉彎。' },
    { pieces: 'R師:C2 B營:G2', practice: { piece: 'C2', goal: 'G2' }, say: '換您試試：讓師長沿著第二排的鐵路，衝過去攻擊右邊的營長。' },
  ] },
  { title: '工兵飛行', steps: [
    { pieces: 'R工:C2', sel: 'C2', legal: true, say: '工兵是鐵路上的特種兵，可以在鐵路上轉彎，到達任何一個有鐵路相通、沒有被擋住的兵站。' },
    { pieces: 'R工:C2', path: ['C2', 'C6', 'G6'], move: ['C2', 'G6'], say: '例如這顆工兵，沿著鐵路轉了一個彎，直接飛到前線的另一邊。' },
    { pieces: 'R工:E2 B雷:C12', practice: { piece: 'E2' }, say: '換您試試：點一個這顆工兵可以到達的位置。' },
  ] },
  { title: '行營', steps: [
    { pieces: 'R團:E4', zones: ['camp'], sel: 'E4', legal: true, say: '行營可以斜著進出：中央行營四周八個方向的兵站，都可以走一步進出。' },
    { pieces: 'R司:E3 B排:E4', sel: 'E3', bad: ['E4'], say: '躲在行營裡的棋子，任何人都不能攻擊它，就算是總司令、炸彈或飛機也不行。' },
    { pieces: 'R司:E4 B排:E3', move: ['E4', 'E3'], say: '但是行營裡的棋子可以出來攻擊別人。' },
    { pieces: 'R營:C2', practice: { piece: 'C2', goal: 'D3' }, say: '換您試試：把營長斜著走進旁邊的行營。' },
  ] },
  { title: '鐵橋過海峽', steps: [
    { pieces: 'R團:C6 R團:E6 R團:G6', zones: ['bridge'], say: '海峽上只有 C、E、G 三座鐵橋，是陸軍過海唯一的通道。' },
    { pieces: 'R師:E6', sel: 'E6', legal: true, bad: ['E8', 'D7'], say: '過橋時要先走上橋、停一步，下一步才能上對岸。海峽其他地方是深海，陸軍過不去。' },
    { pieces: 'R師:E7 B?:E8', move: ['E7', 'E8'], say: '站在橋上的師長，下一步就能攻擊對岸的敵軍。橋頭常常是雙方交戰最激烈的地方。' },
  ] },
  { title: '海軍航行', steps: [
    { pieces: 'R主:A2', sel: 'A2', legal: true, say: '外海航道上的軍艦，只要沒有船擋住，可以一口氣直航到底，甚至直接開到對方後方。' },
    { pieces: 'R驅:B3', sel: 'B3', legal: true, say: '在近海裡，軍艦一次只能前後左右走一格。' },
    { pieces: 'R巡:B4', sel: 'B4', legal: true, bad: ['D4'], say: '軍艦可以開進港口，但是不能上岸。' },
    { pieces: 'R驅:C4', sel: 'C4', legal: true, say: '開進港口的軍艦，下一步只能退回海上。' },
    { pieces: 'R主:A2 B巡:A11', practice: { piece: 'A2', goal: 'A11' }, say: '換您試試：讓主力艦沿著外海航道，直航去攻擊對方的巡洋艦。' },
  ] },
  { title: '海軍大小與潛水艇', steps: [
    { pieces: 'R主:A5 B巡:A6', move: ['A5', 'A6'], say: '軍艦由大到小是：主力艦、巡洋艦、砲艦、驅逐艦、潛水艇。大艦吃小艦。' },
    { pieces: 'R潛:B5 B主:B6', move: ['B5', 'B6'], say: '潛水艇是海中殺手：它主動偷襲時，能擊沉主力艦、巡洋艦和砲艦！' },
    { pieces: 'R主:B5 B潛:B6', move: ['B5', 'B6'], say: '可是如果是大艦先攻擊潛水艇，潛水艇就會被擊沉。' },
    { pieces: 'R潛:H5 B驅:H6', move: ['H5', 'H6'], say: '驅逐艦是潛水艇的天敵，潛水艇碰上驅逐艦一定沉沒。' },
    { pieces: 'R驅:H5 B潛:H6', move: ['H5', 'H6'], say: '所以艦隊裡要帶著驅逐艦，專門保護大艦不被潛水艇偷襲。' },
  ] },
  { title: '砲艦炮擊', steps: [
    { pieces: 'R砲:B5 B團:C5', arrow: ['B5', 'C5'], say: '砲艦可以炮擊緊鄰海岸的陸地兵站。' },
    { pieces: 'R砲:B5 B團:C5', move: ['B5', 'C5'], say: '炮擊打贏了，敵軍被消滅，砲艦還是留在海上。但如果打不贏對方，砲艦會被反擊擊沉。' },
    { pieces: 'R砲:B9 B戰:B10', move: ['B9', 'B10'], say: '砲艦還有防空砲，能擊落飛到海上的敵機。' },
  ] },
  { title: '空軍飛行', steps: [
    { pieces: 'R戰:B1', sel: 'B1', legal: true, say: '飛機沿著直線或斜線飛行，像米字一樣，可以飛越陸地、海洋和中間的棋子。戰鬥機一次最多飛三格。' },
    { pieces: 'R戰:B1', sel: 'B1', bad: ['C4', 'B5'], say: '不是直線或斜線的位置不能去，超過三格也飛不到。' },
    { pieces: 'R偵:H1', sel: 'H1', legal: true, say: '偵察機飛得更遠，一次最多四格。飛機不能降落在大本營。' },
    { pieces: 'R戰:B1 B驅:B3', practice: { piece: 'B1', goal: 'B3' }, say: '換您試試：讓戰鬥機飛過去攻擊海上的驅逐艦。' },
  ] },
  { title: '戰鬥機與高射炮', steps: [
    { pieces: 'R戰:E3 B司:E5', move: ['E3', 'E5'], say: '戰鬥機在空中佔盡優勢，可以吃掉陸軍和軍艦，連總司令、主力艦也不例外！' },
    { pieces: 'R戰:E3 B高:E5', move: ['E3', 'E5'], say: '但是戰鬥機怕高射炮。戰鬥機去攻擊高射炮，會被擊落。' },
    { pieces: 'R高:C2 B戰:B2', move: ['C2', 'B2'], say: '高射炮也能主動射擊旁邊一格的海上或機場上的敵機，擊落後留在原地。' },
    { pieces: 'R團:E5 B戰:E6', sel: 'E5', legal: true, say: '一般的陸軍和軍艦攻擊戰鬥機，只會被打下來。要對付戰鬥機，請用高射炮、砲艦、炸彈，或自己的戰鬥機同歸於盡。' },
  ] },
  { title: '偵察機', steps: [
    { pieces: 'R偵:H1 B?:H4', say: '偵察機不會交戰。它飛到對方的暗子上，就能偵察出那是什麼棋子。' },
    { pieces: 'R偵:H1 B?:H4', reveal: ['H4', 'B潛'], move: ['H1', 'H4'], say: '偵察完，對方的棋子會翻開讓大家看到，偵察機自己飛回原位。' },
    { pieces: 'B驅:H3 R偵:H2', move: ['H3', 'H2'], say: '偵察機沒有武器，任何棋子攻擊它，它都會被打下來，要好好保護。' },
  ] },
  { title: '布陣規則', steps: [
    { pieces: 'preset', zones: ['red'], say: '開戰前，雙方各自在自己的陣地布陣，對方看不到您的布陣。' },
    { zones: ['hq'], say: '規則一：軍旗只能放在大本營。' },
    { zones: ['back2'], say: '規則二：兩顆地雷只能放在陸地的最後兩排。' },
    { zones: ['front'], say: '規則三：兩顆炸彈不能放在陸地的第一排。' },
    { zones: ['camp'], say: '規則四：行營一開始都要空著。' },
    { zones: ['redsea'], say: '規則五：十艘軍艦放在自己這邊的海上。' },
    { zones: ['airfield'], say: '規則六：偵察機和戰鬥機放在自己的兩個飛機場。' },
    { say: '在遊戲裡，點一顆自己的棋子，再點另一顆或空格，就能互換或移動；也可以套用經典布陣、隨機布陣，或請 AI 軍師推薦。' },
  ] },
  { title: '暗棋與敵情推算', steps: [
    { pieces: 'preset', say: '暗棋模式下，您看不到對方的棋子，只看得到一顆顆暗子。交戰時由裁判判定勝負，只公布結果。' },
    { pieces: 'R師:E5 B?:E6', move: ['E5', 'E6'], say: '例如我方師長攻擊一顆暗子贏了，就可以推算：那顆暗子比師長小。' },
    { pieces: 'R旅:C5 B?:C6', reveal: ['C6', 'B軍'], move: ['C5', 'C6'], say: '如果旅長攻擊後陣亡了，代表那顆暗子比旅長大，或是炸彈、地雷。' },
    { say: '棋子的起始位置也是線索：在海上的一定是軍艦，在機場的一定是飛機，地雷只可能在最後兩排；在鐵路上轉彎的一定是工兵。' },
    { say: '遊戲右側的「敵情」分頁，會自動幫您做這些推算，並在棋盤上標示每顆暗子最可能是什麼。AI 也只用同樣的資訊，絕不偷看。' },
  ] },
  { title: '勝負與和棋', steps: [
    { say: '獲勝方法一：奪下對方的軍旗。' },
    { say: '獲勝方法二：對方所有能動的棋子都被消滅或無路可走，輪到對方時沒有棋可以走，就算對方輸。' },
    { say: '如果連續五十回合，也就是一百步都沒有交戰，就判定和棋。也可以提議和棋或認輸。' },
  ] },
  { title: '實戰技巧', steps: [
    { pieces: 'preset', say: '技巧一：先派偵察機翻開對方前線的大子，再決定要用誰去打。' },
    { say: '技巧二：炸彈留在後方，等對方的總司令、軍長衝進來時，再用炸彈換掉它。' },
    { say: '技巧三：高射炮守在軍旗附近，對方的戰鬥機就不敢亂飛。' },
    { say: '技巧四：艦隊帶著驅逐艦一起行動，小心潛水艇偷襲；砲艦守在港口旁邊，炮擊上岸的敵軍。' },
    { say: '技巧五：工兵要保留幾顆，最後才能挖開軍旗旁邊的地雷。別忘了回防！祝您旗開得勝！' },
  ] },
];

// 系統功能說明（語音＋文字）
export const HELP = [
  { title: '首頁與三種對戰', icon: '🏠', paras: [
    '首頁上方可以選「暗棋」或「明棋」。暗棋是正式玩法，看不到對方的棋子，由裁判判定勝負；明棋雙方棋子全部公開，適合練習。',
    'A 真人對 AI：不需要網路，可以選紅軍或藍軍、五種難度。B 真人對真人：建立房間把六位數房號告訴朋友，對方輸入房號就能連線。C AI 對 AI：觀看兩個 AI 對戰。',
    '開始之前要先選好自己的半身頭像，以及陪同參賽的 AI 軍師，按首頁右上方的頭像就能更換。',
  ] },
  { title: '布陣', icon: '🛡', paras: [
    '每局開始先布陣。點一顆自己的棋子，再點另一顆棋子或空格，就會互換或移動位置。陸軍放陸地、軍艦放海上、飛機放機場，不合規則的會告訴您原因。',
    '左邊的布陣面板可以套用經典布陣、隨機布陣、請 AI 軍師推薦，也可以把喜歡的布陣儲存起來，下次直接套用。',
    '排好以後按「布陣完成，開戰」。真人對戰時，雙方都完成布陣才會開始。',
  ] },
  { title: '走棋與戰況紀錄', icon: '♟', paras: [
    '輪到您時，畫面上方會顯示「輪到您下棋」。點自己的棋子，綠點是可以走的位置，紅框是可以攻擊的敵子，再點目標就完成一步。',
    '走錯時會跳出原因，例如「只有工兵可以在鐵路上轉彎」「軍艦不能上岸」。左邊的戰況紀錄會列出每一步、交戰與偵察結果。',
    '下方按鈕有提示、軍師代打、悔棋、提和、認輸、新局與匯出棋譜。',
  ] },
  { title: '敵情推算', icon: '🔍', paras: [
    '右側「敵情」分頁會根據對方棋子的起始位置、走法、每次交戰的結果和偵察機翻開的棋子，推算每顆暗子最可能是什麼，並列出對方剩下的兵力。',
    '勾選「在棋盤上標示」後，暗子上方會出現推算標籤，例如「炸？百分之四十五」。金色標籤代表已經確定。',
  ] },
  { title: 'AI 軍師與代打', icon: '🧙', paras: [
    '右側「軍師」分頁可以隨時請教陪同的 AI 軍師，例如現在該怎麼走、對方哪顆是大子、軍旗安不安全。軍師會在棋盤上用綠色箭頭標出建議。',
    '有 Anthropic API 金鑰時，軍師會用 Claude 白話解說；沒有金鑰也能使用本機 AI 的建議。',
    '需要暫時離開時，按「軍師代打」，由 AI 軍師接手下棋，回來後按「交還主位」就能換回自己。對局中也可以按「換軍師」更換陪同的軍師。',
  ] },
  { title: '遠端對戰與語音', icon: '🌐', paras: [
    '真人對真人時，右側「對話」分頁可以打字聊天，按「語音通話」就能和對方直接講話，通話時背景音樂會自動調小聲。',
    '如果連線中斷，重新加入同一個房間，就會回到原本的棋局。',
  ] },
  { title: '背景音樂與音效', icon: '♫', paras: [
    '遊戲內建二十首原創軍樂風格背景音樂，每首約三分多鐘。右上角「背景音樂」按鈕按一下播放或暫停，滑鼠移上去會出現直立的音量滑桿，往上大聲、往下小聲。',
    '「音效」按鈕旁邊也有直立的音量滑桿，可以調整走棋、交戰、炸彈爆炸的音效大小。右側「音樂」分頁可以換歌、隨機播放，或加入自己的音樂。',
  ] },
  { title: '棋譜庫與學習', icon: '📜', paras: [
    '每下完一局，棋譜會自動存進棋譜庫，可以重播、匯出或刪除，也可以匯入別人的棋譜。重播時雙方的布陣全部翻開。',
    'AI 會從棋譜中累積學習：記住對手常把什麼棋子放在哪裡，推算暗子時更準；也會記住打贏過的布陣，下次拿來使用。',
  ] },
  { title: '視角與操作', icon: '🎥', paras: [
    '右上角可以切換斜視、俯視、立體三種視角，按「⇅」可以翻轉棋盤方向。',
    '滑鼠右鍵拖曳可以旋轉棋盤，滾輪可以放大縮小；觸控螢幕用兩指拖曳旋轉、兩指捏合縮放。',
  ] },
  { title: '版本更新', icon: '🔄', paras: [
    '程式開啟時會自動檢查有沒有新版本，也可以到「設定」或「關於與更新」按「檢查更新」。',
    '有新版時按「立即更新」，程式會自動下載安裝並重新開啟，棋譜與設定都會保留。',
  ] },
];

export class Guide {
  constructor(root, { settings, save, onBack }) {
    this.root = root;
    this.save = save || (() => {});
    this.onBack = onBack;
    this.narr = new Narrator();
    this.narr.on = settings.guideVoice !== false;
    this.narr.rate = settings.guideRate || 1;
    this.narr.onReady = () => this.renderVoice();
    this.which = 'rules';
    this.lesson = 0;
    this.token = 0;
    this.paused = false;
    this.practice = null;
    this.build();
  }

  build() {
    const r = this.root;
    r.innerHTML = '';
    this.list = h('div', { class: 'gd-list' });
    this.caption = h('div', { class: 'gd-caption' }, '');
    this.boardHost = h('div', { class: 'gd-board' });
    this.board = new MiniBoard(this.boardHost, (sq) => this.onBoardClick(sq));
    this.helpHost = h('div', { class: 'gd-help hidden' });
    this.btnPlay = h('button', { class: 'primary', id: 'gdPlay', onclick: () => this.togglePlay() }, '⏸ 暫停');
    this.btnVoice = h('button', { id: 'gdVoice', onclick: () => this.toggleVoice() });
    this.rateSel = h('select', { id: 'gdRate', onchange: () => { this.narr.rate = Number(this.rateSel.value); this.save({ guideRate: this.narr.rate }); } },
      [[0.8, '慢'], [1, '一般'], [1.2, '快']].map(([v, l]) => h('option', { value: v, selected: v === this.narr.rate }, `語速：${l}`)));
    this.status = h('div', { class: 'gd-status muted small' });
    this.tabs = h('div', { class: 'kind-tabs gd-tabs' },
      ...[['rules', '📖 三軍棋教學'], ['help', '🔊 系統功能說明']].map(([k, t]) => h('button', { class: 'kindbtn', 'data-gk': k, onclick: () => this.open(k) }, h('b', {}, t))));
    r.append(
      h('div', { class: 'gd-head' }, h('button', { class: 'ghost', onclick: () => this.close() }, '⟵ 首頁'), h('h2', { id: 'gdTitle' }, '📖 三軍棋教學'), this.tabs),
      h('div', { class: 'gd-body' },
        this.list,
        h('div', { class: 'gd-main' },
          this.caption,
          this.boardHost,
          this.helpHost,
          h('div', { class: 'gd-ctrl' },
            h('button', { onclick: () => this.go(this.lesson - 1) }, '⏮ 上一課'),
            h('button', { onclick: () => this.go(this.lesson) }, '↺ 重播'),
            this.btnPlay,
            h('button', { onclick: () => this.go(this.lesson + 1) }, '下一課 ⏭'),
            this.btnVoice, this.rateSel),
          this.status)));
    this.renderVoice();
  }

  get items() { return this.which === 'help' ? HELP : LESSONS; }

  open(which = 'rules') {
    this.which = which === 'help' ? 'help' : 'rules';
    $$('[data-gk]', this.root).forEach((b) => b.classList.toggle('on', b.dataset.gk === this.which));
    this.root.querySelector('#gdTitle').textContent = this.which === 'help' ? '🔊 系統功能說明' : '📖 三軍棋教學';
    this.root.classList.toggle('help-mode', this.which === 'help');
    this.boardHost.classList.toggle('hidden', this.which === 'help');
    this.helpHost.classList.toggle('hidden', this.which !== 'help');
    this.lesson = 0;
    this.renderList();
    this.go(0);
  }

  close() {
    this.token++;
    this.narr.stop();
    this.onBack && this.onBack();
  }

  renderList() {
    this.list.innerHTML = '';
    this.items.forEach((l, i) => this.list.append(h('button', { class: 'gd-item' + (i === this.lesson ? ' on' : ''), onclick: () => this.go(i) }, h('span', { class: 'n' }, l.icon || String(i + 1)), l.title)));
  }

  renderVoice() {
    const ok = this.narr.available;
    this.btnVoice.textContent = !ok ? '🔇 無語音' : this.narr.on ? '🔊 語音解說：開' : '🔈 語音解說：關';
    this.btnVoice.disabled = !ok;
    this.btnVoice.title = ok ? `使用語音：${this.narr.voiceName}` : '這台裝置沒有中文語音，解說會以文字顯示';
  }

  toggleVoice() {
    this.narr.on = !this.narr.on;
    if (!this.narr.on) this.narr.stop();
    this.save({ guideVoice: this.narr.on });
    this.renderVoice();
  }

  togglePlay() {
    this.paused = !this.paused;
    this.btnPlay.textContent = this.paused ? '▶ 繼續' : '⏸ 暫停';
    if (this.paused) this.narr.pause(); else { this.narr.resume(); if (this.resumeGate) this.resumeGate(); }
  }

  async gate(tok) {
    while (this.paused && tok === this.token) await new Promise((r) => { this.resumeGate = r; setTimeout(r, 300); });
    return tok === this.token;
  }

  go(i) {
    if (i < 0 || i >= this.items.length) return;
    this.lesson = i;
    this.renderList();
    this.paused = false;
    this.btnPlay.textContent = '⏸ 暫停';
    const tok = ++this.token;
    if (this.which === 'help') this.runHelp(tok); else this.run(tok);
  }

  // 依擺子算合法走法與錯誤原因
  boardOf(map) { const b = new Int8Array(J.NSQ); for (const [sq, c] of map) b[sq] = (c & 31) === J.UNK ? J.mk(c >> 5, J.PAI) : c; return b; }

  async run(tok) {
    this.narr.stop();
    this.practice = null;
    const lesson = LESSONS[this.lesson];
    this.status.textContent = `第 ${this.lesson + 1} 課：${lesson.title}（共 ${lesson.steps.length} 步）`;
    let map = new Map();
    for (let i = 0; i < lesson.steps.length; i++) {
      if (!(await this.gate(tok))) return;
      const st = lesson.steps[i];
      if (st.pieces != null) { map = parsePieces(st.pieces); this.board.setPieces(map); }
      const b = this.boardOf(map);
      this.board.clearMarks();
      for (const z of st.zones || []) this.board.zone(z);
      const sel = st.sel ? J.nameToSq(st.sel) : st.practice ? J.nameToSq(st.practice.piece) : -1;
      if (sel >= 0) this.board.select(sel);
      if (st.legal && sel >= 0) this.board.legal(J.targetList(b, sel));
      if (st.bad && sel >= 0) this.board.bad(st.bad.map((s) => { const to = J.nameToSq(s); return [to, J.explainIllegal(b, sel, to)]; }));
      if (st.arrow) this.board.arrow(J.nameToSq(st.arrow[0]), J.nameToSq(st.arrow[1]));
      if (st.path) this.board.path(st.path.map(J.nameToSq));
      let text = st.say;
      if (st.bad && sel >= 0) {
        const reasons = [...new Set(st.bad.map((s) => J.explainIllegal(b, sel, J.nameToSq(s))).filter(Boolean))];
        if (reasons.length) text += '\n✕ ' + reasons.join('\n✕ ');
      }
      this.caption.textContent = text;
      this.caption.classList.toggle('practice', !!st.practice);
      const talk = this.narr.speak(st.say);
      if (st.move) {
        await sleep(1100);
        if (tok !== this.token) return;
        const f = J.nameToSq(st.move[0]), t = J.nameToSq(st.move[1]);
        if (st.reveal) { const [rs, rc] = st.reveal; const m = parsePieces(`${rc[0]}${rc[1]}:${rs}`); for (const [sq, code] of m) { b[sq] = code; } }
        const a = b[f], d = b[t];
        const { out } = outOf(a, d);
        const stay = out !== 'move' && out !== 'scout' && !J.canStand(a & 31, t);
        this.board.arrow(f, t);
        await this.board.move(f, t, out, out === 'scout' ? false : stay);
        if (st.reveal) { const [rs, rc] = st.reveal; const sq = J.nameToSq(rs); if (out === 'lose' || out === 'scout') this.board.reveal(sq, parsePieces(`${rc[0]}${rc[1]}:${rs}`).get(sq)); }
        // 更新擺子
        if (out !== 'scout') {
          if (!(stay && out === 'win')) map.delete(f);
          if (stay && out === 'win') map.delete(t);
          else if (out === 'move' || out === 'win' || out === 'flag') map.set(t, a);
          else if (out === 'tie') { map.delete(t); map.delete(f); }
        }
        const extra = { win: stay ? '遠距攻擊命中，敵軍被消滅。' : '進攻方獲勝。', lose: '進攻方陣亡。', tie: '雙方同歸於盡。', flag: '奪下軍旗！', scout: '偵察成功，翻開了對方的棋子。' }[out];
        if (extra) this.caption.textContent += '\n→ ' + extra;
        // 總司令陣亡亮旗示範
        if (out === 'tie' && (a & 31) === J.SI) {
          await sleep(500);
          for (const [sq, code] of map) if ((code & 31) === J.UNK && J.isHQ(sq)) { this.board.reveal(sq, J.mk(code >> 5, J.FLAG)); this.board.flash(sq, 'gm-good'); break; }
          this.caption.textContent += '\n→ 雙方總司令都陣亡了，藍軍亮出軍旗的位置。';
        }
      }
      if (st.practice) {
        const ok = await this.runPractice(tok, b, st.practice);
        if (!ok) return;
      } else {
        await talk;
        if (tok !== this.token) return;
        await sleep(st.pause || 700);
      }
    }
    if (tok !== this.token) return;
    const next = this.lesson + 1 < LESSONS.length;
    this.caption.textContent = next ? `「${lesson.title}」說明完畢。按「下一課」繼續學「${LESSONS[this.lesson + 1].title}」。` : '三軍棋教學全部看完了，祝您旗開得勝！';
    this.narr.speak(next ? '這一課說明完畢。' : '教學全部看完了，祝您旗開得勝！');
  }

  runPractice(tok, b, pr) {
    const from = J.nameToSq(pr.piece);
    const targets = J.targetList(b, from);
    const goal = pr.goal ? J.nameToSq(pr.goal) : null;
    this.status.textContent = '練習中：在棋盤上點選目標位置（點錯會告訴您原因）';
    return new Promise((resolve) => {
      this.practice = {
        click: async (sq) => {
          if (tok !== this.token || sq === from) return;
          const good = targets.includes(sq) && (goal == null || sq === goal);
          if (good) {
            this.practice = null;
            this.board.clearMarks();
            this.board.flash(sq, 'gm-good');
            const { out } = outOf(b[from], b[sq]);
            await this.board.move(from, sq, out, out === 'win' && !J.canStand(b[from] & 31, sq));
            this.caption.textContent = '答對了！做得好。';
            await this.narr.speak('答對了！做得好。');
            this.status.textContent = '';
            resolve(tok === this.token);
            return;
          }
          this.board.flash(sq, 'gm-wrong');
          const why = targets.includes(sq) ? '這一步可以走，但這題要找另一個位置喔。' : (J.explainIllegal(b, from, sq) || '這個位置不能走喔。');
          this.caption.textContent = `✕ ${why}\n再試一次，或按「看答案」。`;
          this.narr.speak(why);
        },
      };
      const show = h('button', { class: 'gd-answer', onclick: () => {
        if (!this.practice) return;
        this.board.legal(goal != null ? [goal] : targets);
        this.caption.textContent = '綠色的位置就是答案，點它試試看。';
        show.remove();
      } }, '看答案');
      this.status.append(' ', show);
    });
  }

  onBoardClick(sq) { if (this.practice) this.practice.click(sq); }

  // 系統功能說明：逐段朗讀，目前這段會亮起來
  async runHelp(tok) {
    this.narr.stop();
    const item = HELP[this.lesson];
    this.helpHost.innerHTML = '';
    const paras = item.paras.map((p, i) => h('p', { class: 'gd-para', onclick: () => this.narr.speak(p) }, h('span', { class: 'gd-pn' }, String(i + 1)), p));
    this.helpHost.append(h('div', { class: 'gd-help-head' }, h('span', { class: 'gd-help-icon' }, item.icon), h('h3', {}, item.title)), ...paras);
    this.caption.textContent = `${item.icon} ${item.title}`;
    this.status.textContent = `第 ${this.lesson + 1} 項，共 ${HELP.length} 項。點任何一段文字可以單獨朗讀。`;
    for (let i = 0; i < paras.length; i++) {
      if (!(await this.gate(tok))) return;
      paras.forEach((p, k) => p.classList.toggle('on', k === i));
      await this.narr.speak(item.paras[i]);
      if (tok !== this.token) return;
      await sleep(400);
    }
    paras.forEach((p) => p.classList.remove('on'));
  }
}
