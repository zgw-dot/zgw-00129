import React, { useState } from 'react';
import { Card, Tag, Button, Space, Input, Select, Modal, Form, App as AntdApp, Tooltip, Badge, Alert } from 'antd';
import {
  MessageOutlined,
  EditOutlined,
  LockOutlined,
  UnlockOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  MergeOutlined
} from '@ant-design/icons';
import { clausesApi } from '../api';
import {
  Suggestion, SuggestionType, ExclusiveRole, RiskLevel,
  TYPE_LABELS, STATUS_LABELS, STATUS_COLORS, ROLE_LABELS,
  EXCLUSIVE_LABELS, RISK_LABELS, RISK_COLORS, UserRole
} from '../types';
import { useAuthStore } from '../store';
import dayjs from 'dayjs';

interface Props {
  suggestion: Suggestion;
  currentVersion: number;
  clauseId: string;
  onUpdated: () => void;
}

const SuggestionCard: React.FC<Props> = ({ suggestion, currentVersion, clauseId, onUpdated }) => {
  const user = useAuthStore(s => s.user)!;
  const isAdmin = user.role === 'admin';
  const canHandle = suggestion.status === 'pending' && (
    isAdmin ||
    suggestion.exclusive_role === 'all' ||
    suggestion.exclusive_role === user.role
  );
  const canMerge = canHandle && suggestion.type === 'amendment' && (user.role === 'admin' || user.role === 'legal');
  const roleColor = suggestion.created_by_role === 'legal' ? 'blue' : suggestion.created_by_role === 'admin' ? 'gold' : 'green';
  const isStale = suggestion.base_version < currentVersion;

  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const { message, modal } = AntdApp.useApp();

  const action = async (type: 'approve' | 'reject' | 'merge', reason: string) => {
    try {
      if (type === 'approve') await clausesApi.approveSuggestion(clauseId, suggestion.id, reason);
      if (type === 'reject') await clausesApi.rejectSuggestion(clauseId, suggestion.id, reason);
      if (type === 'merge') {
        if (suggestion.base_version < currentVersion) {
          modal.error({
            title: '版本冲突',
            content: `该建议基于 v${suggestion.base_version} 提交，但条款当前已更新至 v${currentVersion}。\n请审阅新版本差异后，由建议人基于最新版本重新提交修改建议。`,
            okText: '知道了'
          });
          return;
        }
        await clausesApi.mergeSuggestion(clauseId, suggestion.id, reason);
      }
      message.success(`${type === 'approve' ? '通过' : type === 'reject' ? '驳回' : '合并'}成功`);
      onUpdated();
    } catch (e: any) {
      message.error(e.response?.data?.error || '操作失败');
    } finally {
      setApproveOpen(false); setRejectOpen(false); setMergeOpen(false);
    }
  };

  return (
    <Card
      size="small"
      className="suggestion-card"
      style={{ marginTop: 12, borderTop: `3px solid ${STATUS_COLORS[suggestion.status] === 'default' ? '#d9d9d9' : STATUS_COLORS[suggestion.status] === 'red' ? '#f5222d' : STATUS_COLORS[suggestion.status] === 'green' ? '#52c41a' : '#1677ff'}` }}
      title={
        <Space wrap>
          <Badge status={
            suggestion.status === 'pending' ? 'processing' :
            suggestion.status === 'merged' ? 'success' :
            suggestion.status === 'approved' ? 'success' : 'error'
          } />
          <Tag icon={suggestion.type === 'amendment' ? <EditOutlined /> : <MessageOutlined />} color={suggestion.type === 'amendment' ? 'blue' : 'purple'}>
            {TYPE_LABELS[suggestion.type]}
          </Tag>
          <Tag color={STATUS_COLORS[suggestion.status] as any}>{STATUS_LABELS[suggestion.status]}</Tag>
          <Tag color={roleColor}>{ROLE_LABELS[suggestion.created_by_role as UserRole]}</Tag>
          {suggestion.exclusive_role !== 'all' && (
            <Tooltip title={`仅 ${suggestion.exclusive_role === 'legal' ? '法务' : '业务'} 人员可决策`}>
              <Tag icon={<LockOutlined />} color="magenta">{EXCLUSIVE_LABELS[suggestion.exclusive_role]}</Tag>
            </Tooltip>
          )}
          {isStale && (
            <Tooltip title={`建议基于 v${suggestion.base_version} 提交，当前条款已更新至 v${currentVersion}`}>
              <Tag color="orange">⚠️ 版本落后</Tag>
            </Tooltip>
          )}
          <span style={{ fontSize: 12, color: '#888' }}>
            {suggestion.creator_name} · {dayjs(suggestion.created_at).format('MM-DD HH:mm')} · 基于 v{suggestion.base_version}
          </span>
        </Space>
      }
      extra={
        suggestion.status === 'pending' && canHandle && (
          <Space size="small">
            {suggestion.type === 'comment' && (
              <Button type="primary" size="small" icon={<CheckCircleOutlined />} onClick={() => setApproveOpen(true)}>通过</Button>
            )}
            {canMerge && (
              <Tooltip title={isStale ? '存在版本冲突，合并将被拒绝' : '将修改合并为新版本'}>
                <Button type="primary" size="small" icon={<MergeOutlined />} danger={isStale} onClick={() => setMergeOpen(true)}>合并</Button>
              </Tooltip>
            )}
            <Button size="small" icon={<CloseCircleOutlined />} onClick={() => setRejectOpen(false)} danger onClickCapture={() => setRejectOpen(true)}>驳回</Button>
          </Space>
        )
      }
    >
      {suggestion.risk_level && (
        <div style={{ marginBottom: 8 }}>
          <Tag color={RISK_COLORS[suggestion.risk_level as RiskLevel]}>调整风险等级：{RISK_LABELS[suggestion.risk_level as RiskLevel]}</Tag>
        </div>
      )}

      <p style={{ margin: '0 0 8px', fontWeight: 500 }}>建议说明：</p>
      <div className="clause-content" style={{ background: '#fafafa', padding: 8, borderRadius: 4, marginBottom: 12 }}>
        {suggestion.content}
      </div>

      {suggestion.type === 'amendment' && (suggestion.amended_title || suggestion.amended_content) && (
        <div className="version-card">
          <p style={{ margin: '0 0 6px', fontWeight: 500, color: '#1677ff' }}>建议修改后的内容：</p>
          {suggestion.amended_title && (
            <div><span style={{ color: '#888', fontSize: 12 }}>标题：</span><strong>{suggestion.amended_title}</strong></div>
          )}
          {suggestion.amended_content && (
            <div className="clause-content" style={{ background: '#f6ffed', padding: 8, borderRadius: 4, marginTop: 6 }}>
              {suggestion.amended_content}
            </div>
          )}
        </div>
      )}

      {suggestion.status !== 'pending' && (
        <Alert
          style={{ marginTop: 8 }}
          type={suggestion.status === 'rejected' ? 'error' : 'success'}
          showIcon
          message={
            <span>
              由 <strong>{suggestion.resolver_name}</strong> 于 {dayjs(suggestion.resolved_at!).format('YYYY-MM-DD HH:mm')}
              {' '}{suggestion.status === 'merged' ? '合并' : suggestion.status === 'approved' ? '通过' : '驳回'}
            </span>
          }
          description={suggestion.decision_reason ? <span style={{ color: '#555' }}>决策原因：{suggestion.decision_reason}</span> : undefined}
        />
      )}

      <Modal title="通过建议" open={approveOpen} onCancel={() => setApproveOpen(false)}
        onOk={async () => {
          const f = document.getElementById('approve_form') as HTMLFormElement;
          const reason = (f.querySelector('textarea') as HTMLTextAreaElement).value;
          if (!reason.trim()) { message.warning('请填写通过原因'); return; }
          await action('approve', reason);
        }}
        width={520}>
        <Form layout="vertical" id="approve_form">
          <Form.Item label="通过原因（必填，将记入审计日志）" rules={[{ required: true, message: '请填写原因' }]}>
            <Input.TextArea rows={4} placeholder="说明通过该建议的原因和依据..." />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="驳回建议" open={rejectOpen} onCancel={() => setRejectOpen(false)}
        onOk={async () => {
          const f = document.getElementById('reject_form') as HTMLFormElement;
          const reason = (f.querySelector('textarea') as HTMLTextAreaElement).value;
          if (!reason.trim()) { message.warning('请填写驳回原因'); return; }
          await action('reject', reason);
        }}
        width={520}>
        <Form layout="vertical" id="reject_form">
          <Form.Item label="驳回原因（必填，将记入审计日志）" rules={[{ required: true, message: '请填写原因' }]}>
            <Input.TextArea rows={4} placeholder="说明驳回该建议的具体原因..." />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={
          <Space>
            <MergeOutlined style={{ color: '#1677ff' }} />
            合并修改建议为新版本
            {isStale && <Tag color="red">⚠️ 版本冲突</Tag>}
          </Space>
        }
        open={mergeOpen} onCancel={() => setMergeOpen(false)}
        onOk={async () => {
          const f = document.getElementById('merge_form') as HTMLFormElement;
          const reason = (f.querySelector('textarea') as HTMLTextAreaElement).value;
          if (!reason.trim()) { message.warning('请填写合并原因'); return; }
          await action('merge', reason);
        }}
        width={620}>
        {isStale && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="存在版本冲突"
            description={`该建议基于 v${suggestion.base_version} 提交，但条款当前已更新至 v${currentVersion}。直接合并可能导致内容覆盖，系统将拒绝本次合并。请建议人基于最新版本重新提交。`}
          />
        )}
        {!isStale && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={`将创建新版本 v${currentVersion + 1}`}
            description="合并后条款内容将按建议更新，历史版本和决策原因永久保留。"
          />
        )}
        <Form layout="vertical" id="merge_form">
          <Form.Item label="合并说明（必填，将记入审计日志并作为变更摘要）" rules={[{ required: true, message: '请填写说明' }]}>
            <Input.TextArea rows={4} placeholder="如：采纳法务合规建议，修改争议解决条款..." />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default SuggestionCard;
