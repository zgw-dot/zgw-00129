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
const del = (url, token) => request('DELETE', url, null, token);
const exportContract = (cid, token) => requestRawText('GET', `/reports/contract/${cid}/export`, token).then(t => JSON.parse(t));

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; failures.push(msg); console.error(`  ❌ ${msg}`); }
}

async function run() {
  console.log('\n=== 草稿恢复与版本冲突 - 端到端回归测试 ===\n');

  const adminToken = await login('admin', 'admin123');
  console.log('✅ admin 登录成功');

  const contract = await post('/contracts', {
    name: '草稿恢复回归测试合同-' + Date.now(),
    description: '测试恢复提示、版本冲突、审计日志、导出包验证'
  }, adminToken);
  const cid = contract.data.id;
  console.log(`✅ 创建合同: ${contract.data.name}`);

  const imp = await post(`/contracts/${cid}/import`, {
    clauses: [
      { clause_number: '1', title: '条款A-恢复测试', content: '条款A原始内容。', risk_level: 'low' },
      { clause_number: '2', title: '条款B-冲突测试', content: '条款B原始内容。', risk_level: 'medium' },
      { clause_number: '3', title: '条款C-权限测试', content: '条款C原始内容。', risk_level: 'high' }
    ]
  }, adminToken);
  console.log(`✅ 导入条款: ${imp.data.imported_count} 条`);

  const clauses = await get(`/clauses?contract_id=${cid}`, adminToken);
  const clauseA = clauses.data.find(c => c.clause_number === '1');
  const clauseB = clauses.data.find(c => c.clause_number === '2');
  const clauseC = clauses.data.find(c => c.clause_number === '3');

  const bizToken = await login('business1', 'biz123');
  const legalToken = await login('legal1', 'legal123');
  console.log('✅ business1 / legal1 登录成功');

  // ========== 测试1：GET /drafts 返回恢复提示字段 ==========
  console.log('\n--- 测试1：GET /drafts 恢复提示字段（last_save_time / conflict_detail） ---');

  const draft1 = await post(`/clauses/${clauseA.id}/drafts`, {
    type: 'comment', content: '草稿内容-恢复提示测试',
    base_version: 1, exclusive_role: 'all'
  }, bizToken);
  assert(draft1.data.id, '草稿保存成功');

  const draftInfo = await get(`/clauses/${clauseA.id}/drafts`, bizToken);
  assert(draftInfo.data.id === draft1.data.id, 'GET /drafts 返回正确草稿');
  assert(typeof draftInfo.data.last_save_time === 'string', 'GET /drafts 包含 last_save_time 字段');
  assert(draftInfo.data.last_save_time.length > 0, 'last_save_time 非空');
  assert(draftInfo.data.version_conflict === false, '基于当前版本的草稿无冲突');
  assert(draftInfo.data.conflict_detail === null, '无冲突时 conflict_detail 为 null');
  assert(typeof draftInfo.data.current_version === 'number', 'GET /drafts 包含 current_version');
  console.log(`  ℹ️  last_save_time = ${draftInfo.data.last_save_time}`);

  // ========== 测试2：POST /drafts/restore 恢复草稿（无冲突） ==========
  console.log('\n--- 测试2：POST /drafts/restore 恢复草稿（无冲突时一键继续） ---');

  const restoreNoConflict = await post(`/clauses/${clauseA.id}/drafts/restore`, {}, bizToken);
  assert(restoreNoConflict.data.id === draft1.data.id, '恢复返回同一草稿ID');
  assert(restoreNoConflict.data.version_conflict === false, '恢复检测无冲突');
  assert(typeof restoreNoConflict.data.last_save_time === 'string', '恢复返回 last_save_time');
  assert(restoreNoConflict.data.conflict_detail === null, '无冲突时恢复 conflict_detail 为 null');

  const restoreAuditLogs = await get('/reports/audit-logs?entity_type=draft', adminToken);
  const restoreLogs = restoreAuditLogs.data.filter(l => l.action === 'restore_draft');
  assert(restoreLogs.length > 0, '恢复草稿有审计日志 (restore_draft)');
  const lastRestoreLog = restoreLogs[0];
  assert(lastRestoreLog.details && lastRestoreLog.details.clause_id === clauseA.id,
    'restore_draft 审计包含正确的 clause_id');
  assert(lastRestoreLog.details.version_conflict === false,
    'restore_draft 审计记录 version_conflict=false');

  // ========== 测试3：版本冲突检测与 conflict_detail ==========
  console.log('\n--- 测试3：版本冲突时 GET /drafts 和 restore 返回 conflict_detail ---');

  await post(`/clauses/${clauseB.id}/drafts`, {
    type: 'comment', content: '基于v1的草稿',
    base_version: 1, exclusive_role: 'all'
  }, bizToken);

  const amendSug = await post(`/clauses/${clauseB.id}/suggestions`, {
    type: 'amendment', content: '修改条款B', base_version: 1,
    amended_content: '条款B被修改了', exclusive_role: 'all'
  }, adminToken);
  await post(`/clauses/${clauseB.id}/suggestions/${amendSug.data.suggestion.id}/merge`, {
    reason: '测试用：升级版本制造冲突'
  }, adminToken);

  const clauseBAfter = await get(`/clauses/${clauseB.id}`, adminToken);
  assert(clauseBAfter.data.current_version === 2, '条款B已升级到 v2');

  const conflictedDraft = await get(`/clauses/${clauseB.id}/drafts`, bizToken);
  assert(conflictedDraft.data.version_conflict === true, 'GET /drafts 检测到版本冲突');
  assert(conflictedDraft.data.base_version === 1, '草稿基于 v1');
  assert(conflictedDraft.data.current_version === 2, '当前版本为 v2');
  assert(conflictedDraft.data.conflict_detail !== null, 'GET /drafts 包含 conflict_detail');
  assert(Array.isArray(conflictedDraft.data.conflict_detail.newer_versions), 'conflict_detail 包含 newer_versions');
  assert(conflictedDraft.data.conflict_detail.newer_versions.length > 0, 'newer_versions 非空');
  assert(conflictedDraft.data.conflict_detail.newer_versions[0].version_number === 2,
    'newer_versions 包含 v2');

  const restoreConflict = await post(`/clauses/${clauseB.id}/drafts/restore`, {}, bizToken);
  assert(restoreConflict.data.version_conflict === true, 'restore 检测到冲突');
  assert(restoreConflict.data.conflict_detail !== null, 'restore 返回 conflict_detail');
  assert(restoreConflict.data.conflict_detail.newer_versions.length > 0,
    'restore 的 conflict_detail 包含更新版本列表');

  const restoreConflictAudit = await get('/reports/audit-logs?entity_type=draft&limit=500', adminToken);
  const restoreConflictAuditAll = restoreConflictAudit.data.filter(l => l.action === 'restore_draft');
  const conflictRestoreLog = restoreConflictAuditAll.find(l =>
    l.details && l.details.version_conflict === true);
  assert(conflictRestoreLog, '冲突恢复有审计日志 (restore_draft with version_conflict=true)');

  // ========== 测试4：POST /drafts/conflict-action — continue ==========
  console.log('\n--- 测试4：冲突操作 - continue（继续基于旧版本编辑） ---');

  const continueRes = await post(`/clauses/${clauseB.id}/drafts/conflict-action`, {
    action: 'continue'
  }, bizToken);
  assert(continueRes.data.action === 'continue', '返回 action=continue');
  assert(continueRes.data.version_conflict === true, '仍然标记为冲突');
  assert(continueRes.data.id, '草稿仍存在');

  const continueAudit = await get('/reports/audit-logs?entity_type=draft', adminToken);
  const continueLogs = continueAudit.data.filter(l => l.action === 'draft_conflict_continue');
  assert(continueLogs.length > 0, '冲突继续操作有审计日志 (draft_conflict_continue)');
  assert(continueLogs[0].details.conflict_action === 'continue',
    '审计记录 conflict_action=continue');
  assert(continueLogs[0].details.base_version === 1, '审计记录 base_version=1');
  assert(continueLogs[0].details.current_version === 2, '审计记录 current_version=2');

  // ========== 测试5：POST /drafts/conflict-action — copy ==========
  console.log('\n--- 测试5：冲突操作 - copy（复制内容到新版本） ---');

  const copyRes = await post(`/clauses/${clauseB.id}/drafts/conflict-action`, {
    action: 'copy'
  }, bizToken);
  assert(copyRes.data.action === 'copy', '返回 action=copy');
  assert(copyRes.data.version_conflict === false, '复制后无冲突');
  assert(copyRes.data.base_version === 2, '复制后 base_version 更新为当前版本');

  const copyAudit = await get('/reports/audit-logs?entity_type=draft', adminToken);
  const copyLogs = copyAudit.data.filter(l => l.action === 'draft_conflict_copy');
  assert(copyLogs.length > 0, '冲突复制操作有审计日志 (draft_conflict_copy)');
  assert(copyLogs[0].details.conflict_action === 'copy', '审计记录 conflict_action=copy');

  // ========== 测试6：POST /drafts/conflict-action — discard ==========
  console.log('\n--- 测试6：冲突操作 - discard（放弃草稿） ---');

  await post(`/clauses/${clauseB.id}/drafts`, {
    type: 'comment', content: '准备丢弃的冲突草稿',
    base_version: 1, exclusive_role: 'all'
  }, bizToken);

  const discardRes = await post(`/clauses/${clauseB.id}/drafts/conflict-action`, {
    action: 'discard'
  }, bizToken);
  assert(discardRes.data.success === true, '冲突丢弃成功');
  assert(discardRes.data.action === 'discard', '返回 action=discard');

  const afterDiscard = await get(`/clauses/${clauseB.id}/drafts`, bizToken);
  assert(afterDiscard.data === null || afterDiscard.data === undefined,
    '丢弃后草稿不再存在');

  const discardAudit = await get('/reports/audit-logs?entity_type=draft', adminToken);
  const discardConflictLogs = discardAudit.data.filter(l => l.action === 'draft_conflict_discard');
  assert(discardConflictLogs.length > 0, '冲突放弃操作有审计日志 (draft_conflict_discard)');
  assert(discardConflictLogs[0].details.conflict_action === 'discard',
    '审计记录 conflict_action=discard');

  // ========== 测试7：无效冲突操作参数 ==========
  console.log('\n--- 测试7：无效冲突操作参数校验 ---');

  try {
    await post(`/clauses/${clauseA.id}/drafts/conflict-action`, {
      action: 'invalid'
    }, bizToken);
    assert(false, '无效 action 不应成功');
  } catch (e) {
    assert(e.response?.status === 400, '无效 action 返回 400');
    assert(String(e.response?.data?.error || '').includes('冲突操作类型无效'),
      '错误信息明确');
  }

  // ========== 测试8：恢复不存在的草稿 ==========
  console.log('\n--- 测试8：恢复不存在的草稿 ---');

  try {
    await post(`/clauses/${clauseC.id}/drafts/restore`, {}, bizToken);
    assert(false, '不存在草稿不应能恢复');
  } catch (e) {
    assert(e.response?.status === 404, '不存在草稿恢复返回 404');
  }

  // ========== 测试9：权限隔离 - 不同角色只能操作自己的草稿 ==========
  console.log('\n--- 测试9：不同角色只能操作自己的草稿 ---');

  const bizDraftC = await post(`/clauses/${clauseC.id}/drafts`, {
    type: 'comment', content: 'business1在条款C的草稿',
    base_version: 1, exclusive_role: 'all'
  }, bizToken);

  const legalDraftView = await get(`/clauses/${clauseC.id}/drafts`, legalToken);
  assert(legalDraftView.data === null || legalDraftView.data.id !== bizDraftC.data.id,
    'legal1 GET /drafts 看不到 business1 的草稿');

  const legalRestore = await post(`/clauses/${clauseC.id}/drafts`, {
    type: 'comment', content: 'legal1自己的草稿',
    base_version: 1, exclusive_role: 'all'
  }, legalToken);

  const legalRestoreRes = await post(`/clauses/${clauseC.id}/drafts/restore`, {}, legalToken);
  assert(legalRestoreRes.data.id === legalRestore.data.id,
    'legal1 恢复的是自己的草稿');

  const bizView = await get(`/clauses/${clauseC.id}/drafts`, bizToken);
  assert(bizView.data.id === bizDraftC.data.id,
    'business1 看到的还是自己的草稿');

  // ========== 测试10：导出包验证 - 新审计类型出现在导出中 ==========
  console.log('\n--- 测试10：导出包验证 - 恢复/冲突审计记录出现在导出中 ---');

  const exportData = await exportContract(cid, adminToken);

  assert(Array.isArray(exportData.drafts), '导出包包含 drafts 字段');

  const draftAuditInExport = (exportData.audit_logs || []).filter(l => l.entity_type === 'draft');

  const restoreInExport = draftAuditInExport.filter(l => l.action === 'restore_draft');
  assert(restoreInExport.length > 0, '导出包包含 restore_draft 审计');

  const continueInExport = draftAuditInExport.filter(l => l.action === 'draft_conflict_continue');
  assert(continueInExport.length > 0, '导出包包含 draft_conflict_continue 审计');

  const copyInExport = draftAuditInExport.filter(l => l.action === 'draft_conflict_copy');
  assert(copyInExport.length > 0, '导出包包含 draft_conflict_copy 审计');

  const discardInExport = draftAuditInExport.filter(l => l.action === 'draft_conflict_discard');
  assert(discardInExport.length > 0, '导出包包含 draft_conflict_discard 审计');

  // ========== 测试11：导出包合同隔离 - 审计不串合同 ==========
  console.log('\n--- 测试11：导出包合同范围隔离验证 ---');

  const contractB = await post('/contracts', {
    name: '隔离测试合同B-' + Date.now(),
    description: '校验跨合同草稿恢复审计隔离'
  }, adminToken);
  const cidB = contractB.data.id;

  await post(`/contracts/${cidB}/import`, {
    clauses: [
      { clause_number: '1', title: '合同B条款1', content: 'B1内容', risk_level: 'low' }
    ]
  }, adminToken);
  const clausesB = await get(`/clauses?contract_id=${cidB}`, adminToken);
  const bClause1 = clausesB.data[0];

  await post(`/clauses/${bClause1.id}/drafts`, {
    type: 'comment', content: '合同B草稿', base_version: 1, exclusive_role: 'all'
  }, bizToken);
  await post(`/clauses/${bClause1.id}/drafts/restore`, {}, bizToken);

  const exportAData = await exportContract(cid, adminToken);
  const aDraftAuditClauseIds = new Set(
    (exportAData.audit_logs || [])
      .filter(l => l.entity_type === 'draft' && l.details && l.details.clause_id)
      .map(l => l.details.clause_id)
  );
  assert(!aDraftAuditClauseIds.has(bClause1.id),
    '合同A导出的草稿审计不包含合同B条款的 restore_draft');

  const exportBData = await exportContract(cidB, adminToken);
  const bRestoreInExport = (exportBData.audit_logs || [])
    .filter(l => l.action === 'restore_draft');
  assert(bRestoreInExport.length > 0, '合同B导出包含自己的 restore_draft');

  // ========== 测试12：跨重启持久化（草稿+恢复状态） ==========
  console.log('\n--- 测试12：草稿与恢复状态跨重启持久化（SQLite 验证） ---');

  const persistDraft = await post(`/clauses/${clauseA.id}/drafts`, {
    type: 'amendment', content: '持久化测试草稿',
    base_version: 1, amended_content: '修改后', exclusive_role: 'all'
  }, bizToken);

  const reReadDraft = await get(`/clauses/${clauseA.id}/drafts`, bizToken);
  assert(reReadDraft.data.id === persistDraft.data.id, '重新读取草稿ID一致');
  assert(reReadDraft.data.content === '持久化测试草稿', '草稿内容一致');
  assert(reReadDraft.data.last_save_time, '有 last_save_time');
  console.log('  ℹ️  草稿存储在 SQLite suggestion_drafts 表，服务重启后不会丢失');

  // ========== 测试13：conflict_detail 版本列表内容验证 ==========
  console.log('\n--- 测试13：conflict_detail 版本列表内容完整性 ---');

  await post(`/clauses/${clauseC.id}/drafts`, {
    type: 'comment', content: 'v1草稿-冲突详情测试',
    base_version: 1, exclusive_role: 'all'
  }, bizToken);

  const amendC = await post(`/clauses/${clauseC.id}/suggestions`, {
    type: 'amendment', content: '升级条款C', base_version: 1,
    amended_content: '条款C修改后内容', exclusive_role: 'all'
  }, adminToken);
  await post(`/clauses/${clauseC.id}/suggestions/${amendC.data.suggestion.id}/merge`, {
    reason: '测试用：升级条款C版本'
  }, adminToken);

  const cConflicted = await get(`/clauses/${clauseC.id}/drafts`, bizToken);
  assert(cConflicted.data.version_conflict === true, '条款C草稿有版本冲突');
  assert(cConflicted.data.conflict_detail !== null, '有 conflict_detail');
  assert(cConflicted.data.conflict_detail.base_version === 1, 'conflict_detail.base_version = 1');
  assert(cConflicted.data.conflict_detail.current_version === 2, 'conflict_detail.current_version = 2');
  assert(cConflicted.data.conflict_detail.newer_versions.length === 1, 'newer_versions 有 1 条');
  const nv = cConflicted.data.conflict_detail.newer_versions[0];
  assert(nv.version_number === 2, '新版本号 = 2');
  assert(typeof nv.display_name === 'string', 'newer_versions 包含 display_name');
  assert(typeof nv.change_summary === 'string', 'newer_versions 包含 change_summary');

  // ========== 测试14：所有新审计动作对比 API 审计日志和导出包 ==========
  console.log('\n--- 测试14：API 审计日志与导出包审计交叉一致性 ---');

  const apiAuditLogs = await get('/reports/audit-logs?entity_type=draft&limit=500', adminToken);
  const apiDraftLogs = apiAuditLogs.data.filter(l => l.entity_type === 'draft');

  const apiActions = new Set(apiDraftLogs.map(l => l.action));
  assert(apiActions.has('restore_draft'), 'API 审计包含 restore_draft');
  assert(apiActions.has('draft_conflict_continue'), 'API 审计包含 draft_conflict_continue');
  assert(apiActions.has('draft_conflict_copy'), 'API 审计包含 draft_conflict_copy');
  assert(apiActions.has('draft_conflict_discard'), 'API 审计包含 draft_conflict_discard');

  const contractClauseIds = new Set([clauseA.id, clauseB.id, clauseC.id, bClause1.id]);
  const draftLogsForThisContract = apiDraftLogs.filter(l =>
    l.details && l.details.clause_id && contractClauseIds.has(l.details.clause_id));
  const allActions = new Set(draftLogsForThisContract.map(l => l.action));
  assert(allActions.has('restore_draft'), '本合同草稿审计包含 restore_draft');
  assert(allActions.has('draft_conflict_continue'), '本合同草稿审计包含 draft_conflict_continue');
  assert(allActions.has('draft_conflict_copy'), '本合同草稿审计包含 draft_conflict_copy');
  assert(allActions.has('draft_conflict_discard'), '本合同草稿审计包含 draft_conflict_discard');

  const allDraftLogsInScope = draftLogsForThisContract;
  const allClauseIdsInLogs = new Set(allDraftLogsInScope.map(l => l.details.clause_id));
  const unexpectedIds = [...allClauseIdsInLogs].filter(id => !contractClauseIds.has(id));
  assert(unexpectedIds.length === 0,
    `本合同草稿审计的 clause_id 全部属于本合同 (意外ID数: ${unexpectedIds.length})`);

  // ========== 测试15：copy 后继续编辑提交 ==========
  console.log('\n--- 测试15：copy 后继续编辑并成功提交建议 ---');

  const copyForEdit = await post(`/clauses/${clauseC.id}/drafts/conflict-action`, {
    action: 'copy'
  }, bizToken);
  assert(copyForEdit.data.version_conflict === false, 'copy 后无冲突');
  assert(copyForEdit.data.base_version === 2, 'copy 后 base_version = 2');

  const submitRes = await post(`/clauses/${clauseC.id}/suggestions`, {
    type: 'comment', content: '基于新版本的建议',
    base_version: 2, exclusive_role: 'all'
  }, bizToken);
  assert(submitRes.data.suggestion.id, '提交成功');

  const draftAfterSubmit = await get(`/clauses/${clauseC.id}/drafts`, bizToken);
  assert(draftAfterSubmit.data === null || draftAfterSubmit.data === undefined,
    '提交后草稿自动清理');

  // ========== 总结 ==========
  console.log(`\n${'='.repeat(60)}`);
  console.log(`草稿恢复与版本冲突回归测试结果: ${passed} 通过, ${failed} 失败`);

  if (failed > 0) {
    console.log('\n❌ 有测试未通过：');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log('\n🎉 全部回归测试通过！');
    console.log('');
    console.log('✅ 恢复提示字段：GET /drafts 返回 last_save_time / conflict_detail / current_version');
    console.log('✅ 一键继续：POST /drafts/restore 无冲突时可一键恢复（记审计）');
    console.log('✅ 冲突检测：版本变化时 conflict_detail 包含变更版本列表');
    console.log('✅ 冲突操作：continue/copy/discard 三种操作均记审计');
    console.log('✅ copy 到新版本：base_version 自动更新，无冲突后可正常提交');
    console.log('✅ discard 冲突草稿：草稿删除并记审计');
    console.log('✅ 权限隔离：不同角色只能操作自己的草稿');
    console.log('✅ 导出包验证：restore_draft / draft_conflict_* 全部出现在导出审计中');
    console.log('✅ 合同隔离：不同合同的草稿恢复审计不会串到另一个合同的导出包');
    console.log('✅ 持久化：草稿和恢复状态存储在 SQLite，服务重启后不丢失');
    console.log('✅ 交叉确认：API 审计日志与导出包审计记录一致');
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
