const API = 'http://localhost:3001/api';
const fs = require('fs');
const path = require('path');

let testPassed = true;
let results = [];

function log(message) {
  console.log(message);
  results.push(message);
}

function assert(condition, message) {
  if (!condition) {
    log(`❌ 断言失败: ${message}`);
    testPassed = false;
  } else {
    log(`✅ ${message}`);
  }
}

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
  log('\n=== 条款导入可控更新流程 - 端到端回归测试 ===\n');

  try {
    const adminToken = await login('admin', 'admin123');
    log('✅ admin 登录成功');

    const bizToken = await login('business1', 'biz123');
    log('✅ business1 登录成功');

    const contract = await post('/contracts', {
      name: '导入更新流程-回归测试',
      description: '完整验证导入更新流程'
    }, adminToken);
    const cid = contract.id;
    log(`✅ 创建测试合同: ${contract.name}`);

    // 步骤1: 首次导入 5 条
    const initialClauses = [
      { clause_number: '1', title: '定义', content: '"本协议"指双方签署的合同及全部附件。', risk_level: 'low' },
      { clause_number: '2.1', title: '服务范围', content: '乙方应依附件A提供专业咨询服务。', risk_level: 'medium' },
      { clause_number: '3.2', title: '付款条款', content: '甲方收到发票后30个工作日内支付款项。', risk_level: 'high' },
      { clause_number: '5.1', title: '保密义务', content: '双方应对商业秘密承担保密义务，保密期5年。', risk_level: 'critical' },
      { clause_number: '8.3', title: '争议解决', content: '因本协议发生争议，协商不成向甲方所在地法院起诉。', risk_level: 'medium' }
    ];
    const imp1 = await post(`/contracts/${cid}/import`, { mode: 'update_by_number', clauses: initialClauses }, adminToken);
    assert(imp1.new_count === 5, `首次导入新增 5 条`);
    assert(imp1.update_count === 0, '首次导入更新 0 条');
    assert(imp1.block_count === 0, '首次导入阻止 0 条');

    const clausesInitial = await get(`/clauses?contract_id=${cid}`, adminToken);
    assert(clausesInitial.length === 5, '条款列表共 5 条');

    log('\n--- 测试 1：预检功能 ---');
    const updatedClauses = [
      { clause_number: '1', title: '定义', content: '"本协议"指双方签署的合同及全部附件。', risk_level: 'low' },
      { clause_number: '2.1', title: '服务内容', content: '乙方应按照附件A的约定提供专业咨询服务。', risk_level: 'medium' },
      { clause_number: '3.2', title: '付款条款', content: '甲方收到增值税专用发票后30个工作日内支付相应款项。', risk_level: 'high' },
      { clause_number: '5.1', title: '保密义务', content: '双方应对商业秘密承担保密义务，保密期5年。', risk_level: 'critical' },
      { clause_number: '8.3', title: '争议解决', content: '因本协议发生争议，协商不成向甲方所在地法院起诉。', risk_level: 'medium' },
      { clause_number: '10.1', title: '不可抗力', content: '因不可抗力导致无法履行的，不承担违约责任。', risk_level: 'medium' }
    ];
    const precheck1 = await post(`/contracts/${cid}/import-precheck`, { clauses: updatedClauses }, adminToken);
    assert(precheck1.total_input === 6, `预检输入 6 条`);
    assert(precheck1.new_count === 1, `预检新增 1 条`);
    assert(precheck1.update_count === 2, `预检更新 2 条`);
    assert(precheck1.skip_count === 3, `预检跳过 3 条`);
    assert(precheck1.blocked_count === 0, `预检阻止 0 条`);
    assert(precheck1.new_clauses[0].clause_number === '10.1', '新增条款为 10.1');
    const updateNums = precheck1.update_clauses.map(c => c.clause_number).sort();
    assert(updateNums.join(',') === '2.1,3.2', `更新条款为 2.1, 3.2`);
    log('✅ 预检功能测试通过');

    log('\n--- 测试 2：只补新条款模式 ---');
    const impAddOnly = await post(`/contracts/${cid}/import`, { mode: 'add_only', clauses: updatedClauses }, adminToken);
    assert(impAddOnly.import_mode === 'add_only', '导入模式为 add_only');
    assert(impAddOnly.new_count === 1, '只补新模式新增 1 条');
    assert(impAddOnly.update_count === 0, '只补新模式更新 0 条');
    assert(impAddOnly.skip_count === 5, '只补新模式跳过 5 条');
    const clause21 = await get(`/clauses?contract_id=${cid}`, adminToken).then(list => list.find(c => c.clause_number === '2.1'));
    assert(clause21.current_version === 1, '只补新模式下 2.1 版本号仍为 1');
    log('✅ 只补新条款模式测试通过');

    log('\n--- 测试 3：按编号更新模式 ---');
    const impUpdate = await post(`/contracts/${cid}/import`, {
      mode: 'update_by_number',
      clauses: updatedClauses.slice(1, 3)
    }, adminToken);
    assert(impUpdate.update_count === 2, '更新模式更新 2 条');
    assert(impUpdate.new_count === 0, '更新模式新增 0 条');
    const clause21v2 = await get(`/clauses?contract_id=${cid}`, adminToken).then(list => list.find(c => c.clause_number === '2.1'));
    assert(clause21v2.current_version === 2, '条款 2.1 版本号递增为 2');
    const versions21 = await get(`/clauses/${clause21v2.id}/versions`, adminToken);
    assert(versions21.length === 2, '条款 2.1 有 2 个历史版本');
    assert(versions21[0].change_summary === '导入更新', '最新版本变更摘要为"导入更新"');
    log('✅ 按编号更新模式测试通过');

    log('\n--- 测试 4：待处理建议阻止覆盖 ---');
    const clause32 = await get(`/clauses?contract_id=${cid}`, adminToken).then(list => list.find(c => c.clause_number === '3.2'));
    const sug = await post(`/clauses/${clause32.id}/suggestions`, {
      type: 'comment', content: '建议增加发票类型说明。',
      base_version: clause32.current_version, exclusive_role: 'all'
    }, bizToken);
    assert(sug.suggestion.status === 'pending', '创建的建议状态为 pending');

    const precheckBlocked = await post(`/contracts/${cid}/import-precheck`, {
      clauses: [{ clause_number: '3.2', title: '付款条款', content: '更新后的内容。', risk_level: 'high' }]
    }, adminToken);
    assert(precheckBlocked.blocked_count === 1, '预检阻止 1 条');
    assert(precheckBlocked.update_clauses[0].has_pending_suggestions === true, '检测到待处理建议');

    const impBlocked = await post(`/contracts/${cid}/import`, {
      mode: 'update_by_number',
      clauses: [{ clause_number: '3.2', title: '付款条款', content: '更新后的内容。', risk_level: 'high' }]
    }, adminToken);
    assert(impBlocked.block_count === 1, '阻止 1 条');
    assert(impBlocked.update_count === 0, '更新 0 条');
    const clause32AfterBlock = await get(`/clauses?contract_id=${cid}`, adminToken).then(list => list.find(c => c.clause_number === '3.2'));
    assert(clause32AfterBlock.current_version === 2, '被阻止后版本号仍为 2');
    log('✅ 待处理建议阻止覆盖测试通过');

    log('\n--- 测试 5：强制确认覆盖 ---');
    const impForce = await post(`/contracts/${cid}/import`, {
      mode: 'update_by_number',
      clauses: [{ clause_number: '3.2', title: '付款条款（修订）', content: '更新后的内容。', risk_level: 'high' }],
      confirm_overrides: [{ clause_number: '3.2', reason: '法务要求紧急更新' }]
    }, adminToken);
    assert(impForce.update_count === 1, '强制更新 1 条');
    assert(impForce.block_count === 0, '阻止 0 条');
    assert(impForce.updated[0].override_reason === '法务要求紧急更新', '记录了覆盖原因');
    const clause32v3 = await get(`/clauses?contract_id=${cid}`, adminToken).then(list => list.find(c => c.clause_number === '3.2'));
    assert(clause32v3.current_version === 3, '强制更新后版本号为 3');
    const versions32 = await get(`/clauses/${clause32v3.id}/versions`, adminToken);
    assert(versions32[0].change_summary.includes('导入覆盖'), '版本历史包含"导入覆盖"');
    assert(versions32[0].change_summary.includes('法务要求紧急更新'), '版本历史包含覆盖原因');
    log('✅ 强制确认覆盖测试通过');

    log('\n--- 测试 6：草稿阻止覆盖 ---');
    const clause1 = await get(`/clauses?contract_id=${cid}`, adminToken).then(list => list.find(c => c.clause_number === '1'));
    await post(`/clauses/${clause1.id}/drafts`, {
      type: 'amendment', content: '建议修改定义条款。',
      base_version: clause1.current_version,
      amended_title: '定义（修订）', amended_content: '修改后的定义。',
      risk_level: 'low', exclusive_role: 'all'
    }, bizToken);
    log('✅ 保存草稿成功');

    const precheckDraft = await post(`/contracts/${cid}/import-precheck`, {
      clauses: [{ clause_number: '1', title: '定义更新', content: '更新的定义内容。', risk_level: 'low' }]
    }, adminToken);
    assert(precheckDraft.blocked_count === 1, '草稿阻止 1 条');
    assert(precheckDraft.update_clauses[0].has_drafts === true, '检测到草稿');

    const impDraftOverride = await post(`/contracts/${cid}/import`, {
      mode: 'update_by_number',
      clauses: [{ clause_number: '1', title: '定义更新', content: '更新的定义内容。', risk_level: 'low' }],
      confirm_overrides: [{ clause_number: '1', reason: '合同整体修订' }]
    }, adminToken);
    assert(impDraftOverride.update_count === 1, '草稿条款成功更新');
    assert(impDraftOverride.updated[0].had_drafts === true, '记录了有草稿');
    const clause1v2 = await get(`/clauses?contract_id=${cid}`, adminToken).then(list => list.find(c => c.clause_number === '1'));
    assert(clause1v2.current_version === 2, '条款 1 版本号递增为 2');
    log('✅ 草稿阻止覆盖测试通过');

    log('\n--- 测试 7：审计日志记录 ---');
    const auditLogs = await get(`/reports/audit-logs?entity_type=contract&entity_id=${cid}&limit=100`, adminToken);
    const importLogs = auditLogs.filter(l => l.action === 'import_clauses');
    assert(importLogs.length >= 4, `至少 4 次导入操作记录 (实际: ${importLogs.length})`);
    const clauseUpdateLogs = auditLogs.filter(l => l.action === 'import_clause_update');
    assert(clauseUpdateLogs.length >= 3, `至少 3 条条款更新记录 (实际: ${clauseUpdateLogs.length})`);
    const clauseNewLogs = auditLogs.filter(l => l.action === 'import_clause_new');
    assert(clauseNewLogs.length === 6, `6 条条款新增记录 (实际: ${clauseNewLogs.length})`);
    const overrideLogs = clauseUpdateLogs.filter(l => l.details?.override_reason);
    assert(overrideLogs.length >= 2, `至少 2 条带覆盖原因的记录 (实际: ${overrideLogs.length})`);
    log('✅ 审计日志记录测试通过');

    log('\n--- 测试 8：导出评审包追溯 ---');
    const exportResp = await fetch(`${API}/reports/contract/${cid}/export`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const exportData = await exportResp.json();
    assert(!!exportData.contract, '导出包含合同信息');
    assert(exportData.clauses.length === 6, `导出包含 6 条条款 (实际: ${exportData.clauses.length})`);
    assert(exportData.audit_logs.length > 0, '导出包含审计日志');
    const importExportLogs = exportData.audit_logs.filter(l => l.action?.startsWith('import'));
    assert(importExportLogs.length > 0, '导出的审计日志包含导入操作');
    const c32Export = exportData.clauses.find(c => c.clause_number === '3.2');
    assert(c32Export.versions.length >= 3, `条款 3.2 至少有 3 个版本 (实际: ${c32Export.versions?.length})`);
    log('✅ 导出评审包追溯测试通过');

    log('\n--- 测试 9：数据持久化验证 ---');
    const dbPath = path.join(__dirname, 'data', 'contract-review.db');
    assert(fs.existsSync(dbPath), 'SQLite 数据文件存在');
    const fileSize = fs.statSync(dbPath).size;
    assert(fileSize > 0, '数据文件大小大于 0');
    log(`   SQLite 数据文件大小: ${fileSize} bytes`);
    log('✅ 数据持久化验证通过');

  } catch (e) {
    log(`\n❌ 测试异常: ${e.message}`);
    if (e.response?.data) {
      log(`   错误详情: ${JSON.stringify(e.response.data)}`);
    }
    testPassed = false;
  }

  if (testPassed) {
    log('\n=== 所有测试通过！===');
    log(`
  测试覆盖范围：
  1. ✅ 预检功能（新增/更新/跳过分类）
  2. ✅ 只补新条款模式 (add_only)
  3. ✅ 按编号更新模式
  4. ✅ 待处理建议阻止覆盖
  5. ✅ 强制确认覆盖（填写原因）
  6. ✅ 草稿阻止覆盖
  7. ✅ 审计日志记录
  8. ✅ 导出评审包追溯
  9. ✅ 数据持久化验证
`);
    // 延迟退出，避免 Node.js 在 Windows 上的崩溃问题
    setTimeout(() => process.exit(0), 500);
  } else {
    log('\n=== 部分测试失败 ===');
    setTimeout(() => process.exit(1), 500);
  }
}

run();
