# 合同条款协同评审系统

一个支持**本地运行**的完整全栈 Web 应用，包含前端、后端和 SQLite 持久化存储。支持法务/业务双角色协同评审，版本并发冲突检测，完整决策审计日志。

---

## 🚀 快速启动（3 步）

> 依赖：Node.js >= 18

```bash
# 1. 安装依赖（前后端同时安装）
npm run install:all

# 2. 初始化数据库（创建 5 个测试用户）
npm run seed

# 3. 同时启动前后端（前端:5173，后端:3001）
npm run dev
```

启动后在浏览器打开 **http://localhost:5173**，使用以下任意账号登录：

| 用户名     | 密码        | 角色   | 权限说明 |
|-----------|------------|--------|---------|
| `admin`   | `admin123` | 管理员 | 全部权限 + 版本回滚 |
| `legal1`  | `legal123` | 法务   | 发起建议、通过/驳回、合并修改 |
| `legal2`  | `legal123` | 法务   | 同上（用于模拟并发冲突） |
| `business1` | `biz123` | 业务 | 发起建议、处理业务专属建议 |
| `business2` | `biz123` | 业务 | 同上（用于模拟并发冲突） |

---

## 🏗️ 技术架构

| 层级     | 技术选型 | 说明 |
|---------|---------|------|
| **前端** | React 18 + TypeScript + Vite + Ant Design 5 + Zustand | 响应式 UI，版本对比可视化 |
| **后端** | Node.js + Express + TypeScript | RESTful API，JWT 鉴权 |
| **存储** | better-sqlite3 (WAL 模式) | 单文件数据库，进程重启数据零丢失 |
| **认证** | JWT + bcrypt | 7 天有效期 Token |

**目录结构：**
```
zgw-00129/
├── backend/                 # 后端服务 (端口 3001)
│   ├── src/
│   │   ├── index.ts         # 入口
│   │   ├── database.ts      # SQLite 初始化与建表
│   │   ├── auth.ts          # JWT / bcrypt
│   │   ├── audit.ts         # 审计日志写入器
│   │   ├── middleware.ts    # 鉴权中间件
│   │   ├── routes/
│   │   │   ├── auth.ts
│   │   │   ├── contracts.ts # 合同/导入
│   │   │   ├── clauses.ts   # 条款/版本/建议/决策/回滚 (核心冲突检测)
│   │   │   └── export.ts    # 评审包导出 + 审计日志
│   │   └── seed.ts          # 初始化测试用户
│   └── data/
│       └── contract-review.db   # SQLite 数据文件
├── frontend/                # 前端服务 (端口 5173)
│   └── src/
│       ├── pages/           # 登录、合同、条款、详情、审计日志、导入指南
│       └── components/      # 布局、导入模态、建议卡片
└── README.md
```

---

## 📋 导入格式（JSON）

在 **合同管理 → 导入条款** 中支持以下 JSON 结构：

```json
[
  {
    "clause_number": "1",
    "title": "定义",
    "content": "\"本协议\"指由双方签署的本合同及其所有附件。",
    "risk_level": "low"
  },
  {
    "clause_number": "3.2",
    "title": "付款条款",
    "content": "甲方应在收到发票后30个工作日内付款，逾期按日万分之五支付违约金。",
    "risk_level": "high"
  }
]
```

| 字段            | 类型   | 必填 | 说明 |
|----------------|--------|------|------|
| `clause_number`| string | ✅ | 条款编号（如 "1", "2.1", "附录A"），同一合同内唯一，**导入后保持稳定**，不随版本变更而改变 |
| `title`        | string | ✅ | 条款标题 |
| `content`      | string | ✅ | 条款正文 |
| `risk_level`   | string | ❌ | 风险等级：`low`(低) / `medium`(中) / `high`(高) / `critical`(严重)，默认 `low` |

---

## ⚡ 并发版本冲突复现指南

### 冲突检测原理
每条建议创建时会绑定 `base_version`（基于哪个版本写的）。若：
- **创建时** `base_version < current_version`：前端弹出提示，展示新增版本列表与已合并决策详情
- **合并时** `base_version < current_version`：后端直接返回 **HTTP 409**，拒绝合并，必须基于最新版本重提

### 4 步复现法

1. **准备环境**
   - admin 登录 → 新建合同 → 导入 ≥2 条条款
   - 打开 **两个浏览器窗口**（或一个普通 + 一个无痕）
   - 窗口A → 登录 `legal1`；窗口B → 登录 `legal2`
   - 两边都进入**同一条款**的详情页，确认当前版本都是 `v1`

2. **A 先合并一版**
   - 窗口A → "发起建议" → 选 **修改建议**，base_version = v1 → 填写修改内容 → 提交
   - 回到建议卡片 → 点击 **"合并"** → 填写原因 → 确认
   - ✅ 条款版本从 v1 升到 **v2**

3. **B 在旧版本上提交**
   - 切到窗口B，**不要刷新**
   - 直接"发起建议" → base_version 还是 v1（或手动选 v1）→ 提交
   - ⚡ 立即弹出冲突对话框，展示 v1→v2 的变更人、摘要、时间
   - 继续提交后，建议卡片上出现 **"版本落后"** 橙色标签

4. **尝试合并（触发拒绝）**
   - 刷新窗口B → 在 B 的建议卡上点击"合并"
   - 🔴 按钮标红警告 → 确认合并 → 后端返回 409，合并被拒绝
   - 必须由 B **刷新后基于 v2 重新提交** 才能合并

---

## ✅ 验收场景清单

### ✔️ 成功路径（建议合并完整流程）
1. admin 创建合同并导入 5 条示例条款
2. business1 发起一条「业务评论」（非修改型）
3. legal1 发起一条「法务专属修改建议」
4. admin 通过业务评论（填写通过原因）
5. legal 合并修改建议（条款版本升级）
6. **导出评审包** → 重启服务 → 重新打开验证：版本历史、决策原因、审计日志全部一致

### ❌ 失败路径（必须触发正确错误）
| # | 场景 | 预期结果 |
|---|------|---------|
| 5.1 | business1 尝试通过 legal1 发起的「法务专属」建议 | HTTP **403**：专属建议禁止越权处理 |
| 5.2 | 通过/驳回/合并/回滚时 **不填原因** | 前端校验 + 后端 HTTP **400**：决策原因必填 |
| 5.3 | 两人基于旧版本同时提交后合并 | 见"冲突复现"→ HTTP **409** 拒绝合并 |
| 5.4 | admin 回滚到一个**不存在的版本号**（如 v99） | HTTP **404**：明确告知"版本 v99 不存在，当前最高 vX" |

---

## 💾 重启一致性验证

**验证方法**：
1. 完成一次成功路径 → 导出评审包 JSON
2. 记录当前条款版本、建议决策原因、审计日志条数
3. `Ctrl+C` 停止前后端 → 重新 `npm run dev`
4. 重新登录 → 进入条款详情：
   - 版本号、标题、内容 **完全一致**
   - 版本历史中的变更摘要、创建人、时间 **完全一致**
   - 已处理建议的决策原因、决策人 **完全一致**
   - 操作日志条数与内容 **完全一致**

**原理**：sql.js 定时导出数据库到磁盘文件 + Node.js `beforeExit` / `SIGINT` 钩子确保退出前持久化。数据库文件位于 `backend/data/contract-review.db`，可直接复制备份。

---

## 📦 导出的评审包内容

`合同管理 → 导出评审包` 下载的 JSON 文件结构：
```json
{
  "exported_at": "2026-06-15T...",
  "contract": { "id": "...", "name": "...", ... },
  "clauses": [
    {
      "id": "...", "clause_number": "1", "title": "...",
      "versions": [ ... ],         // 完整版本链
      "suggestions": [ ... ]       // 所有建议与决策
    }
  ],
  "audit_logs": [ ... ]            // 相关操作日志（含决策原因）
}
```

---

## 🔌 API 速查（调试用）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录取 Token |
| GET  | `/api/clauses?contract_id=X&has_pending=true&risk_level=high` | 条款列表过滤 |
| POST | `/api/clauses/:id/suggestions` | 创建建议（含冲突检测） |
| POST | `/api/clauses/:id/suggestions/:sid/merge` | 合并建议（触发 409 冲突） |
| POST | `/api/clauses/:id/rollback` | 版本回滚（admin，可测不存在版本） |
| GET  | `/api/reports/contract/:id/export` | 导出完整评审包 |
| GET  | `/api/reports/audit-logs` | 审计日志 |

---

## 🛠️ 其他命令

```bash
# 仅后端
cd backend && npm install && npm run seed && npm run dev

# 仅前端
cd frontend && npm install && npm run dev

# 后端生产构建
cd backend && npm run build && npm start
```

数据文件位于 `backend/data/contract-review.db`，可直接拷贝迁移。
