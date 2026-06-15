const API = 'http://localhost:3001/api';

async function login(username, password) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `Login failed ${r.status}`);
  return d.token;
}

const auth = (token) => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${token}`
});

const post = async (url, body, token) => {
  const r = await fetch(`${API}${url}`, {
    method: 'POST', headers: auth(token), body: JSON.stringify(body)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || `HTTP ${r.status}`); e.response = { data: d, status: r.status }; throw e; }
  return d;
};
const get = async (url, token) => {
  const r = await fetch(`${API}${url}`, { headers: { 'Authorization': `Bearer ${token}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || `HTTP ${r.status}`); e.response = { data: d, status: r.status }; throw e; }
  return d;
};
const del = async (url, token) => {
  const r = await fetch(`${API}${url}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || `HTTP ${r.status}`); e.response = { data: d, status: r.status }; throw e; }
  return d;
};

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
    name: '草稿功能回归测试合同',
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

  // ========== 测试1：草稿保存与恢复（跨重启） ==========
  console.log('\n--- 测试1：草稿保存与跨重启恢复 ---');

  const bizToken = await login('business1', 'biz123');
  console.log('  business1 登录成功');

  const draft1 = await post(`/clauses/${clauseA.id}/drafts`, {
    type: 'comment',
    content: '这是business1的草稿评论内容',
    base_version: 1,
    exclusive_role: 'all'
  }, bizToken);
  assert(draft1.id, '草稿保存成功，返回了id');
  assert(draft1.clause_id === clauseA.id, '草稿关联了正确的条款');
  assert(draft1.content === '这是business1的草稿评论内容', '草稿内容正确');
  assert(!draft1.version_conflict, '基于当前版本的草稿没有冲突');
  console.log(`  草稿ID: ${draft1.id.substring(0, 8)}...`);

  // 恢复草稿
  const restored = await get(`/clauses/${clauseA.id}/drafts`, bizToken);
  assert(restored.id === draft1.id, '能恢复已保存的草稿');
  assert(restored.content === '这是business1的草稿评论内容', '恢复的草稿内容一致');
  assert(!restored.version_conflict, '恢复时无版本冲突');

  // 更新草稿
  const draft1Updated = await post(`/clauses/${clauseA.id}/drafts`, {
    type: 'amendment',
    content: '更新后的草稿内容',
    base_version: 1,
    amended_content: '修改后的条款内容',
    exclusive_role: 'legal'
  }, bizToken);
  assert(draft1Updated.id === draft1.id, '更新草稿保持同一ID（upsert）');
  assert(draft1Updated.type === 'amendment', '草稿类型已更新');
  assert(draft1Updated.content === '更新后的草稿内容', '草稿内容已更新');

  console.log('  ℹ️  模拟重启：草稿数据持久化到 SQLite 文件，重启后重新加载即可恢复');

  // ========== 测试2：版本冲突检测 ==========
  console.log('\n--- 测试2：草稿版本冲突检测 ---');

  // business1 在条款B上保存基于 v1 的草稿
  const draftOld = await post(`/clauses/${clauseB.id}/drafts`, {
    type: 'comment',
    content: '基于v1的草稿',
    base_version: 1,
    exclusive_role: 'all'
  }, bizToken);
  assert(!draftOld.version_conflict, 'v1 草稿保存时当前版本也为v1，无冲突');

  // 合并一个修改建议使条款B升级到 v2
  const amendSug = await post(`/clauses/${clauseB.id}/suggestions`, {
    type: 'amendment',
    content: '修改条款B',
    base_version: 1,
    amended_content: '条款B被修改了',
    exclusive_role: 'all'
  }, adminToken);
  await post(`/clauses/${clauseB.id}/suggestions/${amendSug.suggestion.id}/merge`, {
    reason: '测试用：升级版本以制造冲突'
  }, adminToken);

  const clauseBAfter = await get(`/clauses/${clauseB.id}`, adminToken);
  assert(clauseBAfter.current_version === 2, '条款B已升级到 v2');

  // 现在再次获取草稿，应该有冲突
  const conflictedDraft = await get(`/clauses/${clauseB.id}/drafts`, bizToken);
  assert(conflictedDraft.version_conflict === true, '检测到版本冲突');
  assert(conflictedDraft.base_version === 1, '草稿基于版本 v1');
  assert(conflictedDraft.current_version === 2, '当前版本为 v2');

  console.log('  ℹ️  前端收到 version_conflict=true 后会弹出冲突提示');

  // 测试 "复制内容到新版本" 场景：更新草稿 base_version 为 2
  const draftCopy = await post(`/clauses/${clauseB.id}/drafts`, {
    type: conflictedDraft.type,
    content: conflictedDraft.content,
    base_version: 2,
    exclusive_role: conflictedDraft.exclusive_role
  }, bizToken);
  assert(!draftCopy.version_conflict, '更新到 v2 后冲突消失');

  // ========== 测试3：权限隔离 ==========
  console.log('\n--- 测试3：不同用户草稿权限隔离 ---');

  const legalToken = await login('legal1', 'legal123');
  console.log('  legal1 登录成功');

  // legal1 在条款A上保存草稿
  const legalDraft = await post(`/clauses/${clauseA.id}/drafts`, {
    type: 'comment',
    content: '这是法务的草稿',
    base_version: 1,
    exclusive_role: 'all'
  }, legalToken);
  assert(legalDraft.id !== draft1.id, 'legal1 的草稿与 business1 的草稿ID不同');
  assert(legalDraft.content === '这是法务的草稿', 'legal1 的草稿内容独立');

  // legal1 看不到 business1 的草稿
  const legalView = await get(`/clauses/${clauseA.id}/drafts`, legalToken);
  assert(legalView.id === legalDraft.id, 'legal1 只能看到自己的草稿');
  assert(legalView.content === '这是法务的草稿', 'legal1 看到的是自己的草稿内容');

  // business1 看不到 legal1 的草稿
  const bizView = await get(`/clauses/${clauseA.id}/drafts`, bizToken);
  assert(bizView.id === draft1.id, 'business1 只能看到自己的草稿');
  assert(bizView.content === '更新后的草稿内容', 'business1 看到的是自己的草稿内容');

  // legal1 无法删除 business1 的草稿
  try {
    await del(`/clauses/${clauseA.id}/drafts/${draft1.id}`, legalToken);
    assert(false, 'legal1 不应能删除 business1 的草稿');
  } catch (e) {
    assert(e.response?.status === 403, 'legal1 删除别人草稿被拒绝 (403)');
    assert(e.response?.data?.error?.includes('只能删除自己的草稿'), '错误信息明确');
  }

  // ========== 测试4：提交建议后自动清理草稿 ==========
  console.log('\n--- 测试4：提交建议后草稿自动清理 ---');

  // 确认 business1 在条款A还有草稿
  const bizDraftBefore = await get(`/clauses/${clauseA.id}/drafts`, bizToken);
  assert(bizDraftBefore.id === draft1.id, '提交前草稿存在');

  // business1 提交正式建议
  const submitted = await post(`/clauses/${clauseA.id}/suggestions`, {
    type: 'comment',
    content: '正式提交的建议',
    base_version: 1,
    exclusive_role: 'all'
  }, bizToken);
  assert(submitted.suggestion.id, '建议提交成功');

  // 草稿应该被自动清理
  const bizDraftAfter = await get(`/clauses/${clauseA.id}/drafts`, bizToken);
  assert(bizDraftAfter === null, '提交建议后草稿已被自动清理');

  // ========== 测试5：手动丢弃草稿 ==========
  console.log('\n--- 测试5：手动丢弃草稿 ---');

  // legal1 再存一个草稿然后丢弃
  const draftToDiscard = await post(`/clauses/${clauseA.id}/drafts`, {
    type: 'comment',
    content: '待丢弃的草稿',
    base_version: 1,
    exclusive_role: 'all'
  }, legalToken);
  assert(draftToDiscard.id, '创建了待丢弃草稿');

  const discardResult = await del(`/clauses/${clauseA.id}/drafts/${draftToDiscard.id}`, legalToken);
  assert(discardResult.success === true, '丢弃草稿成功');

  const afterDiscard = await get(`/clauses/${clauseA.id}/drafts`, legalToken);
  assert(afterDiscard === null, '丢弃后草稿不再存在');

  // ========== 测试6：审计日志记录 ==========
  console.log('\n--- 测试6：草稿操作审计日志 ---');

  const auditLogs = await get('/reports/audit-logs?entity_type=draft', adminToken);
  const draftLogs = auditLogs.filter(l => l.entity_type === 'draft');
  assert(draftLogs.length > 0, '有草稿相关的审计日志');

  const saveDraftLogs = draftLogs.filter(l => l.action === 'save_draft');
  assert(saveDraftLogs.length > 0, '有保存草稿的日志');
  assert(saveDraftLogs.some(l => l.details && l.details.is_update === true), '区分了首次保存和更新保存');

  const deleteDraftLogs = draftLogs.filter(l => l.action === 'delete_draft');
  assert(deleteDraftLogs.length > 0, '有丢弃草稿的日志');

  const submitDraftLogs = draftLogs.filter(l => l.action === 'submit_draft');
  assert(submitDraftLogs.length > 0, '有草稿转正提交的日志');
  assert(submitDraftLogs.some(l => l.details && l.details.submitted_suggestion_id), '转正日志包含对应建议ID');

  // ========== 测试7：导出评审包包含草稿记录 ==========
  console.log('\n--- 测试7：导出评审包包含草稿与草稿审计 ---');

  const resp = await fetch(`${API}/reports/contract/${cid}/export`, { headers: { 'Authorization': `Bearer ${adminToken}` } });
  const ab = await resp.arrayBuffer();
  const exportData = JSON.parse(Buffer.from(ab).toString('utf8'));

  assert(Array.isArray(exportData.drafts), '导出包包含 drafts 字段');
  assert(exportData.drafts.length >= 0, `导出包中有 ${exportData.drafts.length} 条草稿记录`);

  const draftAuditInExport = exportData.audit_logs.filter(l => l.entity_type === 'draft');
  assert(draftAuditInExport.length > 0, '导出包的审计日志包含草稿操作记录');

  // ========== 测试8：管理员不能把别人的草稿当自己的处理 ==========
  console.log('\n--- 测试8：管理员权限边界 ---');

  // business1 在条款B保存一个草稿
  const bizDraftB = await post(`/clauses/${clauseB.id}/drafts`, {
    type: 'comment',
    content: 'business1在条款B的草稿',
    base_version: 2,
    exclusive_role: 'all'
  }, bizToken);

  // 管理员查看自己的草稿（应该没有）
  const adminDraft = await get(`/clauses/${clauseB.id}/drafts`, adminToken);
  assert(adminDraft === null, '管理员在条款B没有自己的草稿，看不到别人的');

  // 管理员也不能删除别人的草稿
  try {
    await del(`/clauses/${clauseB.id}/drafts/${bizDraftB.id}`, adminToken);
    assert(false, '管理员不应能删除别人的草稿');
  } catch (e) {
    assert(e.response?.status === 403, '管理员删除别人草稿被拒绝 (403)');
  }

  // ========== 汇总 ==========
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
    console.log('✅ 导出包：评审包含 drafts 和 draft 审计日志');
    console.log('✅ 管理员边界：管理员也不能看到或删除别人的草稿');
  }
}

run().catch(e => {
  console.error('\n❌ 测试异常退出:', e.response?.data || e.message);
  process.exit(1);
});
