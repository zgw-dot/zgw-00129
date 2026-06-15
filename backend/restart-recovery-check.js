const API = 'http://127.0.0.1:3000/api';
const fs = require('fs');

async function main() {
  let ok = true;
  let checkCount = 0;
  function assert(cond, msg) {
    checkCount++;
    if (!cond) {
      console.log(`  ❌ 失败[${checkCount}]:`, msg);
      ok = false;
      process.exitCode = 1;
    } else {
      console.log(`  ✔️ [${checkCount}]`, msg);
    }
  }
  async function login(u, p) {
    const r = await fetch(API + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p })
    });
    const j = await r.json();
    return j.token;
  }
  async function get(path, tok) {
    const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + tok } });
    return await r.json();
  }

  console.log('');
  console.log('========== 重启复查：SQLite 持久化验证 ==========');
  console.log('目标：验证服务重启后，回合状态、签收时间、个人结论、变更历史、待重审标记均保留');
  console.log('');

  const admin = await login('admin', 'admin123');
  console.log('1. 登录 admin');
  assert(admin != null, '登录 token 获取成功');

  console.log('\n2. 列出所有合同，找到【E2E测试】合同');
  const contracts = await get('/contracts', admin);
  const e2eContract = contracts.find(c => c.name && c.name.includes('E2E'));
  const target = e2eContract || (contracts.length > 0 ? contracts[0] : null);
  assert(target != null, '找到目标合同 (ID=' + target?.id?.substring?.(0, 8) + '...)');
  if (!target) { console.log('无合同可查，终止'); process.exit(1); }
  const cid = target.id;
  console.log('   合同名:', target.name);

  console.log('\n3. 查询该合同的所有会签回合列表');
  const rounds = await get('/countersigns/contract/' + cid, admin);
  console.log('   admin 视角可见会签数量:', rounds.length);
  assert(Array.isArray(rounds) && rounds.length >= 3, `回合数 ≥ 3（实际 ${rounds?.length}）`);

  const withdrawnR = rounds.find(r => r.status === 'withdrawn');
  const activeRounds = rounds.filter(r => r.status === 'active');
  assert(withdrawnR != null, '存在 withdrawn 状态的回合');
  assert(activeRounds.length >= 2, `存在 ≥2 个 active 回合（实际 ${activeRounds.length}）`);

  console.log('\n4. 查 withdrawn 回合详情：状态、撤回时间、结论矩阵、历史');
  const d1 = await get('/countersigns/' + withdrawnR.id, admin);
  assert(d1.status === 'withdrawn', `详情 status=withdrawn（实际 ${d1.status}）`);
  assert(d1.withdrawn_at != null, 'withdrawn_at 非空（撤回时间保留：' + d1.withdrawn_at?.substring?.(0, 19) + '）');
  assert(d1.withdraw_reason != null, 'withdraw_reason 非空（原因保留）');
  assert(Array.isArray(d1.conclusions) && d1.conclusions.length >= 3, `结论矩阵条目 ≥ 3（实际 ${d1.conclusions?.length}）`);
  assert(Array.isArray(d1.history) && d1.history.length >= 10, `变更历史 ≥ 10 条（实际 ${d1.history?.length}）`);

  const commented = d1.conclusions.find(c => c.comment && c.comment.length > 0);
  assert(commented != null, '存在带 comment 的结论记录（评论内容保留）');
  if (commented) console.log('   示例评论（reject 条款）：', commented.comment.substring(0, 24) + '...');

  const acknowledgedOne = d1.conclusions.find(c => c.acknowledged_at != null);
  assert(acknowledgedOne != null, 'acknowledged_at 非空（签收时间保留：' + acknowledgedOne.acknowledged_at?.substring?.(0, 19) + '）');

  const concludedOne = d1.conclusions.find(c => c.concluded_at != null);
  assert(concludedOne != null, 'concluded_at 非空（结论时间保留：' + concludedOne.concluded_at?.substring?.(0, 19) + '）');

  console.log('\n5. 条款版本变更联动：待重审标记 + rereview_reason 保留');
  const rereviewClause = d1.clauses.find(c => Number(c.needs_rereview) === 1);
  if (rereviewClause) {
    assert(true, '存在 needs_rereview=1 的条款（标记保留）');
    assert(rereviewClause.rereview_reason && rereviewClause.rereview_reason.length > 0, 'rereview_reason 非空（原因保留：' + rereviewClause.rereview_reason.substring(0, 28) + '...)');
  } else {
    console.log('   ⚠️ 此 withdrawn 回合无待重审条款，改用 active 回合查');
    // 找有 clauses 的 active 回合
    const activeIds = activeRounds.map(x => x.id);
    let foundRereview = false;
    for (const rid of activeIds) {
      const ad = await get('/countersigns/' + rid, admin);
      const rc = ad.clauses.find(c => Number(c.needs_rereview) === 1);
      if (rc) { foundRereview = true; assert(true, '回合 '+rid.substring(0,6)+'… 中存在 needs_rereview=1 条款'); assert(rc.rereview_reason?.length>0, 'rereview_reason 非空'); break; }
    }
    assert(foundRereview, '至少一个回合中存在 needs_rereview 标记');
  }

  console.log('\n6. 参与者软删除标记（替换参与人 is_replaced=1）保留');
  const replacedP = d1.participants.find(p => Number(p.is_replaced) === 1);
  assert(replacedP != null, '存在 is_replaced=1 的参与者（软删除标记保留，名称=' + replacedP?.display_name + '）');
  if (replacedP) {
    assert(replacedP.replaced_at != null, '软删除 replaced_at 时间戳非空');
    assert(replacedP.replaced_reason != null, 'replaced_reason 替换原因保留（名称=' + replacedP.display_name + '）');
  }
  // 原参与人的旧结论仍在 conclusions 里
  if (replacedP) {
    const oldConcls = d1.conclusions.filter(c => c.participant_id === replacedP.id);
    assert(oldConcls.length >= 1, `被替换参与人的旧结论保留（${oldConcls.length} 条），不静默丢失`);
  }

  console.log('\n7. 导出评审包字段完整性（重启前后字段一致）');
  const expResp = await fetch(API + '/reports/contract/' + cid + '/export', { headers: { Authorization: 'Bearer ' + admin } });
  const exp = await expResp.json();
  assert(exp.contract != null, '导出包含 contract 字段');
  assert(typeof exp.contract.can_be_marked_complete === 'boolean', 'contract.can_be_marked_complete 是布尔值');
  assert(exp.countersign != null, '导出包含 countersign 顶级字段');
  assert(Array.isArray(exp.countersign.rounds), 'countersign.rounds 是数组');
  assert(exp.countersign.rounds.length >= 3, `rounds 数量 ≥ 3（实际 ${exp.countersign.rounds.length}）`);
  assert(Array.isArray(exp.countersign.incomplete_items), 'countersign.incomplete_items 是数组');
  assert(Array.isArray(exp.countersign.invalidation_reasons), 'countersign.invalidation_reasons 是数组');
  console.log('   rounds=' + exp.countersign.rounds.length + '  incomplete=' + exp.countersign.incomplete_items.length + '  invalidation=' + exp.countersign.invalidation_reasons.length);

  // 检查 withdrawn 回合也出现在导出中
  const expWithdrawn = exp.countersign.rounds.find(r => r.status === 'withdrawn');
  assert(expWithdrawn != null, '导出 rounds 含 withdrawn 状态回合（旧意见不丢失）');

  console.log('\n8. 会签历史动作完整性（create/ack/conclude/替换/撤回/版本变更 全部留痕）');
  const actions = d1.history.map(h => h.action);
  const uniqActions = [...new Set(actions)];
  console.log('   历史动作（去重共 ' + uniqActions.length + ' 种）:', uniqActions.join(', '));
  assert(actions.includes('create_round'), '历史包含 create_round 动作');
  assert(actions.includes('acknowledge'), '历史包含 acknowledge 动作');
  assert(actions.includes('conclude'), '历史包含 conclude 动作');
  assert(actions.includes('replace_participant') || actions.includes('withdraw_round'), '历史包含 replace_participant 或 withdraw_round 动作');
  assert(actions.includes('clause_version_change'), '历史包含 clause_version_change（版本变更审计）');
  assert(actions.includes('withdraw_round'), '历史包含 withdraw_round（撤回留痕）');

  console.log('\n9. 导出评审包内容一致性验证：读取重启前导出的对照文件');
  const prevFile = 'test-output-countersign-export.json';
  if (fs.existsSync(prevFile)) {
    const prev = JSON.parse(fs.readFileSync(prevFile, 'utf8'));
    // 对比核心字段
    const sameTopKeys = JSON.stringify(Object.keys(exp).sort()) === JSON.stringify(Object.keys(prev).sort());
    assert(sameTopKeys, `重启前后导出顶级字段完全一致（${Object.keys(exp).length} 个字段）`);
    assert(exp.countersign.rounds.length === prev.countersign.rounds.length, `重启前后 rounds 数量一致（${exp.countersign.rounds.length}）`);
    console.log('   一致字段：' + Object.keys(exp).join(', '));
  } else {
    console.log('   ⚠️ 未找到重启前对照文件，跳过内容一致性对比');
  }

  console.log('');
  console.log('========== 复查结果 ==========');
  if (ok) {
    console.log(`🎉 全部 ${checkCount} 项检查通过！SQLite 持久化验证成功`);
    console.log('   回合状态、签收时间、结论评论、变更历史、待重审标记、软删除标记 均完整保留 ✓');
    process.exit(0);
  } else {
    console.log(`❌ 部分检查失败`);
    process.exit(1);
  }
}

main().catch(e => { console.error('执行异常：', e.message); process.exit(1); });
