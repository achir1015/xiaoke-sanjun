// 三軍棋（陸海空軍棋）規則引擎（二人對戰：暗棋裁判制／明棋）
// 棋盤 13 列 × 9 行。sq = 列 r × 9 + 行 c；r = 0 在畫面上方（藍軍底線），r = 12 在下方（紅軍底線），r = 6 是中央海峽。
// 每一方的半邊用「本方列」k 表示：k = 0 底線（大本營、機場）… k = 5 前線（緊鄰海峽）。
// 行 c：0、8 是外海航道（可直航），1、7 是近海（k = 0 為飛機場），2～6 是陸地（同陸軍棋 5 行，含鐵路、行營、大本營、港口）。
// 海峽 r = 6：c = 2、4、6 是鐵橋（陸軍過海唯一通道，要在橋上停一步），c = 0、1、7、8 是海，c = 3、5 是深海（不能停留）。
export const ROWS = 13, COLS = 9, NSQ = 117, LSIZE = 54;
export const GONG = 1, PAI = 2, LIAN = 3, YING = 4, TUAN = 5, LV = 6, SHI = 7, JUN = 8, SI = 9, BOMB = 10, MINE = 11, FLAG = 12,
  AA = 13, SUB = 14, DD = 15, GB = 16, CA = 17, BB = 18, RECON = 19, FIGHTER = 20, UNK = 31;
export const NT = 21; // 種類編號上限（1～20）
export const NAMES = ['', '工兵', '排長', '連長', '營長', '團長', '旅長', '師長', '軍長', '總司令', '炸彈', '地雷', '軍旗', '高射炮', '潛水艇', '驅逐艦', '砲艦', '巡洋艦', '主力艦', '偵察機', '戰鬥機'];
NAMES[UNK] = '？';
export const SHORT = ['', '工', '排', '連', '營', '團', '旅', '師', '軍', '司', '炸', '雷', '旗', '高', '潛', '驅', '砲', '巡', '主', '偵', '戰'];
SHORT[UNK] = '？';
export const COUNT = [0, 2, 2, 2, 2, 2, 1, 1, 1, 1, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1, 1];
export const TOTAL = COUNT.reduce((a, b) => a + b, 0); // 每方 33 顆
export const ALL_TYPES = [SI, JUN, SHI, LV, TUAN, YING, LIAN, PAI, GONG, AA, BOMB, MINE, FLAG, BB, CA, GB, DD, SUB, FIGHTER, RECON];
export const LAND_TYPES = [GONG, PAI, LIAN, YING, TUAN, LV, SHI, JUN, SI, BOMB, MINE, FLAG, AA];
export const SEA_TYPES = [SUB, DD, GB, CA, BB];
export const AIR_TYPES = [RECON, FIGHTER];
export const SIDE_NAME = ['紅軍', '藍軍'];
export const RED = 0, BLUE = 1;
export const QUIET_LIMIT = 100;  // 連續 100 步（50 回合）沒有交戰判和
export const PLY_LIMIT = 600;    // 總步數上限
export const FLY_RANGE = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 3]; // 偵察機 4 格、戰鬥機 3 格

export const mk = (side, t) => t | (side << 5);
export const sideOf = (code) => code >> 5;
export const typeOf = (code) => code & 31;
export const rowOf = (sq) => (sq / 9) | 0;
export const colOf = (sq) => sq % 9;
export const SQ = (r, c) => r * 9 + c;
export const halfOf = (sq) => { const r = rowOf(sq); return r >= 7 ? 0 : r <= 5 ? 1 : -1; };
export const isLandType = (t) => t >= GONG && t <= AA;
export const isShip = (t) => t >= SUB && t <= BB;
export const isAir = (t) => t === RECON || t === FIGHTER;
export const movable = (t) => t >= 1 && t <= 20 && t !== MINE && t !== FLAG;
export const isOfficer = (t) => t >= GONG && t <= SI;
export const DOMAIN_NAME = (t) => (isShip(t) ? '海軍' : isAir(t) ? '空軍' : '陸軍');

// 戰力（同軍種、跨軍種一般比大小用）
export const POWER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 0, 0, 3, 3, 5, 6, 7, 8, 0, 0];

// 本方列（0＝底線…5＝前線，海峽為 6）
export const kOf = (sq) => { const r = rowOf(sq); return r >= 7 ? 12 - r : r <= 5 ? r : 6; };
// 布陣用的本方座標：從該方玩家自己的角度看，左邊是 c = 0
export function localOf(side, sq) { const r = rowOf(sq), c = colOf(sq); return side === 0 ? { k: 12 - r, c } : { k: r, c: 8 - c }; }
export function sqOf(side, k, c) { return side === 0 ? SQ(12 - k, c) : SQ(k, 8 - c); }
export const liOf = (side, sq) => { const { k, c } = localOf(side, sq); return k * 9 + c; };
export const sqOfLi = (side, li) => sqOf(side, (li / 9) | 0, li % 9);

// ---------------- 地形 ----------------
export const NONE = 0, POST = 1, CAMP = 2, HQ = 3, HARBOR = 4, BRIDGE = 5, SEA = 6, LANE = 7, AIRFIELD = 8;
export const KIND_NAME = ['深海', '兵站', '行營', '大本營', '港口', '鐵橋', '海域', '航道', '飛機場'];
export const KIND = new Int8Array(NSQ);
for (let sq = 0; sq < NSQ; sq++) {
  const r = rowOf(sq), c = colOf(sq);
  if (r === 6) { KIND[sq] = c === 2 || c === 4 || c === 6 ? BRIDGE : c === 0 || c === 8 ? LANE : c === 1 || c === 7 ? SEA : NONE; continue; }
  const k = kOf(sq);
  if (c === 0 || c === 8) KIND[sq] = LANE;
  else if (c === 1 || c === 7) KIND[sq] = k === 0 ? AIRFIELD : SEA;
  else {
    const x = c - 2; // 陸地 0～4
    if (((k === 2 || k === 4) && (x === 1 || x === 3)) || (k === 3 && x === 2)) KIND[sq] = CAMP;
    else if (k === 0 && (x === 1 || x === 3)) KIND[sq] = HQ;
    else if (k === 3 && (x === 0 || x === 4)) KIND[sq] = HARBOR;
    else KIND[sq] = POST;
  }
}
export const isLandSq = (sq) => KIND[sq] >= POST && KIND[sq] <= BRIDGE;
export const isSeaSq = (sq) => KIND[sq] === SEA || KIND[sq] === LANE;
export const isCamp = (sq) => KIND[sq] === CAMP;
export const isHQ = (sq) => KIND[sq] === HQ;
export const isHarbor = (sq) => KIND[sq] === HARBOR;
export const isBridge = (sq) => KIND[sq] === BRIDGE;
export const isAirfield = (sq) => KIND[sq] === AIRFIELD;
export const isLane = (sq) => KIND[sq] === LANE;
export const isNode = (sq) => KIND[sq] !== NONE;
export const isRail = (sq) => { if (!isLandSq(sq) || isBridge(sq)) return false; const k = kOf(sq), x = colOf(sq) - 2; return k === 1 || k === 5 || ((x === 0 || x === 4) && k >= 1); };
export const liIsCamp = (li) => KIND[sqOfLi(0, li)] === CAMP;
export const liIsHQ = (li) => KIND[sqOfLi(0, li)] === HQ;
export const liKind = (li) => KIND[sqOfLi(0, li)];

// 某種棋子能不能停在這一格
export function canStand(t, sq) {
  const k = KIND[sq];
  if (isAir(t)) return k !== NONE && k !== HQ;
  if (isShip(t)) return k === SEA || k === LANE || k === HARBOR;
  return k === POST || k === CAMP || k === HQ || k === HARBOR || k === BRIDGE;
}

// 鐵路相連
function railEdge(a, b) {
  if (!isRail(a) || !isRail(b) || halfOf(a) !== halfOf(b)) return false;
  const ra = rowOf(a), rb = rowOf(b), ca = colOf(a), cb = colOf(b);
  if (ra === rb && Math.abs(ca - cb) === 1) { const k = kOf(a); return k === 1 || k === 5; }
  if (ca === cb && Math.abs(ra - rb) === 1) return ca === 2 || ca === 6;
  return false;
}
// 陸地公路（一步）：同半邊上下左右；行營可以斜走；鐵橋只連上下
function roadEdge(a, b) {
  if (!isLandSq(a) || !isLandSq(b)) return false;
  const ra = rowOf(a), rb = rowOf(b), ca = colOf(a), cb = colOf(b);
  const dr = Math.abs(ra - rb), dc = Math.abs(ca - cb);
  if (isBridge(a) || isBridge(b)) return ca === cb && dr === 1;
  if (halfOf(a) !== halfOf(b)) return false;
  if (dr + dc === 1) return true;
  if (dr === 1 && dc === 1) return isCamp(a) || isCamp(b);
  return false;
}
// 海路（一步）：海域、航道上下左右；港口只連旁邊那一格近海
function seaEdge(a, b) {
  const ra = rowOf(a), rb = rowOf(b), ca = colOf(a), cb = colOf(b);
  if (Math.abs(ra - rb) + Math.abs(ca - cb) !== 1) return false;
  const sa = isSeaSq(a), sb = isSeaSq(b);
  if (sa && sb) return true;
  if (sa && isHarbor(b)) return ra === rb;
  if (sb && isHarbor(a)) return ra === rb;
  return false;
}

export const ADJ = [], RAILN = [], RUNS = [], SADJ = [], SRUNS = [], AIRLINK = [], NEAR8 = [], COAST = [], FLY = [];
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
for (let s = 0; s < NSQ; s++) {
  ADJ[s] = []; RAILN[s] = []; RUNS[s] = []; SADJ[s] = []; SRUNS[s] = []; AIRLINK[s] = []; NEAR8[s] = []; COAST[s] = []; FLY[s] = [];
  for (let t = 0; t < NSQ; t++) {
    if (s === t) continue;
    if (roadEdge(s, t)) ADJ[s].push(t);
    if (railEdge(s, t)) RAILN[s].push(t);
    if (seaEdge(s, t)) SADJ[s].push(t);
    const dr = Math.abs(rowOf(s) - rowOf(t)), dc = Math.abs(colOf(s) - colOf(t));
    if (dr <= 1 && dc <= 1 && isNode(t)) NEAR8[s].push(t);
    // 機場與旁邊的陸地兵站（只有炸彈、高射炮能從這裡攻擊機場）
    if (dr === 0 && dc === 1 && ((isAirfield(s) && isLandSq(t)) || (isAirfield(t) && isLandSq(s)))) AIRLINK[s].push(t);
    // 砲艦炮擊：近海旁邊的陸地
    if (dr + dc === 1 && isSeaSq(s) && isLandSq(t) && !isCamp(t) && !isHQ(t)) COAST[s].push(t);
  }
  // 鐵路直線（不轉彎）
  if (isRail(s)) for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const run = [];
    let cur = s;
    for (;;) {
      const r = rowOf(cur) + dr, c = colOf(cur) + dc;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) break;
      const nx = SQ(r, c);
      if (!railEdge(cur, nx)) break;
      run.push(nx); cur = nx;
    }
    if (run.length > 1) RUNS[s].push(run);
  }
  // 外海航道直航（上下）
  if (isLane(s)) for (const dr of [1, -1]) {
    const run = [];
    for (let r = rowOf(s) + dr; r >= 0 && r < ROWS; r += dr) run.push(SQ(r, colOf(s)));
    if (run.length > 1) SRUNS[s].push(run);
  }
  // 飛行路線：八個方向
  for (const [dr, dc] of DIRS8) {
    const path = [];
    for (let i = 1; i <= 4; i++) {
      const r = rowOf(s) + dr * i, c = colOf(s) + dc * i;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) break;
      path.push(SQ(r, c));
    }
    if (path.length) FLY[s].push(path);
  }
}

// 從 from 到 to 是否在同一條鐵路直線上
export function onStraightRail(from, to) {
  for (const run of RUNS[from]) if (run.includes(to)) return true;
  return ADJ[from].includes(to) && RAILN[from].includes(to);
}

// 交戰結果（以攻擊方為準）：1 攻方勝、-1 攻方陣亡、0 同歸於盡、2 奪旗、3 偵察（不交戰，翻開對方）
export function fight(at, dt) {
  if (at === RECON) return 3;
  if (dt === FLAG) return isOfficer(at) || isShip(at) ? 2 : -1;
  if (at === BOMB || dt === BOMB) return 0;
  if (dt === MINE) return at === GONG || at === FIGHTER ? 1 : 0;
  if (dt === RECON) return 1;
  if (at === FIGHTER) return dt === FIGHTER ? 0 : dt === AA || dt === GB ? -1 : 1;
  if (dt === FIGHTER) return at === AA || at === GB ? 1 : -1;
  if (at === SUB && (dt === BB || dt === CA || dt === GB)) return 1;
  const pa = POWER[at], pd = POWER[dt];
  return pa > pd ? 1 : pa < pd ? -1 : 0;
}

// 在棋盤陣列上結算一步（AI 搜尋與對局共用）：回傳 fight 結果，空格移動回傳 -2
export function resolveOn(b, from, to) {
  const a = b[from], d = b[to];
  if (!d) { b[from] = 0; b[to] = a; return -2; }
  const r = fight(a & 31, d & 31);
  if (r === 3) return 3;
  b[from] = 0;
  if (r === 1 || r === 2) { if (canStand(a & 31, to)) b[to] = a; else { b[to] = 0; b[from] = a; } }
  else if (r === 0) b[to] = 0;
  return r;
}

// ---------------- 走法產生（給規則判斷與 AI 共用；board 為 117 格的棋子代碼陣列） ----------------
const mark = new Int32Array(NSQ);
let markGen = 1;
const queue = new Int32Array(NSQ);
const visit = new Int32Array(NSQ);
let visitGen = 1;

// 把 sq 上棋子的所有目的地放進 out（回傳數量）
export function targetsOf(board, sq, out, n = 0) {
  const code = board[sq];
  if (!code) return n;
  const t = code & 31;
  if (t === FLAG || t === MINE || t === UNK) return n;
  if (KIND[sq] === HQ) return n; // 進入大本營的棋子不能再移動
  const side = code >> 5;
  const gen = ++markGen;
  mark[sq] = gen;
  // attackOnly：只能攻擊、不能空著走過去（遠距攻擊）
  const add = (to, attackOnly) => {
    if (mark[to] === gen) return;
    const d = board[to];
    if (!d) { if (attackOnly) return; mark[to] = gen; out[n++] = to; return; }
    mark[to] = gen;
    if ((d >> 5) !== side && KIND[to] !== CAMP) out[n++] = to;
  };
  if (isAir(t)) {
    const R = FLY_RANGE[t];
    const fl = FLY[sq];
    for (let i = 0; i < fl.length; i++) {
      const path = fl[i];
      for (let j = 0; j < path.length && j < R; j++) {
        const to = path[j], k = KIND[to];
        if (k === NONE || k === HQ) continue; // 飛越
        add(to, false);
      }
    }
    return n;
  }
  if (isShip(t)) {
    const sa = SADJ[sq];
    for (let i = 0; i < sa.length; i++) add(sa[i], false);
    const sr = SRUNS[sq];
    for (let i = 0; i < sr.length; i++) {
      const run = sr[i];
      for (let j = 0; j < run.length; j++) {
        const to = run[j];
        const d = board[to];
        if (!d) { add(to, false); continue; }
        if ((d >> 5) !== side) add(to, false);
        break;
      }
    }
    if (t === GB) { const co = COAST[sq]; for (let i = 0; i < co.length; i++) add(co[i], true); }
    return n;
  }
  // 陸軍
  const adj = ADJ[sq];
  for (let i = 0; i < adj.length; i++) add(adj[i], false);
  if (t === BOMB || t === AA) { const al = AIRLINK[sq]; for (let i = 0; i < al.length; i++) add(al[i], true); }
  if (t === AA) { const nb = NEAR8[sq]; for (let i = 0; i < nb.length; i++) { const k = KIND[nb[i]]; if (k === SEA || k === LANE || k === AIRFIELD) add(nb[i], true); } }
  if (isRail(sq)) {
    if (t === GONG) {
      // 工兵：鐵路上可以轉彎
      let qh = 0, qt = 0;
      const seen = ++visitGen;
      visit[sq] = seen;
      queue[qt++] = sq;
      while (qh < qt) {
        const rn = RAILN[queue[qh++]];
        for (let i = 0; i < rn.length; i++) {
          const nx = rn[i];
          if (visit[nx] === seen) continue;
          visit[nx] = seen;
          const d = board[nx];
          if (!d) queue[qt++] = nx;
          if (!d || (d >> 5) !== side) add(nx, false);
        }
      }
    } else {
      const runs = RUNS[sq];
      for (let i = 0; i < runs.length; i++) {
        const run = runs[i];
        for (let j = 0; j < run.length; j++) {
          const to = run[j];
          const d = board[to];
          if (!d) { add(to, false); continue; }
          if ((d >> 5) !== side) add(to, false);
          break;
        }
      }
    }
  }
  return n;
}

const tmp = new Int32Array(NSQ);
export function targetList(board, sq) { const n = targetsOf(board, sq, tmp, 0); return Array.from(tmp.subarray(0, n)); }

// 全部走法：m = from * 128 + to
export function genMoves(board, side) {
  const out = [];
  for (let sq = 0; sq < NSQ; sq++) {
    const c = board[sq];
    if (!c || (c >> 5) !== side) continue;
    const n = targetsOf(board, sq, tmp, 0);
    for (let i = 0; i < n; i++) out.push(sq * 128 + tmp[i]);
  }
  return out;
}
export const mvFrom = (m) => m >> 7;
export const mvTo = (m) => m & 127;
export const MV = (f, t) => f * 128 + t;

export function hasMoves(board, side) {
  for (let sq = 0; sq < NSQ; sq++) {
    const c = board[sq];
    if (!c || (c >> 5) !== side) continue;
    if (targetsOf(board, sq, tmp, 0) > 0) return true;
  }
  return false;
}

// 只看地形（不管擋路）：種類 t 能不能從 from 走到 to（attack：to 上有敵子）。推算敵情用，結果有快取
const geoCache = new Map();
const geoBoard = new Int8Array(NSQ);
export function geoCan(t, from, to, attack) {
  const key = ((t * NSQ + from) * NSQ + to) * 2 + (attack ? 1 : 0);
  let v = geoCache.get(key);
  if (v !== undefined) return v;
  geoBoard.fill(0);
  geoBoard[from] = mk(0, t);
  if (attack) geoBoard[to] = mk(1, PAI);
  v = targetList(geoBoard, from).includes(to);
  geoCache.set(key, v);
  return v;
}

// ---------------- 座標與記譜 ----------------
// A～I：紅軍左到右；1～13：紅軍底線往上
export const sqName = (sq) => 'ABCDEFGHI'[colOf(sq)] + (13 - rowOf(sq));
export const nameToSq = (s) => { const m = /^([A-Ia-i])(\d{1,2})$/.exec(String(s).trim()); if (!m) return -1; const c = 'ABCDEFGHI'.indexOf(m[1].toUpperCase()), r = 13 - Number(m[2]); return r >= 0 && r < 13 ? SQ(r, c) : -1; };
export const moveStr = (m) => `${sqName(mvFrom(m))}-${sqName(mvTo(m))}`;
export const strMove = (s) => { const [a, b] = String(s).split('-'); const f = nameToSq(a), t = nameToSq(b); return f >= 0 && t >= 0 ? MV(f, t) : -1; };

// ---------------- 布陣 ----------------
// 布陣陣列 L：54 格（本方列 k × 9 + 行 c），空格為 0，其餘放棋子種類
export const LAYOUT_SLOTS = [];
for (let li = 0; li < LSIZE; li++) { const k = liKind(li); if (k !== CAMP && k !== NONE) LAYOUT_SLOTS.push(li); }

// 某種棋子能不能放在 li（t = 0 表示空格）
export function canPlace(t, li) {
  const kind = liKind(li), k = (li / 9) | 0;
  if (kind === CAMP || kind === NONE) return false;
  if (!t) return true;
  if (isAir(t)) return kind === AIRFIELD;
  if (isShip(t)) return kind === SEA || kind === LANE;
  if (kind !== POST && kind !== HQ && kind !== HARBOR) return false;
  if (t === FLAG) return kind === HQ;
  if (t === MINE) return k <= 1;
  if (t === BOMB) return k !== 5;
  return true;
}
export function placeRule(t) {
  if (t === FLAG) return '軍旗只能放在大本營';
  if (t === MINE) return '地雷只能放在最後兩排的陸地';
  if (t === BOMB) return '炸彈不能放在第一排（前線）';
  if (isAir(t)) return '飛機只能放在飛機場';
  if (isShip(t)) return '軍艦只能放在海上';
  return '陸軍只能放在陸地上的兵站、港口或大本營';
}

// 回傳錯誤說明，合法時回傳空字串
export function validateLayout(L) {
  if (!Array.isArray(L) && !(L instanceof Int8Array) && !(L instanceof Uint8Array)) return '布陣資料錯誤';
  if (L.length !== LSIZE) return '布陣資料錯誤';
  const cnt = new Array(NT).fill(0);
  for (let li = 0; li < LSIZE; li++) {
    const t = L[li];
    if (!t) continue;
    if (!(t >= 1 && t <= 20)) return '布陣資料錯誤';
    if (liIsCamp(li)) return '行營一開始必須空著';
    if (!canPlace(t, li)) return placeRule(t);
    cnt[t]++;
  }
  for (let t = 1; t < NT; t++) if (cnt[t] !== COUNT[t]) return `${NAMES[t]}應該有 ${COUNT[t]} 顆`;
  return '';
}

// 經典布陣（本方視角：第 0 列是底線；每列 9 格＝外海、近海／機場、陸地 5 格、近海／機場、外海）
const LCH = '．工排連營團旅師軍司炸雷旗高潛驅砲巡主偵戰';
export const LAYOUT_CHARS = LCH;
const P = (rows) => { const L = []; for (const r of rows) for (const ch of r) L.push(Math.max(0, LCH.indexOf(ch))); return L; };
export const PRESETS = [
  { name: '穩守中宮', desc: '軍旗左營、雙雷護旗；主力艦守外海，砲艦看住港口', L: P(['主戰雷旗雷排連偵主', '巡砲工高炸．高砲巡', '驅．團．營．旅．驅', '潛．營軍．司連．潛', '．．團．炸．．．．', '．．工排．．師．．']) },
  { name: '三軍齊進', desc: '大子壓在前線鐵路，艦隊集中右翼外海', L: P(['．偵雷旗雷排連戰主', '．砲高炸營工高砲主', '．．師．司．軍．巡', '．．團旅．團連．巡', '潛．營．炸．排．驅', '潛．工．．．．．驅']) },
  { name: '海上長城', desc: '兩翼艦隊各守一邊，陸軍穩紮穩打', L: P(['巡戰雷排雷旗連偵巡', '主砲炸高工營高砲主', '驅．團．師．旅．驅', '潛．連軍．司營．潛', '．．團．炸．排．．', '．．工．．．．．．']) },
  { name: '虛實雙旗', desc: '地雷夾在兩個大本營之間，讓對手猜不透軍旗在哪', L: P(['主偵雷旗雷連排戰主', '巡砲營高工炸高砲巡', '驅．團．司．師．驅', '潛．連軍．旅營．潛', '．．團．炸．排．．', '．．．工．．．．．']) },
];

export function randomLayout(rng = Math.random) {
  for (let tries = 0; tries < 200; tries++) {
    const L = new Array(LSIZE).fill(0);
    const slots = LAYOUT_SLOTS.slice();
    const take = (t) => { const c = slots.filter((li) => canPlace(t, li)); if (!c.length) return false; const li = c[Math.floor(rng() * c.length)]; slots.splice(slots.indexOf(li), 1); L[li] = t; return true; };
    let ok = take(FLAG);
    for (const t of [MINE, MINE, BOMB, BOMB, RECON, FIGHTER]) ok = ok && take(t);
    if (!ok) continue;
    const rest = [];
    for (let t = 1; t < NT; t++) { if (t === FLAG || t === MINE || t === BOMB || isAir(t)) continue; for (let i = 0; i < COUNT[t]; i++) rest.push(t); }
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    for (const t of rest) ok = ok && take(t);
    if (ok && !validateLayout(L)) return L;
  }
  return PRESETS[0].L.slice();
}

// 合法地交換兩格（布陣時使用；空格也可以交換＝移動）
export function canSwap(L, a, b) {
  if (a === b || !canPlace(0, a) || !canPlace(0, b)) return false;
  return canPlace(L[a], b) && canPlace(L[b], a);
}

// 布陣微調：隨機交換幾對「放得下」的位置（AI 使用，避免每局都一樣）
export function mutateLayout(L, n = 4, rng = Math.random) {
  const out = L.slice();
  const S = LAYOUT_SLOTS.length;
  for (let i = 0; i < n * 10 && n > 0; i++) {
    const a = LAYOUT_SLOTS[Math.floor(rng() * S)], b = LAYOUT_SLOTS[Math.floor(rng() * S)];
    if (out[a] === FLAG || out[b] === FLAG) continue;
    if (canSwap(out, a, b) && out[a] !== out[b]) { [out[a], out[b]] = [out[b], out[a]]; n--; }
  }
  return out;
}

// ---------------- 對局（裁判）----------------
export class SanjunGame {
  // layouts：[紅軍布陣, 藍軍布陣]；kind：'dark' 暗棋（看不到對方）｜'open' 明棋；first：先走的一方
  constructor({ layouts, first = 0, kind = 'dark' } = {}) {
    this.kind = kind === 'open' ? 'open' : 'dark';
    this.first = first ? 1 : 0;
    this.layouts = [layouts?.[0] ? Array.from(layouts[0]) : randomLayout(), layouts?.[1] ? Array.from(layouts[1]) : randomLayout()];
    this.board = new Int8Array(NSQ);
    this.pid = new Int16Array(NSQ).fill(-1);
    this.pieces = []; // id → { side, type, home(sq), alive }
    for (const side of [0, 1]) {
      const L = this.layouts[side];
      for (let li = 0; li < LSIZE; li++) {
        if (!L[li]) continue;
        const sq = sqOfLi(side, li);
        const id = this.pieces.length;
        this.pieces.push({ id, side, type: L[li], home: sq, alive: true });
        this.board[sq] = mk(side, L[li]);
        this.pid[sq] = id;
      }
    }
    this.revealed = new Array(this.pieces.length).fill(false); // 被偵察機翻開的棋子
    this.turn = this.first;
    this.moves = [];
    this.log = [];
    this.quiet = 0;
    this.flagShown = [false, false]; // 總司令陣亡後亮出軍旗
    this.result = null;
    this.stack = [];
  }

  get plies() { return this.moves.length; }

  legalMoves(side = this.turn) { return this.result ? [] : genMoves(this.board, side); }
  targets(sq) { return targetList(this.board, sq); }
  isLegal(m) { if (this.result) return false; const f = mvFrom(m); const c = this.board[f]; if (!c || (c >> 5) !== this.turn) return false; return targetList(this.board, f).includes(mvTo(m)); }

  flagSq(side) { for (let sq = 0; sq < NSQ; sq++) if (this.board[sq] === mk(side, FLAG)) return sq; return -1; }

  snapshot() { return { board: this.board.slice(), pid: this.pid.slice(), alive: this.pieces.map((p) => p.alive), revealed: this.revealed.slice(), turn: this.turn, quiet: this.quiet, flagShown: this.flagShown.slice(), result: this.result }; }
  restore(s) { this.board = s.board; this.pid = s.pid; s.alive.forEach((a, i) => { this.pieces[i].alive = a; }); this.revealed = s.revealed; this.turn = s.turn; this.quiet = s.quiet; this.flagShown = s.flagShown; this.result = s.result; }

  // 走一步；回傳這一步的紀錄
  play(m) {
    const from = mvFrom(m), to = mvTo(m);
    this.stack.push(this.snapshot());
    const side = this.turn;
    const a = this.board[from], d = this.board[to];
    const aid = this.pid[from], did = d ? this.pid[to] : -1;
    const ev = { ply: this.moves.length, side, from, to, aid, did, at: a & 31, dt: d ? d & 31 : 0, out: 'move', stay: false, cmdDead: [], flagSq: [-1, -1] };
    if (!d) {
      this.board[from] = 0; this.pid[from] = -1;
      this.board[to] = a; this.pid[to] = aid;
      this.quiet++;
    } else {
      const r = fight(a & 31, d & 31);
      if (r === 3) {
        ev.out = 'scout';
        this.revealed[did] = true;
        this.quiet++;
      } else {
        this.quiet = 0;
        this.board[from] = 0; this.pid[from] = -1;
        if (r === 1 || r === 2) {
          ev.out = r === 2 ? 'flag' : 'win';
          this.pieces[did].alive = false;
          if (canStand(a & 31, to)) { this.board[to] = a; this.pid[to] = aid; }
          else { ev.stay = true; this.board[to] = 0; this.pid[to] = -1; this.board[from] = a; this.pid[from] = aid; }
        } else if (r === -1) {
          ev.out = 'lose';
          this.pieces[aid].alive = false;
        } else {
          ev.out = 'tie';
          this.pieces[aid].alive = false; this.pieces[did].alive = false;
          this.board[to] = 0; this.pid[to] = -1;
        }
        const dead = [];
        if (ev.out === 'lose' || ev.out === 'tie') dead.push(this.pieces[aid]);
        if (ev.out === 'win' || ev.out === 'tie') dead.push(this.pieces[did]);
        for (const p of dead) if (p.type === SI && !this.flagShown[p.side]) {
          this.flagShown[p.side] = true;
          ev.cmdDead.push(p.side);
          ev.flagSq[p.side] = this.flagSq(p.side);
        }
      }
    }
    this.moves.push(m);
    this.log.push(ev);
    this.turn = side ^ 1;
    if (ev.out === 'flag') this.result = { winner: side, reason: '奪下軍旗' };
    else if (!hasMoves(this.board, this.turn)) this.result = { winner: side, reason: `${SIDE_NAME[this.turn]}已經沒有可以走的棋子` };
    else if (this.quiet >= QUIET_LIMIT) this.result = { winner: null, reason: `連續 ${QUIET_LIMIT / 2} 回合沒有交戰` };
    else if (this.moves.length >= PLY_LIMIT) this.result = { winner: null, reason: '步數已達上限' };
    ev.result = this.result;
    return ev;
  }

  countMovable(side) { let n = 0; for (const p of this.pieces) if (p.alive && p.side === side && movable(p.type)) n++; return n; }

  undo() {
    if (!this.stack.length) return false;
    this.restore(this.stack.pop());
    this.moves.pop();
    this.log.pop();
    return true;
  }

  resign(side) { if (!this.result) this.result = { winner: side ^ 1, reason: `${SIDE_NAME[side]}認輸` }; }
  agreeDraw() { if (!this.result) this.result = { winner: null, reason: '雙方同意和棋' }; }
  timeout(side) { if (!this.result) this.result = { winner: side ^ 1, reason: `${SIDE_NAME[side]}超時` }; }

  // 某一方看得到的局面（暗棋：對方棋子只知道位置，被偵察過的會翻開；明棋：全部看得到）
  viewFor(side) {
    const open = this.kind === 'open' || side == null;
    const board = new Int8Array(NSQ);
    for (let sq = 0; sq < NSQ; sq++) {
      const c = this.board[sq];
      if (!c) continue;
      const s = c >> 5;
      board[sq] = open || s === side || this.revealed[this.pid[sq]] || ((c & 31) === FLAG && this.flagShown[s]) ? c : mk(s, UNK);
    }
    const events = this.log.map((e) => publicEvent(e, open ? null : side));
    const homes = this.pieces.map((p) => p.home);
    const sides = this.pieces.map((p) => p.side);
    const known = this.pieces.map((p, i) => (open || p.side === side || this.revealed[i] ? p.type : 0));
    return { side, kind: this.kind, open, turn: this.turn, board, pid: Array.from(this.pid), homes, sides, known, revealed: this.revealed.slice(), alive: this.pieces.map((p) => p.alive), events, quiet: this.quiet, plies: this.moves.length, flagShown: this.flagShown.slice(), result: this.result };
  }

  toRecord(meta = {}) {
    return {
      app: 'xiaoke-sanjun', ver: 1,
      date: new Date().toISOString(),
      ...meta,
      kind: this.kind, first: this.first,
      layouts: this.layouts.map((L) => Array.from(L)),
      moves: this.moves.map(moveStr),
      result: !this.result ? '*' : this.result.winner == null ? 'draw' : this.result.winner === 0 ? 'red' : 'blue',
      reason: (meta && meta.reason) || (this.result ? this.result.reason : ''),
    };
  }
}
export { SanjunGame as JunqiGame };

// 事件的公開版本：viewer 看不到對方棋子的種類（裁判只公布勝負；偵察會翻開被偵察的棋子）
export function publicEvent(e, viewer) {
  const pe = { ply: e.ply, side: e.side, from: e.from, to: e.to, aid: e.aid, did: e.did, out: e.out, stay: !!e.stay, cmdDead: e.cmdDead.slice(), flagSq: e.flagSq.slice() };
  if (viewer == null) { pe.at = e.at; pe.dt = e.dt; }
  else {
    pe.at = e.side === viewer ? e.at : 0;
    pe.dt = e.did >= 0 && e.side !== viewer ? e.dt : 0;
    if (e.out === 'scout') { pe.at = RECON; pe.dt = e.dt; }
    if (e.cmdDead.includes(viewer ^ 1)) {
      if (e.side !== viewer && (e.out === 'lose' || e.out === 'tie') && e.at === SI) pe.at = SI;
      if (e.side === viewer && (e.out === 'win' || e.out === 'tie') && e.dt === SI) pe.dt = SI;
    }
  }
  return pe;
}

// 依紀錄重建對局（upto：只走到第幾步）
export function replayRecord(rec, upto = Infinity) {
  const g = new SanjunGame({ layouts: rec.layouts, first: rec.first || 0, kind: rec.kind });
  const list = rec.moves || [];
  for (let i = 0; i < list.length && i < upto; i++) {
    const m = typeof list[i] === 'number' ? list[i] : strMove(list[i]);
    if (m < 0 || !g.isLegal(m)) break;
    g.play(m);
  }
  if (upto >= list.length && !g.result && rec.result && rec.result !== '*') {
    const w = rec.result === 'red' ? 0 : rec.result === 'blue' ? 1 : null;
    g.result = { winner: w, reason: rec.reason || '' };
  }
  return g;
}

// ---------------- 文字說明 ----------------
const OUT_TEXT = { win: '勝', lose: '敗', tie: '同歸於盡', flag: '奪旗！', scout: '偵察' };
// 一步棋的說明；viewer＝看的人（null 表示全部公開）
export function noteOf(e, viewer = null) {
  const pe = viewer == null ? e : publicEvent(e, viewer);
  const nm = (t, s) => (t ? NAMES[t] : (viewer != null && s !== viewer ? '敵軍' : '？'));
  const a = nm(pe.at, pe.side);
  let s = `${a} ${sqName(pe.from)}→${sqName(pe.to)}`;
  if (pe.out !== 'move') {
    const d = nm(pe.dt, pe.side ^ 1);
    s += pe.out === 'flag' ? '　奪下軍旗！' : pe.out === 'scout' ? `　偵察：那是${d}` : pe.out === 'tie' ? `　與${d}同歸於盡` : pe.out === 'win' ? `　${pe.stay ? '擊毀' : '吃掉'}${d}` : `　碰上${d}陣亡`;
  }
  if (pe.cmdDead.length) s += `　（${pe.cmdDead.map((x) => SIDE_NAME[x]).join('、')}總司令陣亡，亮出軍旗）`;
  return s;
}
export { OUT_TEXT };

// 走錯時的原因
export function explainIllegal(board, from, to) {
  const a = board[from];
  if (!a) return '這裡沒有棋子';
  const t = a & 31, side = a >> 5;
  if (t === FLAG) return '軍旗不能移動';
  if (t === MINE) return '地雷埋好就不能移動';
  if (isHQ(from)) return '進了大本營的棋子就不能再移動';
  const d = board[to];
  if (d && (d >> 5) === side) return '那裡是自己的棋子';
  if (d && isCamp(to)) return '行營裡的棋子受到保護，不能攻擊';
  if (!isNode(to)) return '那裡是深海，不能停留';
  if (isAir(t)) {
    if (isHQ(to)) return '飛機不能降落在大本營';
    const dr = Math.abs(rowOf(from) - rowOf(to)), dc = Math.abs(colOf(from) - colOf(to));
    if (!(dr === 0 || dc === 0 || dr === dc)) return '飛機只能沿著直線或斜線飛（像米字）';
    return `${NAMES[t]}一次最多飛 ${FLY_RANGE[t]} 格`;
  }
  if (isShip(t)) {
    if (isAirfield(to)) return '軍艦不能開進飛機場';
    if (isLandSq(to) && !isHarbor(to)) return t === GB && d ? '砲艦只能炮擊緊鄰海岸的陸地（行營、大本營除外）' : '軍艦不能上岸，只能開進港口';
    if (isLane(from) && isLane(to) && colOf(from) === colOf(to)) return '航道上中間有船擋住';
    return '軍艦在近海一次只能走一格，外海航道才能直航';
  }
  // 陸軍
  if (isAirfield(to)) return t === BOMB || t === AA ? '機場上沒有敵機' : '陸軍不能進入飛機場（只有炸彈、高射炮能攻擊機場）';
  if (isSeaSq(to)) return t === AA && d ? '高射炮只能打旁邊一格的海上目標' : '陸軍不能下海';
  if (isBridge(from) || isBridge(to)) return '鐵橋要一步一步走，過橋時要在橋上停一步';
  if (halfOf(from) !== halfOf(to)) return colOf(from) === colOf(to) && isBridge(SQ(6, colOf(from))) ? '過鐵橋時要先走上橋、停一步，不能直接衝到對岸' : '陸軍只能經由鐵橋過海峽';
  if (isRail(from) && isRail(to)) {
    if (onStraightRail(from, to)) return '鐵路上中間有棋子擋住';
    if (t !== GONG) {
      const tryB = Int8Array.from(board); tryB[from] = mk(side, GONG);
      if (targetList(tryB, from).includes(to)) return '只有工兵可以在鐵路上轉彎';
    } else return '鐵路上沒有通路（被棋子擋住）';
  }
  if (Math.abs(rowOf(from) - rowOf(to)) === 1 && Math.abs(colOf(from) - colOf(to)) === 1) return '斜著走只能進出行營';
  return isRail(from) && isRail(to) ? '鐵路走法不對' : '公路一次只能走一步（鐵路上才能走遠）';
}

// 棋盤文字圖（給 AI 軍師）：viewer 的角度
export function boardText(view) {
  const lines = [];
  for (let r = 0; r < ROWS; r++) {
    const cells = [];
    for (let c = 0; c < COLS; c++) {
      const sq = SQ(r, c);
      const code = view.board[sq];
      let s;
      if (!code) s = ['＃＃', '．．', '（營）', '［本］', '港口', '鐵橋', '～～', '≈≈', '機場'][KIND[sq]];
      else {
        const side = code >> 5, t = code & 31;
        s = (side === 0 ? '紅' : '藍') + (t === UNK ? '？' : SHORT[t]);
      }
      cells.push(s.padEnd(4, '　'));
    }
    lines.push(`${String(13 - r).padStart(2, ' ')} ${cells.join('')}${r === 6 ? '　← 海峽（陸軍只能走 C7、E7、G7 鐵橋）' : ''}`);
  }
  lines.push('    A　　B　　C　　D　　E　　F　　G　　H　　I');
  lines.push('（A、I 行是外海航道；B、H 行是近海，最底列是飛機場；C～G 是陸地）');
  return lines.join('\n');
}
