// 三軍棋 AI：先推算對方布陣（多次抽樣），再對每一種可能做 α-β 搜尋，取平均最好的一步
import * as J from './sanjun.js';
import { buildBelief, sample, marginals, popcount } from './belief.js';

const { NSQ, GONG, SI, BOMB, MINE, FLAG, UNK, RECON } = J;

export const LEVELS = [
  { name: '入門', samples: 3, depth: 1, timeMs: 150, noise: 45 },
  { name: '初級', samples: 6, depth: 2, timeMs: 350, noise: 18 },
  { name: '中級', samples: 10, depth: 2, timeMs: 750, noise: 6 },
  { name: '高級', samples: 16, depth: 3, timeMs: 1500, noise: 0 },
  { name: '大師', samples: 28, depth: 3, timeMs: 3000, noise: 0 },
];

// 棋子價值
const VAL = new Int16Array(32);
[[J.GONG, 20], [J.PAI, 12], [J.LIAN, 16], [J.YING, 22], [J.TUAN, 30], [J.LV, 40], [J.SHI, 55], [J.JUN, 75], [J.SI, 100], [BOMB, 52], [MINE, 20], [FLAG, 0],
  [J.AA, 26], [J.SUB, 28], [J.DD, 30], [J.GB, 36], [J.CA, 40], [J.BB, 55], [RECON, 18], [J.FIGHTER, 72]].forEach(([t, v]) => { VAL[t] = v; });
const WIN = 100000;

// 陸路距離（公路一步、鐵路直線一步、鐵橋一步；不看擋路）
const DIST = (() => {
  const d = [];
  for (let s = 0; s < NSQ; s++) {
    const row = new Int8Array(NSQ).fill(40);
    if (J.isLandSq(s)) {
      row[s] = 0;
      const q = [s];
      for (let i = 0; i < q.length; i++) {
        const cur = q[i];
        const nb = new Set(J.ADJ[cur]);
        for (const run of J.RUNS[cur]) for (const x of run) nb.add(x);
        for (const x of nb) if (row[x] > row[cur] + 1) { row[x] = row[cur] + 1; q.push(x); }
      }
    }
    d.push(row);
  }
  return d;
})();

// ---------------- 局面評估（完整資訊；以 side 為準） ----------------
function evaluate(b, side) {
  let score = 0;
  const flag = [-1, -1], mines = [0, 0], gong = [0, 0], big = [0, 0], aa = [0, 0];
  for (let sq = 0; sq < NSQ; sq++) {
    const c = b[sq];
    if (!c) continue;
    const t = c & 31, s = c >> 5;
    if (t === FLAG) flag[s] = sq;
    else if (t === MINE) mines[s]++;
    else if (t === GONG) gong[s]++;
    else if (t === J.AA || t === J.GB) aa[s]++;
    if ((t <= 9 || t === J.BB || t === J.FIGHTER) && VAL[t] > big[s]) big[s] = VAL[t];
  }
  for (let sq = 0; sq < NSQ; sq++) {
    const c = b[sq];
    if (!c) continue;
    const t = c & 31, s = c >> 5, sign = s === side ? 1 : -1;
    let v = VAL[t];
    if (t === GONG) v += (mines[s ^ 1] ? 8 : 0) + (gong[s] === 1 ? 14 : 0);
    else if (t === BOMB) v = Math.max(25, big[s ^ 1] * 0.62);
    else if (t === MINE) v += 6;
    else if (t === J.FIGHTER) v += aa[s ^ 1] ? 0 : 15;
    else if (t === J.AA) v += 6;
    const ef = flag[s ^ 1];
    if (J.isLandType(t) && t !== MINE && t !== FLAG) {
      if (ef >= 0) {
        const dd = DIST[sq][ef];
        if (dd <= 5) v += (6 - dd) * (t === GONG ? 3 : t >= 7 && t <= 9 ? 3.5 : 2);
      }
      if (J.halfOf(sq) === (s ^ 1)) v += t === BOMB ? 0.5 : 1.5;
      if (J.isBridge(sq)) v += 1;
      if (J.isCamp(sq)) v += J.halfOf(sq) !== s ? 3 : 1;
      const mf = flag[s];
      if (mf >= 0 && DIST[sq][mf] <= 2 && t >= 5 && t <= 10) v += 1.5;
    } else if (J.isShip(t)) {
      // 艦隊往前推進、靠近對方港口
      const k = J.kOf(sq);
      v += J.halfOf(sq) === (s ^ 1) ? (6 - k) * 0.6 + 1 : J.halfOf(sq) === -1 ? 1 : k * 0.3;
    } else if (J.isAir(t)) {
      // 飛機停在對方高射炮、砲艦打不到的地方比較安全；回到機場加一點分
      if (J.isAirfield(sq) && J.halfOf(sq) === s) v += 2;
      if (J.halfOf(sq) === (s ^ 1)) v += 1;
    }
    score += sign * v;
  }
  // 軍旗危險：對方陸軍離我方軍旗太近
  for (const s of [0, 1]) {
    const f = flag[s];
    if (f < 0) continue;
    let danger = 0;
    for (let sq = 0; sq < NSQ; sq++) {
      const c = b[sq];
      if (!c || (c >> 5) === s) continue;
      const t = c & 31;
      if (!J.isOfficer(t)) continue;
      const dd = DIST[sq][f];
      if (dd <= 3) danger += (4 - dd) * (4 - dd) * 2.5;
    }
    score += (s === side ? -1 : 1) * danger;
  }
  return score;
}

// ---------------- α-β 搜尋 ----------------
const BUF = Array.from({ length: 8 }, () => new Int32Array(2048));
const TG = new Int32Array(NSQ);

function genInto(b, side, buf) {
  let n = 0;
  for (let sq = 0; sq < NSQ; sq++) {
    const c = b[sq];
    if (!c || (c >> 5) !== side) continue;
    const k = J.targetsOf(b, sq, TG, 0);
    for (let i = 0; i < k; i++) {
      const to = TG[i];
      const d = b[to];
      // 排序分數：交戰優先（目標越大越先）；偵察排最後
      const key = d ? ((c & 31) === RECON ? 1 : 64 + VAL[d & 31]) : 2;
      buf[n++] = (key << 14) | (sq << 7) | to;
    }
  }
  for (let i = 1; i < n; i++) { const x = buf[i]; let j = i - 1; while (j >= 0 && buf[j] < x) { buf[j + 1] = buf[j]; j--; } buf[j + 1] = x; }
  return n;
}

let nodes = 0, deadline = 0, aborted = false;

function negamax(b, side, depth, alpha, beta, ply) {
  if ((++nodes & 1023) === 0 && performance.now() > deadline) aborted = true;
  if (aborted) return 0;
  if (depth <= 0) return evaluate(b, side);
  const buf = BUF[ply];
  const n = genInto(b, side, buf);
  if (!n) return -WIN + ply;
  let best = -Infinity;
  for (let i = 0; i < n; i++) {
    const mv = buf[i] & 16383, from = mv >> 7, to = mv & 127;
    const a = b[from], d = b[to];
    const r = J.resolveOn(b, from, to);
    const v = r === 2 ? WIN - ply : -negamax(b, side ^ 1, depth - 1, -beta, -alpha, ply + 1);
    b[from] = a; b[to] = d;
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

// 在一個「抽樣出來的完整局面」上，算出每個根著法的分數
function scoreRoot(b, side, rootMoves, depth) {
  const scores = new Float64Array(rootMoves.length);
  for (let i = 0; i < rootMoves.length; i++) {
    const from = J.mvFrom(rootMoves[i]), to = J.mvTo(rootMoves[i]);
    const a = b[from], d = b[to];
    const r = J.resolveOn(b, from, to);
    scores[i] = r === 2 ? WIN : -negamax(b, side ^ 1, depth - 1, -Infinity, Infinity, 1);
    b[from] = a; b[to] = d;
    if (aborted) return null;
  }
  return scores;
}

// 把推算出的敵子種類填回棋盤
function fillBoard(view, smp) {
  const b = Int8Array.from(view.board);
  for (let sq = 0; sq < NSQ; sq++) {
    const c = b[sq];
    if (c && (c & 31) === UNK) {
      const t = smp.get(view.pid[sq]);
      b[sq] = J.mk(c >> 5, t || J.PAI);
    }
  }
  return b;
}

// 偵察的價值：對方暗子越不確定、越可能是大子越值得偵察
function scoutBonus(view, belief, m) {
  if (view.open) return -20;
  const from = J.mvFrom(m), to = J.mvTo(m);
  if ((view.board[from] & 31) !== RECON) return 0;
  const d = view.board[to];
  if (!d || (d & 31) !== UNK) return -20;
  const mk = belief.mask.get(view.pid[to]);
  if (mk == null) return 0;
  const n = popcount(mk);
  return n <= 1 ? -20 : 6 + Math.min(14, n * 1.2);
}

// 選一步棋。view：AI 那一方看得到的局面；learned：學習到的布陣統計（可省略）
export function chooseMove(view, level, learned = null, rng = Math.random) {
  const lv = typeof level === 'number' ? LEVELS[Math.max(0, Math.min(LEVELS.length - 1, level))] : level;
  const side = view.side;
  const root = J.genMoves(view.board, side);
  if (!root.length) return { move: -1, info: '無棋可走' };
  if (root.length === 1) return { move: root[0], info: '只有一步可走' };
  const t0 = performance.now();
  const belief = buildBelief(view, learned && learned.cnt);
  const total = new Float64Array(root.length);
  let used = 0, depthUsed = lv.depth;
  nodes = 0;
  for (let s = 0; s < lv.samples; s++) {
    const smp = sample(belief, rng);
    if (!smp) continue;
    const b = fillBoard(view, smp);
    deadline = t0 + lv.timeMs * 1.6;
    aborted = false;
    let sc = scoreRoot(b, side, root, lv.depth);
    if (!sc && lv.depth > 1) { aborted = false; deadline = performance.now() + 250; sc = scoreRoot(b, side, root, 1); depthUsed = 1; }
    if (!sc) break;
    for (let i = 0; i < root.length; i++) total[i] += Math.max(-WIN / 2, Math.min(WIN / 2, sc[i]));
    used++;
    if (performance.now() - t0 > lv.timeMs && used >= 2) break;
  }
  if (!used) return { move: root[Math.floor(rng() * root.length)], info: '隨機' };
  const last = view.events.filter((e) => e.side === side).slice(-2);
  let bestI = 0, bestV = -Infinity;
  for (let i = 0; i < root.length; i++) {
    let v = total[i] / used + scoutBonus(view, belief, root[i]);
    const f = J.mvFrom(root[i]), to = J.mvTo(root[i]);
    if (last.length && last[last.length - 1].to === f && last[last.length - 1].from === to) v -= 6;
    if (last.length === 2 && last[0].from === f && last[0].to === to) v -= 3;
    if (lv.noise) v += (rng() - 0.5) * lv.noise;
    if (v > bestV) { bestV = v; bestI = i; }
  }
  const ms = Math.round(performance.now() - t0);
  return { move: root[bestI], score: Math.round(bestV), info: `推算 ${used} 種敵方布陣、每種搜尋 ${depthUsed} 層（${nodes} 個局面，${ms} 毫秒）`, samples: used, depth: depthUsed, ms };
}

// 給 AI 軍師／提示用：前幾名候選著法與平均分數
export function analyze(view, level = 3, learned = null, top = 3, rng = Math.random) {
  const lv = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, level))];
  const side = view.side;
  const root = J.genMoves(view.board, side);
  if (!root.length) return [];
  const belief = buildBelief(view, learned && learned.cnt);
  const total = new Float64Array(root.length);
  const t0 = performance.now();
  let used = 0;
  for (let s = 0; s < lv.samples; s++) {
    const smp = sample(belief, rng);
    if (!smp) continue;
    const b = fillBoard(view, smp);
    deadline = t0 + lv.timeMs * 1.6; aborted = false;
    const sc = scoreRoot(b, side, root, Math.min(lv.depth, 2));
    if (!sc) break;
    for (let i = 0; i < root.length; i++) total[i] += Math.max(-WIN / 2, Math.min(WIN / 2, sc[i]));
    used++;
    if (performance.now() - t0 > lv.timeMs) break;
  }
  const val = (i) => (used ? total[i] / used : 0) + scoutBonus(view, belief, root[i]);
  const idx = root.map((m, i) => i).sort((a, b) => val(b) - val(a));
  return idx.slice(0, top).map((i) => ({ move: root[i], score: Math.round(val(i)) }));
}

// 推算（給玩家看）
export function infer(view, learned = null, n = 160) {
  const b = buildBelief(view, learned && learned.cnt);
  return marginals(b, n);
}

// AI 布陣：依難度從經典布陣、學到的好布陣中挑一個再隨機微調
export function chooseLayout(level, learned = null, rng = Math.random) {
  if (level <= 0) return J.randomLayout(rng);
  const good = (learned && learned.goodLayouts) || [];
  let base;
  if (good.length && rng() < 0.45) base = good[Math.floor(rng() * Math.min(5, good.length))].L;
  else base = J.PRESETS[Math.floor(rng() * J.PRESETS.length)].L;
  const L = J.mutateLayout(base, level >= 3 ? 3 : 6, rng);
  return J.validateLayout(L) ? base.slice() : L;
}
