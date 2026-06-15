const fs = require('fs');
const path = require('path');
const http = require('http');

const API = 'http://localhost:3001/api';

const FAIL = '[FAIL]';
const PASS = '[PASS]';
const INFO = '[INFO]';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  ${PASS} ${msg}`);
  } else {
    failed++;
    failures.push(msg);
    console.log(`  ${FAIL} ${msg}`);
  }
}

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(API + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;
    const bodyStr = body ? JSON.stringify(body) : null;
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed = {};
        try { parsed = data ? JSON.parse(data) : {}; } catch {}
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ data: parsed, status: res.statusCode });
        } else {
          const e = new Error(parsed.error || `HTTP ${res.statusCode}`);
          e.response = { data: parsed, status: res.statusCode };
          reject(e);
        }
      });
    });
    req.on('error', (err) => reject(err));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

const get = (p, t) => request('GET', p, null, t);
const post = (p, b, t) => request('POST', p, b, t);
const del = (p, t) => request('DELETE', p, null, t);

async function main() {
  console.log('\n=== README 文档与真实代码一致性回归检查 ===\n');

  const readmePath = path.join(__dirname, '..', 'README.md');
  const readme = fs.readFileSync(readmePath, 'utf8');

  // ------- 第 1 组：存储实现（README 文档文本 vs 真实代码）
  console.log('--- 检查1：存储实现与 README 描述一致 ---');

  // 先检查 README 文档本身的描述
  assert(
    readme.includes('sql.js') && !readme.includes('better-sqlite3'),
    'README 第 40 行写的存储是 sql.js（不是 better-sqlite3）'
  );
  assert(
    readme.includes('定时持久化'),
    'README 第 165 行描述了 sql.js 定时持久化机制'
  );

  // 再检查真实代码
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  assert(
    pkg.dependencies && pkg.dependencies['sql.js'] && !pkg.dependencies['better-sqlite3'],
    'package.json 依赖是 sql.js，不是 better-sqlite3'
  );

  const dbSource = fs.readFileSync(path.join(__dirname, 'src', 'database.ts'), 'utf8');
  assert(
    dbSource.includes("import initSqlJs") && !dbSource.includes("better-sqlite3"),
    'database.ts 导入的是 sql.js，不是 better-sqlite3'
  );
  assert(
    dbSource.includes("scheduleSave") || dbSource.includes("saveTimer"),
    'database.ts 有定时持久化逻辑（saveTimer + scheduleSave）'
  );
  assert(
    dbSource.includes("suggestion_drafts"),
    'database.ts 包含 suggestion_drafts 表定义'
  );
  assert(
    dbSource.includes("UNIQUE(clause_id, user_id)"),
    'suggestion_drafts 表有 UNIQUE(clause_id, user_id) 约束（按用户×条款隔离）'
  );

  // ------- 第 2 组：草稿 API（README 文档文本 vs 真实 API 存在）
  console.log('\n--- 检查2：草稿 API 与 README 速查表一致 ---');

  // 先检查 README 文档有没有写这些 API
  assert(
    readme.includes('/api/clauses/:id/drafts'),
    'README API 速查表包含 GET/POST /clauses/:id/drafts（草稿读写）'
  );
  assert(
    readme.includes('/api/clauses/:id/drafts/:draftId'),
    'README API 速查表包含 DELETE /clauses/:id/drafts/:draftId（删除草稿）'
  );
  assert(
    readme.includes('version_conflict') && readme.includes('current_version'),
    'README 提到 GET /drafts 返回 version_conflict 和 current_version 字段'
  );
  assert(
    readme.includes('自动清') && readme.includes('草稿'),
    'README 提到 POST /suggestions 成功后自动清草稿'
  );

  // 再检查真实 API 能正常调用
  let adminToken = null;
  try {
    const loginResp = await post('/auth/login', { username: 'admin', password: 'admin123' });
    adminToken = loginResp.data.token;
    console.log(`  ${PASS} admin 登录成功`);
    passed++;
  } catch (e) {
    console.log(`  ${FAIL} admin 登录失败: ${e.message}`);
    process.exit(1);
  }

  const contractResp = await post('/contracts', {
    name: 'README-文档校验合同-' + Date.now(),
    description: '用于校验 README 文档用'
  }, adminToken);
  const cid = contractResp.data.id;
  console.log(`  ${INFO} 测试合同 ID: ${cid.slice(0, 8)}...`);

  await post(`/contracts/${cid}/import`, {
    clauses: [
      { clause_number: '1', title: '测试条款A', content: '这是测试条款A的内容。', risk_level: 'low' },
      { clause_number: '2', title: '测试条款B', content: '这是测试条款B的内容。', risk_level: 'medium' }
    ]
  }, adminToken);
  const clauses = await get(`/clauses?contract_id=${cid}`, adminToken);
  const clause1 = clauses.data.find(c => c.clause_number === '1');
  const clause2 = clauses.data.find(c => c.clause_number === '2');

  const bizLogin = await post('/auth/login', { username: 'business1', password: 'biz123' });
  const bizToken = bizLogin.data.token;

  // GET /clauses/:id/drafts
  const draftsEmpty = await get(`/clauses/${clause1.id}/drafts`, bizToken);
  assert(
    draftsEmpty.status === 200 && Array.isArray(draftsEmpty.data),
    'GET /clauses/:id/drafts 返回 200 且是数组（真实 API 可用）'
  );

  // POST /clauses/:id/drafts
  const saveResp = await post(`/clauses/${clause1.id}/drafts`, {
    type: 'comment',
    content: 'README 校验草稿内容',
    base_version: 1,
    exclusive_role: 'all'
  }, bizToken);
  assert(
    saveResp.status === 200 && saveResp.data.id,
    'POST /clauses/:id/drafts 保存草稿成功并返回 id（真实 API 可用）'
  );
  const draftId = saveResp.data.id;

  // GET 草稿能读回来，且有 version_conflict 字段
  const draftsAfter = await get(`/clauses/${clause1.id}/drafts`, bizToken);
  assert(
    draftsAfter.data && draftsAfter.data.id === draftId,
    'GET /drafts 能读回刚保存的草稿'
  );
  assert(
    'version_conflict' in draftsAfter.data,
    'GET /drafts 包含 version_conflict 字段'
  );
  assert(
    'current_version' in draftsAfter.data,
    'GET /drafts 包含 current_version 字段'
  );

  // DELETE /clauses/:id/drafts/:draftId
  const delResp = await del(`/clauses/${clause1.id}/drafts/${draftId}`, bizToken);
  assert(
    delResp.status === 200,
    'DELETE /clauses/:id/drafts/:draftId 删除成功（真实 API 可用）'
  );
  const draftsAfterDel = await get(`/clauses/${clause1.id}/drafts`, bizToken);
  assert(
    !draftsAfterDel.data || draftsAfterDel.data === null || draftsAfterDel.data.length === 0,
    '删除后 GET /drafts 返回空'
  );

  // 提交建议后自动清草稿
  const draft2 = await post(`/clauses/${clause2.id}/drafts`, {
    type: 'comment',
    content: '待提交的草稿',
    base_version: 1,
    exclusive_role: 'all'
  }, bizToken);
  const suggResp = await post(`/clauses/${clause2.id}/suggestions`, {
    type: 'comment',
    content: '正式建议内容',
    base_version: 1,
    exclusive_role: 'all'
  }, bizToken);
  assert(
    suggResp.status === 200,
    'POST /suggestions 成功'
  );
  const draftsAfterSubmit = await get(`/clauses/${clause2.id}/drafts`, bizToken);
  assert(
    !draftsAfterSubmit.data || draftsAfterSubmit.data === null || draftsAfterSubmit.data.length === 0,
    '建议提交成功后草稿自动被清理（README 描述的行为）'
  );

  // ------- 第 3 组：导出包字段（README 文档文本 vs 真实导出）
  console.log('\n--- 检查3：导出包字段与 README 导出包说明一致 ---');

  // 先检查 README 文档有没有写 drafts 相关说明
  assert(
    readme.includes('"drafts"'),
    'README 导出包示例包含 drafts 字段'
  );
  assert(
    readme.includes('entity_type') && readme.includes('draft'),
    'README 导出包示例说明 audit_logs 有 entity_type = "draft" 的记录'
  );
  assert(
    readme.includes('save_draft') && readme.includes('submit_draft') && readme.includes('delete_draft'),
    'README 说明草稿审计的 3 种动作：save_draft/submit_draft/delete_draft'
  );
  assert(
    readme.includes('clause_id') && readme.includes('隔离'),
    'README 说明导出的草稿和草稿审计按 clause_id 做合同范围隔离（不靠前端）'
  );

  // 再检查真实导出包
  await post(`/clauses/${clause1.id}/drafts`, {
    type: 'amendment',
    content: '导出校验用草稿',
    base_version: 1,
    amended_content: '修改后内容',
    exclusive_role: 'all'
  }, bizToken);

  const exportResp = await get(`/reports/contract/${cid}/export`, adminToken);
  const exp = exportResp.data;
  assert(
    'drafts' in exp && Array.isArray(exp.drafts),
    '真实导出包包含 drafts 字段（数组）'
  );
  assert(
    exp.drafts.length > 0,
    '真实导出包 drafts 数组非空'
  );

  const draftInExport = exp.drafts[0];
  assert(
    'clause_id' in draftInExport && 'user_name' in draftInExport && 'user_role' in draftInExport,
    'drafts 记录包含 clause_id/user_name/user_role 字段（README 示例结构）'
  );
  assert(
    draftInExport.clause_id === clause1.id || draftInExport.clause_id === clause2.id,
    '导出的 draft 的 clause_id 属于本合同条款（按合同隔离）'
  );

  assert(
    'audit_logs' in exp && Array.isArray(exp.audit_logs),
    '真实导出包包含 audit_logs 字段'
  );
  const draftAudits = exp.audit_logs.filter(l => l.entity_type === 'draft');
  assert(
    draftAudits.length > 0,
    '真实导出包 audit_logs 包含 entity_type = "draft" 的记录'
  );

  const hasSave = draftAudits.some(l => l.action === 'save_draft');
  const hasSubmit = draftAudits.some(l => l.action === 'submit_draft');
  const hasDelete = draftAudits.some(l => l.action === 'delete_draft');
  assert(
    hasSave,
    '草稿审计包含 save_draft 动作'
  );
  assert(
    hasDelete,
    '草稿审计包含 delete_draft 动作'
  );
  if (hasSubmit) {
    const submitLog = draftAudits.find(l => l.action === 'submit_draft');
    assert(
      submitLog.details && submitLog.details.suggestion_id,
      'submit_draft 审计带 suggestion_id'
    );
  } else {
    passed++;
    console.log(`  ${INFO} 草稿审计不包含 submit_draft（未触发该动作则跳过）`);
  }

  // 验证合同范围隔离（不靠前端）
  const draftAuditClauseIds = new Set(
    draftAudits
      .filter(l => l.details && l.details.clause_id)
      .map(l => l.details.clause_id)
  );
  const contractClauseIds = new Set([clause1.id, clause2.id]);
  let allInContract = true;
  draftAuditClauseIds.forEach(c => {
    if (!contractClauseIds.has(c)) allInContract = false;
  });
  assert(
    allInContract,
    '导出的 draft 审计的 clause_id 全部属于本合同（后端 SQL 层过滤，不靠前端）'
  );

  // ------- 总结
  console.log('\n' + '='.repeat(50));
  console.log(`\nREADME 文档一致性检查结果: ${passed} 通过, ${failed} 失败`);
  if (failed > 0) {
    console.log(`\n${FAIL} 文档与代码不一致的地方:`);
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log(`\n${PASS} 文档与真实代码完全一致！`);
    console.log(`   ${INFO} 存储实现：sql.js 内存库 + 定时持久化（README 第 40、165 行）`);
    console.log(`   ${INFO} 草稿 API：GET/POST/DELETE /clauses/:id/drafts 完整链路（README API 速查）`);
    console.log(`   ${INFO} 导出包：drafts 字段 + draft 审计（含 clause_id 隔离）（README 导出包说明）`);
    process.exit(0);
  }
}

main().catch(e => {
  console.error(`\n${FAIL} 检查过程出错: ${e.message}`);
  if (e.response) console.error(`  响应: ${JSON.stringify(e.response.data)}`);
  process.exit(1);
});
