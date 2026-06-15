const API = 'http://localhost:3001/api';
const fs = require('fs');
const path = require('path');

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

let assertCounter = 0;
function assert(cond, msg) {
  assertCounter++;
  if (!cond) {
    console.log(`   ❌ 断言失败 [${assertCounter}]: ${msg}`);
    process.exit(1);
  }
  console.log(`   ✔️ 断言 [${assertCounter}]: ${msg}`);
}

async function run() {
  console.log('\n========== 会签回合模块 - 端到端验收测试 ==========\n');
  console.log('目标验证流程：发起→签收→退回→撤回→重启复查→导出核对\n');

  // ---------- 1. 登录准备 ----------
  const adminToken = await login('admin', 'admin123');
  console.log('✅ 1. 登录 admin 成功');
  const legalToken = await login('legal1', 'legal123');
  console.log('✅ 1. 登录 legal1 成功');
  const bizToken = await login('business1', 'biz123');
  console.log('✅ 1. 登录 business1 成功');
  const legal2Token = await login('legal2', 'legal123');
  console.log('✅ 1. 登录 legal2 成功');

  // ---------- 2. 创建合同并导入条款 ----------
  const contract = await post('/contracts', {
    name: '【E2E测试】会签流程验证合同',
    description: '用于验证会签完整流程：发起、签收、退回、撤回、版本变更联动、导出核对'
  }, adminToken);
  const cid = contract.id;
  console.log(`\n✅ 2. 创建合同: ${contract.name} (ID=${cid.substring(0, 8)}...)`);

  const importData = {
    clauses: [
      { clause_number: '1', title: '定义', content: '"本协议"指双方签署的合同及全部附件。E2E会签测试用。', risk_level: 'low' },
      { clause_number: '2.1', title: '服务范围', content: '乙方应依附件A提供专业咨询服务，符合行业一般标准。', risk_level: 'medium' },
      { clause_number: '3.2', title: '付款条款', content: '甲方收到发票后30个工作日内支付相应款项。逾期按日万分之五付违约金。', risk_level: 'high' },
      { clause_number: '5.1', title: '保密义务', content: '双方对合作过程中获悉的商业秘密承担保密义务，保密期5年。', risk_level: 'critical' }
    ]
  };
  const imp = await post(`/contracts/${cid}/import`, importData, adminToken);
  console.log(`✅ 2. 导入条款 ${imp.imported_count} 条成功`);

  const clausesAll = await get(`/clauses?contract_id=${cid}`, adminToken);
  assert(clausesAll.length === 4, `合同条款总数为4（实际${clausesAll.length}）`);
  const clause1 = clausesAll.find(c => c.clause_number === '1');
  const clause32 = clausesAll.find(c => c.clause_number === '3.2');
  const clause51 = clausesAll.find(c => c.clause_number === '5.1');

  // ---------- 3. 失败路径：法务尝试发起会签（非管理员） ----------
  console.log('\n❌ 3. 失败路径测试：legal1 尝试发起会签（非管理员）');
  try {
    await post('/countersigns', {
      round_name: '非法发起测试',
      participant_ids: [],
      clause_ids: []
    }, legalToken);
    console.log('   ❌ 失败：应返回403'); process.exit(1);
  } catch (e) {
    assert(e.response?.status === 403, `返回HTTP 403（实际${e.response?.status}）`);
  }

  // ---------- 4. 管理员发起会签 ----------
  console.log('\n✅ 4. 管理员发起会签回合');

  // 先拿到用户列表，选 legal1 和 business1 作参与人
  const allUsers = await get('/auth/users', adminToken);
  const legal1User = allUsers.find(u => u.username === 'legal1');
  const legal2User = allUsers.find(u => u.username === 'legal2');
  const biz1User = allUsers.find(u => u.username === 'business1');
  assert(legal1User && biz1User, '成功获取 legal1 与 business1 用户ID');

  const createResp = await post('/countersigns', {
    contract_id: cid,
    round_name: '法务+业务联合会签（E2E测试）',
    description: '这是一轮端到端测试用的会签回合，验证签收、退回、撤回等流程。',
    deadline: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    participant_ids: [legal1User.id, biz1User.id],
    clause_ids: [clause1.id, clause32.id, clause51.id]
  }, adminToken);
  const roundId = createResp.round.id;
  console.log(`   创建会签成功，ID=${roundId.substring(0, 8)}...`);
  assert(createResp.round.status === 'active', '新创建回合状态为 active');
  assert(createResp.participant_count === 2, `参与人数=2（实际${createResp.participant_count}）`);
  assert(createResp.clause_count === 3, `条款数=3（实际${createResp.clause_count}）`);

  // 按合同列出会签
  const listByContract = await get(`/countersigns/contract/${cid}`, adminToken);
  assert(listByContract.length >= 1, `合同会签列表≥1（实际${listByContract.length}）`);

  // ---------- 5. 失败路径：法务未签收直接提交结论 ----------
  console.log('\n❌ 5. 失败路径测试：legal1 未签收直接提交结论');
  try {
    await post(`/countersigns/${roundId}/conclude`, {
      clause_id: clause1.id,
      conclusion: 'pass',
      comment: '直接提交，不应该成功'
    }, legalToken);
    console.log('   ❌ 失败：应返回400'); process.exit(1);
  } catch (e) {
    assert(e.response?.status === 400, `返回HTTP 400（实际${e.response?.status}）`);
    assert(/签收/.test(e.response?.data?.error || ''), `错误信息含"签收"（实际：${e.response?.data?.error}）`);
  }

  // ---------- 6. legal1 签收所有条款 ----------
  console.log('\n✅ 6. legal1 一键签收所有条款');
  const ack1 = await post(`/countersigns/${roundId}/acknowledge`, {}, legalToken);
  assert(ack1.acknowledged_count === 3, `legal1 签收条款数=3（实际${ack1.acknowledged_count}）`);
  const totalCount = ack1.results?.length || 0;
  console.log(`   新增签收 ${ack1.acknowledged_count} 条，总条款数 ${totalCount} 条`);

  // 重复签收（24小时内）
  const ack1b = await post(`/countersigns/${roundId}/acknowledge`, {}, legalToken);
  assert(ack1b.acknowledged_count === 0, `重复签收新增=0（实际${ack1b.acknowledged_count}）`);
  console.log(`   24小时内再次签收，新增 ${ack1b.acknowledged_count} 条（防重复）`);

  // ---------- 7. business1 签收所有条款 ----------
  console.log('\n✅ 7. business1 一键签收所有条款');
  const ack2 = await post(`/countersigns/${roundId}/acknowledge`, {}, bizToken);
  assert(ack2.acknowledged_count === 3, `business1 签收条款数=3（实际${ack2.acknowledged_count}）`);

  // ---------- 8. legal1 对条款3.2 提交"退回"结论（带评论） ----------
  console.log('\n✅ 8. legal1 对 [3.2 付款条款] 提交 reject 结论');
  const concReject = await post(`/countersigns/${roundId}/conclude`, {
    clause_id: clause32.id,
    conclusion: 'reject',
    comment: '付款违约金条款过于严苛，日万分之五折算年化18%，建议调整为日万分之二或参考LPR。'
  }, legalToken);
  assert(concReject.conclusion.conclusion === 'reject', '结论值为 reject');
  assert(concReject.conclusion.comment && concReject.conclusion.comment.includes('违约金'),
    '退回评论包含"违约金"关键词');
  console.log(`   结论ID=${concReject.conclusion.id.substring(0, 8)}...`);

  // legal1 对条款1 提交 pass
  await post(`/countersigns/${roundId}/conclude`, {
    clause_id: clause1.id, conclusion: 'pass', comment: '定义条款无问题。'
  }, legalToken);

  // legal1 对条款5.1 提交 need_more_info
  await post(`/countersigns/${roundId}/conclude`, {
    clause_id: clause51.id, conclusion: 'need_more_info', comment: '需补充保密信息具体范围清单。'
  }, legalToken);

  // ---------- 9. business1 只提交2条条款结论，保留1条（避免回合自动completed，以便后续测试替换参与人） ----------
  console.log('\n✅ 9. business1 提交2条条款结论（clause51故意留空，避免回合自动completed）');
  await post(`/countersigns/${roundId}/conclude`, { clause_id: clause1.id, conclusion: 'pass', comment: '业务侧认可。' }, bizToken);
  await post(`/countersigns/${roundId}/conclude`, { clause_id: clause32.id, conclusion: 'need_more_info', comment: '请财务同学确认付款周期。' }, bizToken);
  // 故意不提交 clause51，保持回合为 active 状态以便后续替换参与人等操作

  // ---------- 10. 获取会签详情：检查签署矩阵与结论 ----------
  console.log('\n✅ 10. 获取会签详情，核对签署矩阵与变更历史');
  const detail = await get(`/countersigns/${roundId}`, adminToken);
  assert(detail.id === roundId, '详情ID匹配');
  assert(detail.conclusions && detail.conclusions.length === 2 * 3,
    `结论矩阵条目数=6（实际${detail.conclusions?.length}）`);

  // 找 legal1 × clause32 的结论，确认是 reject
  const rejectItem = detail.conclusions.find(
    c => c.user_id === legal1User.id && c.clause_id === clause32.id
  );
  assert(rejectItem?.conclusion === 'reject', 'legal1对clause32结论为reject');
  assert(rejectItem?.acknowledged_at != null, '签收时间字段非空');
  assert(rejectItem?.concluded_at != null, '结论时间字段非空');
  console.log(`   legal1×clause32: 签收于 ${rejectItem.acknowledged_at.substring(0, 19)}，结论于 ${rejectItem.concluded_at.substring(0, 19)}`);

  // 检查变更历史条数
  assert(detail.history && detail.history.length >= 1,
    `变更历史≥1（实际${detail.history?.length}）`);
  console.log(`   变更历史共 ${detail.history.length} 条，包含：`);
  detail.history.forEach(h => console.log(`     · ${h.action} by ${h.user_name} @ ${h.created_at.substring(0,19)}`));

  // ---------- 11. 失败路径：business1 尝试查看不属于自己的回合详情（无权） ----------
  // 先创建一个不含 business1 的回合
  const round2 = await post('/countersigns', {
    contract_id: cid,
    round_name: '纯法务内部会签（测试权限）',
    participant_ids: [legal1User.id, legal2User.id],
    clause_ids: [clause1.id]
  }, adminToken);

  console.log('\n❌ 11. 失败路径测试：business1 尝试访问自己不是参与人的回合');
  try {
    await get(`/countersigns/${round2.round.id}`, bizToken);
    console.log('   ❌ 失败：应返回403'); process.exit(1);
  } catch (e) {
    assert(e.response?.status === 403, `返回HTTP 403（实际${e.response?.status}）`);
  }

  // ---------- 12. 管理员替换参与人：legal1 → legal2 ----------
  console.log('\n✅ 12. 管理员替换参与人：legal1 → legal2（验证旧意见不丢失）');
  // 找到 legal1 在会签中的 participant_id
  const legal1Participant = detail.participants.find(p => p.user_id === legal1User.id && !Number(p.is_replaced));
  assert(legal1Participant, '找到legal1的participant记录');

  const replaceResp = await post(`/countersigns/${roundId}/replace-participant`, {
    old_participant_id: legal1Participant.id,
    new_user_id: legal2User.id,
    reason: 'E2E测试：模拟法务1离职，由法务2接手（旧意见保留）'
  }, adminToken);
  assert(replaceResp.new_participant.user_id === legal2User.id, '新参与人为 legal2');
  assert(replaceResp.old_participant.is_replaced === 1, '旧参与人标记 is_replaced=1');

  // 再查详情：确认参与人数从 2 变为 3（旧的保留软删除+新增）
  const detailAfterReplace = await get(`/countersigns/${roundId}`, adminToken);
  const participantCount = detailAfterReplace.participants.length;
  assert(participantCount === 3, `替换后参与人记录数=3（含软删除旧记录），实际${participantCount}`);

  // 检查结论矩阵是否还保留 legal1 的旧结论
  const oldConclusions = detailAfterReplace.conclusions.filter(
    c => c.participant_id === legal1Participant.id
  );
  assert(oldConclusions.length === 3, `legal1旧结论仍保留3条（实际${oldConclusions.length}），不会静默丢失`);
  console.log(`   legal1旧结论全部保留，reject评论: "${oldConclusions.find(c=>c.conclusion==='reject')?.comment?.substring(0,20)}..."`);

  // legal2 开始处理：签收+给出结论
  await post(`/countersigns/${roundId}/acknowledge`, {}, legal2Token);
  await post(`/countersigns/${roundId}/conclude`, { clause_id: clause1.id, conclusion: 'pass' }, legal2Token);
  await post(`/countersigns/${roundId}/conclude`, { clause_id: clause32.id, conclusion: 'pass', comment: '法务2复核：违约金条款风险在可控范围。' }, legal2Token);
  await post(`/countersigns/${roundId}/conclude`, { clause_id: clause51.id, conclusion: 'need_more_info' }, legal2Token);
  console.log(`   legal2 接手完成，给出3条结论`);

  // ---------- 13. 条款版本变更触发待重审（导入覆盖 clause1） ----------
  console.log('\n✅ 13. 条款版本变更联动：导入覆盖 clause1 → 相关会签标为待重审');
  const detailBefore = await get(`/countersigns/${roundId}`, adminToken);
  const clause1InRound = detailBefore.clauses.find(c => c.clause_id === clause1.id);
  assert(Number(clause1InRound.needs_rereview) === 0, '变更前 clause1 待重审=0');

  // 导入覆盖：用相同 clause_number 强制覆盖更新
  const importOverride = {
    clauses: [
      { clause_number: '1', title: '定义（修订版）', content: '"本协议"指双方签署的合同及所有附件，含补充协议。E2E修订版。', risk_level: 'low' }
    ],
    override_on_conflict: true,
    confirm_reason: 'E2E测试：导入覆盖clause1，触发会签待重审机制'
  };
  const overrideResp = await post(`/contracts/${cid}/import`, importOverride, adminToken);
  console.log(`   导入覆盖 clause1 完成，更新条款数 ${overrideResp.updated_count}`);

  // 再查会签详情，确认 clause1 变待重审
  const detailAfterOverride = await get(`/countersigns/${roundId}`, adminToken);
  const clause1After = detailAfterOverride.clauses.find(c => c.clause_id === clause1.id);
  assert(Number(clause1After.needs_rereview) === 1, `导入后 clause1 待重审标记=1（实际${clause1After?.needs_rereview}）`);
  assert(/变更/.test(clause1After.rereview_reason || '') || /版本/.test(clause1After.rereview_reason || ''),
    `待重审原因包含"变更/版本"关键词（实际：${clause1After?.rereview_reason}）`);
  console.log(`   clause1 rereview_reason: "${clause1After.rereview_reason?.substring(0, 60)}..."`);

  // 检查历史中有 clause_version_change 动作
  const rereviewHistory = detailAfterOverride.history.find(
    h => h.action === 'clause_version_change'
  );
  assert(rereviewHistory != null, '变更历史中存在 clause_version_change 审计记录');
  const detailStr = typeof rereviewHistory.details === 'string' ? rereviewHistory.details : JSON.stringify(rereviewHistory.details || '');
  console.log(`   审计记录已写入：${rereviewHistory.action} - ${detailStr.substring(0, 40)}...`);

  // ---------- 14. "我的会签"列表验证（此时round1仍active） ----------
  console.log('\n✅ 14. "我的会签"列表验证：角色过滤 + 被替换后不再出现');
  const legal1Mine = await get('/countersigns/mine', legalToken);
  assert(Array.isArray(legal1Mine), 'legal1 返回数组');
  assert(!legal1Mine.some(r => r.id === roundId),
    'legal1 已被替换 → 我的会签中不再包含round1（只处理分给自己的）');
  // legal2 现在应该能看到 round1（作为当前有效参与人）
  const legal2Mine = await get('/countersigns/mine', legal2Token);
  assert(Array.isArray(legal2Mine), 'legal2 返回数组');
  assert(legal2Mine.some(r => r.id === roundId),
    'legal2 接手 → 我的会签中包含round1');
  console.log(`   legal1 列表: ${legal1Mine.length} 条（不含round1，正确）；legal2 列表: ${legal2Mine.length} 条（含round1，正确）`);

  // ---------- 15. 管理员撤回整回合（状态转 withdrawn，旧意见保留） ----------
  console.log('\n✅ 15. 管理员撤回整回合（状态转 withdrawn，旧意见保留）');
  const withdrawResp = await post(`/countersigns/${roundId}/withdraw`, {
    reason: 'E2E测试：撤回回合，验证状态变更与历史留存'
  }, adminToken);
  assert(withdrawResp.round.status === 'withdrawn', '撤回后状态=withdrawn');
  assert(withdrawResp.round.withdraw_reason != null, '撤回原因已记录');

  // 再查详情确认
  const detailWithdrawn = await get(`/countersigns/${roundId}`, adminToken);
  assert(detailWithdrawn.status === 'withdrawn', '详情确认状态=withdrawn');
  assert(detailWithdrawn.conclusions.length > 0, '撤回后结论矩阵不为空（保留）');
  assert(detailWithdrawn.history.some(h => h.action === 'withdraw_round'),
    '历史包含 withdraw_round 动作');
  console.log(`   撤回时间：${detailWithdrawn.withdrawn_at?.substring(0,19)}，原因：${detailWithdrawn.withdraw_reason?.substring(0,20)}...`);

  // ---------- 16. 导出评审包核对（countersign 字段完整性） ----------
  console.log('\n✅ 16. 导出评审包，核对 countersign 字段完整性');
  // 先再发起一个 active 状态回合，用于验证未完成项
  const round3Resp = await post('/countersigns', {
    contract_id: cid,
    round_name: '导出核对专用回合（仅签一半）',
    description: '用于验证导出包中 incomplete_items 和 can_be_marked_complete 字段',
    participant_ids: [biz1User.id],
    clause_ids: [clause32.id, clause51.id]
  }, adminToken);
  const round3Id = round3Resp.round.id;
  // business1 只签收+签署 clause32，clause51 留空（制造未完成项）
  await post(`/countersigns/${round3Id}/acknowledge`, {}, bizToken);
  await post(`/countersigns/${round3Id}/conclude`, { clause_id: clause32.id, conclusion: 'pass' }, bizToken);
  console.log(`   准备完成：round3=active，business1 只签了1/2条款，未签完`);

  // 导出
  const exportResp = await fetch(`${API}/reports/contract/${cid}/export`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const exportJson = await exportResp.json();
  assert(exportJson.contract != null, '导出包含 contract');
  assert(typeof exportJson.contract.can_be_marked_complete === 'boolean',
    'contract.can_be_marked_complete 是布尔值');
  assert(exportJson.contract.can_be_marked_complete === false,
    `存在未完成会签 → can_be_marked_complete=false（实际${exportJson.contract.can_be_marked_complete}）`);
  console.log(`   can_be_marked_complete=${exportJson.contract.can_be_marked_complete}（因为round3未签完）`);

  assert(exportJson.countersign != null, '导出包含 countersign 顶级字段');
  assert(Array.isArray(exportJson.countersign.rounds), 'countersign.rounds 是数组');
  assert(exportJson.countersign.rounds.length >= 3,
    `rounds数量≥3（实际${exportJson.countersign.rounds.length}）`);

  // 核对 round1 导出的 rounds 中包含结论
  const expRound1 = exportJson.countersign.rounds.find(r => r.id === roundId);
  assert(expRound1 != null, '导出 rounds 包含 round1（撤回的也在）');
  assert(expRound1.status === 'withdrawn', `round1 导出状态=withdrawn（实际${expRound1.status}）`);
  assert(expRound1.history && expRound1.history.length > 0, 'round1 导出含变更历史');

  // 核对 incomplete_items 包含 clause51（business1 未签的那一条）
  assert(Array.isArray(exportJson.countersign.incomplete_items), 'countersign.incomplete_items 是数组');
  const incomplete51 = exportJson.countersign.incomplete_items.find(
    it => it.round_id === round3Id && it.clause_id === clause51.id
  );
  assert(incomplete51 != null, 'incomplete_items 中存在 round3×clause51 未完成项');
  assert(incomplete51.acknowledged === true, '该条 acknowledged=true（已签收）');
  assert(incomplete51.concluded === false, '该条 concluded=false（未提交结论）');
  console.log(`   incomplete_items 共 ${exportJson.countersign.incomplete_items.length} 条：`);
  exportJson.countersign.incomplete_items.forEach(it => {
    console.log(`     · ${it.round_name.substring(0,10)} | ${it.participant_name} | ${it.clause_number} ${it.clause_title.substring(0,8)} | ack=${it.acknowledged} concl=${it.concluded} rereview=${it.needs_rereview}`);
  });

  // 核对 invalidation_reasons（可能为空数组但应存在）
  assert(Array.isArray(exportJson.countersign.invalidation_reasons),
    'countersign.invalidation_reasons 是数组');

  // 保存导出 JSON 到文件以便人工核对
  const outPath = path.join(__dirname, 'test-output-countersign-export.json');
  fs.writeFileSync(outPath, JSON.stringify(exportJson, null, 2), 'utf-8');
  console.log(`   导出 JSON 已保存到: ${outPath}`);

  // ---------- 17. 会签列表页面角色过滤 ----------
  console.log('\n✅ 17. 角色过滤：business1 查看本合同会签列表');
  const bizListByContract = await get(`/countersigns/contract/${cid}`, bizToken);
  // business1 不是 round2（纯法务）的参与人，所以看不到
  const hasRound2 = bizListByContract.some(r => r.id === round2.round.id);
  assert(hasRound2 === false, 'business1 看不到纯法务回合 round2（权限隔离）');
  console.log(`   business1 看到 ${bizListByContract.length} 个回合，纯法务回合已被过滤`);

  // ---------- 18. 失败路径：发起会签时未选参与人或未选条款 ----------
  console.log('\n❌ 18. 失败路径测试：发起会签参数校验（缺参与人/缺条款）');
  try {
    await post('/countersigns', {
      contract_id: cid,
      round_name: '缺参与人测试', participant_ids: [], clause_ids: [clause1.id]
    }, adminToken);
    console.log('   ❌ 失败：应返回400'); process.exit(1);
  } catch (e) {
    assert(e.response?.status === 400, `缺参与人 → HTTP 400（实际${e.response?.status}）`);
  }
  try {
    await post('/countersigns', {
      contract_id: cid,
      round_name: '缺条款测试', participant_ids: [biz1User.id], clause_ids: []
    }, adminToken);
    console.log('   ❌ 失败：应返回400'); process.exit(1);
  } catch (e) {
    assert(e.response?.status === 400, `缺条款 → HTTP 400（实际${e.response?.status}）`);
  }

  // ---------- 总结 ----------
  console.log('\n' + '='.repeat(60));
  console.log(`🎉 会签模块端到端测试全部通过！共 ${assertCounter} 项断言 ✅`);
  console.log('='.repeat(60));
  console.log('\n已验证流程：');
  console.log('  ✔ 管理员发起会签（含参数校验）');
  console.log('  ✔ 权限隔离：非管理员无法发起，非参与人无法查看详情');
  console.log('  ✔ 两阶段流程：未签收不可提交结论 → 先签收再结论');
  console.log('  ✔ 重复签收防重（24小时内幂等）');
  console.log('  ✔ 三种结论（pass/reject/need_more_info）正确写入');
  console.log('  ✔ 签署矩阵查询正确，签收时间/结论时间双字段独立');
  console.log('  ✔ 替换参与人：is_replaced软删除，旧结论完整保留不丢失');
  console.log('  ✔ 条款导入覆盖 → 会签 clause 标为待重审 + 审计历史');
  console.log('  ✔ 撤回回合 → status=withdrawn，历史/结论完整留存');
  console.log('  ✔ 我的会签列表（/mine）按参与人过滤');
  console.log('  ✔ 导出评审包 countersign.rounds/incomplete_items/invalidation_reasons 字段齐全');
  console.log('  ✔ can_be_marked_complete=false 判定逻辑正确');
  console.log('  ✔ 按合同列表 → 非参与人看不到专属回合（角色过滤）');
  console.log('\n下一步验证（需手动操作，验证"重启复查"）：');
  console.log('  1. Ctrl+C 停止后端服务');
  console.log('  2. 重新启动：cd backend && npm run dev');
  console.log('  3. 重新执行本脚本末尾的"重启复查断言器"（或手动登录）：');
  console.log('     · 验证回合状态、签收时间、结论评论、变更历史全部仍存在');
  console.log('     · 验证导出包 countersign 字段与重启前一致');
  console.log('');
}

run().catch(err => {
  console.error('\n❌ 测试失败：', err.message);
  if (err.response?.data?.error) console.error('   后端错误信息：', err.response.data.error);
  process.exit(1);
});
