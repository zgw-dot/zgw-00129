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

# 3. 同时启动前后端（前端:8080，后端:3001）
npm run dev
```

启动后在浏览器打开 **http://localhost:8080**，使用以下任意账号登录：

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
| **存储** | sql.js (SQLite 内存库 + 定时持久化) | 单文件数据库，进程重启数据零丢失 |
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
├── frontend/                # 前端服务 (端口 8080)
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
  "drafts": [
    {
      "id": "...", "clause_id": "...", "user_id": "...",
      "user_name": "...", "user_role": "...",
      "type": "comment" | "amendment",
      "content": "...",
      "base_version": 1,
      "created_at": "...", "updated_at": "..."
    }
  ],
  "audit_logs": [
    {
      "entity_type": "contract" | "clause" | "suggestion" | "draft",
      "action": "save_draft" | "submit_draft" | "delete_draft" | ...,
      "details": { "clause_id": "...", "draft_id": "...", "suggestion_id": "..." },
      ...
    }
  ]
}
```

**字段说明**：
- `drafts`：本合同所有未被清理的**建议草稿**，按用户 × 条款隔离，`clause_id` 均在当前合同条款范围内。
- `audit_logs` 中 `entity_type = 'draft'` 的记录：草稿保存（`save_draft`）、转正提交（`submit_draft`，带对应 `suggestion_id`）、丢弃（`delete_draft`），其 `details.clause_id` 均在当前合同条款范围内，按后端 SQL 层过滤，不靠前端。
- 草稿持久化到 SQLite 的 `suggestion_drafts` 表，唯一约束 `(clause_id, user_id)`，重启前后端不丢失。

**复查工单导出字段**（`review_tickets` 节点）：
- `all_tickets[]`：该合同所有会签关联的全部工单（含已关闭、已失效），每条带完整 `history[]` 状态流转历史
- `open_tickets[]`：状态为 `pending/acknowledged/reopened` 的未结工单，直接展示需处理项
- `invalid_tickets[]` + `invalidation_reasons[]`：已失效工单清单，逐条说明失效原因、旧结论与旧备注，用于审计"为什么原来的待办不算了"
- `checklist[]`：**核对步骤清单**，按优先级排序，每条含 `step_no`、`ticket_no`、条款信息、责任人、`required_action`（未签收 / 处理中 / 重开），导出后即按表逐项勾核
- `summary`：工单统计总览（总数 / 各状态计数 / 按 7 种触发类型分类计数）
- `contract.can_be_marked_complete`：需同时满足「会签 incomplete_items 为空」**且**「复查工单 open_tickets 为空」才为 `true`

---

## 🔌 API 速查（调试用）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录取 Token |
| GET  | `/api/clauses?contract_id=X&has_pending=true&risk_level=high` | 条款列表过滤 |
| GET  | `/api/clauses/:id/drafts` | **读取当前用户草稿**（含 `version_conflict` 与 `current_version` 字段） |
| POST | `/api/clauses/:id/drafts` | **保存/更新草稿**（upsert，按 clause_id + user_id 唯一） |
| DELETE | `/api/clauses/:id/drafts/:draftId` | **删除草稿**（只能删本人的） |
| POST | `/api/clauses/:id/suggestions` | 创建建议（含冲突检测），成功后自动清同条款同用户草稿 |
| POST | `/api/clauses/:id/suggestions/:sid/merge` | 合并建议（触发 409 冲突）→ 自动触发会签待重审钩子 |
| POST | `/api/clauses/:id/rollback` | 版本回滚（admin，可测不存在版本）→ 自动触发会签待重审钩子 |
| GET  | `/api/reports/contract/:id/export` | 导出完整评审包（含会签 rounds / incomplete_items / invalidation_reasons / 复查工单全量数据 / 核对步骤清单） |
| GET  | `/api/reports/audit-logs` | 审计日志 |
| **— 复查工单模块 —** | | |
| GET  | `/api/review-tickets` | 工单列表（支持 contract_id/round_id/clause_id/assignee_id/status/trigger_type 筛选，only_mine=true 看自己的，含统计摘要） |
| GET  | `/api/review-tickets/mine` | （同上，带 only_mine=true 快捷入口） |
| GET  | `/api/review-tickets/:id` | 工单详情（含完整处理历史、版本变更链、关联条款/会签信息） |
| POST | `/api/review-tickets/:id/acknowledge` | **责任人签收**工单（非责任人禁止代签，返回 403） |
| POST | `/api/review-tickets/:id/conclude` | **责任人提交结论**：`pass`（通过）/ `need_more_info`（补资料）/ `recountersign`（触发重新会签），需先签收 |
| POST | `/api/review-tickets/:id/reassign` | **管理员改派**责任人（body: new_user_id, reason），已签收会重置为待签收 |
| POST | `/api/review-tickets/:id/reopen` | **管理员重开**已关闭工单（body: reason），清空旧结论但保留历史，`reopened_count` +1 |
| POST | `/api/review-tickets/:id/withdraw` | **管理员撤回/失效**工单（body: reason），状态置 invalid，旧结论和处理历史全部保留 |
| POST | `/api/review-tickets/manual-create` | **管理员手动建单**（body: round_id, clause_id, assignee_user_ids[], reason），用于特殊场景重启复查 |
| **— 会签模块 —** | | |
| POST | `/api/countersigns` | **管理员发起会签**（body: round_name, description?, deadline?, participant_ids[], clause_ids[]） |
| GET  | `/api/countersigns/contract/:contractId` | 按合同列出所有会签（管理员全量，法务/业务仅自己参与的） |
| GET  | `/api/countersigns/mine` | 当前登录用户作为参与人的会签列表 |
| GET  | `/api/countersigns/:id` | **会签详情**（含参与人、条款、结论矩阵、变更历史） |
| POST | `/api/countersigns/:id/acknowledge` | **参与人批量签收**所有条款（两阶段第一阶段） |
| POST | `/api/countersigns/:id/conclude` | **对单条条款提交结论**（body: clause_id, conclusion: pass\|reject\|need_more_info, comment?）→ 先校验已签收 |
| POST | `/api/countersigns/:id/withdraw` | **管理员撤回整回合**（body: reason）→ 状态置 withdrawn，旧意见保留 |
| POST | `/api/countersigns/:id/replace-participant` | **管理员替换参与人**（body: old_participant_id, new_user_id, reason）→ 软删除原记录，保留旧结论 |
| POST | `/api/countersigns/:id/rerequest-rereview` | **管理员主动请求重审**指定条款（body: clause_ids[], reason）→ 清空结论并标记待重审 |

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
