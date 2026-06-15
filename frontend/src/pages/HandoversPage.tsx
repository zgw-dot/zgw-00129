import React, { useState, useEffect } from 'react';
import { Card, Table, Tag, Button, Space, Typography, Modal, Form, Select, Input, App as AntdApp, Descriptions, List, Spin } from 'antd';
import { PlusOutlined, EyeOutlined, SwapOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  Handover, HandoverScope,
  HANDOVER_STATUS_COLORS, HANDOVER_STATUS_LABELS,
  HANDOVER_SCOPE_LABELS, HANDOVER_ITEM_TYPE_LABELS
} from '../types';
import { handoverApi, authApi } from '../api';
import { useAuthStore } from '../store';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const HandoversPage: React.FC = () => {
  const [data, setData] = useState<Handover[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const user = useAuthStore(s => s.user);
  const [form] = Form.useForm();

  const loadData = async () => {
    setLoading(true);
    try {
      const list = await handoverApi.list();
      setData(list as Handover[]);
    } catch (e: any) {
      message.error(e.response?.data?.error || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const list = await authApi.users();
      setUsers(list.filter((u: any) => u.id !== user?.id));
    } catch {}
  };

  useEffect(() => { loadData(); loadUsers(); }, []);

  const handlePreview = async () => {
    try {
      const values = await form.validateFields();
      setPreviewLoading(true);
      setShowPreview(true);
      const result = await handoverApi.preview({
        to_user_id: values.to_user_id,
        scope: values.scope
      });
      setPreviewData(result);
    } catch (e: any) {
      if (e.response?.data?.error) {
        message.error(e.response.data.error);
      }
      setShowPreview(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      const result = await handoverApi.create({
        to_user_id: values.to_user_id,
        scope: values.scope,
        reason: values.reason
      });
      message.success(`交接单 ${result.handover?.handover_no || ''} 创建成功`);
      setShowPreview(false);
      setShowCreate(false);
      form.resetFields();
      loadData();
    } catch (e: any) {
      message.error(e.response?.data?.error || '创建失败');
    }
  };

  const handleWithdraw = async (record: Handover) => {
    Modal.confirm({
      title: '撤回交接单',
      content: '确认撤回此交接单？撤回后接收人将无法签收。',
      okText: '确认撤回',
      cancelText: '取消',
      onOk: async () => {
        try {
          await handoverApi.withdraw(record.id, '管理员撤回');
          message.success('已撤回');
          loadData();
        } catch (e: any) {
          message.error(e.response?.data?.error || '撤回失败');
        }
      }
    });
  };

  const columns = [
    {
      title: '交接单号',
      dataIndex: 'handover_no',
      width: 180,
      render: (v: string, r: Handover) => (
        <a onClick={() => navigate(`/handovers/${r.id}`)} style={{ fontWeight: 500 }}>{v}</a>
      )
    },
    {
      title: '发起人',
      dataIndex: 'from_user_name',
      width: 100
    },
    {
      title: '接收人',
      dataIndex: 'to_user_name',
      width: 100
    },
    {
      title: '范围',
      dataIndex: 'scope',
      width: 100,
      render: (v: HandoverScope) => (
        <Tag>{HANDOVER_SCOPE_LABELS[v]}</Tag>
      )
    },
    {
      title: '项目数',
      dataIndex: 'item_count',
      width: 80,
      render: (v: number) => <Text>{v}</Text>
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => (
        <Tag color={HANDOVER_STATUS_COLORS[v as keyof typeof HANDOVER_STATUS_COLORS]}>
          {HANDOVER_STATUS_LABELS[v as keyof typeof HANDOVER_STATUS_LABELS]}
        </Tag>
      )
    },
    {
      title: '原因',
      dataIndex: 'reason',
      ellipsis: true,
      width: 200
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 160,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm')
    },
    {
      title: '签收时间',
      dataIndex: 'signed_at',
      width: 160,
      render: (v: string | null) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : <Text type="secondary">-</Text>
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_: any, r: Handover) => (
        <Space>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => navigate(`/handovers/${r.id}`)}>详情</Button>
          {r.status === 'pending' && user?.role === 'admin' && (
            <Button type="link" size="small" danger onClick={() => handleWithdraw(r)}>撤回</Button>
          )}
        </Space>
      )
    }
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>评审交接单</Title>
        <Space>
          {user?.role !== 'admin' && (
            <Button type="primary" icon={<SwapOutlined />} onClick={() => { setShowCreate(true); form.resetFields(); }}>发起交接</Button>
          )}
          <Button onClick={loadData}>刷新</Button>
        </Space>
      </div>
      <Card>
        <Table rowKey="id" loading={loading} columns={columns} dataSource={data} pagination={{ pageSize: 10 }} />
      </Card>

      <Modal
        title="发起评审交接"
        open={showCreate}
        onCancel={() => { setShowCreate(false); setShowPreview(false); }}
        footer={showPreview ? [
          <Button key="back" onClick={() => setShowPreview(false)}>返回修改</Button>,
          <Button key="submit" type="primary" onClick={handleCreate}>确认创建</Button>
        ] : [
          <Button key="cancel" onClick={() => setShowCreate(false)}>取消</Button>,
          <Button key="preview" type="primary" onClick={handlePreview} loading={previewLoading}>预览</Button>
        ]}
        width={showPreview ? 800 : 520}
      >
        {!showPreview ? (
          <Form form={form} layout="vertical">
            <Form.Item name="to_user_id" label="接收人" rules={[{ required: true, message: '请选择接收人' }]}>
              <Select placeholder="请选择接收人" showSearch optionFilterProp="label">
                {users.map(u => (
                  <Select.Option key={u.id} value={u.id} label={u.display_name}>
                    {u.display_name} ({u.role === 'legal' ? '法务' : u.role === 'business' ? '业务' : '管理员'})
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item name="scope" label="交接范围" rules={[{ required: true }]} initialValue="all">
              <Select>
                <Select.Option value="all">全部（草稿+会签+工单+建议）</Select.Option>
                <Select.Option value="drafts">仅草稿</Select.Option>
                <Select.Option value="countersigns">仅会签待办</Select.Option>
                <Select.Option value="tickets">仅复查工单</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item name="reason" label="交接原因" rules={[{ required: true, message: '请填写交接原因' }]}>
              <Input.TextArea rows={3} placeholder="请说明交接原因" />
            </Form.Item>
          </Form>
        ) : previewLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin tip="加载预览..." /></div>
        ) : previewData ? (
          <div>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="发起人">{previewData.from_user_name}</Descriptions.Item>
              <Descriptions.Item label="接收人">{previewData.to_user_name} ({previewData.to_user_role})</Descriptions.Item>
              <Descriptions.Item label="交接范围">{HANDOVER_SCOPE_LABELS[previewData.scope as HandoverScope]}</Descriptions.Item>
              <Descriptions.Item label="项目总数">{previewData.summary.total}</Descriptions.Item>
            </Descriptions>
            <div style={{ margin: '12px 0' }}>
              <Space>
                <Tag color="blue">草稿 {previewData.summary.drafts}</Tag>
                <Tag color="green">会签 {previewData.summary.countersigns}</Tag>
                <Tag color="orange">工单 {previewData.summary.tickets}</Tag>
                <Tag color="purple">建议 {previewData.summary.suggestions}</Tag>
              </Space>
            </div>
            <List
              size="small"
              bordered
              dataSource={previewData.items}
              pagination={previewData.items.length > 10 ? { pageSize: 10 } : false}
              renderItem={(item: any) => (
                <List.Item>
                  <Space>
                    <Tag>{HANDOVER_ITEM_TYPE_LABELS[item.item_type as keyof typeof HANDOVER_ITEM_TYPE_LABELS]}</Tag>
                    <Text>{item.snapshot?.clause_number || item.snapshot?.round_name || item.snapshot?.ticket_no || item.item_id}</Text>
                    <Text type="secondary">{item.snapshot?.title || item.snapshot?.clause_title || item.snapshot?.round_name || ''}</Text>
                    <Text type="secondary">状态: {item.status_at_handover}</Text>
                  </Space>
                </List.Item>
              )}
            />
          </div>
        ) : null}
      </Modal>
    </div>
  );
};

export default HandoversPage;
