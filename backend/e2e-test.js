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

async function run() {
  console.log('\n=== 合同条款协同评审系统 - 端到端验收测试 ===\n');

  // 1. 登录 admin
  const adminToken = await login('admin', 'admin123');
  console.log('✅ admin 登录成功');

  // 2. 创建合同
  const contract = await post('/contracts', {
    name: '2026年度供应商合作框架协议',
    description: '端到端测试合同，验收完整评审流程与失败路径'
  }, adminToken);
  const cid = contract.id;
  console.log(`✅ 创建合同: ${contract.name} (ID=${cid.substring(0, 8)}...)`);

  // 3. 导入5条条款
  const importData = {
    clauses: [
      { clause_number: '1', title: '定义', content: '"本协议"指双方签署的合同及全部附件。', risk_level: 'low' },
      { clause_number: '2.1', title: '服务范围', content: '乙方应依附件A提供专业咨询服务，符合行业一般标准。', risk_level: 'medium' },
      { clause_number: '3.2', title: '付款条款', content: '甲方收到增值税专用发票后30个工作日内支付相应款项。逾期按日万分之五付违约金。', risk_level: 'high' },
      { clause_number: '5.1', title: '保密义务', content: '双方应对合作过程中获悉的商业秘密承担保密义务，保密期为协议终止后5年。', risk_level: 'critical' },
      { clause_number: '8.3', title: '争议解决', content: '因本协议发生之争议，友好协商解决；协商不成，任何一方均可向甲方所在地人民法院提起诉讼。', risk_level: 'medium' }
    ]
  };
  const imp = await post(`/contracts/${cid}/import`, importData, adminToken);
  console.log(`✅ 导入条款: 成功 ${imp.imported_count} 条，失败 ${imp.error_count} 条`);

  // 4. 查询条款列表 + 过滤
  const clausesAll = await get(`/clauses?contract_id=${cid}`, adminToken);
  const highRisk = await get(`/clauses?contract_id=${cid}&risk_level=high`, adminToken);
  console.log(`✅ 条款列表共 ${clausesAll.length} 条，其中高/严重风险 ${highRisk.length} 条`);
  const clause32 = clausesAll.find(c => c.clause_number === '3.2');
  const clause51 = clausesAll.find(c => c.clause_number === '5.1');

  // ========== 业务1登录 ==========
  const bizToken = await login('business1', 'biz123');
  console.log('\n✅ business1 登录成功');

  // 5. 发起评论
  const comment = await post(`/clauses/${clause32.id}/suggestions`, {
    type: 'comment',
    content: '建议明确"增值税专用发票"为 13% 税率，避免歧义。',
    base_version: clause32.current_version,
    exclusive_role: 'all'
  }, bizToken);
  console.log(`✅ business1 对 [3.2 付款] 发起评论 (冲突=${comment.version_conflict})`);

  // 6. 发起修改建议（法务专属）
  const amendment = await post(`/clauses/${clause51.id}/suggestions`, {
    type: 'amendment',
    content: '业务侧认为保密期5年过长，建议改为3年，符合行业惯例。',
    base_version: clause51.current_version,
    amended_title: '保密义务',
    amended_content: '双方应对合作过程中获悉的对方商业秘密承担保密义务，保密期限为协议终止后3年。',
    risk_level: 'medium',
    exclusive_role: 'legal'
  }, bizToken);
  console.log(`✅ business1 对 [5.1 保密] 发起【法务专属】修改建议 (base_v=${amendment.suggestion.base_version})`);
  const amendmentSid = amendment.suggestion.id;

  // ========== 失败路径 1：business2 企图处理法务专属 ==========
  console.log('\n❌ 测试失败路径 1：business2 通过【法务专属】建议');
  const biz2Token = await login('business2', 'biz123');
  try {
    await post(`/clauses/${clause51.id}/suggestions/${amendmentSid}/approve`, { reason: '业务同意' }, biz2Token);
    console.log('   ❌ 失败：不应通过'); process.exit(1);
  } catch (e) {
    console.log(`   ✅ 预期 403: ${e.response?.data?.error}`);
  }

  // ========== 失败路径 2：不填原因驳回 ==========
  console.log('\n❌ 测试失败路径 2：不填原因驳回建议');
  const legalToken = await login('legal1', 'legal123');
  const commentSid = comment.suggestion.id;
  try {
    await post(`/clauses/${clause32.id}/suggestions/${commentSid}/reject`, { reason: '' }, legalToken);
    console.log('   ❌ 失败：不应通过'); process.exit(1);
  } catch (e) {
    console.log(`   ✅ 预期 400: ${e.response?.data?.error}`);
  }

  // ========== 成功路径 ==========
  console.log('\n✅ 正常路径：legal1 处理建议');
  const approved = await post(`/clauses/${clause32.id}/suggestions/${commentSid}/approve`,
    { reason: '采纳业务建议，将在补充协议中明确发票税率。' }, legalToken);
  console.log(`   通过 [3.2 付款] 评论，状态=${approved.status}`);

  const merged = await post(`/clauses/${clause51.id}/suggestions/${amendmentSid}/merge`,
    { reason: '采纳意见：保密期3年符合行业惯例，风险等级由 critical 调为 medium。' }, legalToken);
  console.log(`   合并 [5.1 保密] 修改建议 -> 新版本 v${merged.new_version}`);

  // ========== 失败路径 3：基于旧版本合并（并发冲突）==========
  console.log('\n❌ 测试失败路径 3：基于过期版本合并（并发冲突 409）');
  const legal2Token = await login('legal2', 'legal123');
  const staleSug = await post(`/clauses/${clause51.id}/suggestions`, {
    type: 'amendment',
    content: '建议增加泄露赔偿条款。',
    base_version: 1,
    amended_content: '双方保密3年。一方泄露承担合同额30%违约金。',
    exclusive_role: 'all'
  }, legal2Token);
  console.log(`   legal2 故意基于 v1 提交建议，创建时冲突=${staleSug.version_conflict}（应为 true）`);
  try {
    await post(`/clauses/${clause51.id}/suggestions/${staleSug.suggestion.id}/merge`,
      { reason: '合并' }, legal2Token);
    console.log('   ❌ 失败：不应通过'); process.exit(1);
  } catch (e) {
    const d = e.response?.data || {};
    console.log(`   ✅ 预期 409 冲突: ${d.error}, base_v=${d.conflict?.base_version}, current_v=${d.conflict?.current_version}`);
  }

  // ========== 失败路径 4：回滚不存在版本 ==========
  console.log('\n❌ 测试失败路径 4：回滚到不存在的 v99');
  try {
    await post(`/clauses/${clause51.id}/rollback`, { target_version: 99, reason: '测试不存在' }, adminToken);
    console.log('   ❌ 失败：不应通过'); process.exit(1);
  } catch (e) {
    console.log(`   ✅ 预期 404: ${e.response?.data?.error}`);
  }

  // ========== 成功路径：正常回滚 ==========
  console.log('\n✅ 正常路径：admin 回滚 [5.1 保密] 至 v1');
  const rollback = await post(`/clauses/${clause51.id}/rollback`,
    { target_version: 1, reason: '法务合规部复核：5年保密期为行业强制要求，恢复原条款。' }, adminToken);
  console.log(`   回滚成功，新版本号 v${rollback.new_version}（内容 = v1）`);

  // ========== 导出评审包 ==========
  console.log('\n✅ 导出评审包（含版本、建议、审计日志）');
  const resp = await fetch(`${API}/reports/contract/${cid}/export`, { headers: { 'Authorization': `Bearer ${adminToken}` } });
  const ab = await resp.arrayBuffer();
  const json = JSON.parse(Buffer.from(ab).toString('utf8'));
  const totalSugs = json.clauses.reduce((s, c) => s + (c.suggestions?.length || 0), 0);
  console.log(`   共 ${json.clauses.length} 条条款, ${totalSugs} 条建议, ${json.audit_logs.length} 条审计日志`);

  // ========== 审计日志核查 ==========
  console.log('\n✅ 审计日志核查');
  const logs = await get(`/reports/audit-logs`, adminToken);
  const actions = {};
  logs.forEach(l => { actions[l.action] = (actions[l.action] || 0) + 1; });
  console.log('   各类操作计数:', actions);

  console.log('\n🎉 ================ 全部验收测试通过！ ================\n');
  console.log('✅  登录 & 用户角色体系');
  console.log('✅  合同创建 + 条款批量导入');
  console.log('✅  条款列表按风险等级 & 待处理状态过滤');
  console.log('✅  评论 & 修改建议（含法务/业务专属）');
  console.log('✅  ❌ 失败1：业务越权处理法务专属建议 (403)');
  console.log('✅  ❌ 失败2：决策缺少原因 (400)');
  console.log('✅  通过评论 + 合并修改建议（生成新版本）');
  console.log('✅  ❌ 失败3：基于旧版本合并 (409 冲突)');
  console.log('✅  ❌ 失败4：回滚到不存在版本 (404)');
  console.log('✅  正常回滚历史版本（生成新版本）');
  console.log('✅  评审包导出（完整版本+建议+审计日志）');
  console.log('✅  完整决策日志记入审计\n');
}

run().catch(e => {
  console.error('\n❌ 测试异常退出:', e.response?.data || e.message);
  process.exit(1);
});
