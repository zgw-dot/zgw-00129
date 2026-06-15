// 快速制造版本冲突：admin 登录 -> 创建修改建议 -> 通过并合并 -> 生成 v2
const BASE = 'http://localhost:3001/api';
const clauseId = 'dd959e7b-8b4e-43f9-8ce7-f33a53e997fd';

async function post(url, body, token) {
  const opts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
  if (token) opts.headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${data.error || JSON.stringify(data)}`);
  return data;
}

async function get(url, token) {
  const opts = { headers: {} };
  if (token) opts.headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + url, opts);
  return res.json();
}

(async () => {
  try {
    const loginRes = await post('/auth/login', { username: 'admin', password: 'admin123' });
    const token = loginRes.token;
    console.log('1. admin logged in');

    const sugRes = await post('/clauses/' + clauseId + '/suggestions', {
      type: 'amendment', base_version: 1,
      content: 'Admin 创建版本冲突测试建议',
      amended_title: '合同B条款1 - v2',
      amended_content: '这是 v2 版本的条款内容，管理员创建用于验证前端冲突 UI。',
      risk_level: 'medium', exclusive_role: 'all'
    }, token);
    const sugId = sugRes.id;
    console.log('2. Created suggestion:', sugId);

    await post('/clauses/' + clauseId + '/suggestions/' + sugId + '/approve', { comment: '自动通过' }, token);
    console.log('3. Approved suggestion');

    const mergeRes = await post('/clauses/' + clauseId + '/suggestions/' + sugId + '/merge', {
      change_summary: '管理员合并建议，生成 v2 版本用于验证前端冲突 UI'
    }, token);
    console.log('4. Merged! New version:', mergeRes.new_version);

    const clause = await get('/clauses/' + clauseId, token);
    console.log('5. Current version:', clause.current_version);
    console.log('5. Current title:', clause.title);

    console.log('\n✅ 版本冲突已制造。business1 登录后打开该条款应看到冲突 UI');
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  }
})();
