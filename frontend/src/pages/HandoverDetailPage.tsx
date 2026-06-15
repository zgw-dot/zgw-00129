import React, { useState, useEffect } from 'react';
import { Card, Tag, Button, Space, Typography, Descriptions, Table, Timeline, Modal, Input, App as AntdApp, Alert } from 'antd';
import { ArrowLeftOutlined, CheckCircleOutlined, CloseCircleOutlined, WarningOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import {
  HandoverDetail, HandoverConflict,
  HANDOVER_STATUS_COLORS, HANDOVER_STATUS_LABELS,
  HANDOVER_SCOPE_LABELS, HANDOVER_ITEM_TYPE_LABELS,
  HANDOVER_HISTORY_ACTION_LABELS
} from '../types';
import { handoverApi } from '../api';
import { useAuthStore } from '../store';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const HandoverDetailPage: React.FC = () => {
  const [detail, setDetail] = useState<HandoverDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [signNote, setSignNote] = useState('');
  const [conflicts, setConflicts] = useState<HandoverConflict[]>([]);
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { message } = AntdApp.useApp();
  const user = useAuthStore(s => s.user);

  const loadData = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await handoverApi.get(id);
      setDetail(data as HandoverDetail);
    } catch (e: any) {
      message.error(e.response?.data?.error || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const loadConflicts = async () => {
    if (!id) return;
    try {
      const data = await handoverApi.conflicts(id);
      setConflicts(data.conflicts);
    } catch {}
  };

  useEffect(() => { loadData(); }, [id]);

  const handleSign = () => {
    if (!detail) return;
    Modal.confirm({
      title: '签收交接单',
      content: (
        <div>
          <p>签收后，以下项目将转移到您名下：</p>
          <ul>
            <li>草稿：转移所有权到您</li>
            <li>会签：替换参与人为您</li>
            <li>工单：改派责任人为您</li>
          </ul>
          <Input.TextArea
            rows={2}
            placeholder="签收备注（可选）"
            value={signNote}
            onChange={e => setSignNote(e.target.value)}
          />
        </div>
      ),
      okText: '确认签收',
      cancelText: '取消',
      onOk: async () => {
        try {
          await handoverApi.sign(detail.id, signNote);
          message.success('签收成功');
          setSignNote('');
          loadData();
        } catch (e: any) {
          if (e.response?.status === 409) {
            message.warning('存在冲突，请查看冲突详情后重新确认');
            loadConflicts();
            loadData();
          } else {
            message.error(e.response?.data?.error || '签收失败');
          }
        }
      }
    });
  };

  const handleWithdraw = () => {
    if (!detail) return;
    Modal.confirm({
      title: '撤回交接单',
      content: '确认撤回？撤回后接收人将无法签收。',
      okText: '确认撤回',
      cancelText: '取消',
      onOk: async () => {
        try {
          await handoverApi.withdraw(detail.id, '管理员撤回');
          message.success('已撤回');
          loadData();
        } catch (e: any) {
          message.error(e.response?.data?.error || '撤回失败');
        }
      }
    });
  };

  const handleReconfirm = (force = false) => {
    if (!detail) return;
    Modal.confirm({
      title: '重新确认交接',
      content: force ? '确认强制签收（忽略剩余冲突）？' : '确认移除冲突项目后重新交接？',
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        try {
          const removeItems = force ? [] : conflicts.map(c => ({ item_type: c.item_type, item_id: c.item_id }));
          await handoverApi.reconfirm(detail.id, { remove_conflict_items: removeItems, force });
          message.success('已重新确认');
          setConflicts([]);
          loadData();
        } catch (e: any) {
          if (e.response?.status === 409) {
            message.warning('仍有冲突，请重新检查');
            loadConflicts();
          } else {
            message.error(e.response?.data?.error || '重新确认失败');
          }
        }
      }
    });
  };

  if (!detail) {
    return <Card loading={loading}><Text>加载中...</Text></Card>;
  }

  const isRecipient = user?.id === detail.to_user_id;
  const isAdmin = user?.role === 'admin';
  const canSign = isRecipient && detail.status === 'pending';
  const canWithdraw = isAdmin && (detail.status === 'pending' || detail.status === 'conflict');
  const canReconfirm = isRecipient && detail.status === 'conflict';

  const itemColumns = [
    {
      title: '类型',
      dataIndex: 'item_type',
      width: 100,
      render: (v: string) => <Tag>{HANDOVER_ITEM_TYPE_LABELS[v as keyof typeof HANDOVER_ITEM_TYPE_LABELS]}</Tag>
    },
    {
      title: '项目ID',
      dataIndex: 'item_id',
      width: 120,
      ellipsis: true
    },
    {
      title: '快照摘要',
      key: 'snapshot_summary',
      render: (_: any, r: any) => {
        const s = r.snapshot || {};
        if (r.item_type === 'draft') return `${s.clause_number || ''} ${s.title || ''}`;
        if (r.item_type === 'countersign') return `${s.round_name || ''} (${s.contract_name || ''})`;
        if (r.item_type === 'ticket') return `${s.ticket_no || ''} ${s.clause_title || ''}`;
        if (r.item_type === 'suggestion') return `${s.clause_number || ''} ${s.title || ''}`;
        return '-';
      }
    },
    {
      title: '交接时状态',
      dataIndex: 'status_at_handover',
      width: 120
    },
    {
      title: '交接时版本',
      dataIndex: 'version_at_handover',
      width: 100,
      render: (v: number | null) => v ? `v${v}` : '-'
    },
    {
      title: '已转移',
      dataIndex: 'transferred',
      width: 80,
      render: (v: number | boolean) => v ? <Tag color="green">是</Tag> : <Tag>否</Tag>
    }
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/handovers')}>返回</Button>
          <Title level={4} style={{ margin: 0 }}>交接单 {detail.handover_no}</Title>
          <Tag color={HANDOVER_STATUS_COLORS[detail.status]}>{HANDOVER_STATUS_LABELS[detail.status]}</Tag>
        </Space>
        <Space>
          {canSign && <Button type="primary" icon={<CheckCircleOutlined />} onClick={handleSign}>签收</Button>}
          {canWithdraw && <Button danger icon={<CloseCircleOutlined />} onClick={handleWithdraw}>撤回</Button>}
          {canReconfirm && <Button type="primary" icon={<WarningOutlined />} onClick={() => handleReconfirm(false)}>移除冲突项重新确认</Button>}
          {canReconfirm && <Button icon={<WarningOutlined />} onClick={() => handleReconfirm(true)}>强制签收</Button>}
          <Button onClick={() => { loadConflicts(); loadData(); }}>检查冲突</Button>
        </Space>
      </div>

      {conflicts.length > 0 && (
        <Alert
          type="warning"
          message={`检测到 ${conflicts.length} 个冲突`}
          description={
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {conflicts.map((c, i) => (
                <li key={i}>
                  <Tag>{HANDOVER_ITEM_TYPE_LABELS[c.item_type as keyof typeof HANDOVER_ITEM_TYPE_LABELS]}</Tag>
                  <Text>{c.description}</Text>
                  <Text type="secondary">（{c.field}: {JSON.stringify(c.old_value)} → {JSON.stringify(c.new_value)}）</Text>
                </li>
              ))}
            </ul>
          }
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      <Card style={{ marginBottom: 16 }}>
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="交接单号">{detail.handover_no}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={HANDOVER_STATUS_COLORS[detail.status]}>{HANDOVER_STATUS_LABELS[detail.status]}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="发起人">{detail.from_user_name}</Descriptions.Item>
          <Descriptions.Item label="接收人">{detail.to_user_name}</Descriptions.Item>
          <Descriptions.Item label="交接范围">{HANDOVER_SCOPE_LABELS[detail.scope as keyof typeof HANDOVER_SCOPE_LABELS]}</Descriptions.Item>
          <Descriptions.Item label="项目数">{detail.items?.length || 0}</Descriptions.Item>
          <Descriptions.Item label="交接原因" span={2}>{detail.reason}</Descriptions.Item>
          {detail.signed_at && <Descriptions.Item label="签收时间">{dayjs(detail.signed_at).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>}
          {detail.sign_note && <Descriptions.Item label="签收备注">{detail.sign_note}</Descriptions.Item>}
          {detail.withdrawn_at && <Descriptions.Item label="撤回时间">{dayjs(detail.withdrawn_at).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>}
          {detail.withdraw_reason && <Descriptions.Item label="撤回原因">{detail.withdraw_reason}</Descriptions.Item>}
          <Descriptions.Item label="创建时间">{dayjs(detail.created_at).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{dayjs(detail.updated_at).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="交接项目" style={{ marginBottom: 16 }}>
        <Table
          rowKey="id"
          size="small"
          columns={itemColumns}
          dataSource={detail.items || []}
          pagination={false}
        />
      </Card>

      <Card title="操作历史">
        <Timeline
          items={(detail.history || []).map((h, i) => ({
            color: h.action === 'sign' ? 'green' : h.action === 'withdraw' ? 'red' : h.action === 'conflict_detected' ? 'orange' : 'blue',
            children: (
              <div key={i}>
                <Space>
                  <Text strong>{HANDOVER_HISTORY_ACTION_LABELS[h.action as keyof typeof HANDOVER_HISTORY_ACTION_LABELS] || h.action}</Text>
                  <Text type="secondary">{h.user_name || '系统'}</Text>
                  <Text type="secondary">{dayjs(h.created_at).format('YYYY-MM-DD HH:mm:ss')}</Text>
                </Space>
                {h.details && <div style={{ marginTop: 4 }}><Text type="secondary">{JSON.stringify(h.details, null, 2)}</Text></div>}
              </div>
            )
          }))}
        />
      </Card>
    </div>
  );
};

export default HandoverDetailPage;
