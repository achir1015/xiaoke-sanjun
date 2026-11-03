// AI 軍師小視窗：本機 AI（推算＋搜尋）分析＋（有金鑰時）Claude 白話解說
import { h, uid } from './util.js';
import * as J from './sanjun.js';
import { maskText } from './belief.js';

const QUICK = [
  ['現在該怎麼走？', '現在輪到我，該怎麼走比較好？'],
  ['對方哪顆是大子？', '根據目前的推算，對方哪幾顆棋子最可能是司令、軍長或炸彈？'],
  ['軍旗安全嗎？', '我的軍旗現在安全嗎？要怎麼防守？'],
  ['布陣建議', '布陣有什麼技巧？軍旗、地雷、炸彈要怎麼擺？'],
];

const pieceName = (code) => (code ? J.NAMES[code & 31] : '');

export class AdvisorPanel {
  // ctx(): { game, view, mySide, phase, kind, analyze(view) → Promise<[{move, score}]>, infer(view) → Promise, showHint(m) }
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx;
    this.history = [];
    this.busy = null;
    this.hasKey = false;
    this.build();
    xk.advisor.onDelta((d) => { if (this.busy && d.id === this.busy.id) { this.busy.text += d.text; this.busy.el.textContent = this.busy.text; this.scroll(); } });
    xk.advisor.onDone((d) => this.onDone(d));
  }

  setAdvisor(label, url, onChange) {
    this.nameEl.textContent = label || '小柯軍師';
    if (url) this.avEl.src = url;
    this.avEl.classList.toggle('hidden', !url);
    this.changeBtn.classList.toggle('hidden', !onChange);
    this.changeBtn.onclick = onChange || null;
  }

  setHasKey(v) {
    this.hasKey = v;
    this.modeEl.textContent = v ? '🟢 Claude 軍師（線上）' : '⚪ 離線軍師（本機 AI）';
    this.modeEl.title = v ? '使用 Claude 以白話解說本機 AI 的分析' : '尚未設定 Anthropic API 金鑰，只提供本機 AI 的建議。可到「設定」輸入金鑰。';
  }

  build() {
    this.modeEl = h('div', { class: 'adv-mode' });
    this.avEl = h('img', { class: 'adv-portrait', alt: '' });
    this.nameEl = h('b', {}, '小柯軍師');
    this.changeBtn = h('button', { class: 'chip adv-change hidden', title: '對局中也可以更換陪同的 AI 軍師' }, '換軍師');
    this.log = h('div', { class: 'adv-log' });
    this.input = h('textarea', { class: 'adv-input', rows: 2, placeholder: '問軍師，例如：對方 C7 那顆是什麼？（Enter 送出）', onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); } } });
    this.btnSend = h('button', { class: 'primary', onclick: () => this.send() }, '請教');
    this.root.append(
      h('div', { class: 'adv-head' }, this.avEl, h('div', { class: 'adv-who' }, this.nameEl, this.modeEl), this.changeBtn),
      this.log,
      h('div', { class: 'adv-quick' }, QUICK.map(([label, q]) => h('button', { class: 'chip', onclick: () => this.send(q) }, label))),
      h('div', { class: 'adv-send' }, this.input, this.btnSend),
    );
    this.say('ai', '您好！我是陪同您參戰的 AI 軍師。布陣、試探、推算對方暗子、保護軍旗都可以問我。');
  }

  reset() {
    this.history = [];
    this.log.innerHTML = '';
    this.say('ai', '新的一局開始了！先把布陣排好，需要建議隨時叫我。');
  }

  say(who, text) {
    const el = h('div', { class: 'adv-msg ' + who }, text);
    this.log.append(el);
    this.scroll();
    return el;
  }

  scroll() { this.log.scrollTop = this.log.scrollHeight; }

  describe(view, m) {
    const f = J.mvFrom(m), t = J.mvTo(m);
    const d = view.board[t];
    return `${pieceName(view.board[f])} ${J.sqName(f)}→${J.sqName(t)}${d ? `（攻擊${(d & 31) === J.UNK ? '敵軍暗子' : pieceName(d)}）` : ''}`;
  }

  async buildContext() {
    const c = this.ctx();
    const g = c.game, view = c.view;
    const me = c.mySide;
    if (!g || !view || c.phase === 'layout') {
      return { layout: true, text: '【局面資訊】目前在布陣階段。規則：軍旗只能放大本營（D1、F1）；兩顆地雷只能放陸地最後兩排；兩顆炸彈不能放第一排；行營要空著；軍艦放海上（A、B、H、I 行）；偵察機、戰鬥機放飛機場（B1、H1）。', mine: true };
    }
    const mine = view.turn === me && !g.result;
    const [cands, inf] = await Promise.all([
      g.result ? Promise.resolve([]) : c.analyze(g.viewFor(view.turn)),
      c.kind === 'dark' ? c.infer(view) : Promise.resolve(null),
    ]);
    const recent = g.log.slice(-10).map((e, i) => `${g.log.length - Math.min(10, g.log.length) + i + 1}. ${J.SIDE_NAME[e.side]}：${J.noteOf(e, c.kind === 'open' ? null : me)}`).join('\n');
    const intel = [];
    if (inf) {
      for (let sq = 0; sq < J.NSQ; sq++) {
        const id = g.pid[sq];
        if (id < 0 || g.pieces[id].side === me) continue;
        const p = inf.pieces[id];
        if (!p) continue;
        const top = p.p.map((x, t) => [t, x]).filter(([, x]) => x > 0.08).sort((a, b) => b[1] - a[1]).slice(0, 3);
        intel.push({ sq, p, line: `${J.sqName(sq)}：範圍「${maskText(p.mask)}」，${top.map(([t, x]) => `${J.NAMES[t]} ${Math.round(x * 100)}%`).join('、')}` });
      }
      intel.sort((a, b) => b.p.pTop - a.p.pTop);
    }
    const myFlag = g.flagSq(me);
    const text = [
      `【局面資訊】您是${J.SIDE_NAME[me]}（${me === 0 ? '棋盤下方' : '棋盤上方'}）。${c.kind === 'dark' ? '暗棋：看不到對方棋子。' : '明棋：雙方棋子公開。'}`,
      g.result ? `對局已結束：${g.result.reason}` : `現在輪到${mine ? '您' : '對方'}。已走 ${g.moves.length} 步，連續 ${g.quiet} 步沒有交戰。`,
      `您的軍旗在 ${myFlag >= 0 ? J.sqName(myFlag) : '（已失守）'}。`,
      '棋盤（紅＝紅軍、藍＝藍軍、？＝看不到的暗子、（營）＝行營、［本］＝大本營、～～＝近海、≈≈＝外海航道、＃＃＝深海）：',
      J.boardText(view),
      recent ? `最近的戰況：\n${recent}` : '（還沒有走任何一步）',
      inf ? `敵情推算（依可能性排序，前 12 顆）：\n${intel.slice(0, 12).map((x) => x.line).join('\n')}` : '',
      cands.length ? `本機 AI 的候選走法（${mine ? '建議您' : '預測對方'}）：\n${cands.map((x, i) => `${i + 1}. ${this.describe(g.viewFor(view.turn), x.move)}（評分 ${x.score}）`).join('\n')}` : '',
    ].filter(Boolean).join('\n');
    return { text, cands, mine, inf, intel, g, view, me };
  }

  async send(q) {
    const question = (q || this.input.value).trim();
    if (!question || this.busy) return;
    this.input.value = '';
    this.say('me', question);
    const pending = this.say('ai thinking', '軍師正在推算敵情…');
    let c;
    try { c = await this.buildContext(); } catch (e) { pending.textContent = '分析失敗：' + e.message; pending.classList.remove('thinking'); return; }
    if (c.mine && c.cands && c.cands[0]) this.ctx().showHint(c.cands[0].move);
    if (!this.hasKey) {
      pending.classList.remove('thinking');
      pending.textContent = this.offlineAnswer(c, question);
      this.scroll();
      return;
    }
    pending.textContent = '';
    pending.classList.add('streaming');
    const id = uid();
    this.busy = { id, el: pending, text: '', question };
    this.btnSend.textContent = '停止';
    this.btnSend.onclick = () => xk.advisor.cancel(id);
    const userMsg = { role: 'user', content: `${c.text}\n\n【我的問題】${question}` };
    this.busy.userMsg = userMsg;
    this.busy.offline = this.offlineAnswer(c, question);
    xk.advisor.ask(id, { messages: [...this.history.slice(-12), userMsg] });
  }

  onDone(d) {
    const b = this.busy;
    if (!b || d.id !== b.id) return;
    this.busy = null;
    this.btnSend.textContent = '請教';
    this.btnSend.onclick = () => this.send();
    b.el.classList.remove('thinking', 'streaming');
    if (d.error) {
      if (d.error === 'cancelled') { b.el.textContent = (b.text || '') + '（已停止）'; return; }
      if (d.error === 'nokey') { this.setHasKey(false); b.el.textContent = b.offline; return; }
      b.el.textContent = `${b.offline}\n\n⚠ ${d.error}`;
      return;
    }
    const text = d.text || b.text;
    b.el.textContent = text + (d.truncated ? '…' : '');
    this.history.push(b.userMsg, { role: 'assistant', content: text });
    this.scroll();
  }

  offlineAnswer(c, question) {
    if (c.layout || /布陣/.test(question)) {
      return '布陣小技巧：\n1. 軍旗放大本營，旁邊用地雷圍住，對方只有工兵、戰鬥機能清掉地雷。\n2. 高射炮放在後方靠近機場、軍旗的位置，敵機一來就能擊落。\n3. 炸彈放在第二、三排靠鐵路的位置，等對方總司令、軍長衝進來時換掉它。\n4. 主力艦、巡洋艦放外海航道可以快速直航；驅逐艦跟在旁邊專打潛水艇。\n5. 砲艦放在港口旁的近海，可以炮擊上岸的敵軍。\n也可以按左邊「🧙 軍師推薦」讓我幫您排。';
    }
    const g = c.g;
    if (g.result) return `這局已經結束（${g.result.reason}），可以到「棋譜庫」重播檢討，雙方布陣都會翻開。`;
    const lines = [];
    if (c.cands && c.cands[0]) {
      const best = this.describe(g.viewFor(c.view.turn), c.cands[0].move);
      lines.push(c.mine ? `建議：${best}。（棋盤上綠色箭頭就是建議走法）` : `現在是對方走，電腦預測對方可能會 ${best}。`);
    }
    if (c.inf && c.intel.length) {
      const big = c.intel.filter((x) => (x.p.p[J.SI] || 0) + (x.p.p[J.JUN] || 0) + (x.p.p[J.FIGHTER] || 0) > 0.35).slice(0, 2);
      const bombs = c.intel.filter((x) => (x.p.p[J.BOMB] || 0) > 0.3).slice(0, 2);
      const mines = c.intel.filter((x) => (x.p.p[J.MINE] || 0) > 0.5).slice(0, 3);
      if (big.length) lines.push(`可能是大子（總司令／軍長／戰鬥機）：${big.map((x) => J.sqName(x.sq)).join('、')}，別用小子硬碰。`);
      if (bombs.length) lines.push(`可能是炸彈：${bombs.map((x) => J.sqName(x.sq)).join('、')}，可以先用小子試探。`);
      if (mines.length) lines.push(`很可能是地雷：${mines.map((x) => J.sqName(x.sq)).join('、')}，要派工兵去挖。`);
    }
    const f = g.flagSq(c.me);
    if (f >= 0) {
      const near = J.ADJ[f].filter((sq) => g.board[sq] && (g.board[sq] >> 5) !== c.me);
      if (near.length) lines.push(`⚠ 敵軍已經到了軍旗旁邊（${near.map(J.sqName).join('、')}），要立刻回防！`);
    }
    if (!lines.length) lines.push('局面平穩，可以派偵察機翻開對方的大子，或用小子過鐵橋試探，觀察裁判結果再決定大子要往哪裡打。');
    return lines.join('\n');
  }
}
