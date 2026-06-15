import React, { useState, useEffect } from 'react';
import {
  Modal, Tabs, Button, Form, Input, Select, App as AntdApp, Typography, Space, Tag,
  Divider, Alert, Radio, List, Card, Checkbox, InputNumber, Tooltip, Empty
} from 'antd';
import {
  UploadOutlined, FileTextOutlined, DownloadOutlined, PlusOutlined,
  ExclamationCircleOutlined, CheckCircleOutlined, InfoCircleOutlined,
  StopOutlined, EditOutlined
} from '@ant-design/icons';
import { contractsApi, ImportPrecheckResult, ImportConfirmOverride, ImportResult } from '../api';
import { RiskLevel, RISK_LABELS, RISK_COLORS } from '../types';

const { Paragraph, Text, Title } = Typography;
const { TextArea } = Input;

interface Props {
  contractId: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const SAMPLE_CLAUSES = [
  {
    clause_number: '1',
    title: '定义',
    content: '"本协议"指由双方签署的本合同及其所有附件。"一方"指甲方或乙方，"双方"指甲方和乙方。',
    risk_level: 'low' as RiskLevel
  },
  {
    clause_number: '2.1',
    title: '服务内容',
    content: '乙方应按照附件A的约定向甲方提供咨询服务，服务应符合行业公认的专业标准。',
    risk_level: 'medium' as RiskLevel
  },
  {
    clause_number: '3.2',
    title: '付款条款',
    content: '甲方应在收到乙方开具的增值税专用发票后30个工作日内支付相应款项。逾期付款按每日万分之五支付违约金。',
    risk_level: 'high' as RiskLevel
  },
  {
    clause_number: '5.1',
    title: '保密义务',
    content: '双方对在合作过程中获悉的对方商业秘密负有保密义务，保密期限为协议终止后5年。',
    risk_level: 'critical' as RiskLevel
  },
  {
    clause_number: '8.3',
    title: '争议解决',
    content: '因本协议引起的争议，双方应友好协商解决；协商不成的，任何一方均可向甲方所在地有管辖权的人民法院提起诉讼。',
    risk_level: 'medium' as RiskLevel
  }
];

type ImportMode = 'add_only' | 'update_by_number';
type Step = 'input' | 'precheck' | 'confirm' | 'result';

const ImportClauseModal: React.FC<Props> = ({ contractId, open, onClose, onSuccess }) => {
  const [activeTab, setActiveTab] = useState('json');
  const [jsonText, setJsonText] = useState('');
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [precheckLoading, setPrecheckLoading] = useState(false);
  const { message, modal } = AntdApp.useApp();

  const [step, setStep] = useState<Step>('input');
  const [precheckResult, setPrecheckResult] = useState<ImportPrecheckResult | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>('update_by_number');
  const [clausesData, setClausesData] = useState<any[]>([]);
  const [confirmOverrides, setConfirmOverrides] = useState<Map<string, string>>(new Map());
  const [selectedBlocks, setSelectedBlocks] = useState<Set<string>>(new Set());
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    if (open) {
      setJsonText(JSON.stringify(SAMPLE_CLAUSES, null, 2));
      form.resetFields();
      setActiveTab('json');
      setStep('input');
      setPrecheckResult(null);
      setImportMode('update_by_number');
      setClausesData([]);
      setConfirmOverrides(new Map());
      setSelectedBlocks(new Set());
      setImportResult(null);
    }
  }, [open]);

  const parseClausesFromForm = (): any[] => {
    const values = form.getFieldsValue(true);
    return values.clauses || [];
  };

  const handleParseJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) throw new Error('必须是数组');
      form.setFieldsValue({ clauses: parsed });
      setClausesData(parsed);
      message.success(`解析成功，共 ${parsed.length} 条条款`);
      setActiveTab('review');
    } catch (e: any) {
      message.error('JSON 解析失败：' + e.message);
    }
  };

  const handlePrecheck = async () => {
    try {
      let clauses: any[];
      if (activeTab === 'json') {
        const parsed = JSON.parse(jsonText);
        if (!Array.isArray(parsed)) throw new Error('必须是数组');
        clauses = parsed;
      } else {
        const values = await form.validateFields();
        clauses = values.clauses || [];
      }

      if (clauses.length === 0) {
        message.warning('请先输入至少一条条款');
        return;
      }

      setClausesData(clauses);
      setPrecheckLoading(true);
      const result = await contractsApi.precheckImport(contractId, clauses);
      setPrecheckResult(result);
      setStep('precheck');

      const initialSelected = new Set<string>();
      const initialOverrides = new Map<string, string>();
      result.update_clauses.forEach(c => {
        if (c.blocked) {
          initialSelected.add(c.clause_number);
        }
      });
      setSelectedBlocks(initialSelected);
      setConfirmOverrides(initialOverrides);
    } catch (e: any) {
      message.error(e.response?.data?.error || '预检失败');
    } finally {
      setPrecheckLoading(false);
    }
  };

  const handleModeChange = (e: any) => {
    setImportMode(e.target.value);
  };

  const handleBlockToggle = (clauseNumber: string, checked: boolean) => {
    const newSelected = new Set(selectedBlocks);
    if (checked) {
      newSelected.add(clauseNumber);
    } else {
      newSelected.delete(clauseNumber);
    }
    setSelectedBlocks(newSelected);
  };

  const handleOverrideReasonChange = (clauseNumber: string, reason: string) => {
    const newOverrides = new Map(confirmOverrides);
    if (reason.trim()) {
      newOverrides.set(clauseNumber, reason);
    } else {
      newOverrides.delete(clauseNumber);
    }
    setConfirmOverrides(newOverrides);
  };

  const canProceedToConfirm = (): boolean => {
    if (!precheckResult) return false;
    if (importMode === 'add_only') {
      return precheckResult.new_count > 0;
    }
    return precheckResult.new_count > 0 || precheckResult.update_count > 0;
  };

  const handleGoToConfirm = () => {
    if (!canProceedToConfirm()) {
      message.warning('没有可执行的操作');
      return;
    }
    setStep('confirm');
  };

  const getBlockedConfirmOverrides = (): ImportConfirmOverride[] => {
    const overrides: ImportConfirmOverride[] = [];
    if (!precheckResult) return overrides;

    precheckResult.update_clauses.forEach(c => {
      if (c.blocked && selectedBlocks.has(c.clause_number)) {
        const reason = confirmOverrides.get(c.clause_number);
        if (reason && reason.trim()) {
          overrides.push({ clause_number: c.clause_number, reason });
        }
      }
    });
    return overrides;
  };

  const validateConfirms = (): boolean => {
    if (!precheckResult) return false;

    for (const c of precheckResult.update_clauses) {
      if (c.blocked && selectedBlocks.has(c.clause_number)) {
        const reason = confirmOverrides.get(c.clause_number);
        if (!reason || !reason.trim()) {
          message.error(`请为条款 [${c.clause_number}] 填写覆盖原因`);
          return false;
        }
      }
    }
    return true;
  };

  const handleImport = async () => {
    if (!validateConfirms()) return;

    try {
      setLoading(true);
      const overrides = getBlockedConfirmOverrides();
      const result = await contractsApi.confirmImport(contractId, importMode, clausesData, overrides);
      setImportResult(result);
      setStep('result');

      if (result.error_count > 0 || result.block_count > 0) {
        message.warning(
          `导入完成：新增 ${result.new_count} 条，更新 ${result.update_count} 条，` +
          `跳过 ${result.skip_count} 条，阻止 ${result.block_count} 条，错误 ${result.error_count} 条`
        );
      } else {
        message.success(`导入成功：新增 ${result.new_count} 条，更新 ${result.update_count} 条`);
      }

      onSuccess();
    } catch (e: any) {
      message.error(e.response?.data?.error || '导入失败');
    } finally {
      setLoading(false);
    }
  };

  const addBlankRow = () => {
    const current = form.getFieldValue('clauses') || [];
    form.setFieldsValue({
      clauses: [...current, { clause_number: '', title: '', content: '', risk_level: 'low' }]
    });
  };

  const downloadSample = () => {
    const blob = new Blob([JSON.stringify(SAMPLE_CLAUSES, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '条款导入模板.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleBack = () => {
    if (step === 'precheck') {
      setStep('input');
    } else if (step === 'confirm') {
      setStep('precheck');
    } else if (step === 'result') {
      setStep('input');
      setPrecheckResult(null);
      setImportResult(null);
    }
  };

  const handleClose = () => {
    if (step !== 'result' && step !== 'input') {
      modal.confirm({
        title: '确认关闭',
        content: '关闭后当前导入进度将丢失，确定继续吗？',
        okText: '确定关闭',
        cancelText: '继续操作',
        onOk: () => {
          onClose();
        }
      });
    } else {
      onClose();
    }
  };

  const riskTag = (level: string) => (
    <Tag color={RISK_COLORS[level as RiskLevel]}>{RISK_LABELS[level as RiskLevel]}</Tag>
  );

  const renderInputStep = () => (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="导入格式说明"
        description={
          <div>
            字段 <Text code>clause_number</Text>（条款编号）、<Text code>title</Text>（标题）、<Text code>content</Text>（内容）必填；
            <Text code>risk_level</Text> 可选：low / medium / high / critical；
            条款编号在合同内必须唯一且导入后保持稳定不变。
            导入前会进行预检，区分新增、更新和跳过条款。
          </div>
        }
      />

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'json',
            label: 'JSON 文本导入',
            children: (
              <div>
                <Space style={{ marginBottom: 12 }}>
                  <Button onClick={() => setJsonText(JSON.stringify(SAMPLE_CLAUSES, null, 2))}>
                    <FileTextOutlined /> 填入示例
                  </Button>
                  <Button type="primary" onClick={handleParseJson}>解析并进入预览</Button>
                </Space>
                <TextArea
                  value={jsonText}
                  onChange={e => setJsonText(e.target.value)}
                  rows={12}
                  className="diff-content"
                  placeholder="在此粘贴 JSON 格式的条款数组..."
                  style={{ fontFamily: 'Consolas, monospace' }}
                />
              </div>
            )
          },
          {
            key: 'manual',
            label: '手动逐行录入',
            children: (
              <div>
                <Button type="dashed" block style={{ marginBottom: 12 }} onClick={addBlankRow}>
                  + 新增一条条款
                </Button>
                <Form.List name="clauses">
                  {(fields, { add, remove }) => (
                    <>
                      {fields.map(({ key, name, ...restField }) => (
                        <div key={key} style={{
                          border: '1px solid #f0f0f0', padding: 12, borderRadius: 6, marginBottom: 12,
                          background: '#fafafa'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                            <Tag color="blue">第 {name + 1} 条</Tag>
                            <Button type="text" danger size="small" onClick={() => remove(name)}>删除</Button>
                          </div>
                          <Space key={key} style={{ display: 'flex', width: '100%', flexWrap: 'wrap' }} size={12}>
                            <Form.Item {...restField} name={[name, 'clause_number']}
                              label="条款编号"
                              rules={[{ required: true, message: '必填' }]}
                              style={{ width: 140, marginBottom: 8 }}>
                              <Input placeholder="如 2.1" />
                            </Form.Item>
                            <Form.Item {...restField} name={[name, 'title']}
                              label="标题"
                              rules={[{ required: true, message: '必填' }]}
                              style={{ width: 240, marginBottom: 8 }}>
                              <Input placeholder="条款标题" />
                            </Form.Item>
                            <Form.Item {...restField} name={[name, 'risk_level']}
                              label="风险等级" style={{ width: 140, marginBottom: 8 }}>
                              <Select options={[
                                { value: 'low', label: RISK_LABELS.low },
                                { value: 'medium', label: RISK_LABELS.medium },
                                { value: 'high', label: RISK_LABELS.high },
                                { value: 'critical', label: RISK_LABELS.critical }
                              ]} />
                            </Form.Item>
                            <Form.Item {...restField} name={[name, 'content']}
                              label="条款内容"
                              rules={[{ required: true, message: '必填' }]}
                              style={{ width: '100%', marginBottom: 0 }}>
                              <TextArea rows={3} placeholder="条款正文..." />
                            </Form.Item>
                          </Space>
                        </div>
                      ))}
                      <Button type="dashed" onClick={() => add()} block icon={<FileTextOutlined />}>
                        + 添加条款
                      </Button>
                    </>
                  )}
                </Form.List>
              </div>
            )
          },
          {
            key: 'review',
            label: '数据预览',
            children: (
              <div>
                <Form form={form} style={{ display: 'none' }}>
                  <Form.Item name="clauses"><Input /></Form.Item>
                </Form>
                {(() => {
                  const clauses = form.getFieldValue('clauses') || [];
                  if (clauses.length === 0) return <Paragraph type="secondary">暂无数据，请先在 JSON 或手动录入标签页填入数据。</Paragraph>;
                  return (
                    <div>
                      <Title level={5} style={{ marginTop: 0 }}>共 {clauses.length} 条待导入：</Title>
                      {clauses.map((c: any, idx: number) => (
                        <div key={idx} style={{ borderLeft: `3px solid ${c.risk_level === 'critical' ? '#f5222d' : c.risk_level === 'high' ? '#fa8c16' : c.risk_level === 'medium' ? '#faad14' : '#52c41a'}`, paddingLeft: 12, marginBottom: 16 }}>
                          <Space>
                            <Tag color="blue">[{c.clause_number || '未填'}]</Tag>
                            <Text strong>{c.title || '未填标题'}</Text>
                            {c.risk_level && riskTag(c.risk_level)}
                          </Space>
                          <Paragraph ellipsis={{ rows: 2 }} style={{ marginTop: 6, marginBottom: 0 }}>
                            {c.content || '（内容为空）'}
                          </Paragraph>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )
          }
        ]}
      />
    </div>
  );

  const renderPrecheckStep = () => {
    if (!precheckResult) return null;

    return (
      <div>
        <Alert
          type="info"
          showIcon
          icon={<InfoCircleOutlined />}
          style={{ marginBottom: 16 }}
          message={`预检完成：共 ${precheckResult.total_input} 条输入`}
          description={
            <Space wrap>
              <Tag color="green" icon={<PlusOutlined />}>新增 {precheckResult.new_count} 条</Tag>
              <Tag color="blue" icon={<EditOutlined />}>更新 {precheckResult.update_count} 条</Tag>
              <Tag color="default" icon={<CheckCircleOutlined />}>跳过 {precheckResult.skip_count} 条</Tag>
              {precheckResult.blocked_count > 0 && (
                <Tag color="red" icon={<ExclamationCircleOutlined />}>需确认 {precheckResult.blocked_count} 条</Tag>
              )}
              {precheckResult.error_count > 0 && (
                <Tag color="error" icon={<StopOutlined />}>错误 {precheckResult.error_count} 条</Tag>
              )}
            </Space>
          }
        />

        <div style={{ marginBottom: 16 }}>
          <Text strong>导入模式：</Text>
          <Radio.Group value={importMode} onChange={handleModeChange} style={{ marginLeft: 12 }}>
            <Radio.Button value="update_by_number">按编号更新（新增 + 覆盖）</Radio.Button>
            <Radio.Button value="add_only">只补新条款（跳过已存在）</Radio.Button>
          </Radio.Group>
        </div>

        <Tabs
          defaultActiveKey="new"
          items={[
            {
              key: 'new',
              label: <span><PlusOutlined /> 新增条款 ({precheckResult.new_count})</span>,
              children: precheckResult.new_clauses.length === 0 ? (
                <Empty description="无新增条款" />
              ) : (
                <List
                  size="small"
                  dataSource={precheckResult.new_clauses}
                  renderItem={item => (
                    <List.Item>
                      <List.Item.Meta
                        avatar={<Tag color="green">新增</Tag>}
                        title={
                          <Space>
                            <Text code>[{item.clause_number}]</Text>
                            <Text strong>{item.title}</Text>
                            {riskTag(item.risk_level)}
                          </Space>
                        }
                        description={
                          <Paragraph ellipsis={{ rows: 1 }} style={{ marginBottom: 0 }}>
                            {item.content}
                          </Paragraph>
                        }
                      />
                    </List.Item>
                  )}
                />
              )
            },
            {
              key: 'update',
              label: <span><EditOutlined /> 将被覆盖 ({precheckResult.update_count})</span>,
              children: precheckResult.update_clauses.length === 0 ? (
                <Empty description="无将被覆盖的条款" />
              ) : (
                <div>
                  {precheckResult.update_clauses.map((item, idx) => (
                    <Card
                      key={idx}
                      size="small"
                      style={{ marginBottom: 12 }}
                      title={
                        <Space>
                          <Tag color="blue">{item.clause_number}</Tag>
                          <Text strong>{item.new_title}</Text>
                          {item.blocked && (
                            <Tag color="red" icon={<ExclamationCircleOutlined />}>需确认</Tag>
                          )}
                        </Space>
                      }
                      extra={riskTag(item.new_risk_level)}
                    >
                      {item.blocked && (
                        <Alert
                          type="warning"
                          showIcon
                          style={{ marginBottom: 12 }}
                          message="该条款存在未处理事项，覆盖需确认"
                          description={
                            <div>
                              {item.has_pending_suggestions && (
                                <div>
                                  <Text type="warning">
                                    <ExclamationCircleOutlined /> 待处理建议：{item.pending_suggestions_count} 条
                                  </Text>
                                  <ul style={{ margin: '4px 0 8px 20px', padding: 0 }}>
                                    {item.pending_suggestions.slice(0, 3).map((s: any) => (
                                      <li key={s.id}>
                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                          {s.creator_name}：{s.content.substring(0, 30)}...
                                        </Text>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {item.has_drafts && (
                                <div>
                                  <Text type="warning">
                                    <ExclamationCircleOutlined /> 未提交草稿：{item.drafts.length} 份
                                  </Text>
                                  <ul style={{ margin: '4px 0 0 20px', padding: 0 }}>
                                    {item.drafts.map((d: any) => (
                                      <li key={d.id}>
                                        <Text type="secondary" style={{ fontSize: 12 }}>
                                          {d.user_name}（{d.user_role}）的{d.type === 'amendment' ? '修改建议' : '评论'}草稿
                                        </Text>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          }
                        />
                      )}
                      <div style={{ display: 'flex', gap: 16 }}>
                        <div style={{ flex: 1 }}>
                          <Text type="secondary">当前版本 (v{item.current_version})：</Text>
                          <Paragraph ellipsis={{ rows: 2 }} style={{ marginTop: 4, marginBottom: 0 }}>
                            {item.old_content}
                          </Paragraph>
                        </div>
                        <div style={{ flex: 1 }}>
                          <Text type="secondary">导入后：</Text>
                          <Paragraph ellipsis={{ rows: 2 }} style={{ marginTop: 4, marginBottom: 0 }}>
                            {item.new_content}
                          </Paragraph>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )
            },
            {
              key: 'skip',
              label: <span><CheckCircleOutlined /> 直接跳过 ({precheckResult.skip_count})</span>,
              children: precheckResult.skip_clauses.length === 0 ? (
                <Empty description="无跳过条款" />
              ) : (
                <List
                  size="small"
                  dataSource={precheckResult.skip_clauses}
                  renderItem={item => (
                    <List.Item>
                      <List.Item.Meta
                        avatar={<Tag color="default">跳过</Tag>}
                        title={
                          <Space>
                            <Text code>[{item.clause_number}]</Text>
                            <Text>{item.title}</Text>
                            <Text type="secondary">v{item.current_version}</Text>
                          </Space>
                        }
                        description="内容无变化，直接跳过"
                      />
                    </List.Item>
                  )}
                />
              )
            }
          ]}
        />
      </div>
    );
  };

  const renderConfirmStep = () => {
    if (!precheckResult) return null;

    const blockedClauses = precheckResult.update_clauses.filter(c => c.blocked);
    const hasBlocked = blockedClauses.length > 0;

    return (
      <div>
        <Alert
          type={hasBlocked ? 'warning' : 'success'}
          showIcon
          style={{ marginBottom: 16 }}
          message={hasBlocked ? '请确认需要覆盖的条款' : '确认导入操作'}
          description={
            <div>
              <Space wrap>
                <Tag color="green">新增 {precheckResult.new_count} 条</Tag>
                {importMode === 'update_by_number' && (
                  <Tag color="blue">更新 {precheckResult.update_count} 条</Tag>
                )}
                <Tag color="default">跳过 {precheckResult.skip_count + (importMode === 'add_only' ? precheckResult.update_count : 0)} 条</Tag>
              </Space>
              {importMode === 'add_only' && (
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary">当前为"只补新条款"模式，已存在的条款将全部跳过。</Text>
                </div>
              )}
            </div>
          }
        />

        {hasBlocked && importMode === 'update_by_number' && (
          <div>
            <Title level={5} style={{ marginTop: 0 }}>需确认覆盖的条款</Title>
            <Text type="secondary" style={{ marginBottom: 12, display: 'block' }}>
              勾选并填写覆盖原因后，这些条款将被更新。未勾选的条款将被跳过。
            </Text>
            {blockedClauses.map((item, idx) => (
              <Card
                key={idx}
                size="small"
                style={{ marginBottom: 12 }}
                title={
                  <Space>
                    <Checkbox
                      checked={selectedBlocks.has(item.clause_number)}
                      onChange={e => handleBlockToggle(item.clause_number, e.target.checked)}
                    >
                      <Tag color="blue">{item.clause_number}</Tag>
                      <Text strong>{item.new_title}</Text>
                    </Checkbox>
                  </Space>
                }
              >
                <div style={{ marginBottom: 8 }}>
                  <Text type="warning">
                    <ExclamationCircleOutlined /> 存在 {item.pending_suggestions_count} 条待处理建议
                    {item.has_drafts && ` 和 ${item.drafts.length} 份未提交草稿`}
                  </Text>
                </div>
                {selectedBlocks.has(item.clause_number) && (
                  <Form.Item
                    label="覆盖原因"
                    required
                    style={{ marginBottom: 0 }}
                  >
                    <TextArea
                      rows={2}
                      placeholder="请填写覆盖原因，说明为什么要在有未处理事项的情况下覆盖此条款..."
                      value={confirmOverrides.get(item.clause_number) || ''}
                      onChange={e => handleOverrideReasonChange(item.clause_number, e.target.value)}
                    />
                  </Form.Item>
                )}
              </Card>
            ))}
          </div>
        )}

        <Divider />

        <Alert
          type="info"
          showIcon
          message="导入影响说明"
          description={
            <ul style={{ margin: '8px 0 0 20px', padding: 0 }}>
              <li>被覆盖的条款版本号将递增，历史版本保留</li>
              <li>现有草稿将保留，但基于旧版本的草稿会提示版本冲突</li>
              <li>待处理建议将保留，但基于旧版本的建议可能需要重新评估</li>
              <li>所有操作将记录到审计日志中</li>
            </ul>
          }
        />
      </div>
    );
  };

  const renderResultStep = () => {
    if (!importResult) return null;

    return (
      <div>
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
          message="导入完成"
          description={
            <Space wrap>
              <Tag color="green">新增 {importResult.new_count} 条</Tag>
              <Tag color="blue">更新 {importResult.update_count} 条</Tag>
              <Tag color="default">跳过 {importResult.skip_count} 条</Tag>
              {importResult.block_count > 0 && (
                <Tag color="orange">阻止 {importResult.block_count} 条</Tag>
              )}
              {importResult.error_count > 0 && (
                <Tag color="red">错误 {importResult.error_count} 条</Tag>
              )}
            </Space>
          }
        />

        <Tabs
          defaultActiveKey="new"
          items={[
            {
              key: 'new',
              label: `新增 (${importResult.new_count})`,
              children: importResult.imported_new.length === 0 ? (
                <Empty description="无新增条款" />
              ) : (
                <List
                  size="small"
                  dataSource={importResult.imported_new}
                  renderItem={(item: any) => (
                    <List.Item>
                      <List.Item.Meta
                        avatar={<Tag color="green">新增</Tag>}
                        title={
                          <Space>
                            <Text code>[{item.clause_number}]</Text>
                            <Text strong>{item.title}</Text>
                          </Space>
                        }
                      />
                    </List.Item>
                  )}
                />
              )
            },
            {
              key: 'updated',
              label: `更新 (${importResult.update_count})`,
              children: importResult.updated.length === 0 ? (
                <Empty description="无更新条款" />
              ) : (
                <List
                  size="small"
                  dataSource={importResult.updated}
                  renderItem={(item: any) => (
                    <List.Item>
                      <List.Item.Meta
                        avatar={<Tag color="blue">更新</Tag>}
                        title={
                          <Space>
                            <Text code>[{item.clause_number}]</Text>
                            <Text strong>{item.title}</Text>
                            <Text type="secondary">v{item.old_version} → v{item.new_version}</Text>
                          </Space>
                        }
                        description={item.override_reason ? `覆盖原因：${item.override_reason}` : null}
                      />
                    </List.Item>
                  )}
                />
              )
            },
            {
              key: 'skipped',
              label: `跳过 (${importResult.skip_count})`,
              children: importResult.skipped.length === 0 ? (
                <Empty description="无跳过条款" />
              ) : (
                <List
                  size="small"
                  dataSource={importResult.skipped}
                  renderItem={(item: any) => (
                    <List.Item>
                      <List.Item.Meta
                        avatar={<Tag color="default">跳过</Tag>}
                        title={
                          <Space>
                            <Text code>[{item.clause_number}]</Text>
                            <Text>{item.title}</Text>
                          </Space>
                        }
                        description={item.reason}
                      />
                    </List.Item>
                  )}
                />
              )
            },
            importResult.block_count > 0 ? {
              key: 'blocked',
              label: `阻止 (${importResult.block_count})`,
              children: (
                <List
                  size="small"
                  dataSource={importResult.blocked}
                  renderItem={(item: any) => (
                    <List.Item>
                      <List.Item.Meta
                        avatar={<Tag color="red">阻止</Tag>}
                        title={
                          <Space>
                            <Text code>[{item.clause_number}]</Text>
                            <Text>{item.title}</Text>
                          </Space>
                        }
                        description={item.reason}
                      />
                    </List.Item>
                  )}
                />
              )
            } : null
          ].filter(Boolean) as any}
        />
      </div>
    );
  };

  const getModalTitle = () => {
    switch (step) {
      case 'input': return <span><UploadOutlined /> 导入合同条款</span>;
      case 'precheck': return <span><InfoCircleOutlined /> 导入预检</span>;
      case 'confirm': return <span><ExclamationCircleOutlined /> 确认导入</span>;
      case 'result': return <span><CheckCircleOutlined /> 导入结果</span>;
      default: return <span><UploadOutlined /> 导入合同条款</span>;
    }
  };

  const getOkText = () => {
    switch (step) {
      case 'input': return '下一步：预检';
      case 'precheck': return '下一步：确认';
      case 'confirm': return '确认导入';
      case 'result': return '完成';
      default: return '确认导入';
    }
  };

  const handleOk = () => {
    if (step === 'input') {
      handlePrecheck();
    } else if (step === 'precheck') {
      handleGoToConfirm();
    } else if (step === 'confirm') {
      handleImport();
    } else if (step === 'result') {
      onClose();
    }
  };

  return (
    <Modal
      title={getModalTitle()}
      open={open}
      onCancel={handleClose}
      onOk={handleOk}
      okText={getOkText()}
      cancelText={step === 'input' || step === 'result' ? '关闭' : '上一步'}
      confirmLoading={loading || precheckLoading}
      width={900}
      okButtonProps={step === 'precheck' ? { disabled: !canProceedToConfirm() } : undefined}
      footer={(_, { OkBtn, CancelBtn }) => (
        <Space>
          <Button icon={<DownloadOutlined />} onClick={downloadSample} disabled={step !== 'input'}>
            下载模板示例
          </Button>
          {step !== 'input' && step !== 'result' && (
            <Button onClick={handleBack}>上一步</Button>
          )}
          {step === 'result' ? (
            <Button type="primary" onClick={onClose}>完成</Button>
          ) : (
            <Button
              type="primary"
              onClick={handleOk}
              loading={loading || precheckLoading}
              disabled={step === 'precheck' && !canProceedToConfirm()}
            >
              {getOkText()}
            </Button>
          )}
        </Space>
      )}
    >
      {step === 'input' && renderInputStep()}
      {step === 'precheck' && renderPrecheckStep()}
      {step === 'confirm' && renderConfirmStep()}
      {step === 'result' && renderResultStep()}
    </Modal>
  );
};

export default ImportClauseModal;
