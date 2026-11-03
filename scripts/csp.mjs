// 重新計算 index.html 內嵌 importmap 的 CSP 雜湊（改過 importmap 後執行：node scripts/csp.mjs [檔案]）
import fs from 'fs';
import crypto from 'crypto';
const file = process.argv[2] || new URL('../src/renderer/index.html', import.meta.url);
let html = fs.readFileSync(file, 'utf8');
const m = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);
if (!m) throw new Error('找不到 importmap');
const hash = crypto.createHash('sha256').update(m[1], 'utf8').digest('base64');
html = html.replace(/script-src 'self' 'sha256-[^']*'/, `script-src 'self' 'sha256-${hash}'`);
fs.writeFileSync(file, html, 'utf8');
console.log('sha256-' + hash);
