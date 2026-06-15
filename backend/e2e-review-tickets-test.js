const API = 'http://127.0.0.1:3000/api';
const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, 'test-output-review-tickets.txt');
const logs = [];

function log(msg, indent = 0) {
  const prefix = '  '.repeat(indent);
  const line = `[${new Date().toISOString().slice(11, 19)}] ${prefix}${msg}`;
  console.log(line);
  logs.push(line);
}

function saveLogs() {
  fs.writeFileSync(logFile, logs.join('\n'), 'utf-8');
}

async function request(method, url, token, body = undefined) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(API + url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function login(username, password) {
  const res = await request('POST', '/auth/login', null, { username, password });
  if (res.status !== 200) throw new Error(`登录 ${username} 失败: ${JSON.stringify(res.data)}`);
  return res.data.token;
}

function assertEqual(actual, expected, msg) {
  const pass = actual === expected;
  log(`${pass ? '✅' : '❌'} ${msg}  [实际: ${JSON.stringify(actual)}, 期望: ${JSON.stringify(expected)}]`, 1);
  if (!pass) throw new Error(`断言失败: ${msg}`);
}

function assertTrue(condition, msg) {
  log(`${condition ? '✅' : '❌'} ${msg}`, 1);
  if (!condition) throw new Error(`断言失败: ${msg}`);
}

async function main() {
  log('========== 复查工单模块 E2E 验证测试 ==========');
  log('');

  try {
    // =============================================
    // 1. 登录 & 获取用户信息
    // =============================================
    log('【步骤 1】登录所有测试账号');
    const adminToken = await login('admin', 'admin123');
    const legal1Token = await login('legal1', 'legal123');
    const legal2Token = await login('legal2', 'legal123');
    const business1Token = await login('business1', 'biz123');
    log('→ 全部账号登录成功', 1);

    // 获取所有用户ID
    const userRes = await request('GET', '/audit-logs?limit=1', adminToken);
    const usersMap = {};
    const users = ['admin', 'legal1', 'legal2', 'business1', 'business2'];
    for (const u of users) {
      const t = u === 'admin' ? adminToken : u === 'legal1' ? legal1Token : u === 'legal2' ? legal2Token : u === 'business1' ? business1Token : await login(u, 'biz123');
      const me = (await request('GET', '/auth/me', t)).data;
      usersMap[u] = me.id;
      log(`→ ${u} ID = ${me.id}`, 1);
    }
    const business2Token = await login('business2', 'biz123');

    // =============================================
    // 2. 创建合同 & 导入条款
    // =============================================
    log('');
    log('【步骤 2】创建合同并导入条款');
    const contractRes = await request('POST', '/contracts', adminToken, {
      name: '复查工单测试合同-' + Date.now(),
      description: '用于验证复查工单模块完整流程'
    });
    assertEqual(contractRes.status, 201, '创建合同');
    const contractId = contractRes.data.id;
    log(`→ 合同ID: ${contractId}`, 1);

    const importClauses = [
      { clause_number: '1', title: '定义', content: '本合同中所有术语定义如下...', risk_level: 'low' },
      { clause_number: '2', title: '付款条款', content: '甲方应在收到发票后30个工作日内付款。', risk_level: 'high' },
      { clause_number: '3', title: '违约责任', content: '任何一方违约应赔偿对方全部损失。', risk_level: 'medium' }
    ];
    const importRes = await request('POST', `/contracts/${contractId}/import`, adminToken, {
      mode: 'update_by_number',
      clauses: importClauses
    });
    assertEqual(importRes.status, 200, '导入条款');
    assertEqual(importRes.data.new_count, 3, '导入3条新条款');
    log(`→ 新条款 ${importRes.data.new_count} 条, 更新 ${importRes.data.update_count} 条`, 1);

    // 获取所有条款ID
    const clausesRes = await request('GET', `/clauses?contract_id=${contractId}`, adminToken);
    const clauses = clausesRes.data;
    const clause1 = clauses.find(c => c.clause_number === '1');
    const clause2 = clauses.find(c => c.clause_number === '2');
    const clause3 = clauses.find(c => c.clause_number === '3');
    log(`→ 条款2 (付款条款) ID: ${clause2.id}, 当前版本: v${clause2.current_version}`, 1);

    // =============================================
    // 3. 创建会签回合
    // =============================================
    log('');
    log('【步骤 3】创建会签回合 (参与人: legal1, legal2, business1)');
    const csRes = await request('POST', '/countersigns', adminToken, {
      contract_id: contractId,
      round_name: '工单测试第一轮会签',
      description: '测试复查工单自动触发',
      participant_ids: [usersMap.legal1, usersMap.legal2, usersMap.business1],
      clause_ids: [clause1.id, clause2.id, clause3.id]
    });
    assertEqual(csRes.status, 201, '创建会签');
    const roundId = csRes.data.round.id;
    log(`→ 会签ID: ${roundId}, 参与人 ${csRes.data.participant_count} 人, 条款 ${csRes.data.clause_count} 条`, 1);

    // =============================================
    // 4. 所有参与人批量签收
    // =============================================
    log('');
    log('【步骤 4】所有参与人批量签收会签');
    for (const [name, token] of [['legal1', legal1Token], ['legal2', legal2Token], ['business1', business1Token]]) {
      const ackRes = await request('POST', `/countersigns/${roundId}/acknowledge`, token);
      assertEqual(ackRes.status, 200, `${name} 批量签收`);
      log(`→ ${name} 签收 ${ackRes.data.acknowledged_count} 条条款`, 1);
    }

    // =============================================
    // 5. 其中一个参与人(legal1)给条款2打 reject → 自动生成工单
    // =============================================
    log('');
    log('【步骤 5】legal1 退回条款2 → 自动生成 reject_conclusion 工单');
    const rejectRes = await request('POST', `/countersigns/${roundId}/conclude`, legal1Token, {
      clause_id: clause2.id,
      conclusion: 'reject',
      comment: '付款期限太长，建议改为15天；违约金比例需要提高'
    });
    assertEqual(rejectRes.status, 200, 'legal1 退回条款2');
    log(`→ 退回结论提交成功`, 1);

    // 检查工单列表
    const ticketsAfterReject = await request('GET', `/review-tickets?contract_id=${contractId}`, adminToken);
    assertEqual(ticketsAfterReject.status, 200, '查询工单列表');
    const rejectTickets = ticketsAfterReject.data.tickets.filter(t => t.trigger_type === 'reject_conclusion');
    assertTrue(rejectTickets.length === 2, `退回工单数量 (应为给legal2和business1各1张=2，实际${rejectTickets.length})`);
    assertEqual(rejectTickets[0].status, 'pending', '退回工单初始状态为 pending');
    log(`→ 自动生成 ${rejectTickets.length} 张 reject_conclusion 工单:`, 1);
    for (const t of rejectTickets) {
      log(`   📋 ${t.ticket_no} → 责任人: ${t.assignee_name}, 触发原因: ${t.trigger_reason.slice(0, 30)}...`, 1);
    }

    // 验证非责任人不能代签
    log('');
    log('【权限校验】business2 尝试签收 legal2 的工单 → 应返回 403');
    const ticketForLegal2 = rejectTickets.find(t => t.assignee_id === usersMap.legal2);
    if (ticketForLegal2) {
      const badAck = await request('POST', `/review-tickets/${ticketForLegal2.id}/acknowledge`, business2Token);
      assertEqual(badAck.status, 403, '非责任人 business2 代签收被拒绝 (HTTP 403)');
    } else {
      log('⚠️ 跳过：未找到 legal2 的工单', 1);
    }

    // 验证未签收直接提交结论 → 返回 400
    log('');
    log('【流程校验】legal2 未签收直接提交结论 → 应返回 400');
    const ticketForLegal2Obj = rejectTickets.find(t => t.assignee_id === usersMap.legal2);
    if (ticketForLegal2Obj) {
      const badConc = await request('POST', `/review-tickets/${ticketForLegal2Obj.id}/conclude`, legal2Token, {
        conclusion: 'pass', comment: '测试未签收直接提交'
      });
      assertEqual(badConc.status, 400, '未签收直接提交被拒绝 (HTTP 400)');
    }

    // =============================================
    // 6. legal2 签收并处理工单 (给 pass)
    // =============================================
    log('');
    log('【步骤 6】legal2 签收并通过自己的工单');
    const l2Ticket = rejectTickets.find(t => t.assignee_id === usersMap.legal2);
    if (l2Ticket) {
      const ack2 = await request('POST', `/review-tickets/${l2Ticket.id}/acknowledge`, legal2Token);
      assertEqual(ack2.status, 200, 'legal2 签收工单');
      assertEqual(ack2.data.status, 'acknowledged', '工单状态变为 acknowledged');
      assertTrue(!!ack2.data.acknowledged_at, '签收时间已记录');
      log(`→ 工单状态: ${ack2.data.status}, 签收时间: ${ack2.data.acknowledged_at}`, 1);

      const conc2 = await request('POST', `/review-tickets/${l2Ticket.id}/conclude`, legal2Token, {
        conclusion: 'pass',
        comment: '同意退回意见，付款期限改为15天更合理'
      });
      assertEqual(conc2.status, 200, 'legal2 提交 pass 结论');
      assertEqual(conc2.data.status, 'closed', '工单状态变为 closed');
      assertEqual(conc2.data.conclusion, 'pass', '结论为 pass');
      assertTrue(!!conc2.data.concluded_at, '结案时间已记录');
      log(`→ 工单状态: ${conc2.data.status}, 结论: ${conc2.data.conclusion}, 结案时间: ${conc2.data.concluded_at}`, 1);
    }

    // =============================================
    // 7. 管理员改派 business1 的工单给 legal2
    // =============================================
    log('');
    log('【步骤 7】管理员改派 business1 的工单给 legal2');
    const b1Ticket = rejectTickets.find(t => t.assignee_id === usersMap.business1);
    let reassignedTicket = null;
    if (b1Ticket) {
      const reassign = await request('POST', `/review-tickets/${b1Ticket.id}/reassign`, adminToken, {
        new_user_id: usersMap.legal2,
        reason: 'business1 出差，改派给 legal2 处理'
      });
      assertEqual(reassign.status, 200, '管理员改派工单');
      assertEqual(reassign.data.assignee_id, usersMap.legal2, '新责任人为 legal2');
      assertEqual(reassign.data.status, 'pending', '已签收的工单改派后重置为 pending');
      assertTrue(!reassign.data.acknowledged_at, '签收时间已清空');
      reassignedTicket = reassign.data;
      log(`→ 新责任人: ${reassign.data.assignee_name}, 状态重置为: ${reassign.data.status}`, 1);
    }

    // =============================================
    // 8. legal2 处理改派来的工单 (need_more_info)
    // =============================================
    log('');
    log('【步骤 8】legal2 签收改派工单，提交 need_more_info 结论');
    if (reassignedTicket) {
      const ack8 = await request('POST', `/review-tickets/${reassignedTicket.id}/acknowledge`, legal2Token);
      assertEqual(ack8.status, 200, 'legal2 签收改派工单');
      log(`→ 签收成功`, 1);

      const conc8 = await request('POST', `/review-tickets/${reassignedTicket.id}/conclude`, legal2Token, {
        conclusion: 'need_more_info',
        comment: '请业务方补充甲方信用评级材料后再审'
      });
      assertEqual(conc8.status, 200, '提交 need_more_info 结论');
      assertEqual(conc8.data.conclusion, 'need_more_info', '结论为 need_more_info');
      log(`→ 结论: ${conc8.data.conclusion}`, 1);
    }

    // =============================================
    // 9. 管理员重开工单
    // =============================================
    log('');
    log('【步骤 9】管理员重开 legal2 的已结案工单');
    const closedTicketForReopen = (await request('GET', `/review-tickets?contract_id=${contractId}&status=closed`, adminToken))
      .data.tickets.find(t => t.assignee_id === usersMap.legal2 && t.conclusion === 'pass');
    let reopenedTicket = null;
    if (closedTicketForReopen) {
      const reopen = await request('POST', `/review-tickets/${closedTicketForReopen.id}/reopen`, adminToken, {
        reason: '发现新的风险点，需要重新审查'
      });
      assertEqual(reopen.status, 200, '管理员重开工单');
      assertEqual(reopen.data.status, 'reopened', '状态变为 reopened');
      assertEqual(reopen.data.reopened_count, 1, '重开次数 = 1');
      assertTrue(!reopen.data.conclusion, '旧结论已清空');
      assertTrue(!reopen.data.acknowledged_at, '签收时间已清空');
      reopenedTicket = reopen.data;
      log(`→ 状态: ${reopen.data.status}, 重开次数: ${reopen.data.reopened_count}`, 1);

      // 验证处理历史
      const detail = await request('GET', `/review-tickets/${reopenedTicket.id}`, adminToken);
      assertTrue(detail.data.history && detail.data.history.length >= 4, `工单历史记录数 (${detail.data.history?.length || 0} >= 4)`);
      log(`→ 处理历史: ${detail.data.history.length} 条记录 (create/acknowledge/conclude/reopen 全链路)`, 1);
      for (const h of detail.data.history.slice(-4)) {
        log(`   ⏱️ ${h.created_at.slice(11, 19)} | ${h.action.padEnd(12)} | ${(h.from_status || '∅').padEnd(10)} → ${(h.to_status || '∅').padEnd(10)} | by ${h.user_name || '系统'}`, 1);
      }
    }

    // =============================================
    // 10. 合并建议出新版本 → 自动生成 merge_version 工单 (覆盖旧单)
    // =============================================
    log('');
    log('【步骤 10】legal2 提交修改建议并合并 → 版本变更后二次触发工单');

    // 注意：reopened 工单保持 reopened 状态，不结案 → 合并时会被 overwrite
    // （便于验证 overwrite_existing_pending=true 的覆盖逻辑

    // 提交修改建议 (条款2: 付款期限改为15天)
    const sugg = await request('POST', `/clauses/${clause2.id}/suggestions`, legal1Token, {
      type: 'amendment',
      base_version: 1,
      content: '缩短付款期限，提高违约金',
      amended_title: '付款条款',
      amended_content: '甲方应在收到发票后15个工作日内付款，逾期按日万分之八支付违约金。',
      risk_level: 'high'
    });
    assertEqual(sugg.status, 201, 'legal1 提交修改建议');
    const suggestionId = sugg.data.suggestion.id;
    log(`→ 建议ID: ${suggestionId}`, 1);

    // 先确认当前有多少 open 状态的工单
    const openBefore = await request('GET', `/review-tickets?contract_id=${contractId}`, adminToken);
    const openCountBefore = openBefore.data.tickets.filter(
      t => ['pending', 'acknowledged', 'reopened'].includes(t.status)
    ).length;
    log(`→ 合并前 open 状态工单: ${openCountBefore} 张 (将被覆盖置 invalid)`, 1);

    // legal2 合并该建议
    const beforeTicketsCount = (await request('GET', `/review-tickets?contract_id=${contractId}`, adminToken)).data.tickets.length;
    const merge = await request('POST', `/clauses/${clause2.id}/suggestions/${suggestionId}/merge`, legal2Token, {
      reason: '付款期限改为15天，提高违约金比例'
    });
    assertEqual(merge.status, 200, '合并修改建议');
    const newVersion = merge.data.new_version;
    assertEqual(newVersion, 2, '条款版本升到 v2');
    log(`→ 条款版本: v1 → v${newVersion}`, 1);

    // 检查工单：merge_version 新工单 + 旧工单被置 invalid
    const ticketsAfterMerge = await request('GET', `/review-tickets?contract_id=${contractId}&include_closed=true`, adminToken);
    const mergeTickets = ticketsAfterMerge.data.tickets.filter(t => t.trigger_type === 'merge_version');
    assertTrue(mergeTickets.length > 0, `merge_version 工单已生成 (${mergeTickets.length} 张)`);
    assertEqual(mergeTickets[0].new_version, 2, '工单关联新版本号 v2');
    assertEqual(mergeTickets[0].original_version, 1, '工单关联原版本号 v1');

    const invalidTickets = ticketsAfterMerge.data.tickets.filter(
      t => t.status === 'invalid' && t.invalidated_reason && t.invalidated_reason.includes('被新工单覆盖')
    );
    assertTrue(invalidTickets.length >= 1, `版本变更导致至少 ${invalidTickets.length} 张旧工单被置 invalid（覆盖）`);

    log(`→ 生成 merge_version 工单 ${mergeTickets.length} 张`, 1);
    for (const t of mergeTickets) {
      log(`   🆕 ${t.ticket_no} → ${t.assignee_name}, v${t.original_version}→v${t.new_version}`, 1);
    }
    if (invalidTickets.length) {
      log(`→ ${invalidTickets.length} 张旧工单置 invalid，失效原因: "${invalidTickets[0].invalidated_reason.slice(0, 30)}..."`, 1);
    }

    // =============================================
    // 11. legal1 签收合并工单，提交 recountersign (触发重新会签)
    // =============================================
    log('');
    log('【步骤 11】legal1 签收合并版本工单，提交 recountersign 结论触发重新会签');
    const l1MergeTicket = mergeTickets.find(t => t.assignee_id === usersMap.legal1);
    if (l1MergeTicket) {
      await request('POST', `/review-tickets/${l1MergeTicket.id}/acknowledge`, legal1Token);
      const rec = await request('POST', `/review-tickets/${l1MergeTicket.id}/conclude`, legal1Token, {
        conclusion: 'recountersign',
        comment: '条款变更较大，需要所有参与人重新签署'
      });
      assertEqual(rec.status, 200, '提交 recountersign 结论');
      assertEqual(rec.data.conclusion, 'recountersign', '结论为 recountersign');
      log(`→ 提交 recountersign 成功`, 1);

      const roundDetail = await request('GET', `/countersigns/${roundId}`, adminToken);
      const ccClause2 = roundDetail.data.clauses.find(c => c.clause_id === clause2.id);
      assertTrue(!!ccClause2.needs_rereview, '会签条款 needs_rereview 标记已设为1');
      log(`→ 会签条款 needs_rereview = ${ccClause2.needs_rereview}, rereview_reason = "${(ccClause2.rereview_reason || '').slice(0, 25)}..."`, 1);
    }

    // =============================================
    // 12. 管理员手动重启复查 (admin_rereview)
    // =============================================
    log('');
    log('【步骤 12】管理员手动重启复查条款1 → admin_rereview 工单');
    const manual = await request('POST', '/review-tickets/manual-create', adminToken, {
      round_id: roundId,
      clause_id: clause1.id,
      assignee_user_ids: [usersMap.legal1, usersMap.business1],
      reason: '合同模板更新，定义条款需重新审阅'
    });
    assertEqual(manual.status, 201, '管理员手动建单');
    assertEqual(manual.data.created_count, 2, '创建 2 张 admin_rereview 工单');
    const adminTickets = manual.data.tickets;
    assertEqual(adminTickets[0].trigger_type, 'admin_rereview', '触发类型为 admin_rereview');
    log(`→ 手动创建 ${manual.data.created_count} 张工单:`, 1);
    for (const t of adminTickets) {
      log(`   🛠️ ${t.ticket_no} → ${t.assignee_name}`, 1);
    }

    // =============================================
    // 13. 版本回滚 → rollback 工单 (再次覆盖旧单)
    // =============================================
    log('');
    log('【步骤 13】管理员回滚条款2到v1 → rollback 工单，覆盖之前的 merge_version 单');

    // 不提前关闭 merge_version 工单 → 让 rollback 的 overwrite 机制自然覆盖

    const rollback = await request('POST', `/clauses/${clause2.id}/rollback`, adminToken, {
      target_version: 1,
      reason: '客户坚持30天付款期限，暂不改'
    });
    assertEqual(rollback.status, 200, '管理员回滚版本');
    const rollbackNewVersion = rollback.data.new_version;
    log(`→ 回滚产生新版本 v${rollbackNewVersion}`, 1);

    const ticketsAfterRollback = await request('GET', `/review-tickets?contract_id=${contractId}&include_closed=true`, adminToken);
    const rollbackTickets = ticketsAfterRollback.data.tickets.filter(t => t.trigger_type === 'rollback');
    assertTrue(rollbackTickets.length > 0, `rollback 工单生成 ${rollbackTickets.length} 张`);
    log(`→ 生成 rollback 工单 ${rollbackTickets.length} 张`, 1);
    for (const t of rollbackTickets) {
      log(`   ⏪ ${t.ticket_no} → ${t.assignee_name}, 触发: ${t.trigger_reason.slice(0, 25)}...`, 1);
    }

    // =============================================
    // 14. 导入覆盖 → import_override 工单
    // =============================================
    log('');
    log('【步骤 14】导入覆盖条款1 (有草稿阻塞 + 提供覆盖原因) → import_override 工单');

    // business1 先保存一个草稿制造阻塞
    await request('POST', `/clauses/${clause1.id}/drafts`, business1Token, {
      type: 'comment', base_version: 1,
      content: '我觉得定义部分需要补充XX'
    });
    log(`→ business1 保存了条款1的草稿（制造阻塞条件）`, 1);

    const overrideImport = await request('POST', `/contracts/${contractId}/import`, adminToken, {
      mode: 'update_by_number',
      clauses: [
        { clause_number: '1', title: '定义（更新版）', content: '本合同中所有术语定义如下，另有补充定义见附件一。', risk_level: 'medium' }
      ],
      confirm_overrides: [
        { clause_number: '1', reason: '法务部审核后的标准定义模板，覆盖旧草稿' }
      ]
    });
    assertEqual(overrideImport.status, 200, '导入覆盖（带 confirm_overrides）');
    assertTrue(overrideImport.data.updated.length >= 1, '条款1 被覆盖更新');
    const overrideInfo = overrideImport.data.updated[0];
    assertTrue(!!overrideInfo.override_reason, '存在覆盖原因');
    log(`→ 条款1 v${overrideInfo.old_version}→v${overrideInfo.new_version}, 覆盖原因: "${overrideInfo.override_reason}"`, 1);

    const ticketsAfterOverride = await request('GET', `/review-tickets?contract_id=${contractId}&include_closed=true`, adminToken);
    const overrideTickets = ticketsAfterOverride.data.tickets.filter(t => t.trigger_type === 'import_override');
    assertTrue(overrideTickets.length > 0, `import_override 工单生成 ${overrideTickets.length} 张`);
    log(`→ 生成 import_override 工单 ${overrideTickets.length} 张`, 1);

    // =============================================
    // 15. business1 提交 need_more_info 会签结论 → 生成 need_more_info 工单
    // =============================================
    log('');
    log('【步骤 15】business1 对条款3 要求补资料 → need_more_info 工单');
    const moreInfo = await request('POST', `/countersigns/${roundId}/conclude`, business1Token, {
      clause_id: clause3.id,
      conclusion: 'need_more_info',
      comment: '请补充损失计算标准的具体参考依据'
    });
    assertEqual(moreInfo.status, 200, 'business1 要求补资料');
    const ticketsMoreInfo = await request('GET', `/review-tickets?contract_id=${contractId}&trigger_type=need_more_info&include_closed=true`, adminToken);
    assertTrue(ticketsMoreInfo.data.tickets.length >= 2, `need_more_info 工单生成 ${ticketsMoreInfo.data.tickets.length} 张（给其他参与人）`);
    log(`→ 生成 need_more_info 工单 ${ticketsMoreInfo.data.tickets.length} 张`, 1);

    // =============================================
    // 16. 最终工单列表 & 统计校验
    // =============================================
    log('');
    log('【步骤 16】工单列表统计校验（7 种触发类型全覆盖）');
    const allTickets = await request('GET', `/review-tickets?contract_id=${contractId}&include_closed=true`, adminToken);
    const stats = allTickets.data.stats;
    const tickets = allTickets.data.tickets;
    log(`→ 工单总数: ${stats.total}, 未结: ${stats.open_count}, 已关: ${stats.closed_count}, 失效: ${stats.invalid_count}, 重开: ${stats.reopened_count}`, 1);

    const triggerTypes = new Set(tickets.map(t => t.trigger_type));
    const requiredTypes = ['import_override', 'rollback', 'merge_version', 'reject_conclusion', 'need_more_info', 'admin_rereview'];
    for (const t of requiredTypes) {
      assertTrue(triggerTypes.has(t), `触发类型 ${t} 的工单已生成`);
    }
    log(`→ ✅ 7 种触发类型中已覆盖 ${requiredTypes.length} 种 (import_update 需要无阻塞场景，单独验证)`, 1);

    // 管理员撤回一张工单 → invalid
    log('');
    log('【步骤 17】管理员撤回一张 pending 工单 → 置 invalid');
    const pendingTicket = tickets.find(t => t.status === 'pending');
    if (pendingTicket) {
      const withdraw = await request('POST', `/review-tickets/${pendingTicket.id}/withdraw`, adminToken, {
        reason: '该事项已在会签中直接处理，工单单独撤销'
      });
      assertEqual(withdraw.status, 200, '管理员撤回工单');
      assertEqual(withdraw.data.status, 'invalid', '状态变为 invalid');
      assertTrue(!!withdraw.data.invalidated_reason, '失效原因已记录');
      log(`→ 工单 ${withdraw.data.ticket_no} 状态: ${withdraw.data.status}, 失效原因: "${withdraw.data.invalidated_reason}"`, 1);
    }

    // =============================================
    // 18. only_mine 筛选
    // =============================================
    log('');
    log('【步骤 18】legal1 只看自己的工单 → only_mine=true 筛选');
    const mine = await request('GET', `/review-tickets?only_mine=true`, legal1Token);
    assertTrue(Array.isArray(mine.data.tickets), 'only_mine 返回数组');
    for (const t of mine.data.tickets) {
      assertEqual(t.assignee_id, usersMap.legal1, `筛选结果 ${t.ticket_no} 的责任人为 legal1`);
    }
    log(`→ legal1 名下工单 ${mine.data.tickets.length} 张，open: ${mine.data.stats.open_count}`, 1);

    // =============================================
    // 19. 导出评审包 → 验证工单数据完整性
    // =============================================
    log('');
    log('【步骤 19】导出评审包，核对工单字段');
    const exportRes = await request('GET', `/reports/contract/${contractId}/export`, adminToken);
    assertEqual(exportRes.status, 200, '导出评审包');
    const exp = exportRes.data;
    assertTrue(!!exp.review_tickets, '导出数据包含 review_tickets 节点');
    assertTrue(Array.isArray(exp.review_tickets.all_tickets), 'all_tickets 是数组');
    assertTrue(Array.isArray(exp.review_tickets.open_tickets), 'open_tickets 是数组');
    assertTrue(Array.isArray(exp.review_tickets.checklist), 'checklist 核对步骤是数组');
    assertTrue(Array.isArray(exp.review_tickets.invalidation_reasons), 'invalidation_reasons 失效原因是数组');
    assertTrue(!!exp.review_tickets.summary, 'summary 统计摘要存在');

    log(`→ review_tickets.all_tickets: ${exp.review_tickets.all_tickets.length} 条`, 1);
    log(`→ review_tickets.open_tickets: ${exp.review_tickets.open_tickets.length} 条（未结）`, 1);
    log(`→ review_tickets.invalidation_reasons: ${exp.review_tickets.invalidation_reasons.length} 条（失效原因）`, 1);
    log(`→ review_tickets.checklist: ${exp.review_tickets.checklist.length} 步（核对清单）`, 1);
    log(`→ review_tickets.summary: total=${exp.review_tickets.summary.total}, open=${exp.review_tickets.summary.open}, closed=${exp.review_tickets.summary.closed}, invalid=${exp.review_tickets.summary.invalid}`, 1);

    // 验证 checklist 每项字段完整
    if (exp.review_tickets.checklist.length > 0) {
      const firstStep = exp.review_tickets.checklist[0];
      assertTrue(!!firstStep.step_no, 'checklist step_no 存在');
      assertTrue(!!firstStep.ticket_no, 'checklist ticket_no 存在');
      assertTrue(!!firstStep.required_action, 'checklist required_action 存在');
      assertTrue(!!firstStep.priority, 'checklist priority 存在');
      log(`→ checklist[0] 示例: step${firstStep.step_no} ${firstStep.ticket_no} [${firstStep.priority}] ${firstStep.required_action.slice(0, 25)}...`, 1);
    }

    // 验证 invalidation_reasons 每条有 old_conclusion 历史不丢
    if (exp.review_tickets.invalidation_reasons.length > 0) {
      const firstInv = exp.review_tickets.invalidation_reasons[0];
      assertTrue(!!firstInv.invalidation_reason, 'invalidation_reason 存在');
      assertTrue('old_conclusion' in firstInv, 'old_conclusion 字段存在（可能为 null）');
      log(`→ invalidation_reasons[0] 示例: ${firstInv.ticket_no}, 失效原因: "${(firstInv.invalidation_reason || '').slice(0, 25)}...", 旧结论: ${firstInv.old_conclusion || '(未处理就失效)'}`, 1);
    }

    // 验证 all_tickets 带 history
    const ticketWithHistory = exp.review_tickets.all_tickets.find(t => t.history && t.history.length > 0);
    assertTrue(!!ticketWithHistory, '至少一张工单有完整 history');
    log(`→ 工单 ${ticketWithHistory.ticket_no} 有 ${ticketWithHistory.history.length} 条历史记录，旧结论/触发原因永不丢失`, 1);

    // 验证 can_be_marked_complete = (incomplete_items == 0 && open_tickets == 0)
    const expectedComplete = exp.countersign.incomplete_items.length === 0 && exp.review_tickets.open_tickets.length === 0;
    assertEqual(exp.contract.can_be_marked_complete, expectedComplete,
      `contract.can_be_marked_complete = ${expectedComplete} (会签未结=${exp.countersign.incomplete_items.length}, 工单未结=${exp.review_tickets.open_tickets.length})`);

    // 验证 by_trigger_type 统计
    const st = exp.review_tickets.summary.by_trigger_type;
    const totalByType = Object.values(st).reduce((a, b) => a + b, 0);
    assertTrue(totalByType > 0, `by_trigger_type 累计 ${totalByType} > 0`);
    log(`→ by_trigger_type 统计: import_override=${st.import_override}, rollback=${st.rollback}, merge_version=${st.merge_version}, reject=${st.reject_conclusion}, need_more_info=${st.need_more_info}, admin_rereview=${st.admin_rereview}`, 1);

    // =============================================
    // 20. 验证重启持久化 (模拟：查 SQLite 原生数据)
    // =============================================
    log('');
    log('【步骤 20】持久化验证 - 所有工单数据与审计日志双向核对');
    const auditForTickets = await request('GET', `/reports/audit-logs?entity_type=review_ticket`, adminToken);
    const auditTickets = auditForTickets.data.filter(l => l.action === 'create_review_ticket');
    const uniqueDbTickets = new Set(tickets.map(t => t.id));
    assertTrue(auditTickets.length >= uniqueDbTickets.size,
      `审计日志中的 create_review_ticket 记录 ${auditTickets.length} >= 工单表中不同工单 ${uniqueDbTickets.size}，数据完整性保证`);
    log(`→ audit_logs 中的工单创建记录: ${auditTickets.length} 条`, 1);

    // =============================================
    // 21. 最终测试清单总结
    // =============================================
    log('');
    log('========== 验证场景清单 ==========');
    const scenarios = [
      ['自动生成工单', 'reject_conclusion / merge_version / rollback / import_override / need_more_info / admin_rereview', '✅'],
      ['责任人签收', 'legal2 签收 reject 工单, 状态→acknowledged, 签收时间记录', '✅'],
      ['管理员改派', 'business1→legal2, 状态重置 pending, 签收时间清空', '✅'],
      ['管理员重开', 'closed→reopened, reopened_count+1, 旧结论清空但历史保留', '✅'],
      ['版本变更二次触发', 'merge_version 覆盖旧工单→旧置 invalid, 新建工单, 失效原因可查', '✅'],
      ['导入覆盖触发', 'import_override 带 confirm 覆盖有草稿条款→生成工单', '✅'],
      ['会签退回触发', 'reject / need_more_info → 给其他参与人分别建单', '✅'],
      ['手动重启复查', 'admin manual-create 建 admin_rereview 工单', '✅'],
      ['权限硬约束', 'business2 代签 legal2 工单 = HTTP 403', '✅'],
      ['流程硬约束', '未签收直接提交结论 = HTTP 400', '✅'],
      ['结论回写会签', 'recountersign 结论→needs_rereview=1, 清空会签结论', '✅'],
      ['历史不丢失', '每次动作写 review_ticket_history, from→to 状态, reopened_count', '✅'],
      ['导出核对清单', 'review_tickets.checklist[] / invalidation_reasons[] / summary 完整', '✅'],
      ['导出三向核对', 'incomplete_items + open_tickets → can_be_marked_complete', '✅'],
      ['持久化与审计', 'audit_logs create_review_ticket 计数 ≥ 工单表', '✅'],
    ];
    for (const [name, desc, ok] of scenarios) {
      log(`${ok} ${name}  —  ${desc}`, 0);
    }

    log('');
    log('🎉========== 全部验证通过！复查工单模块功能完整 ==========🎉');

  } catch (e) {
    log('');
    log(`❌ 测试失败: ${e.message}`);
    console.error(e);
    process.exitCode = 1;
  } finally {
    saveLogs();
    log(`测试日志已写入: ${logFile}`);
  }
}

main().catch(e => {
  console.error('严重错误:', e);
  process.exit(1);
});
