import React, { useState, useEffect } from 'react';
import { Modal, Tabs, Button, Form, Input, Select, App as AntdApp, Typography, Space, Tag, Divider, Alert } from 'antd';
import { UploadOutlined, FileTextOutlined, DownloadOutlined } from '@ant-design/icons';
import { contractsApi } from '../api';
import { RiskLevel, RISK_LABELS, RISK_COLORS } from '../types';

const { Paragraph, Text, Title } = Typography;

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

const ImportClauseModal: React.FC<Props> = ({ contractId, open, onClose, onSuccess }) => {
  const [activeTab, setActiveTab] = useState('json');
  const [jsonText, setJsonText] = useState('');
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const { message } = AntdApp.useApp();

  useEffect(() => {
    if (open) {
      setJsonText(JSON.stringify(SAMPLE_CLAUSES, null, 2));
      form.resetFields();
      setActiveTab('json');
    }
  }, [open]);

  const handleParseJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) throw new Error('必须是数组');
      form.setFieldsValue({ clauses: parsed });
      message.success(`解析成功，共 ${parsed.length} 条条款`);
      setActiveTab('review');
    } catch (e: any) {
      message.error('JSON 解析失败：' + e.message);
    }
  };

  const handleImport = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      const result = await contractsApi.importClauses(contractId, values.clauses);
      if (result.error_count > 0) {
        message.warning(`部分导入成功：成功 ${result.imported_count} 条，失败 ${result.error_count} 条。错误：${result.errors.join('；')}`);
      } else {
        message.success(`成功导入 ${result.imported_count} 条条款`);
      }
      onSuccess();
      onClose();
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

  return (
    <Modal
      title={<span><UploadOutlined /> 导入合同条款</span>}
      open={open}
      onCancel={onClose}
      onOk={handleImport}
      okText="确认导入"
      cancelText="取消"
      confirmLoading={loading}
      width={900}
      footer={(_, { OkBtn, CancelBtn }) => (
        <Space>
          <Button icon={<DownloadOutlined />} onClick={downloadSample}>下载模板示例</Button>
          <CancelBtn />
          <OkBtn />
        </Space>
      )}
    >
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
                <Input.TextArea
                  value={jsonText}
                  onChange={e => setJsonText(e.target.value)}
                  rows={14}
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
                              <Input.TextArea rows={3} placeholder="条款正文..." />
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
                            {c.risk_level && <Tag color={RISK_COLORS[c.risk_level as RiskLevel]}>{RISK_LABELS[c.risk_level as RiskLevel]}</Tag>}
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
    </Modal>
  );
};

export default ImportClauseModal;
