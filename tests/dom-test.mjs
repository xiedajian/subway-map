// DOM 级验证：用 jsdom 真实跑一遍 subway-map.html，检查下拉、渲染、交互状态、错误分支
// 用法：先在项目根目录起静态服务，再
//   cd tests && npm install && node dom-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.BASE || 'http://127.0.0.1:8000').replace(/\/?$/, '/');
let fail = 0;
const check = (n, c, extra = '') => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const html = fs.readFileSync(path.join(ROOT, 'subway-map.html'), 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  url: BASE + 'subway-map.html',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(win) {
    // jsdom 没有 fetch；用 Node 的 fetch，把相对路径解析到本地 http 服务
    win.fetch = (u, o) => fetch(new URL(u, BASE), o);
    win.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
  },
});
const win = dom.window, doc = win.document;
const $ = id => doc.getElementById(id);
const count = sel => doc.querySelectorAll(sel).length;

async function waitFor(fn, ms = 6000, step = 50) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (fn()) return true; } catch (_) {}
    await sleep(step);
  }
  return false;
}

// 预期值随 index.json 走，换数据集后不用改测试
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/index.json'), 'utf8'));
const TOTAL = index.total;
const bjInfo = index.cities.find(c => c.code === 131);
const shInfo = index.cities.find(c => c.code === 289);

/* ---------- 1. 首屏（默认北京） ---------- */
const booted = await waitFor(() => $('city') && $('city').options.length > 3);
check('下拉已填充', booted, `options=${$('city') ? $('city').options.length : 0}`);
await waitFor(() => count('#root polyline') > 0);

const sel = $('city');
check(`选项数 = ${TOTAL}`, sel.options.length === TOTAL, `实际 ${sel.options.length}`);
check('下拉按三组排列',
  [...sel.querySelectorAll('optgroup')].map(g => g.label).join('|') === '国内（53）|中国港澳台（4）|海外（22）',
  [...sel.querySelectorAll('optgroup')].map(g => g.label).join(' | '));
check('默认选中北京 131', sel.value === '131' && win.location.hash === '#131', `value=${sel.value} hash=${win.location.hash}`);
check('下拉可用（非 disabled）', sel.disabled === false);
check('选项文案含线路数', sel.options[0].textContent.includes('线'), sel.options[0].textContent.trim());

check(`SVG 线路数 = ${bjInfo.lines}`, count('#root polyline') === bjInfo.lines, `实际 ${count('#root polyline')}`);
check('站点圆点已绘制', count('#root circle') > 300, `实际 ${count('#root circle')}`);
check('站点/换乘文字标注已绘制', count('#root text') > 100, `实际 ${count('#root text')}`);
check(`图例行数 = ${bjInfo.lines}`, count('#legend .row') === bjInfo.lines, `实际 ${count('#legend .row')}`);
check('顶栏线路数正确', $('s-l').textContent === String(bjInfo.lines), $('s-l').textContent);
check('顶栏站点数正确', $('s-s').textContent === String(425), $('s-s').textContent);
check('状态徽标 ok', $('badge').className.includes('ok'), $('badge-t').textContent);
check('标题含城市名', doc.title.startsWith('北京市'), doc.title);
check('覆盖层已隐藏', !$('overlay').className.includes('on'));
check('图例标题含城市名', $('legend-hd').textContent.includes('北京市'), $('legend-hd').textContent.trim());
check('viewport 已设置', ($('cv').getAttribute('viewBox') || '').split(' ').length === 4, $('cv').getAttribute('viewBox'));

/* ---------- 1b. 悬停高亮（回归点：lineNodes 必须真的被填充） ---------- */
const polys = [...doc.querySelectorAll('#root polyline')];
const op = n => n.getAttribute('opacity');
check('每条线路都带 data-li', polys.every((p, k) => p.getAttribute('data-li') === String(k)), `共 ${polys.length} 条`);

const rows = [...doc.querySelectorAll('#legend .row')];
const T = 2;
rows[T].dispatchEvent(new win.MouseEvent('mouseenter'));
check('悬停时目标线路保持高亮', op(polys[T]) === '0.95', `line${T + 1}=` + op(polys[T]));
check('悬停时其它线路变暗为 0.1', op(polys[0]) === '0.1' && op(polys[polys.length - 1]) === '0.1',
  `line1=${op(polys[0])} lineN=${op(polys[polys.length - 1])}`);

const circlesAll = [...doc.querySelectorAll('#root circle')];
const cMine = circlesAll.filter(c => c.getAttribute('data-li') === String(T));
const cOther = circlesAll.filter(c => c.getAttribute('data-li') === '0');
check('悬停时目标线路站点全亮', cMine.length > 0 && cMine.every(c => op(c) === '1'), `目标站 ${cMine.length} 个`);
check('悬停时其它线路站点变暗为 0.12', cOther.every(c => op(c) === '0.12'), `对照站 ${cOther.length} 个`);

const textsAll = [...doc.querySelectorAll('#root text')];
const tMine = textsAll.filter(t => t.getAttribute('data-li') === String(T));
check('悬停时目标线路标注全亮', tMine.length > 0 && tMine.every(t => op(t) === '1'), `标注 ${tMine.length} 个`);

rows[T].dispatchEvent(new win.MouseEvent('mouseleave'));
check('移开后线路/站点/标注全部恢复',
  polys.every(p => op(p) === '0.95') && circlesAll.every(c => op(c) === '1') && textsAll.every(t => op(t) === '1'));

/* ---------- 2. 切换城市 ---------- */
sel.value = '289';
sel.dispatchEvent(new win.Event('change'));
const switched = await waitFor(() => $('s-l').textContent === String(shInfo.lines));
check(`切到上海后重绘（${shInfo.lines} 线）`, switched, `s-l=${$('s-l').textContent}`);
check('切换后 hash 同步为 #289', win.location.hash === '#289', win.location.hash);
check('切换后标题更新', doc.title.startsWith('上海市'), doc.title);
check(`切换后图例重建为 ${shInfo.lines} 行`, count('#legend .row') === shInfo.lines, `实际 ${count('#legend .row')}`);
check(`切换后 SVG 重建为 ${shInfo.lines} 条线`, count('#root polyline') === shInfo.lines, `实际 ${count('#root polyline')}`);
check('切换后无残留（旧图已清空）', count('#root polyline') !== bjInfo.lines);

/* ---------- 3. 切回已加载城市（命中内存缓存，不重复请求） ---------- */
let fetchCount = 0;
const origFetch = win.fetch;
win.fetch = (u, o) => { fetchCount++; return origFetch(u, o); };
sel.value = '131';
sel.dispatchEvent(new win.Event('change'));
await waitFor(() => $('s-l').textContent === String(bjInfo.lines));
await sleep(300);
check('切回北京命中缓存（0 次请求）', fetchCount === 0, `fetch=${fetchCount}`);

/* ---------- 4. 数据文件缺失时的错误分支 ---------- */
win.location.hash = '#99999';
const errShown = await waitFor(() => $('overlay').className.includes('on'), 5000);
check('hash 指向不存在的城市 → 弹错误层', errShown);
check('错误层文案指出文件缺失',
  $('overlay-card').innerHTML.includes('找不到') || $('overlay-card').innerHTML.includes('city-99999'),
  ($('overlay-card').textContent || '').slice(0, 40));
check('错误态徽标为 err', $('badge').className.includes('err'), $('badge-t').textContent);

/* ---------- 5. 无脚本错误 ---------- */
check('运行期无未捕获错误', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log(fail === 0 ? '\nDOM 层全部通过 ✅' : `\n有 ${fail} 项未通过 ❌`);
dom.window.close();
process.exit(fail === 0 ? 0 : 1);
