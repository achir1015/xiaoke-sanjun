// 敵情推算：只根據「看得到的資訊」（起始位置、走過的路線、裁判公布的勝負、偵察結果）推算對方每顆暗子是什麼
import * as J from './sanjun.js';

const { SI, FLAG, COUNT, NT, LSIZE } = J;
const BIT = (t) => 1 << t;
const RANGE = (a, b) => { let m = 0; for (let t = a; t <= b; t++) m |= BIT(t); return m; };
export const ALL = RANGE(1, 20);
export const MOVABLE = ALL & ~BIT(J.MINE) & ~BIT(FLAG);
const popcount = (m) => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
const OUT_CODE = { win: 1, lose: -1, tie: 0, flag: 2, scout: 3 };

// 預設的布陣習慣（每個本方位置 li 放各種棋子的相對可能性）
export function defaultPrior(li, t) {
  if (!J.canPlace(t, li)) return 0;
  if (!J.isLandType(t)) return 1;
  const k = (li / 9) | 0, x = (li % 9) - 2;
  switch (t) {
    case FLAG: return 1;
    case J.MINE: return k === 0 ? (x === 1 || x === 3 ? 1.4 : 2.4) : (x >= 1 && x <= 3 ? 1.8 : 1.0);
    case J.BOMB: return k === 1 || k === 2 ? 1.3 : k === 3 || k === 4 ? 1.15 : 0.7;
    case SI: case J.JUN: return k >= 3 ? 1.5 : k === 2 ? 1.0 : 0.45;
    case J.SHI: case J.LV: return k >= 2 ? 1.25 : 0.7;
    case J.GONG: return k === 5 ? 1.35 : k <= 1 ? 1.05 : 0.9;
    case J.PAI: return k === 5 ? 1.25 : 1;
    case J.AA: return k <= 2 ? 1.4 : 0.8;
    default: return 1;
  }
}

// 學習到的布陣統計＋預設習慣 → 每個位置每種棋子的權重
export function priorTable(learnedCnt) {
  const W = new Float64Array(LSIZE * NT);
  for (let li = 0; li < LSIZE; li++) {
    let sd = 0, n = 0;
    for (let t = 1; t < NT; t++) { sd += defaultPrior(li, t) * COUNT[t]; if (learnedCnt) n += learnedCnt[li * NT + t] || 0; }
    const A = 8;
    for (let t = 1; t < NT; t++) {
      const pd = sd ? (defaultPrior(li, t) * COUNT[t]) / sd : 0;
      const pl = learnedCnt && n ? (learnedCnt[li * NT + t] || 0) / n : 0;
      const p = learnedCnt && n ? (n * pl + A * pd) / (n + A) : pd;
      // 抽樣時會再乘上剩餘數量，這裡除掉數量避免重複計算
      W[li * NT + t] = J.canPlace(t, li) ? Math.max(1e-4, p) / COUNT[t] : 0;
    }
  }
  return W;
}

// 從 from 到 to 這一步，可能是哪些種類走的（只看地形）
const moveMaskCache = new Map();
function moveMask(from, to, attack) {
  const key = (from * J.NSQ + to) * 2 + (attack ? 1 : 0);
  let m = moveMaskCache.get(key);
  if (m !== undefined) return m;
  m = 0;
  for (let t = 1; t < NT; t++) if (J.movable(t) && J.geoCan(t, from, to, attack)) m |= BIT(t);
  moveMaskCache.set(key, m);
  return m;
}
// 交戰結果符合的種類
function fightMaskAttacker(d, code) { let m = 0; for (let t = 1; t < NT; t++) if (J.movable(t) && J.fight(t, d) === code) m |= BIT(t); return m; }
function fightMaskDefender(a, code) { let m = 0; for (let t = 1; t < NT; t++) if (J.fight(a, t) === code) m |= BIT(t); return m; }

// 由局面與事件推出每顆敵子可能的種類（位元遮罩）
export function buildBelief(view, learnedCnt) {
  const me = view.side, en = me ^ 1;
  const ids = [];
  for (let id = 0; id < view.homes.length; id++) if (view.sides[id] === en) ids.push(id);
  const mask = new Map();
  const W = priorTable(learnedCnt);
  for (const id of ids) {
    const li = J.liOf(en, view.homes[id]);
    let m = 0;
    for (let t = 1; t < NT; t++) if (J.canPlace(t, li)) m |= BIT(t);
    if (view.known[id]) m = BIT(view.known[id]);
    mask.set(id, m);
  }
  const and = (id, m) => { if (mask.has(id)) mask.set(id, mask.get(id) & m); };
  for (const e of view.events) {
    const deadEnemy = [];
    const code = OUT_CODE[e.out];
    if (e.side === en) {
      and(e.aid, moveMask(e.from, e.to, e.did >= 0));
      if (e.did >= 0 && e.dt) and(e.aid, fightMaskAttacker(e.dt, code));
      if (e.out === 'scout') and(e.aid, BIT(J.RECON));
      if (e.out === 'lose' || e.out === 'tie') deadEnemy.push(e.aid);
    } else if (e.did >= 0) {
      if (e.out === 'scout' && e.dt) and(e.did, BIT(e.dt));
      else if (e.at) and(e.did, fightMaskDefender(e.at, code));
      if (e.out === 'win' || e.out === 'tie' || e.out === 'flag') deadEnemy.push(e.did);
    }
    // 總司令陣亡會公布；沒公布就不是總司令
    for (const id of deadEnemy) and(id, e.cmdDead.includes(en) ? BIT(SI) : ~BIT(SI));
    if (e.flagSq[en] >= 0) for (const id of ids) and(id, view.homes[id] === e.flagSq[en] ? BIT(FLAG) : ~BIT(FLAG));
  }
  // 看得到的敵子（亮出的軍旗、被偵察翻開的棋子）
  for (let sq = 0; sq < J.NSQ; sq++) {
    const c = view.board[sq];
    if (!c || (c >> 5) !== en || (c & 31) === J.UNK) continue;
    const id = view.pid[sq];
    and(id, BIT(c & 31));
    if ((c & 31) === FLAG) for (const x of ids) if (x !== id) and(x, ~BIT(FLAG));
  }
  const w = new Map();
  for (const id of ids) {
    const li = J.liOf(en, view.homes[id]);
    const arr = new Float64Array(NT);
    for (let t = 1; t < NT; t++) arr[t] = mask.get(id) & BIT(t) ? W[li * NT + t] : 0;
    w.set(id, arr);
  }
  const b = { side: me, en, ids, mask, w, alive: ids.filter((id) => view.alive[id]) };
  if (!feasible(b, null)) relax(b, view);
  return b;
}

// 規則限制互相矛盾（理論上不會發生）時，退回只用起始位置的限制
function relax(b, view) {
  for (const id of b.ids) {
    const li = J.liOf(b.en, view.homes[id]);
    let m = 0;
    for (let t = 1; t < NT; t++) if (J.canPlace(t, li)) m |= BIT(t);
    if (view.known[id]) m = BIT(view.known[id]);
    b.mask.set(id, m);
    const arr = b.w.get(id);
    for (let t = 1; t < NT; t++) if (!arr[t] && m & BIT(t)) arr[t] = 0.05;
  }
}

// 二分圖配對：剩下的棋子能不能分配到剩下的種類（每種有固定數量）
function feasible(b, fixed) {
  const ids = b.ids.filter((id) => !fixed || !fixed.has(id));
  const rem = COUNT.slice();
  if (fixed) for (const t of fixed.values()) rem[t]--;
  if (rem.some((x) => x < 0)) return false;
  const slots = [];
  for (let t = 1; t < NT; t++) for (let i = 0; i < rem[t]; i++) slots.push(t);
  const owner = new Array(slots.length).fill(-1);
  const tryAssign = (ii, seen) => {
    const m = b.mask.get(ids[ii]);
    for (let s = 0; s < slots.length; s++) {
      if (seen[s] || !(m & BIT(slots[s]))) continue;
      seen[s] = 1;
      if (owner[s] < 0 || tryAssign(owner[s], seen)) { owner[s] = ii; return true; }
    }
    return false;
  };
  for (let ii = 0; ii < ids.length; ii++) if (!tryAssign(ii, new Uint8Array(slots.length))) return false;
  return true;
}

// 抽一組「跟所有資訊都不矛盾」的對方布陣：回傳 Map id → 種類
export function sample(b, rng = Math.random) {
  const order = b.ids.slice().sort((x, y) => popcount(b.mask.get(x)) - popcount(b.mask.get(y)) || rng() - 0.5);
  const pick = (id, rem, exclude = 0) => {
    const arr = b.w.get(id), m = b.mask.get(id) & ~exclude;
    let tot = 0;
    for (let t = 1; t < NT; t++) if (m & BIT(t) && rem[t] > 0) tot += arr[t] * rem[t];
    if (tot <= 0) { for (let t = 1; t < NT; t++) if (m & BIT(t) && rem[t] > 0) return t; return 0; }
    let r = rng() * tot;
    for (let t = 1; t < NT; t++) if (m & BIT(t) && rem[t] > 0) { r -= arr[t] * rem[t]; if (r <= 0) return t; }
    for (let t = NT - 1; t >= 1; t--) if (m & BIT(t) && rem[t] > 0) return t;
    return 0;
  };
  // 先用快速的貪婪抽樣，多數情況都會成功
  for (let tries = 0; tries < 12; tries++) {
    const rem = COUNT.slice();
    const out = new Map();
    let ok = true;
    for (const id of order) {
      const t = pick(id, rem);
      if (!t) { ok = false; break; }
      rem[t]--; out.set(id, t);
    }
    if (ok) return out;
  }
  // 限制很多時：每一步都確認剩下的還分配得完
  const rem = COUNT.slice();
  const out = new Map();
  for (const id of order) {
    let excl = 0, t = 0;
    for (let k = 0; k < NT; k++) {
      t = pick(id, rem, excl);
      if (!t) break;
      out.set(id, t);
      if (feasible(b, out)) break;
      out.delete(id);
      excl |= BIT(t);
      t = 0;
    }
    if (!t) return null;
    rem[t]--;
  }
  return out;
}

// 推算結果：每顆活著的敵子最可能是什麼（給玩家的「敵情推算」與 AI 軍師）
export function marginals(b, n = 160, rng = Math.random) {
  const probs = new Map(b.alive.map((id) => [id, new Float64Array(NT)]));
  const remain = new Float64Array(NT);
  let got = 0;
  for (let i = 0; i < n; i++) {
    const s = sample(b, rng);
    if (!s) continue;
    got++;
    for (const id of b.alive) { const t = s.get(id); probs.get(id)[t]++; remain[t]++; }
  }
  const res = {};
  for (const [id, arr] of probs) {
    const p = Array.from(arr, (x) => (got ? x / got : 0));
    let best = 1;
    for (let t = 1; t < NT; t++) if (p[t] > p[best]) best = t;
    res[id] = { p, top: best, pTop: p[best], mask: b.mask.get(id) };
  }
  return { pieces: res, remain: Array.from(remain, (x) => (got ? x / got : 0)), samples: got };
}

// 遮罩的白話說明（例如「師長以上」「工兵或地雷」「海軍艦艇」）
export function maskText(m) {
  const types = [];
  for (let t = 1; t < NT; t++) if (m & BIT(t)) types.push(t);
  if (types.length === 1) return J.NAMES[types[0]];
  if (!types.length) return '未知';
  const sea = types.filter((t) => J.isShip(t)), air = types.filter((t) => J.isAir(t));
  const offs = types.filter((t) => t <= 9), rest = types.filter((t) => t >= 10 && t <= 13);
  if (types.length >= 14) return '未知';
  const parts = [];
  if (offs.length) {
    const lo = offs[0], hi = offs[offs.length - 1];
    const contiguous = hi - lo + 1 === offs.length;
    if (contiguous && offs.length > 2) parts.push(hi === 9 ? `${J.NAMES[lo]}以上` : lo === 1 ? `${J.NAMES[hi]}以下` : `${J.NAMES[lo]}～${J.NAMES[hi]}`);
    else parts.push(offs.map((t) => J.SHORT[t]).join('、'));
  }
  if (rest.length) parts.push(rest.map((t) => J.NAMES[t]).join('、'));
  if (sea.length) parts.push(sea.length === 5 ? '任一艦艇' : sea.map((t) => J.NAMES[t]).join('、'));
  if (air.length) parts.push(air.length === 2 ? '飛機' : J.NAMES[air[0]]);
  return parts.join('或');
}
export { BIT, popcount };
