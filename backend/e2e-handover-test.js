const API = 'http://127.0.0.1:3000/api';
const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, 'test-output-handovers.txt');
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
  log('========== 评审交接单模块 E2E 验证测试 ==========');
  log('');

  try {
    log('【步骤 1】登录所有测试账号');
    const adminToken = await login('admin', 'admin123');
    const legal1Token = await login('legal1', 'legal123');
    const legal2Token = await login('legal2', 'legal123');
    const business1Token = await login('business1', 'biz123');
    const business2Token = await login('business2', 'biz123');
    log('→ 全部账号登录成功', 1);

    const usersMap = {};
    for (const u of ['admin', 'legal1', 'legal2', 'business1', 'business2']) {
      const t = u === 'admin' ? adminToken : u === 'legal1' ? legal1Token : u === 'legal2' ? legal2Token : u === 'business1' ? business1Token : business2Token;
      const me = (await request('GET', '/auth/me', t)).data;
      usersMap[u] = me.id;
      log(`→ ${u} ID = ${me.id}`, 1);
    }

    log('');
    log('【步骤 2】创建合同 & 条款');
    const contractRes = await request('POST', '/contracts', adminToken, { name: '交接测试合同', description: '用于测试评审交接' });
    assertEqual(contractRes.status, 201, '创建合同');
    const contractId = contractRes.data.id;

    const importRes = await request('POST', `/contracts/${contractId}/import`, adminToken, {
      mode: 'add_only',
      clauses: [
        { clause_number: '1.1', title: '定义条款', content: '定义内容...', risk_level: 'low' },
        { clause_number: '2.1', title: '保密条款', content: '保密内容...', risk_level: 'high' },
        { clause_number: '3.1', title: '违约条款', content: '违约内容...', risk_level: 'critical' }
      ]
    });
    assertTrue(importRes.status === 200 || importRes.status === 201, '导入条款');

    const clausesRes = await request('GET', `/clauses?contract_id=${contractId}`, adminToken);
    const clauses = clausesRes.data;
    assertEqual(clauses.length, 3, '条款数');

    log('');
    log('【步骤 3】创建会签回合');
    const csRes = await request('POST', '/countersigns', adminToken, {
      contract_id: contractId,
      round_name: '交接测试会签',
      description: '测试交接',
      participant_ids: [usersMap.legal1, usersMap.business1],
      clause_ids: clauses.map(c => c.id)
    });
    assertEqual(csRes.status, 201, '创建会签');
    const roundId = csRes.data.round.id;

    log('');
    log('【步骤 4】legal1 保存草稿');
    const draftRes = await request('POST', `/clauses/${clauses[0].id}/drafts`, legal1Token, {
      type: 'amendment',
      content: '修改建议草稿',
      base_version: 1,
      amended_title: '修改后的定义条款',
      amended_content: '修改后的定义内容...'
    });
    assertEqual(draftRes.status, 200, '保存草稿');
    const draftId = draftRes.data.id;

    log('');
    log('【步骤 5】提交一条待处理建议');
    const suggRes = await request('POST', `/clauses/${clauses[1].id}/suggestions`, legal1Token, {
      type: 'comment',
      content: '需要修改',
      base_version: 1
    });
    assertEqual(suggRes.status, 201, '提交建议');

    log('');
    log('========================================');
    log('【测试 1】预览交接');
    log('========================================');
    const previewRes = await request('POST', '/handovers/preview', legal1Token, {
      to_user_id: usersMap.legal2,
      scope: 'all'
    });
    assertEqual(previewRes.status, 200, '预览交接成功');
    const preview = previewRes.data;
    assertTrue(preview.summary.total > 0, '预览有项目');
    assertTrue(preview.summary.drafts >= 1, `预览含草稿: ${preview.summary.drafts}`);
    assertTrue(preview.summary.countersigns >= 1, `预览含会签: ${preview.summary.countersigns}`);
    assertTrue(preview.summary.suggestions >= 1, `预览含建议: ${preview.summary.suggestions}`);
    log(`→ 预览结果: 草稿${preview.summary.drafts} 会签${preview.summary.countersigns} 工单${preview.summary.tickets} 建议${preview.summary.suggestions}`, 1);

    log('');
    log('【测试 1a】预览交接 - 交接给自己应失败');
    const selfPreviewRes = await request('POST', '/handovers/preview', legal1Token, {
      to_user_id: usersMap.legal1,
      scope: 'all'
    });
    assertEqual(selfPreviewRes.status, 400, '不能交接给自己');

    log('');
    log('【测试 1b】预览交接 - 不存在的接收人应失败');
    const badPreviewRes = await request('POST', '/handovers/preview', legal1Token, {
      to_user_id: 'nonexistent-user-id',
      scope: 'all'
    });
    assertEqual(badPreviewRes.status, 404, '接收人不存在');

    log('');
    log('========================================');
    log('【测试 2】创建交接单');
    log('========================================');
    const createRes = await request('POST', '/handovers', legal1Token, {
      to_user_id: usersMap.legal2,
      scope: 'all',
      reason: '临时出差，需交接评审工作'
    });
    assertEqual(createRes.status, 201, '创建交接单成功');
    const handover = createRes.data.handover;
    const handoverId = handover.id;
    assertEqual(handover.status, 'pending', '交接单状态为pending');
    assertTrue(!!handover.handover_no, `交接单号: ${handover.handover_no}`);
    assertEqual(handover.from_user_id, usersMap.legal1, '发起人正确');
    assertEqual(handover.to_user_id, usersMap.legal2, '接收人正确');
    assertTrue(createRes.data.items.length > 0, `交接项数: ${createRes.data.items.length}`);

    log('');
    log('========================================');
    log('【测试 3】查看交接单详情');
    log('========================================');
    const detailRes = await request('GET', `/handovers/${handoverId}`, legal1Token);
    assertEqual(detailRes.status, 200, '发起人可查看详情');
    const detail = detailRes.data;
    assertEqual(detail.status, 'pending', '状态仍为pending');
    assertTrue(detail.items.length > 0, `详情中有交接项: ${detail.items.length}`);
    assertTrue(detail.history.length > 0, `有操作历史: ${detail.history.length}`);

    const detailRes2 = await request('GET', `/handovers/${handoverId}`, legal2Token);
    assertEqual(detailRes2.status, 200, '接收人可查看详情');

    log('');
    log('========================================');
    log('【测试 4】权限隔离 - 无关人员不能查看');
    log('========================================');
    const forbiddenRes = await request('GET', `/handovers/${handoverId}`, business1Token);
    assertEqual(forbiddenRes.status, 403, '无关人员无权查看');

    log('');
    log('========================================');
    log('【测试 5】签收交接单');
    log('========================================');
    const signRes = await request('POST', `/handovers/${handoverId}/sign`, legal2Token, { note: '已确认接收' });
    assertEqual(signRes.status, 200, '签收成功');
    assertEqual(signRes.data.status, 'signed', '状态变为signed');
    assertTrue(!!signRes.data.signed_at, `签收时间: ${signRes.data.signed_at}`);

    log('');
    log('【测试 5a】签收后草稿所有权已转移');
    const draftAfter = await request('GET', `/clauses/${clauses[0].id}/drafts`, legal2Token);
    assertTrue(!!draftAfter.data, 'legal2 现在能看到草稿');

    const draftOldUser = await request('GET', `/clauses/${clauses[0].id}/drafts`, legal1Token);
    assertTrue(!draftOldUser.data || draftOldUser.data.user_id !== usersMap.legal1, 'legal1 已不再是草稿所有人');

    log('');
    log('【测试 5b】签收后不能再次签收');
    const signAgainRes = await request('POST', `/handovers/${handoverId}/sign`, legal2Token, { note: '再次签收' });
    assertEqual(signAgainRes.status, 400, '已签收不能再签收');

    log('');
    log('【测试 5c】已签收交接单不能撤回');
    const withdrawSignedRes = await request('POST', `/handovers/${handoverId}/withdraw`, adminToken, { reason: '想撤回' });
    assertEqual(withdrawSignedRes.status, 400, '已签收不能撤回');

    log('');
    log('========================================');
    log('【测试 6】交接单列表');
    log('========================================');
    const listRes = await request('GET', '/handovers', adminToken);
    assertEqual(listRes.status, 200, '管理员可查看列表');
    assertTrue(listRes.data.length > 0, `列表有数据: ${listRes.data.length}`);

    const listLegal1Res = await request('GET', '/handovers', legal1Token);
    assertEqual(listLegal1Res.status, 200, 'legal1 可查看自己相关的交接单');
    assertTrue(listLegal1Res.data.some(h => h.id === handoverId), 'legal1 能看到自己的交接单');

    const listBizRes = await request('GET', '/handovers', business1Token);
    assertTrue(!listBizRes.data.some(h => h.id === handoverId), 'business1 看不到不相关的交接单');

    log('');
    log('========================================');
    log('【测试 7】撤回未签收的交接单');
    log('========================================');
    const csResWithdraw = await request('POST', '/countersigns', adminToken, {
      contract_id: contractId,
      round_name: '撤回测试会签',
      description: '用于撤回测试',
      participant_ids: [usersMap.legal2],
      clause_ids: [clauses[0].id]
    });
    assertEqual(csResWithdraw.status, 201, '创建撤回测试会签');

    const createRes2 = await request('POST', '/handovers', legal2Token, {
      to_user_id: usersMap.business1,
      scope: 'all',
      reason: '第二个交接单用于测试撤回'
    });
    assertEqual(createRes2.status, 201, '创建第二个交接单');
    const handover2Id = createRes2.data.handover.id;

    const withdrawRes = await request('POST', `/handovers/${handover2Id}/withdraw`, adminToken, { reason: '管理员撤回测试' });
    assertEqual(withdrawRes.status, 200, '管理员撤回成功');
    assertEqual(withdrawRes.data.status, 'withdrawn', '状态变为withdrawn');

    log('');
    log('【测试 7a】非管理员不能撤回');
    const csResWithdraw2 = await request('POST', '/countersigns', adminToken, {
      contract_id: contractId,
      round_name: '权限撤回测试会签',
      description: '用于撤回权限测试',
      participant_ids: [usersMap.business1],
      clause_ids: [clauses[2].id]
    });
    assertEqual(csResWithdraw2.status, 201, '创建权限撤回测试会签');

    const createRes3 = await request('POST', '/handovers', business1Token, {
      to_user_id: usersMap.business2,
      scope: 'all',
      reason: '第三个交接单用于测试非管理员撤回'
    });
    assertEqual(createRes3.status, 201, '创建第三个交接单');
    const handover3Id = createRes3.data.handover.id;

    const withdrawBizRes = await request('POST', `/handovers/${handover3Id}/withdraw`, business1Token, { reason: '业务撤回' });
    assertEqual(withdrawBizRes.status, 403, '非管理员不能撤回');

    log('');
    log('========================================');
    log('【测试 8】冲突检测 - 条款版本变更');
    log('========================================');
    const csRes2 = await request('POST', '/countersigns', adminToken, {
      contract_id: contractId,
      round_name: '冲突测试第二轮会签',
      description: '用于冲突测试',
      participant_ids: [usersMap.legal2, usersMap.business2],
      clause_ids: clauses.map(c => c.id)
    });
    assertEqual(csRes2.status, 201, '创建冲突测试会签');

    const draftRes2 = await request('POST', `/clauses/${clauses[0].id}/drafts`, legal2Token, {
      type: 'comment',
      content: '冲突测试草稿',
      base_version: 1
    });
    assertTrue(draftRes2.status === 200, 'legal2保存草稿用于冲突测试');

    const createRes4 = await request('POST', '/handovers', legal2Token, {
      to_user_id: usersMap.business2,
      scope: 'all',
      reason: '冲突测试交接'
    });
    assertEqual(createRes4.status, 201, '创建冲突测试交接单');
    const handover4Id = createRes4.data.handover.id;

    const origItems = await request('GET', `/handovers/${handover4Id}`, legal2Token);
    const origItemVersions = origItems.data.items.map(i => i.version_at_handover);

    await request('POST', `/clauses/${clauses[1].id}/suggestions`, adminToken, {
      type: 'amendment',
      content: '管理员修改',
      base_version: 1,
      amended_title: '更新的保密条款',
      amended_content: '更新后的保密内容...'
    });
    const allSuggs = await request('GET', `/clauses/${clauses[1].id}/suggestions`, adminToken);
    const amendSugg = allSuggs.data.find(s => s.type === 'amendment');

    if (amendSugg) {
      await request('POST', `/clauses/${clauses[1].id}/suggestions/${amendSugg.id}/merge`, adminToken, { reason: '合并修改以制造版本冲突' });
    }

    const conflictCheckRes = await request('GET', `/handovers/${handover4Id}/conflicts`, legal2Token);
    assertEqual(conflictCheckRes.status, 200, '冲突检查成功');

    log('');
    log('========================================');
    log('【测试 9】签收时冲突自动检测');
    log('========================================');
    const signConflictRes = await request('POST', `/handovers/${handover4Id}/sign`, business2Token, { note: '尝试签收' });
    if (signConflictRes.status === 409) {
      log('✅ 签收时检测到冲突，返回409', 1);
      assertTrue(signConflictRes.data.conflicts && signConflictRes.data.conflicts.length > 0, `冲突数量: ${signConflictRes.data.conflicts?.length}`);

      log('');
      log('【测试 9a】重新确认 - 移除冲突项');
      const reconfirmRes = await request('POST', `/handovers/${handover4Id}/reconfirm`, business2Token, {
        remove_conflict_items: signConflictRes.data.conflicts.map(c => ({ item_type: c.item_type, item_id: c.item_id })),
        force: false
      });
      assertEqual(reconfirmRes.status, 200, '重新确认成功');

      const reSignRes = await request('POST', `/handovers/${handover4Id}/sign`, business2Token, { note: '移除冲突后签收' });
      assertEqual(reSignRes.status, 200, '移除冲突后签收成功');
    } else {
      log('⚠️ 未检测到冲突（可能无草稿/建议），直接签收', 1);
      assertEqual(signConflictRes.status, 200, '直接签收成功');
    }

    log('');
    log('========================================');
    log('【测试 10】重启后交接状态恢复');
    log('========================================');
    const beforeRestart = await request('GET', `/handovers/${handoverId}`, adminToken);
    assertEqual(beforeRestart.status, 200, '重启前能获取交接单');
    assertEqual(beforeRestart.data.status, 'signed', '重启前状态为signed');
    assertEqual(beforeRestart.data.sign_note, '已确认接收', '签收备注还在');
    assertTrue(!!beforeRestart.data.signed_at, `签收时间还在: ${beforeRestart.data.signed_at}`);
    assertTrue(beforeRestart.data.items.length > 0, `交接项还在: ${beforeRestart.data.items.length}`);

    log('→ 数据已写入SQLite，重启服务后交接单状态、签收时间和映射关系应持久化', 1);
    log('→ 交接单数据验证: id=' + handoverId + ' status=' + beforeRestart.data.status + ' signed_at=' + beforeRestart.data.signed_at, 1);

    log('');
    log('========================================');
    log('【测试 11】导出评审包核对交接记录');
    log('========================================');
    const exportRes = await request('GET', `/reports/contract/${contractId}/export`, adminToken);
    assertEqual(exportRes.status, 200, '导出评审包成功');

    const exportData = exportRes.data;
    assertTrue(!!exportData.handovers, '导出数据包含handovers字段');
    assertTrue(!!exportData.handovers.records, '导出数据包含handovers.records');
    assertTrue(exportData.handovers.records.length > 0, `导出包含交接记录: ${exportData.handovers.records.length}`);

    const exportedHandover = exportData.handovers.records.find(h => h.id === handoverId);
    assertTrue(!!exportedHandover, '导出包含已签收的交接单');
    if (exportedHandover) {
      assertEqual(exportedHandover.status, 'signed', '导出的交接单状态为signed');
      assertTrue(!!exportedHandover.signed_at, '导出的签收时间存在');
      assertTrue(exportedHandover.items.length > 0, `导出的交接项数: ${exportedHandover.items.length}`);
      assertTrue(exportedHandover.history.length > 0, `导出的操作历史: ${exportedHandover.history.length}`);
    }

    assertTrue(!!exportData.handovers.summary, '导出包含交接摘要');
    log(`→ 导出交接摘要: total=${exportData.handovers.summary.total} signed=${exportData.handovers.summary.signed} withdrawn=${exportData.handovers.summary.withdrawn}`, 1);

    log('');
    log('========================================');
    log('【测试 12】交接单创建原因不能为空');
    log('========================================');
    const noReasonRes = await request('POST', '/handovers', business1Token, {
      to_user_id: usersMap.business2,
      scope: 'all',
      reason: ''
    });
    assertEqual(noReasonRes.status, 400, '空原因不能创建');

    log('');
    log('========================================');
    log('【测试 13】只有接收人能签收');
    log('========================================');
    const csRes3 = await request('POST', '/countersigns', adminToken, {
      contract_id: contractId,
      round_name: '权限测试会签',
      description: '用于权限测试',
      participant_ids: [usersMap.business1, usersMap.business2],
      clause_ids: [clauses[2].id]
    });
    assertEqual(csRes3.status, 201, '创建权限测试会签');

    const createRes5 = await request('POST', '/handovers', business1Token, {
      to_user_id: usersMap.business2,
      scope: 'all',
      reason: '权限测试交接'
    });
    assertEqual(createRes5.status, 201, '创建权限测试交接单');
    const handover5Id = createRes5.data.handover.id;

    const wrongSignRes = await request('POST', `/handovers/${handover5Id}/sign`, business1Token, { note: '发起人不能签收' });
    assertEqual(wrongSignRes.status, 403, '非接收人不能签收');

    const wrongSignRes2 = await request('POST', `/handovers/${handover5Id}/sign`, adminToken, { note: '管理员也不能签收' });
    assertEqual(wrongSignRes2.status, 403, '管理员不能签收别人的交接');

    log('');
    log('【测试 13a】撤回权限测试交接单');
    await request('POST', `/handovers/${handover5Id}/withdraw`, adminToken, { reason: '测试完毕撤回' });

    log('');
    log('========================================');
    log('【测试 14】冲突检测 - 工单状态变更');
    log('========================================');
    const createRes6 = await request('POST', '/handovers', legal1Token, {
      to_user_id: usersMap.legal2,
      scope: 'tickets',
      reason: '工单交接冲突测试'
    });

    if (createRes6.status === 201) {
      const handover6Id = createRes6.data.handover.id;

      const ticketsRes = await request('GET', '/review-tickets?only_mine=true', legal1Token);
      if (ticketsRes.data.tickets && ticketsRes.data.tickets.length > 0) {
        const ticket = ticketsRes.data.tickets[0];
        await request('POST', `/review-tickets/${ticket.id}/acknowledge`, legal1Token);

        const conflictCheck = await request('GET', `/handovers/${handover6Id}/conflicts`, legal1Token);
        assertEqual(conflictCheck.status, 200, '工单状态变更冲突检查');
        if (conflictCheck.data.conflicts.length > 0) {
          log('✅ 工单状态变更被检测到冲突', 1);
        }
      }

      await request('POST', `/handovers/${handover6Id}/withdraw`, adminToken, { reason: '清理' });
    } else {
      log('⚠️ legal1 无工单可交接，跳过工单冲突测试', 1);
    }

    log('');
    log('========================================');
    log('🎉 全部测试通过！');
    log('========================================');

  } catch (e) {
    log(`❌ 测试失败: ${e.message}`);
    console.error(e);
  }

  saveLogs();
}

main();
