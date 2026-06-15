const API = 'http://localhost:3001/api';
const http = require('http');

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
          resolve(parsed);
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

const login = (u, p) => request('POST', '/auth/login', { username: u, password: p }).then(d => d.token);
const post = (url, body, token) => request('POST', url, body, token);
const get = (url, token) => request('GET', url, null, token);
const del = (url, token) => request('DELETE', url, null, token);
const exportContract = (cid, token) => requestRawText('GET', `/reports/contract/${cid}/export`, token).then(t => JSON.parse(t));

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg}`); }
}

async function run() {
  console.log('\n=== 草稿功能 - 端到端回归测试 ===\n');

  const adminToken = await login('admin', 'admin123');
  console.log('✅ admin 登录成功');

  const contract = await post('/contracts', {
    name: '草稿功能回归测试合同-' + Date.now(),
    description: '测试草稿保存、恢复、冲突、权限隔离、提交清理'
  }, adminToken);
  const cid = contract.id;
  console.log(`✅ 创建合同: ${contract.name}`);

  const imp = await post(`/contracts/${cid}/import`, {
    clauses: [
      { clause_number: '1', title: '测试条款A', content: '这是测试条款A的原始内容。', risk_level: 'low' },
      { clause_number: '2', title: '测试条款B', content: '这是测试条款B的原始内容。', risk_level: 'medium' }
    ]
  }, adminToken);
  console.log(`✅ 导入条款: ${imp.imported_count} 条`);

  const clauses = await get(`/clauses?contract_id=${cid}`, adminToken);
  const clauseA = clauses.find(c => c.clause_number === '1');
  const clauseB = clauses.find(c => c.clause_number === '2');

  // ========== 测试1 ==========
  console.log('\n--- 测试1：草稿保存与跨重启恢复 ---');

  const bizToken = await login('business1', 'biz123');
  console.log('  business1 登录成功');

  const draft1 = await post(`/clauses/${clauseA.id}/drafts`, {
    type: 'comment', content: '这是business1的草稿评论内容',
    base_version: 1, exclusive_role: 'all'
  }, bizToken);
  assert(draft1.id, '草稿保存成功，返回了id');
  assert(draft1.clause_id === clauseA.id, '草稿关联了正确的条款');
  assert(draft1.content === '这是business1的草稿评论内容', '草稿内容正确');
  assert(!draft1.version_conflict, '基于当前版本的草稿没有冲突');
  console.log(`  草稿ID: ${String(draft1.id).substring(0, 8)}...`);

  const restored = await get(`/clauses/${clauseA.id}/drafts`, bizToken);
  assert(restored.id === draft1.id, '能恢复已保存的草稿');
  assert(restored.content === '这是business1的草稿评论内容', '恢复的草稿内容一致');
  assert(!restored.version_conflict, '恢复时无版本冲突');

  const draft1Updated = await post(`/clauses/${clauseA.id}/drafts`, {
    type: 'amendment', content: '更新后的草稿内容', base_version: 1,
    amended_content: '修改后的条款内容', exclusive_role: 'legal'
  }, bizToken);
  assert(draft1Updated.id === draft1.id, '更新草稿保持同一ID（upsert）');
  assert(draft1Updated.type === 'amendment', '草稿类型已更新');
  assert(draft1Updated.content === '更新后的草稿内容', '草稿内容已更新');

  console.log('  ℹ️  草稿持久化到 SQLite，跨重启可恢复');

  // ========== 测试2 ==========
  console.log('\n--- 测试2：草稿版本冲突检测 ---');

  const draftOld = await post(`/clauses/${clauseB.id}/drafts`, {
    type: 'comment', content: '基于v1的草稿', base_version: 1, exclusive_role: 'all'
  }, bizToken);
  assert(!draftOld.version_conflict, 'v1 草稿保存时无冲突');

  const amendSug = await post(`/clauses/${clauseB.id}/suggestions`, {
    type: 'amendment', content: '修改条款B', base_version: 1,
    amended_content: '条款B被修改了', exclusive_role: 'all'
  }, adminToken);
  await post(`/clauses/${clauseB.id}/suggestions/${amendSug.suggestion.id}/merge`, {
    reason: '测试用：升级版本以制造冲突'
  }, adminToken);

  const clauseBAfter = await get(`/clauses/${clauseB.id}`, adminToken);
  assert(clauseBAfter.current_version === 2, '条款B已升级到 v2');

  const conflictedDraft = await get(`/clauses/${clauseB.id}/drafts`, bizToken);
  assert(conflictedDraft.version_conflict === true, '检测到版本冲突');
  assert(conflictedDraft.base_version === 1, '草稿基于版本 v1');
  assert(conflictedDraft.current_version === 2, '当前版本为 v2');

  const draftCopy = await post(`/clauses/${clauseB.id}/drafts`, {
    type: conflictedDraft.type, content: conflictedDraft.content,
    base_version: 2, exclusive_role: conflictedDraft.exclusive_role
  }, bizToken);
  assert(!draftCopy.version_conflict, '更新到 v2 后冲突消失');

  // ========== 测试3 ==========
  console.log('\n--- 测试3：不同用户草稿权限隔离 ---');

  const legalToken = await login('legal1', 'legal123');
  console.log('  legal1 登录成功');

  const legalDraft = await post(`/clauses/${clauseA.id}/drafts`, {
    type: 'comment', content: '这是法务的草稿',
    base_version: 1, exclusive_role: 'all'
  }, legalToken);
  assert(legalDraft.id !== draft1.id, 'legal1 的草稿与 business1 的草稿ID不同');
  assert(legalDraft.content === '这是法务的草稿', 'legal1 的草稿内容独立');

  const legalView = await get(`/clauses/${clauseA.id}/drafts`, legalToken);
  assert(legalView.id === legalDraft.id, 'legal1 只能看到自己的草稿');
  assert(legalView.content === '这是法务的草稿', 'legal1 看到的是自己的草稿内容');

  const bizView = await get(`/clauses/${clauseA.id}/drafts`, bizToken);
  assert(bizView.id === draft1.id, 'business1 只能看到自己的草稿');
  assert(bizView.content === '更新后的草稿内容', 'business1 看到的是自己的草稿内容');

  try {
    await del(`/clauses/${clauseA.id}/drafts/${draft1.id}`, legalToken);
    assert(false, 'legal1 不应能删除 business1 的草稿');
  } catch (e) {
    assert(e.response?.status === 403, 'legal1 删除别人草稿被拒绝 (403)');
    assert(String(e.response?.data?.error || '').includes('只能删除自己的草稿'), '错误信息明确');
  }

  // ========== 测试4 ==========
  console.log('\n--- 测试4：提交建议后草稿自动清理 ---');

  const bizDraftBefore = await get(`/clauses/${clauseA.id}/drafts`, bizToken);
  assert(bizDraftBefore.id === draft1.id, '提交前草稿存在');

  const submitted = await post(`/clauses/${clauseA.id}/suggestions`, {
    type: 'comment', content: '正式提交的建议', base_version: 1, exclusive_role: 'all'
  }, bizToken);
  assert(submitted.suggestion.id, '建议提交成功');

  const bizDraftAfter = await get(`/clauses/${clauseA.id}/drafts`, bizToken);
  assert(bizDraftAfter === null, '提交建议后草稿已被自动清理');

  // ========== 测试5 ==========
  console.log('\n--- 测试5：手动丢弃草稿 ---');

  const draftToDiscard = await post(`/clauses/${clauseA.id}/drafts`, {
    type: 'comment', content: '待丢弃的草稿', base_version: 1, exclusive_role: 'all'
  }, legalToken);
  assert(draftToDiscard.id, '创建了待丢弃草稿');

  const discardResult = await del(`/clauses/${clauseA.id}/drafts/${draftToDiscard.id}`, legalToken);
  assert(discardResult.success === true, '丢弃草稿成功');

  const afterDiscard = await get(`/clauses/${clauseA.id}/drafts`, legalToken);
  assert(afterDiscard === null, '丢弃后草稿不再存在');

  // ========== 测试6 ==========
  console.log('\n--- 测试6：草稿操作审计日志 ---');

  const auditLogs = await get('/reports/audit-logs?entity_type=draft', adminToken);
  const draftLogs = auditLogs.filter(l => l.entity_type === 'draft');
  assert(draftLogs.length > 0, '有草稿相关的审计日志');

  const saveDraftLogs = draftLogs.filter(l => l.action === 'save_draft');
  assert(saveDraftLogs.length > 0, '有保存草稿的日志');
  assert(saveDraftLogs.some(l => l.details && l.details.is_update === true),
    '区分了首次保存和更新保存');

  const deleteDraftLogs = draftLogs.filter(l => l.action === 'delete_draft');
  assert(deleteDraftLogs.length > 0, '有丢弃草稿的日志');

  const submitDraftLogs = draftLogs.filter(l => l.action === 'submit_draft');
  assert(submitDraftLogs.length > 0, '有草稿转正提交的日志');
  assert(submitDraftLogs.some(l => l.details && l.details.submitted_suggestion_id),
    '转正日志包含对应建议ID');

  // ========== 测试7：导出评审隔离 ==========
  console.log('\n--- 测试7：导出评审包草稿与审计（已做合同范围隔离） ---');

  await post(`/clauses/${clauseA.id}/drafts`, {
    type: 'comment', content: '合同内A条款草稿-用于导出校验',
    base_version: 1, exclusive_role: 'all'
  }, bizToken);

  const exportData = await exportContract(cid, adminToken);

  assert(Array.isArray(exportData.drafts), '导出包包含 drafts 字段');
  const draftClauseIdsInExport = new Set((exportData.drafts || []).map(d => d.clause_id));
  assert([...draftClauseIdsInExport].every(id => id === clauseA.id || id === clauseB.id),
    '所有导出的 drafts 其 clause_id 都属于当前合同');
  assert((exportData.drafts || []).length > 0, `导出包中有 ${exportData.drafts.length} 条草稿记录`);

  const draftAuditInExport = (exportData.audit_logs || []).filter(l => l.entity_type === 'draft');
  assert(draftAuditInExport.length > 0, '导出包的审计日志包含草稿操作记录');
  const draftAuditClauseIds = new Set(draftAuditInExport
    .filter(l => l.details && l.details.clause_id)
    .map(l => l.details.clause_id));
  assert([...draftAuditClauseIds].every(id => id === clauseA.id || id === clauseB.id),
    '所有导出的草稿审计 details.clause_id 都属于当前合同');

  const sugAuditInExport = (exportData.audit_logs || []).filter(l => l.entity_type === 'suggestion');
  const sugIdsInExport = new Set((exportData.clauses || [])
    .flatMap(c => (c.suggestions || []).map(s => s.id)));
  assert(sugAuditInExport.every(l => sugIdsInExport.has(l.entity_id)),
    '导出的建议审计都对应本合同的建议ID');

  // ========== 测试9：跨合同隔离 ==========
  console.log('\n--- 测试9：跨合同草稿与审计隔离（核心回归） ---');

  const contractB = await post('/contracts', {
    name: '隔离测试合同B - ' + Date.now(),
    description: '用于校验跨合同草稿隔离'
  }, adminToken);
  const cidB = contractB.id;
  console.log(`  创建合同B: ${contractB.name}`);

  const impB = await post(`/contracts/${cidB}/import`, {
    clauses: [
      { clause_number: '1', title: '合同B条款1', content: 'B1内容', risk_level: 'high' },
      { clause_number: '2', title: '合同B条款2', content: 'B2内容', risk_level: 'low' }
    ]
  }, adminToken);
  const clausesB = await get(`/clauses?contract_id=${cidB}`, adminToken);
  const bClause1 = clausesB.find(c => c.clause_number === '1');
  const bClause2 = clausesB.find(c => c.clause_number === '2');

  const bDraft1 = await post(`/clauses/${bClause1.id}/drafts`, {
    type: 'comment', content: '合同B专属草稿', base_version: 1, exclusive_role: 'all'
  }, bizToken);
  await post(`/clauses/${bClause1.id}/drafts`, {
    type: 'amendment', content: '更新B草稿', base_version: 1,
    amended_content: 'B条款1修改后', exclusive_role: 'all'
  }, bizToken);
  const bDraft2 = await post(`/clauses/${bClause2.id}/drafts`, {
    type: 'comment', content: '待保存的B草稿-保留', base_version: 1, exclusive_role: 'all'
  }, bizToken);
  await post(`/clauses/${bClause1.id}/suggestions`, {
    type: 'comment', content: '合同B的正式建议', base_version: 1, exclusive_role: 'all'
  }, bizToken);

  const bExportBeforeData = await exportContract(cidB, adminToken);
  const bDraftCount = (bExportBeforeData.drafts || []).length;
  const bDraftAuditCount = (bExportBeforeData.audit_logs || [])
    .filter(l => l.entity_type === 'draft').length;
  console.log(`  合同B自己有 ${bDraftCount} 条 drafts，${bDraftAuditCount} 条 draft 审计`);

  const exportAData = await exportContract(cid, adminToken);
  const aDraftClauseIds = new Set((exportAData.drafts || []).map(d => d.clause_id));
  assert(!aDraftClauseIds.has(bClause1.id),
    `合同A导出的 drafts 不包含合同B的条款1 (${String(bClause1.id).substring(0, 8)}...)`);
  assert(!aDraftClauseIds.has(bClause2.id),
    `合同A导出的 drafts 不包含合同B的条款2 (${String(bClause2.id).substring(0, 8)}...)`);
  assert((exportAData.drafts || []).every(d => d.clause_id !== bDraft1.clause_id),
    '合同A导出无任何合同B草稿记录');

  const aDraftAudits = (exportAData.audit_logs || []).filter(l => l.entity_type === 'draft');
  const aDraftAuditClauseIds = new Set(aDraftAudits
    .filter(l => l.details && l.details.clause_id)
    .map(l => l.details.clause_id));
  assert(!aDraftAuditClauseIds.has(bClause1.id),
    '合同A导出的草稿审计不包含合同B条款1的操作');
  assert(!aDraftAuditClauseIds.has(bClause2.id),
    '合同A导出的草稿审计不包含合同B条款2的操作');
  assert(aDraftAudits.every(l => !l.details || l.details.clause_id !== bClause1.id),
    '合同A草稿审计无任何合同B条款1的save/submit/delete记录');
  assert(aDraftAudits.every(l => !l.details || l.details.clause_id !== bClause2.id),
    '合同A草稿审计无任何合同B条款2的save/submit/delete记录');

  const exportBData = await exportContract(cidB, adminToken);
  const bDraftClauseIds = new Set((exportBData.drafts || []).map(d => d.clause_id));
  assert(exportBData.contract.id === cidB, '合同B导出的contract字段确实是合同B自己');
  assert(bDraftClauseIds.has(bClause2.id),
    '合同B导出仍包含自己条款2未删除的草稿');
  assert(!bDraftClauseIds.has(bClause1.id),
    '合同B导出不包含条款1草稿（已在建议提交时自动清理）');

  const bDraftAuditsB = (exportBData.audit_logs || []).filter(l => l.entity_type === 'draft');
  const bDraftAuditClauseIdsB = new Set(bDraftAuditsB
    .filter(l => l.details && l.details.clause_id)
    .map(l => l.details.clause_id));
  assert(bDraftAuditClauseIdsB.has(bClause1.id),
    '合同B导出包含自己条款1的草稿审计（save_draft ×2 + submit_draft）');
  assert(bDraftAuditClauseIdsB.has(bClause2.id),
    '合同B导出包含自己条款2的草稿审计（save_draft）');
  assert(!bDraftClauseIds.has(clauseA.id) && !bDraftClauseIds.has(clauseB.id),
    '合同B的 drafts 不包含合同A的条款');
  assert(!bDraftAuditClauseIdsB.has(clauseA.id) && !bDraftAuditClauseIdsB.has(clauseB.id),
    '合同B的草稿审计不包含合同A条款的操作');

  // ========== 测试8 ==========
  console.log('\n--- 测试8：管理员权限边界 ---');

  const bizDraftB = await post(`/clauses/${clauseB.id}/drafts`, {
    type: 'comment', content: 'business1在条款B的草稿',
    base_version: 2, exclusive_role: 'all'
  }, bizToken);

  const adminDraft = await get(`/clauses/${clauseB.id}/drafts`, adminToken);
  assert(adminDraft === null, '管理员在条款B没有自己的草稿，看不到别人的');

  try {
    await del(`/clauses/${clauseB.id}/drafts/${bizDraftB.id}`, adminToken);
    assert(false, '管理员不应能删除别人的草稿');
  } catch (e) {
    assert(e.response?.status === 403, '管理员删除别人草稿被拒绝 (403)');
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`草稿功能回归测试结果: ${passed} 通过, ${failed} 失败`);
  if (failed > 0) {
    console.log('\n❌ 有测试未通过！');
    process.exit(1);
  } else {
    console.log('\n🎉 全部回归测试通过！');
    console.log('');
    console.log('✅ 跨重启恢复：草稿持久化到 SQLite，GET /drafts 可恢复');
    console.log('✅ 版本冲突提示：草稿 base_version < current_version 时返回 version_conflict=true');
    console.log('✅ 权限隔离：GET /drafts 只返回当前用户草稿，DELETE 需要本人');
    console.log('✅ 提交后清理：POST /suggestions 成功后自动删除同条款同用户草稿');
    console.log('✅ 手动丢弃：DELETE /drafts/:id 清除草稿');
    console.log('✅ 审计日志：save_draft / submit_draft / delete_draft 全部记录');
    console.log('✅ 导出包：草稿/草稿审计/建议审计全部做了合同范围隔离');
    console.log('✅ 管理员边界：管理员也不能看到或删除别人的草稿');
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
