import React, { useState, useEffect } from 'react';
import { Table, Select, Typography, Tag, Space, Input, Card } from 'antd';
import { HistoryOutlined, SearchOutlined, FilterOutlined } from '@ant-design/icons';
import { reportsApi } from '../api';
import { AuditLog, ROLE_LABELS, UserRole } from '../types';
import dayjs from 'dayjs';

const { Title } = Typography;

const ACTION_COLORS: Record<string, string> = {
  login: 'green',
  create_contract: 'blue',
  delete_contract: 'red',
  import_clauses: 'cyan',
  create_suggestion: 'purple',
  approve_suggestion: 'green',
  reject_suggestion: 'red',
  merge_suggestion: 'blue',
  new_version: 'geekblue',
  rollback: 'orange',
  save_draft: 'volcano',
  submit_draft: 'purple',
  delete_draft: 'red'
};

const ACTION_LABELS: Record<string, string> = {
  login: '用户登录',
  create_contract: '创建合同',
  delete_contract: '删除合同',
  import_clauses: '导入条款',
  create_suggestion: '发起建议',
  approve_suggestion: '通过建议',
  reject_suggestion: '驳回建议',
  merge_suggestion: '合并建议',
  new_version: '新版本生成',
  rollback: '版本回滚',
  save_draft: '保存草稿',
  submit_draft: '草稿转正提交',
  delete_draft: '丢弃草稿'
};

const ENTITY_LABELS: Record<string, string> = {
  user: '用户',
  contract: '合同',
  clause: '条款',
  suggestion: '建议',
  draft: '草稿'
};

const AuditLogsPage: React.FC = () => {
  const [data, setData] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [entityType, setEntityType] = useState<string>('all');
  const [action, setAction] = useState<string>('all');
  const [keyword, setKeyword] = useState<string>('');

  const loadData = async () => {
    setLoading(true);
    try {
      const params: any = { limit: 500 };
      if (entityType !== 'all') params.entity_type = entityType;
      const list = await reportsApi.auditLogs(params);
      setData(list);
    } finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, [entityType]);

  const filtered = data.filter(l => {
    if (action !== 'all' && l.action !== action) return false;
    if (keyword) {
      const k = keyword.toLowerCase();
      return (
        (l.action || '').toLowerCase().includes(k) ||
        (l.user_name || '').toLowerCase().includes(k) ||
        (l.details ? JSON.stringify(l.details).toLowerCase().includes(k) : false)
      );
    }
    return true;
  });

  const columns = [
    {
      title: '时间',
      dataIndex: 'created_at',
      width: 170,
      fixed: 'left' as const,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss')
    },
    {
      title: '操作人',
      dataIndex: 'user_name',
      width: 120,
      render: (v: string, r: AuditLog) => (
        <Space>
          <span>{v || '系统'}</span>
          {r.user_role && <Tag color={r.user_role === 'admin' ? 'gold' : r.user_role === 'legal' ? 'blue' : 'green'}>
            {ROLE_LABELS[r.user_role as UserRole]}
          </Tag>}
        </Space>
      )
    },
    {
      title: '操作类型',
      dataIndex: 'action',
      width: 140,
      filters: Object.entries(ACTION_LABELS).map(([v, l]) => ({ text: l, value: v })),
      onFilter: (v: any, r: AuditLog) => r.action === v,
      render: (v: string) => <Tag color={ACTION_COLORS[v] || 'default'}>{ACTION_LABELS[v] || v}</Tag>
    },
    {
      title: '对象类型',
      dataIndex: 'entity_type',
      width: 100,
      render: (v: string) => <Tag>{ENTITY_LABELS[v] || v}</Tag>
    },
    {
      title: '对象ID',
      dataIndex: 'entity_id',
      width: 200,
      render: (v: string) => v ? <span style={{ fontFamily: 'Consolas, monospace', fontSize: 12, color: '#555' }}>{v.substring(0, 8)}...</span> : '-'
    },
    {
      title: '决策详情',
      dataIndex: 'details',
      render: (v: any) => {
        if (!v) return <span style={{ color: '#999' }}>-</span>;
        const entries = Object.entries(v);
        if (entries.length === 0) return <span style={{ color: '#999' }}>-</span>;
        return (
          <Space size={[6, 4]} wrap>
            {entries.map(([k, val]) => (
              <Tag key={k} color="geekblue" style={{ margin: 0 }}>
                {k}: {String(val).length > 40 ? String(val).substring(0, 40) + '...' : String(val)}
              </Tag>
            ))}
          </Space>
        );
      }
    }
  ];

  return (
    <div>
      <Title level={3} style={{ marginTop: 0 }}>
        <HistoryOutlined style={{ color: '#1677ff' }} /> 操作审计日志
      </Title>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input
            prefix={<SearchOutlined />}
            placeholder="搜索操作/操作人/详情"
            allowClear
            style={{ width: 280 }}
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
          />
          <FilterOutlined style={{ color: '#888' }} />
          <Select value={entityType} onChange={setEntityType} style={{ width: 140 }}
            options={[
              { value: 'all', label: '全部对象' },
              { value: 'contract', label: '合同' },
              { value: 'clause', label: '条款' },
              { value: 'suggestion', label: '建议' },
              { value: 'draft', label: '草稿' },
              { value: 'user', label: '用户' }
            ]} />
          <Select value={action} onChange={setAction} style={{ width: 160 }}
            options={[
              { value: 'all', label: '全部操作' },
              ...Object.entries(ACTION_LABELS).map(([v, l]) => ({ value: v, label: l }))
            ]} />
          <Tag color="blue">共 {filtered.length} 条记录</Tag>
        </Space>
      </Card>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={filtered}
        pagination={{ pageSize: 15 }}
        scroll={{ x: 1200 }}
      />
    </div>
  );
};

export default AuditLogsPage;
