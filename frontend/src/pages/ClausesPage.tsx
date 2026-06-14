import React, { useState, useEffect } from 'react';
import { Table, Button, Tag, Space, Select, Typography, Input, Tooltip } from 'antd';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { EyeOutlined, FilterOutlined, FileTextOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { clausesApi, contractsApi } from '../api';
import { Clause, RiskLevel, RISK_COLORS, RISK_LABELS, STATUS_LABELS, STATUS_COLORS } from '../types';
import dayjs from 'dayjs';

const { Title, Paragraph } = Typography;

const ClausesPage: React.FC = () => {
  const { contractId } = useParams<{ contractId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<Clause[]>([]);
  const [loading, setLoading] = useState(false);
  const [contract, setContract] = useState<any>(null);
  const [riskLevel, setRiskLevel] = useState<string>('all');
  const [pendingFilter, setPendingFilter] = useState<string>('all');
  const [keyword, setKeyword] = useState<string>('');

  const loadData = async () => {
    setLoading(true);
    try {
      const c = await contractsApi.get(contractId!);
      setContract(c);
      const params: any = { contract_id: contractId! };
      if (riskLevel !== 'all') params.risk_level = riskLevel;
      if (pendingFilter === 'pending') params.has_pending = 'true';
      if (pendingFilter === 'done') params.has_pending = 'false';
      const list = await clausesApi.list(params);
      setData(list);
    } finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, [contractId, riskLevel, pendingFilter]);

  const filteredData = data.filter(c => {
    if (!keyword) return true;
    const k = keyword.toLowerCase();
    return c.title.toLowerCase().includes(k) || c.clause_number.includes(k) || c.content.toLowerCase().includes(k);
  });

  const columns = [
    {
      title: '条款编号',
      dataIndex: 'clause_number',
      width: 100,
      fixed: 'left' as const,
      sorter: (a: Clause, b: Clause) => a.clause_number.localeCompare(b.clause_number)
    },
    {
      title: '标题 / 内容',
      dataIndex: 'title',
      render: (_: any, r: Clause) => (
        <div>
          <Paragraph ellipsis style={{ marginBottom: 4 }}>
          <a onClick={() => navigate(`/clauses/${r.id}`)} style={{ fontWeight: 500 }}>{r.title}</a>
          </Paragraph>
          <Paragraph ellipsis={{ rows: 2 }} style={{ color: '#666', fontSize: 12, margin: 0 }}>
            {r.content}
          </Paragraph>
        </div>
      )
    },
    {
      title: '风险等级',
      dataIndex: 'risk_level',
      width: 100,
      filters: [
        { text: RISK_LABELS.low, value: 'low' },
        { text: RISK_LABELS.medium, value: 'medium' },
        { text: RISK_LABELS.high, value: 'high' },
        { text: RISK_LABELS.critical, value: 'critical' }
      ],
      onFilter: (v: any, r: Clause) => r.risk_level === v,
      render: (v: RiskLevel) => <Tag color={RISK_COLORS[v]}>{RISK_LABELS[v]}</Tag>
    },
    {
      title: '当前版本',
      dataIndex: 'current_version',
      width: 90,
      render: (v: number) => <Tag color="geekblue">v{v}</Tag>
    },
    {
      title: '待处理建议',
      width: 110,
      render: (_: any, r: Clause) => (r.pending_count || 0) > 0
        ? <Tag color="red" style={{ fontWeight: 600 }}>{r.pending_count} 待处理</Tag>
        : <Tag color="green">无</Tag>
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      width: 160,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm')
    },
    {
      title: '操作',
      width: 100,
      render: (_: any, r: Clause) => (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => navigate(`/clauses/${r.id}`)}>
          详情
        </Button>
      )
    }
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Link to="/contracts"><Button icon={<ArrowLeftOutlined />}>返回合同列表</Button></Link>
      </Space>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
          <FileTextOutlined /> {contract?.name}
          </Title>
          <Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
            {contract?.description || '无描述'} · 共 {filteredData.length} 条条款
          </Paragraph>
        </div>
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Tooltip title="搜索条款编号/标题/内容">
          <Input.Search
            placeholder="搜索条款编号/标题/内容"
            allowClear
            style={{ width: 280 }}
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
          />
        </Tooltip>
        <FilterOutlined style={{ color: '#999999' }} />
        <Select value={riskLevel} onChange={setRiskLevel} style={{ width: 140 }}
          options={[
            { value: 'all', label: '全部风险' },
            { value: 'low', label: RISK_LABELS.low },
            { value: 'medium', label: RISK_LABELS.medium },
            { value: 'high', label: RISK_LABELS.high },
            { value: 'critical', label: RISK_LABELS.critical }
          ]} />
        <Select value={pendingFilter} onChange={setPendingFilter} style={{ width: 140 }}
          options={[
            { value: 'all', label: '全部状态' },
            { value: 'pending', label: '有待处理建议' },
            { value: 'done', label: '已处理完毕' }
          ]} />
        <Tag color="blue">共 {filteredData.length} 条</Tag>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={filteredData}
        pagination={{ pageSize: 10 }}
        scroll={{ x: 1100 }}
      />
    </div>
  );
};

export default ClausesPage;
