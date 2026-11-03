import test from 'node:test';
import assert from 'node:assert/strict';
import * as J from '../src/renderer/js/sanjun.js';
import { LESSONS, HELP, parsePieces } from '../src/renderer/js/guide.js';

function boardOf(spec) {
  const b = new Int8Array(J.NSQ);
  if (spec === 'preset') { J.PRESETS[0].L.forEach((t, li) => { if (t) b[J.sqOfLi(0, li)] = J.mk(0, t); }); J.PRESETS[1].L.forEach((t, li) => { if (t) b[J.sqOfLi(1, li)] = J.mk(1, t); }); return b; }
  const toks = String(spec || '').trim().split(/\s+/).filter(Boolean);
  for (const tok of toks) assert.match(tok, /^([RB])(.):([A-I]\d{1,2})$/, `擺子格式錯誤：${tok}`);
  const map = parsePieces(spec);
  assert.equal(map.size, toks.length, `有棋子沒擺上去：${spec}`);
  for (const [sq, c] of map) { assert.ok(J.isNode(sq), spec); b[sq] = (c & 31) === J.UNK ? J.mk(c >> 5, J.PAI) : c; }
  return b;
}

test('每一課的示範走法都合乎規則', () => {
  for (const lesson of LESSONS) {
    let b = new Int8Array(J.NSQ);
    for (const st of lesson.steps) {
      if (st.pieces != null) b = boardOf(st.pieces);
      assert.ok(st.say && st.say.length > 4, lesson.title);
      if (st.move) {
        const f = J.nameToSq(st.move[0]), t = J.nameToSq(st.move[1]);
        assert.ok(J.targetList(b, f).includes(t), `${lesson.title}：${st.move.join('→')} 不合規則`);
      }
      if (st.bad) {
        const sel = J.nameToSq(st.sel);
        for (const s of st.bad) {
          assert.ok(!J.targetList(b, sel).includes(J.nameToSq(s)), `${lesson.title}：${st.sel}→${s} 其實可以走`);
          assert.ok(J.explainIllegal(b, sel, J.nameToSq(s)), `${lesson.title}：${st.sel}→${s} 沒有說明`);
        }
      }
      if (st.practice) {
        const f = J.nameToSq(st.practice.piece);
        const tg = J.targetList(b, f);
        assert.ok(tg.length, `${lesson.title}：練習的棋子沒有路走`);
        if (st.practice.goal) assert.ok(tg.includes(J.nameToSq(st.practice.goal)), `${lesson.title}：練習答案不合規則`);
      }
      if (st.path) {
        for (let i = 1; i < st.path.length; i++) assert.ok(J.onStraightRail(J.nameToSq(st.path[i - 1]), J.nameToSq(st.path[i])), `${lesson.title}：路線不是鐵路`);
      }
    }
  }
  assert.ok(LESSONS.length >= 18 && HELP.length >= 8);
});

test('教學的交戰示範結果正確', () => {
  const find = (title, i) => LESSONS.find((l) => l.title === title).steps[i];
  const res = (st) => { const b = boardOf(st.pieces); if (st.reveal) { for (const [sq, c] of parsePieces(`${st.reveal[1]}:${st.reveal[0]}`)) b[sq] = c; } return J.fight(b[J.nameToSq(st.move[0])] & 31, b[J.nameToSq(st.move[1])] & 31); };
  assert.equal(res(find('炸彈', 3)), -1);
  assert.equal(res(find('地雷與工兵', 1)), 0);
  assert.equal(res(find('海軍大小與潛水艇', 1)), 1);
  assert.equal(res(find('偵察機', 1)), 3);
  assert.equal(res(find('暗棋與敵情推算', 2)), -1);
});
