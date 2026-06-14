import React, { useState, useEffect } from 'react';
import { Table, Button, Space, Modal, Form, Input, Typography, Tag, Popconfirm, App as AntdApp } from 'antd';
import { PlusOutlined, DeleteOutlined, UploadOutlined, FileTextOutlined, ExportOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { contractsApi, reportsApi } from '../api';
import { Contract } from '../types';
import { useAuthStore } from '../store';
import ImportClauseModal from '../components/ImportClauseModal';
import dayjs from 'dayjs';

const { Title } = Typography;

const ContractsPage: React.FC = () => {
  const [data, setData] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState<string | null>(null);
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const user = useAuthStore(s => s.user);
  const isAdmin = user?.role === 'admin';

  const loadData = async () => {
    setLoading(true);
    try {
      const list = await contractsApi.list();
      setData(list);
    } catch (e: any) {
      message.error(e.response?.data?.error || '加载失败');
    } finally {
      setLoading(false);
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
      title: '创建时间',
      dataIndex: 'created_at',
      width: 170,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm')
    },
    {
      title: '操作',
      width: 280,
      render: (_: any, r: Contract) => (
        <Space size="small">
          <Button type="link" size="small" icon={<UploadOutlined />} onClick={() => setImportOpen(r.id)}>导入条款</Button>
          <Button type="link" size="small" icon={<FileTextOutlined />} onClick={() => navigate(`/contracts/${r.id}/clauses`)}>查看条款</Button>
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
    </div>
  );
};

export default ContractsPage;
