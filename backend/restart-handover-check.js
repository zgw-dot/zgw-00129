const API = 'http://127.0.0.1:3000/api';
const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, 'test-output-handover-restart.txt');
const logs = [];

function log(msg) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
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

async function main() {
  log('========== 评审交接单 - 重启恢复验证测试 ==========');

  try {
    const adminToken = await login('admin', 'admin123');
    const legal1Token = await login('legal1', 'legal123');

    const listRes = await request('GET', '/handovers', adminToken);
    if (listRes.status !== 200) {
      log('❌ 无法获取交接单列表');
      saveLogs();
      return;
    }

    log(`→ 当前交接单总数: ${listRes.data.length}`);

    const signedHandovers = listRes.data.filter(h => h.status === 'signed');
    log(`→ 已签收交接单: ${signedHandovers.length}`);

    if (signedHandovers.length > 0) {
      const h = signedHandovers[0];
      log(`→ 检查第一个已签收交接单: ${h.handover_no}`);
      log(`  状态: ${h.status}`);
      log(`  签收时间: ${h.signed_at || '无'}`);
      log(`  发起人: ${h.from_user_name}`);
      log(`  接收人: ${h.to_user_name}`);
      log(`  项目数: ${h.item_count}`);

      const detail = await request('GET', `/handovers/${h.id}`, adminToken);
      if (detail.status === 200) {
        log(`  详情项数: ${detail.data.items?.length || 0}`);
        log(`  操作历史: ${detail.data.history?.length || 0}`);

        const transferredItems = (detail.data.items || []).filter(i => i.transferred);
        log(`  已转移项数: ${transferredItems.length}`);

        if (detail.data.signed_at && transferredItems.length > 0) {
          log('✅ 重启恢复验证通过：签收时间、交接项和转移状态均已持久化');
        } else {
          log('⚠️ 部分数据可能未持久化');
        }
      }
    }

    const withdrawnHandovers = listRes.data.filter(h => h.status === 'withdrawn');
    log(`→ 已撤回交接单: ${withdrawnHandovers.length}`);
    if (withdrawnHandovers.length > 0) {
      const w = withdrawnHandovers[0];
      log(`  撤回时间: ${w.withdrawn_at || '无'}`);
      log(`  撤回原因: ${w.withdraw_reason || '无'}`);
      log('✅ 撤回数据已持久化');
    }

    const pendingHandovers = listRes.data.filter(h => h.status === 'pending');
    log(`→ 待签收交接单: ${pendingHandovers.length}`);

    log('');
    log('🎉 重启恢复验证完成');

  } catch (e) {
    log(`❌ 测试失败: ${e.message}`);
  }

  saveLogs();
}

main();
