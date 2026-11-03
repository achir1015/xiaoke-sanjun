// AI 背景執行緒：計算著法、推算敵情、布陣
import { chooseMove, analyze, infer, chooseLayout } from './ai.js';

self.onmessage = (e) => {
  const { id, cmd, view, opts = {} } = e.data;
  try {
    let r;
    if (cmd === 'move') r = chooseMove(view, opts.level ?? 2, opts.learned || null);
    else if (cmd === 'analyze') r = analyze(view, opts.level ?? 3, opts.learned || null, opts.top || 3);
    else if (cmd === 'infer') r = infer(view, opts.learned || null, opts.n || 160);
    else if (cmd === 'layout') r = chooseLayout(opts.level ?? 2, opts.learned || null);
    else throw new Error('未知的指令 ' + cmd);
    self.postMessage({ id, ok: true, r });
  } catch (err) {
    self.postMessage({ id, ok: false, e: String((err && err.stack) || err) });
  }
};
