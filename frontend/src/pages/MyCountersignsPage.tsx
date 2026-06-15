import React, { useState, useEffect } from 'react';
import { Card, Table, Tag, Button, Space, Typography, App as AntdApp } from 'antd';
import { useNavigate } from 'react-router-dom';
import { EyeOutlined } from '@ant-design/icons';
import {
  CountersignRound,
  COUNTERSIGN_STATUS_COLORS, COUNTERSIGN_STATUS_LABELS
} from '../types';
import { countersignApi } from '../api';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const MyCountersignsPage: React.FC = () => {
  const [data, setData] = useState<CountersignRound[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();

  const loadData = async () => {
    setLoading(true);
    try {
      const list = await countersignApi.listMine();
      setData(list as CountersignRound[]);
    } catch (e: any) {
      message.error(e.response?.data?.error || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const columns = [
    {
      title: '会签名称',
      dataIndex: 'round_name',
      render: (v: string, r: CountersignRound) => (
        <a onClick={() => navigate(`/countersigns/${r.id}`)} style={{ fontWeight: 500 }}>
          {v}
        </a>
      )
    },
    {
      title: '所属合同',
      dataIndex: 'contract_name',
      render: (v: string) => <Text>{v}</Text>
    },
    {
      title: '创建人',
      dataIndex: 'creator_name',
      width: 100
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => (
        <Tag color={COUNTERSIGN_STATUS_COLORS[v as keyof typeof COUNTERSIGN_STATUS_COLORS]}>
          {COUNTERSIGN_STATUS_LABELS[v as keyof typeof COUNTERSIGN_STATUS_LABELS]}
        </Tag>
      )
    },
    {
      title: '我的进度',
      key: 'my_progress',
      width: 160,
      render: (_: any, r: CountersignRound) => {
        const total = r.clause_count || 0;
        const concluded = r.my_concluded || 0;
        const acknowledged = r.my_acknowledged || 0;
        return (
          <Space size={4}>
            <Tag color="green">{concluded} 已签</Tag>
            {acknowledged > 0 && <Tag color="blue">{acknowledged} 待签</Tag>}
            <Text type="secondary">/ {total}</Text>
          </Space>
        );
      }
    },
    {
      title: '整体进度',
      key: 'progress',
      width: 160,
      render: (_: any, r: CountersignRound) => {
        const total = (r.participant_count || 0) * (r.clause_count || 0);
        const done = r.concluded_count || 0;
        const ack = r.acknowledged_count || 0;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        return (
          <Space direction="vertical" size={0}>
            <Text>{done}/{total} ({pct}%)</Text>
            {ack > 0 && <Text type="secondary" style={{ fontSize: 12 }}>{ack} 已签收待签</Text>}
          </Space>
        );
      }
    },
    {
      title: '截止时间',
      dataIndex: 'deadline',
      width: 160,
      render: (v: string | null | undefined) => v
        ? (
          <Text type={dayjs().isAfter(v) ? 'danger' : 'secondary'}>
            {dayjs(v).format('YYYY-MM-DD HH:mm')}
            {dayjs().isAfter(v) ? ' · 已超期' : ''}
          </Text>
        )
        : <Text type="secondary">无</Text>
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 160,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm')
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_: any, r: CountersignRound) => (
        <Button
          type="link"
          size="small"
          icon={<EyeOutlined />}
          onClick={() => navigate(`/countersigns/${r.id}`)}
        >详情</Button>
      )
    }
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>我的会签</Title>
        <Button onClick={loadData}>刷新</Button>
      </div>
      <Card>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={data}
          pagination={{ pageSize: 10 }}
        />
      </Card>
    </div>
  );
};

export default MyCountersignsPage;
