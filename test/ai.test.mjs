import test from 'node:test';
import assert from 'node:assert/strict';
import * as J from '../src/renderer/js/sanjun.js';
import { buildBelief, sample, marginals, maskText } from '../src/renderer/js/belief.js';
import { chooseMove, chooseLayout, infer } from '../src/renderer/js/ai.js';

const playUntilFights = (g, fights = 8) => {
  let n = 0;
  while (!g.result && n < 400 && g.log.filter((e) => e.out !== 'move').length < fights) {
    const ms = g.legalMoves();
    const cap = ms.filter((m) => g.board[J.mvTo(m)]);
    const pool = cap.length && n % 2 === 0 ? cap : ms;
    g.play(pool[(n * 13) % pool.length]);
    n++;
  }
};

test('推算：抽樣一定符合數量與位置規則', () => {
  const g = new J.SanjunGame({ layouts: [J.PRESETS[0].L, J.PRESETS[2].L] });
  const b = buildBelief(g.viewFor(0), null);
  for (let i = 0; i < 40; i++) {
    const s = sample(b);
    assert.ok(s);
    const cnt = new Array(J.NT).fill(0);
    for (const [id, t] of s) { cnt[t]++; const li = J.liOf(1, g.pieces[id].home); assert.ok(J.canPlace(t, li), J.NAMES[t]); }
    for (let t = 1; t < J.NT; t++) assert.equal(cnt[t], J.COUNT[t]);
  }
});

test('推算：交戰與偵察結果都和真相一致（不會把真實種類排除）', () => {
  for (let k = 0; k < 6; k++) {
    const g = new J.SanjunGame({ layouts: [J.randomLayout(), J.randomLayout()] });
    playUntilFights(g, 10);
    for (const side of [0, 1]) {
      const v = g.viewFor(side);
      const b = buildBelief(v, null);
      for (const id of b.ids) assert.ok(b.mask.get(id) & (1 << g.pieces[id].type), `${J.NAMES[g.pieces[id].type]} 被排除了`);
      const m = marginals(b, 30);
      assert.ok(m.samples > 0);
    }
  }
});

test('遮罩說明', () => {
  assert.equal(maskText(1 << J.SI), '總司令');
  assert.match(maskText((1 << J.BB) | (1 << J.CA)), /巡洋艦/);
});

test('AI 一定走合法的棋，且只看自己的視角', () => {
  const g = new J.SanjunGame({ layouts: [chooseLayout(2), chooseLayout(3)] });
  for (let i = 0; i < 16 && !g.result; i++) {
    const r = chooseMove(g.viewFor(g.turn), 1);
    assert.ok(g.isLegal(r.move), r.info);
    g.play(r.move);
  }
  const v = g.viewFor(0);
  assert.ok(Array.from(v.board).some((c) => c && (c >> 5) === 1 && (c & 31) === J.UNK));
  assert.ok(infer(v, null, 20).samples > 0);
});

test('AI 會吃掉送上門的總司令（明棋）', () => {
  const g = new J.SanjunGame({ layouts: [J.PRESETS[0].L, J.PRESETS[1].L], kind: 'open' });
  // 讓藍軍總司令走到紅軍戰鬥機能飛到的地方
  const si = g.pieces.find((p) => p.side === 1 && p.type === J.SI);
  const sq = si.home, dst = J.nameToSq('B4');
  g.board[dst] = 0;
  const fighter = g.pieces.find((p) => p.side === 0 && p.type === J.FIGHTER);
  // 把總司令放到戰鬥機旁邊的近海（飛機可以攻擊海上目標）
  g.board[dst] = g.board[sq]; g.pid[dst] = si.id; g.board[sq] = 0; g.pid[sq] = -1;
  const r = chooseMove(g.viewFor(0), 2);
  assert.equal(J.mvTo(r.move), dst, `AI 走了 ${J.moveStr(r.move)}，戰鬥機在 ${J.sqName(fighter.home)}`);
});

test('AI 布陣合法', () => {
  for (let lv = 0; lv < 5; lv++) assert.equal(J.validateLayout(chooseLayout(lv)), '');
});
