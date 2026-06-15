import React, { useState, useEffect } from 'react';
import {
  Card, Typography, Tag, Button, Space, Table, Modal, Form, Input, Select,
  Timeline, Alert, Tooltip, Divider, App as AntdApp, Row, Col, Progress, Popconfirm
} from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined,
  RollbackOutlined, UserSwitchOutlined, FileTextOutlined, ArrowLeftOutlined,
  AuditOutlined, TeamOutlined, ClockCircleOutlined, ReloadOutlined
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import {
  CountersignRoundDetail, CountersignClause, CountersignConclusionItem,
  CountersignParticipant,
  COUNTERSIGN_STATUS_COLORS, COUNTERSIGN_STATUS_LABELS,
  COUNTERSIGN_CONCLUSION_COLORS, COUNTERSIGN_CONCLUSION_LABELS,
  COUNTERSIGN_HISTORY_ACTION_LABELS, ROLE_LABELS, RISK_COLORS, RISK_LABELS
} from '../types';
import { countersignApi, authApi } from '../api';
import { useAuthStore } from '../store';
import dayjs from 'dayjs';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const CountersignDetailPage: React.FC = () => {
  const { roundId } = useParams<{ roundId: string }>();
  const navigate = useNavigate();
  const { message, modal } = AntdApp.useApp();
  const user = useAuthStore(s => s.user);
  const isAdmin = user?.role === 'admin';

  const [data, setData] = useState<CountersignRoundDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [concludeOpen, setConcludeOpen] = useState<CountersignClause | null>(null);
  const [concludeForm] = Form.useForm();
  const [concludeLoading, setConcludeLoading] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawForm] = Form.useForm();
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<CountersignParticipant | null>(null);
  const [replaceForm] = Form.useForm();
  const [replaceLoading, setReplaceLoading] = useState(false);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [rereviewOpen, setRereviewOpen] = useState(false);
  const [rereviewForm] = Form.useForm();
  const [rereviewLoading, setRereviewLoading] = useState(false);
  const [selectedRereviewClauses, setSelectedRereviewClauses] = useState<string[]>([]);

  const loadDetail = async () => {
    if (!roundId) return;
    setLoading(true);
    try {
      const detail = await countersignApi.get(roundId);
      setData(detail);
    } catch (e: any) {
      message.error(e.response?.data?.error || '加载会签详情失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetail();
    authApi.users().then(u => setAllUsers(u as any[])).catch(() => {});
  }, [roundId]);

  if (!data) {
    return <Card loading={loading}><Text type="secondary">加载中...</Text></Card>;
  }

  const isParticipant = !!data.my_participation;
  const activeParticipants = data.participants.filter(p => !Number(p.is_replaced));
  const validClauses = data.clauses.filter(c => !Number(c.invalidated));
  const totalExpected = activeParticipants.length * validClauses.length;
  const concludedCount = data.conclusions.filter(c => c.concluded_at).length;
  const acknowledgedCount = data.conclusions.filter(c => c.acknowledged_at && !c.concluded_at).length;
  const progressPercent = totalExpected > 0 ? Math.round((concludedCount / totalExpected) * 100) : 0;

  const myConclusions: Record<string, CountersignConclusionItem> = {};
  if (data.my_participation) {
    for (const c of data.conclusions) {
      if (c.participant_id === data.my_participation!.id) {
        myConclusions[c.clause_id] = c;
      }
    }
  }

  const allMyAcknowledged = validClauses.every(c => myConclusions[c.clause_id]?.acknowledged_at);
  const allMyConcluded = validClauses.every(c => myConclusions[c.clause_id]?.concluded_at);

  const handleAcknowledgeAll = async () => {
    try {
      setLoading(true);
      await countersignApi.acknowledge(roundId!);
      message.success('签收成功');
      loadDetail();
    } catch (e: any) {
      message.error(e.response?.data?.error || '签收失败');
    } finally {
      setLoading(false);
    }
  };

  const handleConclude = async () => {
    if (!concludeOpen) return;
    try {
      const values = await concludeForm.validateFields();
      setConcludeLoading(true);
      await countersignApi.conclude(roundId!, {
        clause_id: concludeOpen.clause_id,
        conclusion: values.conclusion,
        comment: values.comment
      });
      message.success('结论提交成功');
      setConcludeOpen(null);
      concludeForm.resetFields();
      loadDetail();
    } catch (e: any) {
      message.error(e.response?.data?.error || '提交失败');
    } finally {
      setConcludeLoading(false);
    }
  };

  const handleWithdraw = async () => {
    try {
      const values = await withdrawForm.validateFields();
      setWithdrawLoading(true);
      await countersignApi.withdraw(roundId!, values.reason);
      message.success('会签已撤回');
      setWithdrawOpen(false);
      withdrawForm.resetFields();
      loadDetail();
    } catch (e: any) {
      message.error(e.response?.data?.error || '撤回失败');
    } finally {
      setWithdrawLoading(false);
    }
  };

  const handleReplace = async () => {
    if (!replaceTarget) return;
    try {
      const values = await replaceForm.validateFields();
      setReplaceLoading(true);
      await countersignApi.replaceParticipant(roundId!, {
        old_participant_id: replaceTarget.id,
        new_user_id: values.new_user_id,
        reason: values.reason
      });
      message.success('参与人替换成功，旧意见已保留在历史记录中');
      setReplaceOpen(false);
      setReplaceTarget(null);
      replaceForm.resetFields();
      loadDetail();
    } catch (e: any) {
      message.error(e.response?.data?.error || '替换失败');
    } finally {
      setReplaceLoading(false);
    }
  };

  const handleRereview = async () => {
    if (selectedRereviewClauses.length === 0) {
      message.warning('请选择需要重审的条款');
      return;
    }
    try {
      const values = await rereviewForm.validateFields();
      setRereviewLoading(true);
      await countersignApi.rerequestRereview(roundId!, {
        clause_ids: selectedRereviewClauses,
        reason: values.reason
      });
      message.success('已将相关条款标记为待重审，参与人需要重新给出结论');
      setRereviewOpen(false);
      setSelectedRereviewClauses([]);
      rereviewForm.resetFields();
      loadDetail();
    } catch (e: any) {
      message.error(e.response?.data?.error || '请求失败');
    } finally {
      setRereviewLoading(false);
    }
  };

  const getConclusionFor = (participantId: string, clauseId: string) =>
    data.conclusions.find(c => c.participant_id === participantId && c.clause_id === clauseId);

  const clauseColumns = [
    {
      title: '条款',
      dataIndex: 'clause_number',
      key: 'clause_number',
      width: 100,
      render: (_: any, r: CountersignClause) => (
        <Space direction="vertical" size={0}>
          <Text strong>第{r.clause_number}条</Text>
          <Tag color={RISK_COLORS[r.risk_level || 'low']}>{RISK_LABELS[r.risk_level || 'low']}</Tag>
        </Space>
      )
    },
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      render: (_: any, r: CountersignClause) => (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Text strong>{r.title}</Text>
            {Number(r.needs_rereview) && (
              <Tooltip title={r.rereview_reason || '需要重审'}>
                <Tag color="orange" icon={<ReloadOutlined />}>待重审</Tag>
              </Tooltip>
            )}
            {r.clause_version_at_create !== r.current_version && (
              <Tooltip title={`会签时版本v${r.clause_version_at_create}，当前v${r.current_version}`}>
                <Tag color="purple">版本已变 v{r.current_version}</Tag>
              </Tooltip>
            )}
          </div>
          {r.rereview_reason && (
            <Text type="warning" style={{ fontSize: 12 }}>重审原因：{r.rereview_reason}</Text>
          )}
          <Paragraph
            type="secondary"
            ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}
            style={{ marginTop: 4, marginBottom: 0 }}
          >
            {r.content}
          </Paragraph>
        </div>
      )
    },
    ...activeParticipants.map(p => ({
      title: (
        <Space direction="vertical" size={0} style={{ whiteSpace: 'nowrap' }}>
          <Text>{p.display_name}</Text>
          <Tag color={p.role === 'legal' ? 'blue' : 'cyan'}>{ROLE_LABELS[p.role || 'business']}</Tag>
        </Space>
      ),
      key: `p_${p.id}`,
      width: 140,
      align: 'center' as const,
      render: (_: any, r: CountersignClause) => {
        const conc = getConclusionFor(p.id, r.clause_id);
        const isMe = p.user_id === user?.id && data.status === 'active';
        if (!conc || !conc.acknowledged_at) {
          return <Tag color="default">未签收</Tag>;
        }
        if (!conc.concluded_at) {
          return (
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              <Tag color="blue">已签收</Tag>
              {isMe && (
                <Button
                  type="link"
                  size="small"
                  icon={<AuditOutlined />}
                  onClick={() => setConcludeOpen(r)}
                >
                  签署结论
                </Button>
              )}
            </Space>
          );
        }
        return (
          <Tooltip title={conc.comment || '（无意见备注）'}>
            <Space direction="vertical" size={2}>
              <Tag color={COUNTERSIGN_CONCLUSION_COLORS[conc.conclusion || 'pass']} icon={
                conc.conclusion === 'pass' ? <CheckCircleOutlined /> :
                conc.conclusion === 'reject' ? <CloseCircleOutlined /> :
                <ExclamationCircleOutlined />
              }>
                {COUNTERSIGN_CONCLUSION_LABELS[conc.conclusion || 'pass']}
              </Tag>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {dayjs(conc.concluded_at).format('MM-DD HH:mm')}
              </Text>
            </Space>
          </Tooltip>
        );
      }
    }))
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button>
        <Button
          type="default"
          icon={<ReloadOutlined />}
          onClick={loadDetail}
        >刷新</Button>
      </Space>

      <Card
        title={
          <Space>
            <Title level={4} style={{ margin: 0 }}>{data.round_name}</Title>
            <Tag color={COUNTERSIGN_STATUS_COLORS[data.status]}>
              {COUNTERSIGN_STATUS_LABELS[data.status]}
            </Tag>
          </Space>
        }
        extra={
          <Space>
            {data.status === 'active' && isParticipant && !allMyConcluded && (
              <Space>
                {!allMyAcknowledged && (
                  <Button type="primary" icon={<CheckCircleOutlined />} onClick={handleAcknowledgeAll}>
                    一键签收全部条款
                  </Button>
                )}
              </Space>
            )}
            {isAdmin && data.status === 'active' && (
              <Space>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => setRereviewOpen(true)}
                >请求重审</Button>
                <Popconfirm
                  title="确定撤回此会签回合？"
                  description="撤回后所有未完成的签署将失效，但历史意见会保留。"
                  onConfirm={() => setWithdrawOpen(true)}
                  okText="去填写原因"
                  cancelText="取消"
                >
                  <Button danger icon={<RollbackOutlined />}>撤回会签</Button>
                </Popconfirm>
              </Space>
            )}
          </Space>
        }
      >
        <Row gutter={24}>
          <Col span={12}>
            <Space direction="vertical" size="small">
              <Text type="secondary">所属合同：</Text>
              <Text strong>
                <FileTextOutlined /> {data.contract_name}
              </Text>
              <Text type="secondary">创建人：{data.creator_name} · {dayjs(data.created_at).format('YYYY-MM-DD HH:mm')}</Text>
              {data.deadline && (
                <Space>
                  <ClockCircleOutlined style={{ color: dayjs().isAfter(data.deadline) ? 'red' : 'inherit' }} />
                  <Text type={dayjs().isAfter(data.deadline) ? 'danger' : 'secondary'}>
                    截止：{dayjs(data.deadline).format('YYYY-MM-DD HH:mm')}
                    {dayjs().isAfter(data.deadline) ? '（已超期）' : ''}
                  </Text>
                </Space>
              )}
              {data.description && <Paragraph style={{ margin: 0 }}>{data.description}</Paragraph>}
            </Space>
          </Col>
          <Col span={12}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Space>
                <TeamOutlined />
                <Text>参与人 {activeParticipants.length} 人</Text>
                <Text type="secondary">· 必看条款 {validClauses.length} 条</Text>
              </Space>
              <div>
                <Text>完成进度：{concludedCount} / {totalExpected} 已签署</Text>
                {acknowledgedCount > 0 && (
                  <Text type="secondary"> （{acknowledgedCount} 已签收待签署）</Text>
                )}
              </div>
              <Progress percent={progressPercent} status={progressPercent === 100 ? 'success' : 'active'} />
              {data.status === 'withdrawn' && (
                <Alert
                  type="warning"
                  showIcon
                  message={`已于 ${dayjs(data.withdrawn_at || '').format('YYYY-MM-DD HH:mm')} 由 ${data.withdrawer_name} 撤回`}
                  description={data.withdraw_reason}
                />
              )}
              {data.status === 'completed' && (
                <Alert
                  type="success"
                  showIcon
                  message={`本回合已于 ${dayjs(data.completed_at || '').format('YYYY-MM-DD HH:mm')} 自动完成`}
                />
              )}
            </Space>
          </Col>
        </Row>

        {data.participants.filter(p => Number(p.is_replaced)).length > 0 && (
          <Alert
            style={{ marginTop: 16 }}
            type="info"
            showIcon
            message="参与人变更记录（旧意见保留在历史中）"
            description={
              <Space wrap size="middle">
                {data.participants.filter(p => Number(p.is_replaced)).map(p => (
                  <Tag key={p.id}>
                    {p.original_user_name || p.display_name} →
                    {data.participants.find(np => np.original_participant_id === p.id)?.display_name}
                    {p.replaced_reason && <Text type="secondary">（{p.replaced_reason}）</Text>}
                  </Tag>
                ))}
              </Space>
            }
          />
        )}
      </Card>

      <Divider orientation="left">签署矩阵</Divider>

      <Card>
        <Table
          rowKey="id"
          loading={loading}
          columns={clauseColumns as any}
          dataSource={validClauses as any[]}
          pagination={false}
          size="middle"
          scroll={{ x: Math.max(800, 300 + activeParticipants.length * 140) }}
        />
      </Card>

      {isAdmin && (
        <>
          <Divider orientation="left">参与人管理</Divider>
          <Card size="small">
            <Table
              rowKey="id"
              size="small"
              dataSource={data.participants}
              pagination={false}
              columns={[
                { title: '参与人', dataIndex: 'display_name' },
                { title: '角色', dataIndex: 'role', render: (r: string) => ROLE_LABELS[r as keyof typeof ROLE_LABELS] || r },
                {
                  title: '状态',
                  dataIndex: 'is_replaced',
                  render: (v: any, r: any) => Number(v)
                    ? <Tag color="default">已替换 · 由{r.original_user_name}换出</Tag>
                    : <Tag color="green">有效</Tag>
                },
                {
                  title: '进度',
                  key: 'progress',
                  render: (_: any, r: CountersignParticipant) => {
                    if (Number(r.is_replaced)) return <Text type="secondary">N/A</Text>;
                    const mine = validClauses.map(c => getConclusionFor(r.id, c.clause_id));
                    const done = mine.filter(c => c?.concluded_at).length;
                    const ack = mine.filter(c => c?.acknowledged_at && !c?.concluded_at).length;
                    return (
                      <Space size={4}>
                        <Tag color="green">{done} 已签</Tag>
                        {ack > 0 && <Tag color="blue">{ack} 待签</Tag>}
                        <Text type="secondary">/ {validClauses.length}</Text>
                      </Space>
                    );
                  }
                },
                {
                  title: '操作',
                  key: 'action',
                  render: (_: any, r: CountersignParticipant) => (
                    data.status === 'active' && !Number(r.is_replaced) ? (
                      <Button
                        type="link"
                        size="small"
                        icon={<UserSwitchOutlined />}
                        onClick={() => { setReplaceTarget(r); setReplaceOpen(true); }}
                      >替换</Button>
                    ) : null
                  ),
                  width: 80
                }
              ]}
            />
          </Card>
        </>
      )}

      <Divider orientation="left">变更历史 / 审计</Divider>

      <Card size="small">
        <Timeline
          items={data.history.slice().reverse().map(h => ({
            color:
              h.action === 'create_round' ? 'blue' :
              h.action === 'withdraw_round' ? 'red' :
              h.action === 'conclude' ? 'green' :
              h.action === 'replace_participant' ? 'orange' :
              h.action === 'clause_version_change' ? 'purple' :
              h.action === 'rereview_requested' ? 'orange' : 'gray',
            children: (
              <Space direction="vertical" size={0}>
                <Space>
                  <Text strong>{COUNTERSIGN_HISTORY_ACTION_LABELS[h.action]}</Text>
                  <Text type="secondary">{h.user_name || '系统'}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {dayjs(h.created_at).format('YYYY-MM-DD HH:mm:ss')}
                  </Text>
                </Space>
                {h.details && Object.keys(h.details).length > 0 && (
                  <pre style={{
                    margin: '4px 0 0',
                    padding: 8,
                    background: '#f5f5f5',
                    borderRadius: 4,
                    fontSize: 12,
                    whiteSpace: 'pre-wrap',
                    maxHeight: 120,
                    overflow: 'auto'
                  }}>
                    {JSON.stringify(h.details, null, 2)}
                  </pre>
                )}
              </Space>
            )
          }))}
        />
      </Card>

      <Modal
        title={`签署结论 - 第${concludeOpen?.clause_number}条 ${concludeOpen?.title}`}
        open={!!concludeOpen}
        onOk={handleConclude}
        onCancel={() => { setConcludeOpen(null); concludeForm.resetFields(); }}
        okText="提交结论"
        confirmLoading={concludeLoading}
        width={600}
        destroyOnClose
      >
        {concludeOpen && (
          <>
            <Alert
              style={{ marginBottom: 16 }}
              type="info"
              showIcon
              message={`条款当前版本 v${concludeOpen.current_version}，会签创建时版本 v${concludeOpen.clause_version_at_create}`}
              description={
                Number(concludeOpen.needs_rereview)
                  ? `此条款需要重审：${concludeOpen.rereview_reason}`
                  : concludeOpen.current_version !== concludeOpen.clause_version_at_create
                    ? '条款内容在会签期间有更新，请结合差异判断。'
                    : '版本无变化。'
              }
            />
            <Paragraph
              style={{
                padding: 12,
                background: '#fafafa',
                borderRadius: 6,
                maxHeight: 200,
                overflow: 'auto'
              }}
            >{concludeOpen.content}</Paragraph>
            <Form form={concludeForm} layout="vertical">
              <Form.Item
                name="conclusion"
                label="结论"
                rules={[{ required: true, message: '请选择结论' }]}
              >
                <Select
                  options={[
                    { value: 'pass', label: '通过 - 条款合规，风险可控' },
                    { value: 'reject', label: '退回 - 存在重大问题，需修改' },
                    { value: 'need_more_info', label: '需补充 - 信息不足或需对方澄清' }
                  ]}
                />
              </Form.Item>
              <Form.Item name="comment" label="意见备注">
                <TextArea rows={4} placeholder="可选：具体说明原因或修改意见" />
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>

      <Modal
        title="撤回会签回合"
        open={withdrawOpen}
        onOk={handleWithdraw}
        onCancel={() => { setWithdrawOpen(false); withdrawForm.resetFields(); }}
        okText="确认撤回"
        okButtonProps={{ danger: true }}
        confirmLoading={withdrawLoading}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="撤回后本回合将不再接受新的签署"
          description="所有已给出的结论和签收记录都会完整保留在历史和审计中，不会静默丢弃。"
        />
        <Form form={withdrawForm} layout="vertical">
          <Form.Item
            name="reason"
            label="撤回原因"
            rules={[{ required: true, message: '请填写撤回原因' }]}
          >
            <TextArea rows={4} placeholder="请说明撤回此会签的具体原因" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`替换参与人 - ${replaceTarget?.display_name}`}
        open={replaceOpen}
        onOk={handleReplace}
        onCancel={() => { setReplaceOpen(false); setReplaceTarget(null); replaceForm.resetFields(); }}
        okText="确认替换"
        confirmLoading={replaceLoading}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="旧参与人的历史意见不会丢失"
          description={`原参与人 ${replaceTarget?.display_name} 在此回合中给出的所有签署意见将完整保留在历史记录中，仅将有效签署人替换为新用户，新用户需要对所有条款重新给出结论。`}
        />
        <Form form={replaceForm} layout="vertical">
          <Form.Item
            name="new_user_id"
            label="新参与人"
            rules={[{ required: true, message: '请选择新的参与人' }]}
          >
            <Select
              placeholder="请选择"
              options={allUsers
                .filter(u => u.id !== replaceTarget?.user_id)
                .map(u => ({
                  value: u.id,
                  label: `${u.display_name} (${ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] || u.role})`
                }))}
            />
          </Form.Item>
          <Form.Item
            name="reason"
            label="替换原因"
            rules={[{ required: true, message: '请填写替换原因' }]}
          >
            <TextArea rows={3} placeholder="如：原参与人请假、调动、离职等" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="请求条款重审"
        open={rereviewOpen}
        onOk={handleRereview}
        onCancel={() => { setRereviewOpen(false); rereviewForm.resetFields(); setSelectedRereviewClauses([]); }}
        okText="确认请求重审"
        confirmLoading={rereviewLoading}
        width={600}
        destroyOnClose
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="标记为待重审后，参与人需要对这些条款重新给出结论"
          description="已给出的旧结论不会删除，会以追加备注的方式保留完整历史。"
        />
        <div style={{ marginBottom: 16 }}>
          <Text strong>选择需要重审的条款：</Text>
          <div style={{ marginTop: 8, maxHeight: 200, overflow: 'auto' }}>
            {validClauses.map(c => (
              <div key={c.id} style={{ padding: '6px 0' }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selectedRereviewClauses.includes(c.clause_id)}
                    onChange={e => {
                      if (e.target.checked) {
                        setSelectedRereviewClauses([...selectedRereviewClauses, c.clause_id]);
                      } else {
                        setSelectedRereviewClauses(selectedRereviewClauses.filter(id => id !== c.clause_id));
                      }
                    }}
                  />
                  <Space direction="vertical" size={0}>
                    <Text>第{c.clause_number}条 - {c.title}</Text>
                    {Number(c.needs_rereview) && (
                      <Text type="warning" style={{ fontSize: 12 }}>
                        当前已待重审：{c.rereview_reason}
                      </Text>
                    )}
                  </Space>
                </label>
              </div>
            ))}
          </div>
        </div>
        <Form form={rereviewForm} layout="vertical">
          <Form.Item
            name="reason"
            label="重审原因"
            rules={[{ required: true, message: '请填写重审原因' }]}
          >
            <TextArea rows={3} placeholder="说明为什么这些条款需要重新审阅" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default CountersignDetailPage;
