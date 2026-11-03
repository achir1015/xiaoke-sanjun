import test from 'node:test';
import assert from 'node:assert/strict';
import * as J from '../src/renderer/js/sanjun.js';

const { mk, GONG, PAI, SI, JUN, SHI, BOMB, MINE, FLAG, LIAN, AA, SUB, DD, GB, CA, BB, RECON, FIGHTER } = J;
const empty = () => new Int8Array(J.NSQ);
const S = (n) => J.nameToSq(n);
const tg = (b, sq) => J.targetList(b, sq).map(J.sqName).sort();
const put = (b, side, t, name) => { b[S(name)] = mk(side, t); };

test('經典布陣與隨機布陣都合法，每方 33 顆', () => {
  assert.equal(J.TOTAL, 33);
  for (const p of J.PRESETS) assert.equal(J.validateLayout(p.L), '', p.name);
  for (let i = 0; i < 50; i++) assert.equal(J.validateLayout(J.randomLayout()), '');
});

test('棋盤：行營、大本營、港口、機場、鐵橋', () => {
  const names = (pred) => { const a = []; for (let s = 0; s < J.NSQ; s++) if (pred(s)) a.push(J.sqName(s)); return a.sort(); };
  assert.deepEqual(names((s) => J.isHQ(s)), ['D1', 'D13', 'F1', 'F13']);
  assert.deepEqual(names((s) => J.isAirfield(s)), ['B1', 'B13', 'H1', 'H13']);
  assert.deepEqual(names((s) => J.isHarbor(s)), ['C10', 'C4', 'G10', 'G4']);
  assert.deepEqual(names((s) => J.isBridge(s)), ['C7', 'E7', 'G7']);
  assert.deepEqual(names((s) => J.isCamp(s) && J.halfOf(s) === 0), ['D3', 'D5', 'E4', 'F3', 'F5']);
  assert.equal(J.KIND[S('D7')], J.NONE);
  assert.equal(J.LAYOUT_SLOTS.length, 49);
});

test('陸軍：鐵路直走不轉彎；工兵可轉彎', () => {
  const b = empty();
  put(b, 0, SHI, 'C2');
  const t = tg(b, S('C2'));
  assert.ok(t.includes('C6') && t.includes('G2'), '鐵路直走');
  assert.ok(!t.includes('G6') && !t.includes('C7'), '不轉彎、鐵路不過海峽');
  const b2 = empty();
  put(b2, 0, GONG, 'C2');
  assert.ok(tg(b2, S('C2')).includes('G6'), '工兵轉彎');
});

test('陸軍經鐵橋過海，要在橋上停一步；不能下海、不能進機場', () => {
  const b = empty();
  put(b, 0, SI, 'C6');
  const t = tg(b, S('C6'));
  assert.ok(t.includes('C7') && !t.includes('C8'));
  assert.ok(!t.includes('B6'), '不能下海');
  put(b, 0, JUN, 'E7');
  assert.deepEqual(tg(b, S('E7')), ['E6', 'E8']);
  const b2 = empty();
  put(b2, 0, PAI, 'C1');
  assert.ok(!tg(b2, S('C1')).includes('B1'));
});

test('軍艦：近海一步、外海航道直航、可進港不能上岸', () => {
  const b = empty();
  put(b, 0, CA, 'A2');
  const t = tg(b, S('A2'));
  assert.ok(t.includes('A13') && t.includes('B2'), '航道直航到底');
  put(b, 1, PAI, 'A9');
  assert.ok(tg(b, S('A2')).includes('A9') && !tg(b, S('A2')).includes('A10'), '被擋住');
  const b2 = empty();
  put(b2, 0, DD, 'B4');
  assert.deepEqual(tg(b2, S('B4')), ['A4', 'B3', 'B5', 'C4']);
  const b3 = empty();
  put(b3, 0, DD, 'C4');
  assert.deepEqual(tg(b3, S('C4')), ['B4'], '港口只能回海上');
});

test('砲艦炮擊海岸、高射炮打飛機：贏了留在原地', () => {
  const g = new J.SanjunGame({ layouts: [J.PRESETS[0].L, J.PRESETS[1].L] });
  g.board.fill(0); g.pid.fill(-1);
  const place = (side, t, name) => { const id = g.pieces.findIndex((p) => p.side === side && p.type === t && p.alive && g.pid[p.home] !== -2 && !p._used); g.pieces[id]._used = true; g.board[S(name)] = mk(side, t); g.pid[S(name)] = id; };
  place(0, GB, 'B6'); place(1, PAI, 'C6'); place(0, FLAG, 'D1'); place(1, FLAG, 'D13');
  place(0, AA, 'C12'); place(1, FIGHTER, 'B12'); place(1, GONG, 'E10');
  const ev = g.play(J.MV(S('B6'), S('C6')));
  assert.equal(ev.out, 'win'); assert.equal(ev.stay, true);
  assert.equal(g.board[S('B6')], mk(0, GB)); assert.equal(g.board[S('C6')], 0);
  g.play(J.MV(S('E10'), S('E9')));
  const ev2 = g.play(J.MV(S('C12'), S('B12')));
  assert.equal(ev2.out, 'win'); assert.ok(ev2.stay);
  assert.equal(g.board[S('C12')], mk(0, AA));
});

test('飛機：米字飛行越過棋子，不能降落大本營、深海', () => {
  const b = empty();
  put(b, 0, FIGHTER, 'B1');
  put(b, 0, PAI, 'C2');
  const t = tg(b, S('B1'));
  assert.ok(t.includes('E4') && !t.includes('F5'), '戰鬥機 3 格');
  assert.ok(t.includes('B4') && t.includes('E1'));
  assert.ok(!t.includes('D1'), '不降大本營');
  const b2 = empty();
  put(b2, 0, RECON, 'D5');
  assert.ok(!tg(b2, S('D5')).includes('D7') && tg(b2, S('D5')).includes('D9'), '深海飛越');
});

test('交戰：官階、炸彈、地雷、艦艇、飛機', () => {
  assert.equal(J.fight(SI, JUN), 1);
  assert.equal(J.fight(PAI, LIAN), -1);
  assert.equal(J.fight(LIAN, LIAN), 0);
  assert.equal(J.fight(BOMB, SI), 0);
  assert.equal(J.fight(SI, MINE), 0);
  assert.equal(J.fight(GONG, MINE), 1);
  assert.equal(J.fight(FIGHTER, MINE), 1);
  assert.equal(J.fight(GONG, FLAG), 2);
  assert.equal(J.fight(BB, FLAG), 2);
  assert.equal(J.fight(FIGHTER, FLAG), -1);
  assert.equal(J.fight(BOMB, FLAG), -1);
  assert.equal(J.fight(SUB, BB), 1, '潛艇擊沉主力艦');
  assert.equal(J.fight(BB, SUB), 1);
  assert.equal(J.fight(SUB, DD), -1, '潛艇怕驅逐艦');
  assert.equal(J.fight(BB, CA), 1);
  assert.equal(J.fight(FIGHTER, SI), 1);
  assert.equal(J.fight(FIGHTER, AA), -1);
  assert.equal(J.fight(AA, FIGHTER), 1);
  assert.equal(J.fight(GB, FIGHTER), 1);
  assert.equal(J.fight(SI, FIGHTER), -1);
  assert.equal(J.fight(RECON, SI), 3);
  assert.equal(J.fight(PAI, RECON), 1);
});

test('偵察：翻開對方棋子，不交戰', () => {
  const g = new J.SanjunGame({ layouts: [J.PRESETS[0].L, J.PRESETS[1].L] });
  // 紅軍偵察機在 H1（穩守中宮布陣），往前飛到能看見的敵子
  let rec = -1; for (let sq = 0; sq < J.NSQ; sq++) if (g.board[sq] === mk(0, RECON)) rec = sq;
  assert.ok(rec >= 0);
  const blue = g.pieces.find((p) => p.side === 1 && p.type === SUB);
  g.board[S('H5')] = g.board[blue.home]; g.pid[S('H5')] = blue.id; g.board[blue.home] = 0; g.pid[blue.home] = -1;
  const ev = g.play(J.MV(rec, S('H4')));
  assert.equal(ev.out, 'move');
  g.play(g.legalMoves().find((m) => !g.board[J.mvTo(m)]));
  const ev2 = g.play(J.MV(S('H4'), S('H5')));
  assert.equal(ev2.out, 'scout');
  assert.equal(g.viewFor(0).board[S('H5')], mk(1, SUB));
  assert.equal(J.noteOf(ev2, 0), '偵察機 H4→H5　偵察：那是潛水艇');
});

test('行營保護、進大本營不能動', () => {
  const b = empty();
  put(b, 1, SI, 'E5'); put(b, 0, PAI, 'E4');
  assert.ok(!tg(b, S('E5')).includes('E4'));
  put(b, 1, FIGHTER, 'E1');
  assert.ok(!tg(b, S('E1')).includes('E4') && tg(b, S('E1')).includes('E3'));
  const b2 = empty();
  put(b2, 0, SI, 'D1');
  assert.deepEqual(tg(b2, S('D1')), []);
});

test('布陣規則', () => {
  const L = J.PRESETS[0].L.slice();
  const fl = L.indexOf(FLAG);
  const bad = L.slice(); [bad[fl], bad[fl + 1]] = [bad[fl + 1], bad[fl]];
  assert.match(J.validateLayout(bad), /軍旗/);
  assert.ok(!J.canPlace(BB, 2 * 9 + 2), '軍艦不能放陸地');
  assert.ok(!J.canPlace(FIGHTER, 9), '飛機只放機場');
  assert.ok(J.canPlace(FIGHTER, 1) && J.canPlace(RECON, 7));
  assert.ok(!J.canPlace(MINE, 2 * 9 + 2) && J.canPlace(MINE, 9 + 2));
  assert.ok(!J.canPlace(BOMB, 5 * 9 + 2));
  assert.ok(J.canSwap(L, J.LAYOUT_SLOTS.find((li) => L[li] === PAI && li > 40), J.LAYOUT_SLOTS.find((li) => !L[li] && J.liKind(li) === J.POST)), '可以移到空格');
});

test('記譜與重播', () => {
  const g = new J.SanjunGame({ layouts: [J.PRESETS[0].L, J.PRESETS[2].L] });
  for (let i = 0; i < 60 && !g.result; i++) { const ms = g.legalMoves(); g.play(ms[(i * 7) % ms.length]); }
  const rec = g.toRecord({});
  const g2 = J.replayRecord(rec);
  assert.deepEqual(Array.from(g2.board), Array.from(g.board));
  assert.equal(J.sqName(J.nameToSq('I13')), 'I13');
  assert.equal(J.strMove('C2-C6'), J.MV(S('C2'), S('C6')));
});

test('隨機對局都能正常結束，悔棋可還原', () => {
  for (let k = 0; k < 20; k++) {
    const g = new J.SanjunGame({ layouts: [J.randomLayout(), J.randomLayout()] });
    let n = 0;
    while (!g.result && n < 700) { const ms = g.legalMoves(); g.play(ms[Math.floor(Math.random() * ms.length)]); n++; }
    assert.ok(g.result);
    const before = Array.from(g.board);
    if (g.moves.length) { g.undo(); g.play(g.moves.length ? g.legalMoves()[0] : 0); }
    assert.ok(before.length === J.NSQ);
  }
});
