const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const FRONTEND_PORT = 8080;
const BACKEND_PORT = 3001;

let failed = 0;

function check(desc, ok, detail) {
  if (ok) {
    console.log('✅ ' + desc);
  } else {
    console.error('❌ ' + desc + ' — ' + detail);
    failed++;
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const viteConfig = read('frontend/vite.config.ts');
const portMatch = viteConfig.match(/port:\s*(\d+)/);
check(
  'vite.config.ts 前端端口 = ' + FRONTEND_PORT,
  portMatch && Number(portMatch[1]) === FRONTEND_PORT,
  '实际是 ' + (portMatch ? portMatch[1] : '未找到')
);

const readme = read('README.md');
check('README.md 不含旧端口 5173', !readme.includes('5173'), '仍包含 5173，请统一到 ' + FRONTEND_PORT);
check('README.md 包含正确端口 ' + FRONTEND_PORT, readme.includes(String(FRONTEND_PORT)), '未找到 ' + FRONTEND_PORT);

const backendIndex = read('backend/src/index.ts');
check('后端 CORS 白名单包含 :' + FRONTEND_PORT, backendIndex.includes(':' + FRONTEND_PORT), '后端 index.ts CORS 白名单未放行 :' + FRONTEND_PORT);
check('后端 CORS 白名单不含旧端口 5173', !backendIndex.includes(':5173'), '仍包含 :5173，请清理');

const e2e = read('backend/e2e-test.js');
check('e2e-test.js 后端端口 = ' + BACKEND_PORT, e2e.includes(':' + BACKEND_PORT + '/api'), '未指向 ' + BACKEND_PORT);

if (failed > 0) {
  console.error('\n❌ 端口一致性检查失败，共 ' + failed + ' 项错误。请先修复后再启动。');
  process.exit(1);
} else {
  console.log('\n✅ 端口一致性全部通过（前端 ' + FRONTEND_PORT + '，后端 ' + BACKEND_PORT + '）。');
}
