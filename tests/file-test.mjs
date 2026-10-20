// file:// 分支验证：双击打开时必须弹引导层，而不是白屏 / 刷一屏 CORS 报错
// 用法：cd tests && npm install && node file-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const check = (n, c, extra = '') => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push(e.message));
vc.on('error', (...a) => errors.push(a.join(' ')));

let fetches = 0;
const fileUrl = 'file:///' + ROOT.replace(/\\/g, '/').replace(/^\//, '') + '/index.html';
const dom = new JSDOM(html, {
  url: fileUrl,
  runScripts: 'dangerously',
  virtualConsole: vc,
  beforeParse(win) {
    // file:// 下真实浏览器会直接拦掉 fetch；这里模拟成抛错，同时计数
    win.fetch = () => { fetches++; return Promise.reject(new TypeError('Failed to fetch')); };
  },
});
const win = dom.window, doc = win.document;
const $ = id => doc.getElementById(id);
await sleep(500);

check('检测到 file:// 协议', win.location.protocol === 'file:');
check('弹出了引导层', $('overlay').className.includes('on'));
check('引导层标题说明原因', $('overlay-card').textContent.includes('本地服务'), ($('overlay-card').textContent || '').slice(0, 30));
check('引导层给出了 serve 入口', $('overlay-card').innerHTML.includes('serve.bat'));
check('引导层给出了 python -m http.server', $('overlay-card').innerHTML.includes('python -m http.server 8000'));
check('下拉置为 disabled', $('city').disabled === true);
check('徽标提示 file:// 打开', $('badge').className.includes('err') && $('badge-t').textContent.includes('file://'), $('badge-t').textContent);
check('未发出任何请求（不刷 CORS 报错）', fetches === 0, `fetch=${fetches}`);
check('无未捕获错误', errors.length === 0, errors.slice(0, 2).join(' | '));
check('点击重新加载不崩', (() => { try { $('reload').click(); return true; } catch (e) { return false; } })());

console.log(fail === 0 ? '\nfile:// 分支全部通过 ✅' : `\n有 ${fail} 项未通过 ❌`);
dom.window.close();
process.exit(fail === 0 ? 0 : 1);
