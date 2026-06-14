import React from 'react';
import { Typography, Card, Table, Tag, Steps, Alert, Divider, Space, Button, Collapse, Code } from 'antd';
import {
  ImportOutlined, WarningOutlined, ThunderboltOutlined, SafetyCertificateOutlined,
  CheckCircleOutlined, CloseCircleOutlined, RollbackOutlined, LockOutlined
} from '@ant-design/icons';

const { Title, Paragraph, Text, Link } = Typography;

const exampleJson = `[
  {
    "clause_number": "1",
    "title": "定义",
    "content": "\\"本协议\\"指由双方签署的本合同及其所有附件。",
    "risk_level": "low"
  },
  {
    "clause_number": "2.1",
    "title": "服务内容",
    "content": "乙方应按照附件A的约定向甲方提供咨询服务。",
    "risk_level": "medium"
  }
]`;

const ImportGuidePage: React.FC = () => {
  return (
    <div style={{ maxWidth: 1000 }}>
      <Title level={3}>
        <ImportOutlined style={{ color: '#1677ff' }} /> 导入格式与验收场景说明
      </Title>

      <Card style={{ marginBottom: 20 }} title="一、条款导入 JSON 格式说明">
        <Paragraph>合同条款支持 JSON 格式导入，字段规范如下：</Paragraph>

        <Table
          size="small"
          pagination={false}
          columns={[
            { title: '字段名', dataIndex: 'name', width: 140, render: v => <Text code>{v}</Text> },
            { title: '类型', dataIndex: 'type', width: 100 },
            { title: '必填', dataIndex: 'required', width: 80, render: v => v ? <Tag color="red">是</Tag> : <Tag color="green">否</Tag> },
            { title: '说明', dataIndex: 'desc' }
          ]}
          dataSource={[
            { name: 'clause_number', type: 'string', required: true, desc: '条款编号（如 "1", "2.1", "附录A.3"），同一合同内必须唯一且导入后保持稳定不变' },
            { name: 'title', type: 'string', required: true, desc: '条款标题' },
            { name: 'content', type: 'string', required: true, desc: '条款正文内容' },
            { name: 'risk_level', type: 'string', required: false, desc: '风险等级枚举：low（低）、medium（中）、high（高）、critical（严重），默认 low' }
          ]}
        />

        <Divider />

        <Title level={5}>示例：</Title>
        <pre className="import-template">{exampleJson}</pre>

        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          message="提示"
          description={
            <>
              <Paragraph style={{ marginBottom: 4 }}>1. 在「合同管理」→ 点击合同行的「导入条款」按钮，可选择 JSON 文本导入或手动逐行录入。</Paragraph>
              <Paragraph style={{ marginBottom: 4 }}>2. 条款编号在导入后作为业务主键保持稳定，修改建议合并、版本回滚均不会改变原 clause_number。</Paragraph>
              <Paragraph style={{ margin: 0 }}>3. 如导入编号重复的条款，系统会逐条报错提示，不影响其他正常条款导入。</Paragraph>
            </>
          }
        />
      </Card>

      <Card style={{ marginBottom: 20 }}
        title={
          <span><SafetyCertificateOutlined style={{ color: '#faad14' }} /> 二、预设角色与账号</span>
        }>
        <Table size="small" pagination={false}
          columns={[
            { title: '用户名', dataIndex: 'u' },
            { title: '密码', dataIndex: 'p' },
            { title: '角色', dataIndex: 'r', render: (v: string) => <Tag color={v === 'admin' ? 'gold' : v === 'legal' ? 'blue' : 'green'}>{v === 'admin' ? '管理员' : v === 'legal' ? '法务' : '业务'}</Tag> },
            { title: '权限范围', dataIndex: 'desc' }
          ]}
          dataSource={[
            { u: 'admin', p: 'admin123', r: 'admin', desc: '全部权限：合同/条款/建议操作、版本回滚、删除合同' },
            { u: 'legal1 / legal2', p: 'legal123', r: 'legal', desc: '发起评论/修改建议，通过/驳回建议，合并修改建议（创建新版本）' },
            { u: 'business1 / business2', p: 'biz123', r: 'business', desc: '发起评论/修改建议，通过/驳回归属业务的建议' }
          ]} />
      </Card>

      <Card style={{ marginBottom: 20 }}
        title={<span><ThunderboltOutlined style={{ color: '#f5222d' }} /> 三、并发版本冲突复现步骤</span>}
      >
        <Alert type="warning" showIcon style={{ marginBottom: 16 }}
          message="冲突检测原理"
          description={`每条建议创建时会绑定 base_version。若提交/合并时 base_version 小于条款 current_version，系统视为冲突：创建时会前端提示冲突详情；合并时后端直接返回 409 并拒绝合并。`} />

        <Steps
          direction="vertical"
          size="small"
          current={-1}
          items={[
            {
              title: '准备工作',
              status: 'process',
              description: (
                <Paragraph>
                  1. 使用 admin 创建合同并导入 <Text strong>2 条以上</Text> 条款；<br />
                  2. 同时打开两个浏览器窗口：窗口A登录 <Text code>legal1</Text>，窗口B登录 <Text code>legal2</Text>（或 business1）；<br />
                  3. 两窗口均进入同一条款的详情页，此时双方看到的 current_version 相同（如 v1）。
                </Paragraph>
              )
            },
            {
              title: '步骤 1：A 先提交修改建议并合并',
              status: 'process',
              description: (
                <Paragraph>
                  窗口A（legal1）→ 发起「修改建议」→ base_version 选 v1 → 填写修改内容 → 提交 → 进入建议列表，点击「合并」→ 填写合并原因 → 确认。<br />
                  <Tag color="blue">结果：条款 current_version 升为 v2</Tag>
                </Paragraph>
              )
            },
            {
              title: '步骤 2：B 在旧版本上提交修改建议',
              status: 'process',
              description: (
                <Paragraph>
                  切到窗口B → <Text strong type="warning">不要刷新页面</Text> → 直接发起「修改建议」→ base_version 仍为 v1（或明确选 v1）→ 提交。<br />
                  <Tag color="orange">结果：提交时立即弹出冲突提示，显示从 v1 到 v2 的变更详情。可继续提交，但建议会被标记为「版本落后」。</Tag>
                </Paragraph>
              )
            },
            {
              title: '步骤 3：尝试合并 B 的建议（触发冲突拒绝）',
              status: 'process',
              description: (
                <Paragraph>
                  刷新窗口B → 进入 B 的建议卡片 → 点击「合并」→ 填写原因 → 确认。<br />
                  <Tag color="red">结果：合并按钮标红并提示冲突。后端返回 HTTP 409，明确提示 base_version {'<'} current_version，合并被拒绝。<br />
                  必须由 B 基于 v2 重新提交修改建议后才能合并。</Tag>
                </Paragraph>
              )
            }
          ]}
        />
      </Card>

      <Card style={{ marginBottom: 20 }}
        title={<span><CheckCircleOutlined /> 四、成功路径：完整建议合并流程</span>}
      >
        <Steps size="small" direction="vertical" current={-1}
          items={[
            { title: '1. admin 新建合同 → 导入示例条款', description: '合同应包含至少 2 条 medium/high 风险条款。' },
            { title: '2. business1 发起业务评论', description: '选择「评论」类型，内容例如："建议明确付款起算日以发票开具日为准"。' },
            { title: '3. legal1 发起法务修改建议', description: '选择「修改建议」+「法务专属」，提供完整修改后的条款正文。' },
            { title: '4. admin 或 legal 处理建议', description: '通过业务评论（填写通过原因）→ 合并法务修改建议（填写合并原因）→ 条款版本升级 v2。' },
            { title: '5. 导出评审包验证', description: '合同列表 →「导出评审包」下载 JSON 文件，重启服务后重新导入或仅查看：版本历史和决策原因应完整一致。' }
          ]} />
      </Card>

      <Card style={{ marginBottom: 20 }}
        title={<span><CloseCircleOutlined style={{ color: '#f5222d' }} /> 五、失败路径验收场景</span>}
      >
        <Collapse
          items={[
            {
              key: '1',
              label: <Space><LockOutlined style={{ color: '#722ed1' }} /> 5.1 业务角色接受法务专属建议（权限越界）</Space>,
              children: (
                <Alert type="error" showIcon
                  message="预期结果：HTTP 403 错误，消息：此为法务专属建议，业务角色无权处理"
                  description={
                    <Paragraph>
                      复现：legal1 发起建议时「可见范围」选 <Tag color="magenta">仅法务可决策</Tag> → business1 登录 → 尝试点击建议的「通过/驳回」按钮。
                    </Paragraph>
                  } />
              )
            },
            {
              key: '2',
              label: <Space><WarningOutlined style={{ color: '#faad14' }} /> 5.2 驳回/通过/合并缺少决策原因</Space>,
              children: (
                <Alert type="error" showIcon
                  message="预期结果：前端表单校验 + 后端均返回 400，提示原因不能为空"
                  description="决策原因字段是系统硬约束，所有通过/驳回/合并/回滚操作必须填写，且会永久记入审计日志。" />
              )
            },
            {
              key: '3',
              label: <Space><ThunderboltOutlined style={{ color: '#fa541c' }} /> 5.3 两人基于旧版本同时提交（冲突检测）</Space>,
              children: (
                <Alert type="error" showIcon
                  message="预期结果：创建建议时弹出冲突详情；合并时直接拒绝，HTTP 409"
                  description="参见第三节完整复现步骤。" />
              )
            },
            {
              key: '4',
              label: <Space><RollbackOutlined style={{ color: '#f5222d' }} /> 5.4 回滚到不存在版本</Space>,
              children: (
                <Alert type="error" showIcon
                  message="预期结果：回滚失败弹窗，显示'版本 vX 不存在，无法回滚'，并提示当前条款最高历史版本号"
                  description={
                    <Paragraph>
                      复现：条款当前 v2，最高历史版本亦为 2 → 管理员点击版本回滚 → 目标版本手动填入 99 → 提交。<br />
                      <Text type="secondary">注：通过 UI 选择时下拉仅展示存在的版本；可直接调 API POST /api/clauses/:id/rollback 传 target_version: 99 复现。</Text>
                    </Paragraph>
                  } />
              )
            }
          ]}
        />
      </Card>

      <Card title={<span>六、重启一致性验证</span>}>
        <Paragraph>
          数据持久化使用 SQLite 本地文件（<Text code>backend/data/contract-review.db</Text>），配合 WAL 日志模式，进程重启后数据完整。
        </Paragraph>
        <Paragraph>验证步骤：</Paragraph>
        <ol>
          <li>完成上述成功路径，导出合同评审包 JSON 保存；</li>
          <li>记录审计日志中的关键条目；</li>
          <li>停止 <Text code>npm run dev</Text>（前后端均停止）→ 再重新启动；</li>
          <li>重新登录 → 进入同一条款 → 比对：
            <ul>
              <li>current_version 版本号、标题、内容一致；</li>
              <li>版本历史中各版本变更摘要、创建人、时间一致；</li>
              <li>建议列表中已处理建议的决策原因、决策人、时间一致；</li>
              <li>审计日志页中操作记录完整，决策详情标签可读。</li>
            </ul>
          </li>
        </ol>
      </Card>
    </div>
  );
};

export default ImportGuidePage;
