import React, { useState, useEffect } from 'react';
import { Table, Button, Space, Modal, Form, Input, Typography, Tag, Popconfirm, App as AntdApp, Tooltip, Progress } from 'antd';
import {
  PlusOutlined, DeleteOutlined, UploadOutlined, FileTextOutlined, ExportOutlined,
  AuditOutlined, EyeOutlined, UserOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { contractsApi, reportsApi, countersignApi } from '../api';
import { Contract, CountersignRound, COUNTERSIGN_STATUS_COLORS, COUNTERSIGN_STATUS_LABELS } from '../types';
import { useAuthStore } from '../store';
import ImportClauseModal from '../components/ImportClauseModal';
import CreateCountersignModal from '../components/CreateCountersignModal';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const ContractsPage: React.FC = () => {
  const [data, setData] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState<string | null>(null);
  const [createCountersignOpen, setCreateCountersignOpen] = useState<{ id: string; name: string } | null>(null);
  const [countersignsByContract, setCountersignsByContract] = useState<Record<string, CountersignRound[]>>({});
  const [countersignLoading, setCountersignLoading] = useState(false);
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const user = useAuthStore(s => s.user);
  const isAdmin = user?.role === 'admin';

  const loadData = async () => {
    setLoading(true);
    try {
      const list = await contractsApi.list();
      setData(list as Contract[]);
      loadAllCountersigns(list as Contract[]);
    } catch (e: any) {
      message.error(e.response?.data?.error || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const loadAllCountersigns = async (contracts: Contract[]) => {
    setCountersignLoading(true);
    try {
      const results: Record<string, CountersignRound[]> = {};
      for (const c of contracts) {
        try {
          const list = await countersignApi.listByContract(c.id);
          results[c.id] = list as CountersignRound[];
        } catch {}
      }
      setCountersignsByContract(results);
    } finally {
      setCountersignLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      await contractsApi.create(values);
      message.success('创建成功');
      setCreateOpen(false);
      form.resetFields();
      loadData();
    } catch {}
  };

  const handleDelete = async (id: string) => {
    try {
      await contractsApi.delete(id);
      message.success('删除成功');
      loadData();
    } catch (e: any) {
      message.error(e.response?.data?.error || '删除失败');
    }
  };

  const handleExport = async (id: string, name: string) => {
    try {
      const blob = await reportsApi.exportContract(id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `评审包-${name}-${dayjs().format('YYYYMMDDHHmmss')}.json`;
      a.click();
      window.URL.revokeObjectURL(url);
      message.success('评审包导出成功，包含完整版本历史与决策日志');
    } catch (e: any) {
      message.error(e.response?.data?.error || '导出失败');
    }
  };

  const renderExpandedRow = (r: Contract) => {
    const rounds = countersignsByContract[r.id] || [];
    if (rounds.length === 0) {
      return (
        <div style={{ padding: '8px 16px' }}>
          <Text type="secondary">暂无会签记录。{isAdmin ? '点击"发起会签"按钮创建会签回合。' : ''}</Text>
        </div>
      );
    }
    return (
      <div style={{ padding: '8px 0' }}>
        <Table
          rowKey="id"
          size="small"
          loading={countersignLoading}
          pagination={false}
          dataSource={rounds}
          columns={[
            { title: '会签名称', dataIndex: 'round_name', render: (v, r2: any) =>
              <a onClick={() => navigate(`/countersigns/${r2.id}`)} style={{ fontWeight: 500 }}>
                <AuditOutlined /> {v}
              </a>
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 90,
              render: (v: string) => (
                <Tag color={COUNTERSIGN_STATUS_COLORS[v as keyof typeof COUNTERSIGN_STATUS_COLORS]}>
                  {COUNTERSIGN_STATUS_LABELS[v as keyof typeof COUNTERSIGN_STATUS_LABELS]}
                </Tag>
              )
            },
            {
              title: '进度',
              key: 'progress',
              width: 220,
              render: (_: any, r2: CountersignRound) => {
                const total = (r2.participant_count || 0) * (r2.clause_count || 0);
                const done = r2.concluded_count || 0;
                const ack = r2.acknowledged_count || 0;
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                const canBeComplete = total === 0 ? true : done === total;
                return (
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Progress percent={pct} size="small" style={{ margin: 0, flex: 1 }} status={pct === 100 ? 'success' : 'active'} />
                      <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{done}/{total}</Text>
                    </div>
                    {!canBeComplete ? (
                      <Tag color="orange" style={{ width: 'fit-content' }}>
                        <UserOutlined /> 未全部签署，合同不可标记完成
                      </Tag>
                    ) : r2.status === 'completed' ? (
                      <Tag color="green" style={{ width: 'fit-content' }}>已全部完成</Tag>
                    ) : null}
                    {ack > 0 && !canBeComplete && (
                      <Text type="secondary" style={{ fontSize: 12 }}>{ack} 条已签收待签署</Text>
                    )}
                  </Space>
                );
              }
            },
            { title: '创建人', dataIndex: 'creator_name', width: 100 },
            {
              title: '截止',
              dataIndex: 'deadline',
              width: 150,
              render: (v: any) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : <Text type="secondary">无</Text>
            },
            { title: '参与人/条款', key: 'counts', width: 100, render: (_: any, r2: any) =>
              <Space>
                <Tag color="blue">{r2.participant_count || 0}人</Tag>
                <Tag color="cyan">{r2.clause_count || 0}条</Tag>
              </Space>
            },
            {
              title: '操作',
              key: 'op',
              width: 80,
              render: (_: any, r2: any) => (
                <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => navigate(`/countersigns/${r2.id}`)}>详情</Button>
              )
            }
          ]}
        />
      </div>
    );
  };

  const columns = [
    {
      title: '合同名称',
      dataIndex: 'name',
      render: (v: string, r: Contract) => (
        <a onClick={() => navigate(`/contracts/${r.id}/clauses`)} style={{ fontWeight: 500 }}>
          <FileTextOutlined /> {v}
        </a>
      )
    },
    { title: '描述', dataIndex: 'description', ellipsis: true },
    { title: '创建人', dataIndex: 'creator_name' },
    {
      title: '条款数',
      dataIndex: 'clause_count',
      width: 80,
      render: (v: number) => <Tag color="blue">{v || 0} 条</Tag>
    },
    {
      title: '待处理建议',
      dataIndex: 'pending_suggestions',
      width: 110,
      render: (v: number) => v > 0 ? <Tag color="red">{v} 条</Tag> : <Tag color="green">无</Tag>
    },
    {
      title: '会签状态',
      key: 'cs_status',
      width: 140,
      render: (_: any, r: Contract) => {
        const rounds = countersignsByContract[r.id] || [];
        if (rounds.length === 0) {
          return <Tag color="default">无会签</Tag>;
        }
        const activeRounds = rounds.filter(rr => rr.status === 'active');
        const completedRounds = rounds.filter(rr => rr.status === 'completed');
        const hasBlocking = activeRounds.some(rr => {
          const total = (rr.participant_count || 0) * (rr.clause_count || 0);
          const done = rr.concluded_count || 0;
          return total > 0 && done < total;
        });
        return (
          <Space direction="vertical" size={2}>
            <Space size={4} wrap>
              {activeRounds.length > 0 && (
                <Tag color={hasBlocking ? 'red' : 'blue'}>进行中 {activeRounds.length}</Tag>
              )}
              {completedRounds.length > 0 && <Tag color="green">已完成 {completedRounds.length}</Tag>}
              {rounds.filter(rr => rr.status === 'withdrawn').length > 0 && (
                <Tag color="default">已撤回 {rounds.filter(rr => rr.status === 'withdrawn').length}</Tag>
              )}
            </Space>
            {hasBlocking && (
              <Text type="danger" style={{ fontSize: 11 }}>未完成，不可作为已完成</Text>
            )}
          </Space>
        );
      }
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 170,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm')
    },
    {
      title: '操作',
      width: 380,
      render: (_: any, r: Contract) => (
        <Space size="small">
          <Button type="link" size="small" icon={<UploadOutlined />} onClick={() => setImportOpen(r.id)}>导入条款</Button>
          <Button type="link" size="small" icon={<FileTextOutlined />} onClick={() => navigate(`/contracts/${r.id}/clauses`)}>查看条款</Button>
          {isAdmin && (
            <Tooltip title="选参与人、条款和截止时间发起会签回合">
              <Button type="link" size="small" icon={<AuditOutlined />} onClick={() => setCreateCountersignOpen({ id: r.id, name: r.name })}>
                发起会签
              </Button>
            </Tooltip>
          )}
          <Button type="link" size="small" icon={<ExportOutlined />} onClick={() => handleExport(r.id, r.name)}>导出评审包</Button>
          {isAdmin && (
            <Popconfirm title="确定删除此合同？所有条款和建议将一并删除。" onConfirm={() => handleDelete(r.id)}>
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          )}
        </Space>
      )
    }
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>合同管理</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建合同</Button>
      </div>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={data}
        pagination={{ pageSize: 10 }}
        expandable={{
          expandedRowRender: renderExpandedRow,
          expandRowByClick: false,
          columnWidth: 40
        }}
      />

      <Modal title="新建合同" open={createOpen} onOk={handleCreate} onCancel={() => { setCreateOpen(false); form.resetFields(); }}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="合同名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：2026年度供应商合作框架协议" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="简要描述合同目的与范围" />
          </Form.Item>
        </Form>
      </Modal>

      {importOpen && (
        <ImportClauseModal
          contractId={importOpen}
          open={!!importOpen}
          onClose={() => setImportOpen(null)}
          onSuccess={() => { loadData(); }}
        />
      )}

      {createCountersignOpen && (
        <CreateCountersignModal
          contractId={createCountersignOpen.id}
          contractName={createCountersignOpen.name}
          open={!!createCountersignOpen}
          onClose={() => setCreateCountersignOpen(null)}
          onSuccess={() => { loadData(); }}
        />
      )}
    </div>
  );
};

export default ContractsPage;
