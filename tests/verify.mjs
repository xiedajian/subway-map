// 数据层验证：1) 抽出页面里的 normalize() 跑全部城市数据 2) 校验静态服务路由
// 用法：先起静态服务（serve.bat / serve.sh / python -m http.server 8000），再
//   node tests/verify.mjs
// 可用 BASE 环境变量指向别的端口：BASE=http://127.0.0.1:8080 node tests/verify.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
let fail = 0;
const check = (name, cond, extra = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

/* ---------- 1. 从页面里抽出 normalize() ---------- */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const start = script.indexOf('function normalize(raw)');
let i = script.indexOf('{', start), depth = 0, end = -1;
for (let j = i; j < script.length; j++) {
  if (script[j] === '{') depth++;
  else if (script[j] === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
}
const normalize = eval('(' + script.slice(start, end).replace(/^function\s+\w+/, 'function') + ')');
check('从页面抽出 normalize()', typeof normalize === 'function');

/* ---------- 2. 全部城市跑一遍 normalize ---------- */
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/index.json'), 'utf8'));
check(`index.json 城市数 = ${index.total}`, index.total === index.cities.length,
  `total=${index.total} ok=${index.ok} empty=${index.empty} failed=${index.failed}`);

let bj = null, crashes = 0, empties = 0, colorBad = 0, ptsBad = 0;
const perCity = [];
for (const c of index.cities) {
  const f = path.join(ROOT, 'data', c.file);
  try {
    const d = normalize(JSON.parse(fs.readFileSync(f, 'utf8')));
    if (!d.lines.length) empties++;
    d.lines.forEach(L => {
      if (!/^#[0-9A-Fa-f]{6}$/.test(L.color)) colorBad++;
      if (!L.pts.length) ptsBad++;
    });
    perCity.push([c.cn_name, d.lines.length, d.lines.reduce((s, L) => s + L.pts.length, 0)]);
    if (c.code === 131) bj = d;
  } catch (e) {
    crashes++;
    console.log('   !! normalize 抛错:', c.cn_name, e.message);
  }
}
check('全部城市可 normalize 不抛错', crashes === 0, `crashes=${crashes}`);
check('无空线路城市', empties === 0, `empties=${empties}`);
check('线路颜色全部合法 #RRGGBB', colorBad === 0, `bad=${colorBad}`);
check('没有零点线路', ptsBad === 0, `bad=${ptsBad}`);

/* ---------- 3. 北京基线（与改造前对拍，防止解析逻辑被改坏） ---------- */
const bjPts = bj.lines.reduce((s, L) => s + L.pts.length, 0);
const bjStn = new Set(bj.lines.flatMap(L => L.pts.filter(p => p.st && p.n).map(p => p.n + p.x + p.y))).size;
check('北京线路数 = 28', bj.lines.length === 28, `实际 ${bj.lines.length}`);
check('北京几何点数 = 808', bjPts === 808, `实际 ${bjPts}`);
check('北京去重站点数 = 425', bjStn === 425, `实际 ${bjStn}`);
check('北京图形版本哈希存在', /^[0-9a-f]{64}$/.test(bj.ver), bj.ver.slice(0, 12) + '…');

/* ---------- 4. 静态服务路由 ---------- */
const routes = ['/', '/index.html', '/data/index.json', '/data/city-131.json', '/data/city-289.json', '/serve.bat'];
for (const r of routes) {
  try {
    const res = await fetch(BASE + r);
    const body = await res.arrayBuffer();
    check(`HTTP ${r}`, res.status === 200 && body.byteLength > 0, `${res.status} ${body.byteLength}B`);
  } catch (e) {
    check(`HTTP ${r}`, false, e.message + ' —— 服务没起来？先跑 serve.bat / serve.sh');
  }
}
const miss = await fetch(BASE + '/data/city-99999.json');
check('不存在的城市返回 404（页面走错误分支）', miss.status === 404, `HTTP ${miss.status}`);

/* ---------- 5. 页面里无代理 / 无上游域名残留 ---------- */
check('页面无 /api/ 残留', !html.includes('/api/'));
check('页面无 fetch 百度域名', !html.includes('map.baidu.com'));
check('页面体积 < 30KB（零内联数据）', Buffer.byteLength(html) < 30 * 1024, (Buffer.byteLength(html) / 1024).toFixed(1) + 'KB');

/* ---------- 汇总 ---------- */
perCity.sort((a, b) => b[1] - a[1]);
console.log('\n线路数 Top5:', perCity.slice(0, 5).map(x => `${x[0]}(${x[1]}线)`).join('  '));
console.log('线路数最少的:', perCity.slice(-3).map(x => `${x[0]}(${x[1]}线)`).join('  '));
console.log(fail === 0 ? '\n全部通过 ✅' : `\n有 ${fail} 项未通过 ❌`);
process.exit(fail === 0 ? 0 : 1);
