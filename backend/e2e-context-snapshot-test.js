const http = require('http');

const API = 'http://localhost:3001/api';

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

function requestRawText(method, path, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(API + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: { 'Accept': 'application/json' }
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          const e = new Error(`HTTP ${res.statusCode}`);
          e.response = { data: {}, status: res.statusCode };
          reject(e);
        }
      });
    });
    req.on('error', (err) => reject(err));
    req.end();
  });
}

const login = (u, p) => request('POST', '/auth/login', { username: u, password: p }).then(d => d.data.token);
const post = (url, body, token) => request('POST', url, body, token);
const get = (url, token) => request('GET', url, null, token);
const exportContract = (cid, token) => requestRawText('GET', `/reports/contract/${cid}/export`, token).then(t => JSON.parse(t));

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; failures.push(msg); console.error(`  ❌ ${msg}`); }
}

async function run() {
  console.log('\n=== Context Snapshot 与恢复一键开弹窗 - 增强回归测试 ===\n');

  const adminToken = await login('admin', 'admin123');
  console.log('✅ admin 登录成功');

  const contract = await post('/contracts', {
    name: '快照增强测试合同-' + Date.now(),
    description: '测试 context_snapshot、copy 时快照更新、导出包含快照'
  }, adminToken);
  const cid = contract.data.id;
  console.log(`✅ 创建合同: ${contract.data.name}`);

  const TITLE_V1 = '条款A-快照测试v1';
  const CONTENT_V1 = '条款A v1 原始内容：甲方应于每月1日支付服务费。';
  const TITLE_V2 = '条款A-快照测试v2';
  const CONTENT_V2 = '条款A v2 修改内容：甲方应于每月5日支付服务费，并提供发票。';

  const imp = await post(`/contracts/${cid}/import`, {
    clauses: [
      { clause_number: '1', title: TITLE_V1, content: CONTENT_V1, risk_level: 'medium' }
    ]
  }, adminToken);
  console.log(`✅ 导入条款: ${imp.data.imported_count} 条`);

  const clauses = await get(`/clauses?contract_id=${cid}`, adminToken);
  const clauseA = clauses.data.find(c => c.clause_number === '1');

  const bizToken = await login('business1', 'biz123');
  console.log('✅ business1 登录成功');

  // ========== 测试1：POST /drafts 返回 context_snapshot ==========
  console.log('\n--- 测试1：POST /drafts 保存时自动生成 context_snapshot ---');

  const saveRes = await post(`/clauses/${clauseA.id}/drafts`, {
    type: 'comment', content: '建议在v1基础上增加违约金条款',
    base_version: 1, exclusive_role: 'all'
  }, bizToken);
  assert(saveRes.data.id, '草稿保存成功');
  assert(saveRes.data.context_snapshot !== null && saveRes.data.context_snapshot !== undefined,
    'POST /drafts 返回 context_snapshot 字段');
  const snap1 = saveRes.data.context_snapshot;
  assert(typeof snap1 === 'object', 'context_snapshot 是 JSON 对象');
  assert(snap1.version_number === 1, 'snapshot.version_number = 1');
  assert(snap1.clause_title === TITLE_V1, 'snapshot.clause_title 正确 = v1 标题');
  assert(snap1.clause_content === CONTENT_V1, 'snapshot.clause_content 正确 = v1 内容');
  assert(snap1.version_title === TITLE_V1, 'snapshot.version_title 正确');
  assert(snap1.version_content === CONTENT_V1, 'snapshot.version_content 正确');
  assert(snap1.clause_risk_level === 'medium', 'snapshot.clause_risk_level = medium');
  console.log(`  ℹ️  snapshot.version_content = "${snap1.version_content.substring(0, 30)}..."`);

  // ========== 测试2：GET /drafts 返回 context_snapshot ==========
  console.log('\n--- 测试2：GET /drafts 返回 context_snapshot ---');

  const getRes = await get(`/clauses/${clauseA.id}/drafts`, bizToken);
  assert(getRes.data.context_snapshot !== null, 'GET /drafts 返回 context_snapshot');
  assert(getRes.data.context_snapshot.version_number === 1,
    'GET 的 snapshot.version_number = 1');
  assert(getRes.data.context_snapshot.version_content === CONTENT_V1,
    'GET 的 snapshot.version_content 正确');

  // ========== 测试3：升级条款版本制造冲突 ==========
  console.log('\n--- 测试3：升级条款到 v2（制造版本冲突） ---');

  const amendSug = await post(`/clauses/${clauseA.id}/suggestions`, {
    type: 'amendment', content: '修改付款日期', base_version: 1,
    amended_title: TITLE_V2, amended_content: CONTENT_V2, exclusive_role: 'all'
  }, adminToken);
  await post(`/clauses/${clauseA.id}/suggestions/${amendSug.data.suggestion.id}/merge`, {
    reason: '测试：修改付款条款'
  }, adminToken);
  const clauseAfter = await get(`/clauses/${clauseA.id}`, adminToken);
  assert(clauseAfter.data.current_version === 2, '条款已升级到 v2');

  // ========== 测试4：POST /drafts/restore 冲突时返回旧快照 ==========
  console.log('\n--- 测试4：POST /drafts/restore 冲突时返回 v1 时代的旧快照 ---');

  const restoreConflict = await post(`/clauses/${clauseA.id}/drafts/restore`, {}, bizToken);
  assert(restoreConflict.data.version_conflict === true, 'restore 检测到冲突');
  assert(restoreConflict.data.context_snapshot !== null, 'restore 返回 context_snapshot');
  assert(restoreConflict.data.context_snapshot.version_number === 1,
    'restore 的 snapshot 仍是 v1 时代（旧快照）');
  assert(restoreConflict.data.context_snapshot.version_content === CONTENT_V1,
    'restore 的 snapshot.version_content 是 v1 内容');

  // ========== 测试5：POST conflict-action copy 时更新快照到 v2 ==========
  console.log('\n--- 测试5：conflict-action = copy 时快照更新为当前 v2 ---');

  const copyRes = await post(`/clauses/${clauseA.id}/drafts/conflict-action`, {
    action: 'copy'
  }, bizToken);
  assert(copyRes.data.action === 'copy', 'copy 操作成功');
  assert(copyRes.data.base_version === 2, 'copy 后 base_version = 2');
  assert(copyRes.data.context_snapshot !== null, 'copy 返回 context_snapshot');
  assert(copyRes.data.context_snapshot.version_number === 2,
    'copy 后 snapshot.version_number 更新为 2');
  assert(copyRes.data.context_snapshot.version_title === TITLE_V2,
    'copy 后 snapshot.version_title = v2 标题');
  assert(copyRes.data.context_snapshot.version_content === CONTENT_V2,
    'copy 后 snapshot.version_content = v2 内容');
  console.log(`  ℹ️  copy 后的新 snapshot.version_content = "${copyRes.data.context_snapshot.version_content.substring(0, 30)}..."`);

  // ========== 测试6：GET /drafts 再次验证快照已更新 ==========
  console.log('\n--- 测试6：GET /drafts 验证 copy 后快照已持久化 ---');

  const getAfterCopy = await get(`/clauses/${clauseA.id}/drafts`, bizToken);
  assert(getAfterCopy.data.context_snapshot !== null, 'GET 后仍有 snapshot');
  assert(getAfterCopy.data.context_snapshot.version_number === 2,
    'GET 的 snapshot.version_number = 2（持久化）');
  assert(getAfterCopy.data.context_snapshot.version_content === CONTENT_V2,
    'GET 的 snapshot.version_content = v2 内容（持久化）');

  // ========== 测试7：conflict-action continue 返回旧快照 ==========
  console.log('\n--- 测试7：conflict-action = continue 时仍保持旧快照 ---');

  // 先保存当前 copy 后（base_version=2）的快照用于后续导出验证
  const draftBeforeContinue = await get(`/clauses/${clauseA.id}/drafts`, bizToken);

  // 现在写入 v1 continue测试内容（会覆盖上面 base_version=2 的草稿，因为 UNIQUE 约束）
  await post(`/clauses/${clauseA.id}/drafts`, {
    type: 'comment', content: 'v1草稿用于continue测试',
    base_version: 1, exclusive_role: 'all'
  }, bizToken);

  const continueRes = await post(`/clauses/${clauseA.id}/drafts/conflict-action`, {
    action: 'continue'
  }, bizToken);
  assert(continueRes.data.action === 'continue', 'continue 操作成功');
  assert(continueRes.data.base_version === 1, 'continue 后 base_version 保持 1');
  assert(continueRes.data.context_snapshot !== null, 'continue 返回 context_snapshot');
  assert(continueRes.data.context_snapshot.version_number === 1,
    'continue 的 snapshot.version_number 保持 1');
  assert(continueRes.data.context_snapshot.version_content === CONTENT_V1,
    'continue 的 snapshot.version_content 保持 v1 内容');

  // ========== 测试8：导出包包含 drafts 的 context_snapshot ==========
  console.log('\n--- 测试8：导出合同评审包包含 drafts 的 context_snapshot ---');

  const exportData = await exportContract(cid, adminToken);
  assert(Array.isArray(exportData.drafts), '导出包含 drafts');
  assert(exportData.drafts.length > 0, '导出有草稿记录');
  // 由于 UNIQUE 约束，当前导出的草稿是 continue 操作后的（base=1 版本）
  const exportedDraft = exportData.drafts[0];
  assert(exportedDraft.context_snapshot !== null, '导出草稿包含 context_snapshot');
  assert(typeof exportedDraft.context_snapshot === 'object',
    '导出 context_snapshot 是解析后的对象');
  assert(exportedDraft.context_snapshot.version_number === 1,
    '导出草稿 snapshot.version_number = 1（当前为 continue 后的 base=1');
  assert(exportedDraft.context_snapshot.version_content === CONTENT_V1,
    '导出草稿 snapshot.version_content = v1 内容');

  // ========== 测试9：GET clause/version-history 导出不报错（已有数据） ==========
  console.log('\n--- 测试9：审计日志中 save_draft 记录验证 ---');

  // 额外验证：在另一个条款上验证 copy 后（base=2）的导出，避免 UNIQUE 冲突
  console.log('\n  ℹ️  额外验证：新条款验证 copy 后导出 context_snapshot（跨条款验证） ---');
  const imp2 = await post(`/contracts/${cid}/import`, {
    clauses: [
      { clause_number: '2', title: TITLE_V1 + '条款2', content: CONTENT_V1, risk_level: 'high' }
    ]
  }, adminToken);
  const clauses2 = await get(`/clauses?contract_id=${cid}`, adminToken);
  const clauseB = clauses2.data.find(c => c.clause_number === '2');
  // 条款2：先保存 v1 草稿
  await post(`/clauses/${clauseB.id}/drafts`, {
    type: 'amendment', content: '条款2修改意见', base_version: 1,
    amended_content: '修改后', exclusive_role: 'all'
  }, bizToken);
  // 升级条款2到v2
  const sugB = await post(`/clauses/${clauseB.id}/suggestions`, {
    type: 'amendment', content: '升级条款2', base_version: 1,
    amended_content: CONTENT_V2, exclusive_role: 'all'
  }, adminToken);
  await post(`/clauses/${clauseB.id}/suggestions/${sugB.data.suggestion.id}/merge`, {
    reason: '条款2升级'
  }, adminToken);
  // copy 到新版本
  const copyB = await post(`/clauses/${clauseB.id}/drafts/conflict-action`, { action: 'copy' }, bizToken);
  assert(copyB.data.base_version === 2, '条款2 copy 后 base=2');
  assert(copyB.data.context_snapshot.version_number === 2, '条款2 copy 后 snapshot.version=2');
  // 再次导出合同
  const exportData2 = await exportContract(cid, adminToken);
  const draftBInExport = exportData2.drafts.find(d => d.clause_id === clauseB.id);
  assert(draftBInExport, '导出中找到条款2的草稿');
  assert(draftBInExport.base_version === 2, '条款2草稿 base_version=2');
  assert(draftBInExport.context_snapshot !== null, '条款2草稿导出有 context_snapshot');
  assert(draftBInExport.context_snapshot.version_number === 2,
    '条款2草稿导出 snapshot.version_number=2 (copy后的新版本)');

  const auditLogs = await get('/reports/audit-logs?entity_type=draft&limit=500', adminToken);
  const saveDraftLogs = auditLogs.data.filter(l =>
    l.action === 'save_draft' && l.details && l.details.clause_id === clauseA.id);
  assert(saveDraftLogs.length > 0, '有 save_draft 审计日志');

  // ========== 总结 ==========
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Context Snapshot 增强回归测试结果: ${passed} 通过, ${failed} 失败`);

  if (failed > 0) {
    console.log('\n❌ 有测试未通过：');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log('\n🎉 全部 Context Snapshot 测试通过！');
    console.log('');
    console.log('✅ POST /drafts 保存时自动写入 context_snapshot');
    console.log('✅ GET /drafts 返回解析后的 context_snapshot 对象');
    console.log('✅ POST /drafts/restore 返回 context_snapshot');
    console.log('✅ 冲突时 restore 的 snapshot 仍为旧版本内容（便于查看）');
    console.log('✅ conflict-action copy 时 snapshot 更新为当前版本内容');
    console.log('✅ conflict-action continue 时 snapshot 保持旧版本');
    console.log('✅ copy 后 snapshot 持久化到数据库（GET 验证）');
    console.log('✅ 导出合同评审包包含 drafts 的 context_snapshot 字段');
  }
}

run().catch(e => {
  console.error('\n❌ 测试异常退出. Message:', e.message);
  if (e.response) {
    console.error('  status:', e.response.status);
    console.error('  data:', JSON.stringify(e.response.data));
  }
  console.error('  stack:', e.stack);
  process.exit(1);
});
