// 棋譜累積：從所有下過（與匯入）的對局學習
// 1. 對手的布陣習慣（每個位置最常放什麼）→ AI 推算暗子時參考
// 2. 打贏過的布陣 → AI 布陣時參考
import * as J from './sanjun.js';

export class Learned {
  constructor() {
    this.cnt = new Array(J.LSIZE * J.NT).fill(0); // 布陣統計：li × 種類
    this.layouts = new Map();              // 布陣 → { L, w, l, d }
    this.games = 0;
    this.moves = 0;
    this.attacks = 0;
  }

  addRecord(rec) {
    if (!rec || !Array.isArray(rec.layouts) || rec.layouts.length !== 2) return;
    if (rec.layouts.some((L) => J.validateLayout(L))) return;
    this.games++;
    this.moves += (rec.moves || []).length;
    const winner = rec.result === 'red' ? 0 : rec.result === 'blue' ? 1 : rec.result === 'draw' ? -1 : null;
    for (const side of [0, 1]) {
      const L = rec.layouts[side];
      // 真人的布陣比較有參考價值（AI 布陣的權重低一點）
      const human = rec.mode === 'net' || rec.mode === 'import' || (rec.mode === 'ai' && rec.mySide === (side === 0 ? 'red' : 'blue'));
      const wgt = human ? 2 : 1;
      for (let li = 0; li < J.LSIZE; li++) if (L[li]) this.cnt[li * J.NT + L[li]] += wgt;
      if (winner === null) continue;
      const key = L.join('');
      const s = this.layouts.get(key) || { L: L.slice(), w: 0, l: 0, d: 0 };
      if (winner === -1) s.d++; else if (winner === side) s.w++; else s.l++;
      this.layouts.set(key, s);
    }
    // 交戰次數（統計用）
    try { const g = J.replayRecord(rec); this.attacks += g.log.filter((e) => e.out !== 'move').length; } catch {}
  }

  get goodLayouts() {
    return [...this.layouts.values()].filter((s) => s.w > s.l).sort((a, b) => (b.w - b.l) - (a.w - a.l) || b.w - a.w);
  }

  // 傳給背景執行緒用的精簡資料
  plain() { return { cnt: this.games ? this.cnt : null, goodLayouts: this.goodLayouts.slice(0, 8).map((s) => ({ L: s.L, w: s.w, l: s.l })) }; }

  // 某個位置最常見的棋子（給布陣畫面的提示）
  topAt(li) {
    let best = 0, n = 0, tot = 0;
    for (let t = 1; t < J.NT; t++) { const c = this.cnt[li * J.NT + t]; tot += c; if (c > n) { n = c; best = t; } }
    return tot ? { t: best, p: n / tot } : null;
  }
}

export function buildLearned(records) {
  const l = new Learned();
  for (const r of records) l.addRecord(r);
  return l;
}
