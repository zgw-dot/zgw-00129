import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Row, Col, Tag, Typography, Button, Space, Card, Divider, Tabs, Modal, Form,
  Input, Select, App as AntdApp, Timeline, Alert, Empty, Tooltip, Statistic, Badge
} from 'antd';
import {
  ArrowLeftOutlined, EditOutlined, MessageOutlined, HistoryOutlined,
  RollbackOutlined, FileTextOutlined, PlusOutlined, WarningOutlined,
  LockOutlined, TeamOutlined, SafetyOutlined, ReloadOutlined,
  SaveOutlined, DeleteOutlined, CopyOutlined, EyeOutlined,
  ThunderboltOutlined
} from '@ant-design/icons';
import { clausesApi, reportsApi } from '../api';
import {
  Clause, ClauseVersion, Suggestion, SuggestionType, RiskLevel,
  RISK_LABELS, RISK_COLORS, ROLE_LABELS, UserRole, SuggestionDraft,
  DraftContextSnapshot
} from '../types';
import { useAuthStore } from '../store';
import SuggestionCard from '../components/SuggestionCard';
import dayjs from 'dayjs';

const { Title, Paragraph, Text } = Typography;

const ClauseDetailPage: React.FC = () => {
  const { clauseId } = useParams<{ clauseId: string }>();
  const navigate = useNavigate();
  const user = useAuthStore(s => s.user)!;
  const { message, modal } = AntdApp.useApp();

  const [clause, setClause] = useState<Clause | null>(null);
  const [loading, setLoading] = useState(false);
  const [suggestionTab, setSuggestionTab] = useState<string>('pending');
  const [showNewSuggestion, setShowNewSuggestion] = useState(false);
  const [suggestionForm] = Form.useForm();
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [rollbackForm] = Form.useForm();
  const [compareVersions, setCompareVersions] = useState<{ a?: ClauseVersion; b?: ClauseVersion }>({});
  const [currentDraft, setCurrentDraft] = useState<SuggestionDraft | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftConflictHandled, setDraftConflictHandled] = useState(false);
  const [restorePromptOpen, setRestorePromptOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [viewOldContentOpen, setViewOldContentOpen] = useState(false);
  const [oldSnapshot, setOldSnapshot] = useState<DraftContextSnapshot | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fillDraftIntoFormAndOpen = useCallback((draft: SuggestionDraft) => {
    suggestionForm.setFieldsValue({
      type: draft.type,
      base_version: draft.base_version,
      content: draft.content,
      amended_title: draft.amended_title,
      amended_content: draft.amended_content,
      risk_level: draft.risk_level,
      exclusive_role: draft.exclusive_role || 'all'
    });
    setShowNewSuggestion(true);
  }, [suggestionForm]);

  const loadClause = async () => {
    setLoading(true);
    try {
      const data = await clausesApi.get(clauseId!);
      setClause(data);
      if (['legal', 'business', 'admin'].includes(user.role)) {
        const draft = await loadDraft();
        if (draft) setRestorePromptOpen(true);
      }
    } finally { setLoading(false); }
  };

  useEffect(() => { loadClause(); }, [clauseId]);

  useEffect(() => {
    if (clause && ['legal', 'business', 'admin'].includes(user.role)) {
      (async () => {
        try {
          const draft = await clausesApi.getDraft(clauseId!);
          if (draft) {
            setCurrentDraft(draft);
            setRestorePromptOpen(true);
            setDraftConflictHandled(!draft.version_conflict);
          }
        } catch {}
      })();
    }
  }, [clauseId, clause]);

  const loadDraft = useCallback(async () => {
    try {
      const draft = await clausesApi.getDraft(clauseId!);
      setCurrentDraft(draft);
      if (draft && draft.version_conflict) {
        setDraftConflictHandled(false);
      } else {
        setDraftConflictHandled(true);
      }
      return draft;
    } catch {
      setCurrentDraft(null);
      setDraftConflictHandled(true);
      return null;
    }
  }, [clauseId]);

  const saveDraft = useCallback(async (formValues: Record<string, any>) => {
    if (!formValues.type || !formValues.base_version) return;
    try {
      setDraftSaving(true);
      const draft = await clausesApi.saveDraft(clauseId!, formValues);
      setCurrentDraft(draft);
    } catch {
    } finally {
      setDraftSaving(false);
    }
  }, [clauseId]);

  const handleFormChange = useCallback(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      const values = suggestionForm.getFieldsValue();
      if (values.type && values.base_version) {
        saveDraft(values);
      }
    }, 1500);
  }, [suggestionForm, saveDraft]);

  useEffect(() => {
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, []);

  const handleDiscardDraft = async () => {
    if (!currentDraft) return;
    try {
      await clausesApi.deleteDraft(clauseId!, currentDraft.id);
      setCurrentDraft(null);
      setDraftConflictHandled(true);
      setRestorePromptOpen(false);
      suggestionForm.resetFields();
      message.success('草稿已丢弃');
    } catch (e: any) {
      message.error(e.response?.data?.error || '丢弃草稿失败');
    }
  };

  const handleRestoreContinue = async () => {
    if (!currentDraft) return;
    try {
      setRestoring(true);
      const restored = await clausesApi.restoreDraft(clauseId!);
      setCurrentDraft(restored);
      setDraftConflictHandled(true);
      setRestorePromptOpen(false);
      message.success('已恢复上次编辑草稿，正在打开编辑窗口...');
      fillDraftIntoFormAndOpen(restored);
    } catch (e: any) {
      message.error(e.response?.data?.error || '恢复草稿失败');
    } finally {
      setRestoring(false);
    }
  };

  const handleDraftConflictAction = async (action: 'continue' | 'discard' | 'copy') => {
    if (!currentDraft || !clause) return;
    try {
      setRestoring(true);
      const res = await clausesApi.draftConflictAction(clauseId!, action);
      if (action === 'discard') {
        setCurrentDraft(null);
        setDraftConflictHandled(true);
        setRestorePromptOpen(false);
        suggestionForm.resetFields();
        message.success('草稿已丢弃');
      } else if (action === 'continue') {
        const merged = { ...currentDraft, ...(res as SuggestionDraft) };
        setCurrentDraft(merged);
        setDraftConflictHandled(true);
        setRestorePromptOpen(false);
        message.info('继续基于旧版本编辑');
        fillDraftIntoFormAndOpen(merged);
      } else if (action === 'copy') {
        const merged = res as SuggestionDraft;
        setCurrentDraft(merged);
        setDraftConflictHandled(true);
        setRestorePromptOpen(false);
        message.success('已将草稿内容复制到基于当前版本，正在打开编辑窗口...');
        fillDraftIntoFormAndOpen(merged);
      }
    } catch (e: any) {
      message.error(e.response?.data?.error || '操作失败');
    } finally {
      setRestoring(false);
    }
  };

  const openSuggestionModal = async () => {
    const draft = await loadDraft();
    if (draft) {
      suggestionForm.setFieldsValue({
        type: draft.type,
        base_version: draft.base_version,
        content: draft.content,
        amended_title: draft.amended_title,
        amended_content: draft.amended_content,
        risk_level: draft.risk_level,
        exclusive_role: draft.exclusive_role || 'all'
      });
    } else {
      suggestionForm.setFieldsValue({
        base_version: clause?.current_version,
        type: 'comment',
        exclusive_role: 'all',
        content: '',
        amended_title: undefined,
        amended_content: undefined,
        risk_level: undefined
      });
    }
    setShowNewSuggestion(true);
  };

  const handleCreateSuggestion = async () => {
    try {
      const values = await suggestionForm.validateFields();
      const res = await clausesApi.createSuggestion(clauseId!, values);
      setCurrentDraft(null);
      if (res.version_conflict) {
        modal.warning({
          title: <Space><WarningOutlined style={{ color: '#faad14' }} /> 版本冲突提示</Space>,
          width: 640,
          content: (
            <div>
              <Paragraph>
                您的建议基于 <Tag color="blue">v{values.base_version}</Tag> 提交，但条款已更新至 <Tag color="red">v{clause?.current_version}</Tag>。
              </Paragraph>
              <Paragraph>
                请先审阅下方变更内容，确认您的建议与新版本不冲突后，再决定是否继续提交。
              </Paragraph>
              {res.conflict_detail?.newer_versions?.length > 0 && (
                <div>
                  <Text strong>新增版本列表：</Text>
                  <ul>
                    {res.conflict_detail.newer_versions.map((v: any) => (
                      <li key={v.version_number}>
                        v{v.version_number} · {v.display_name} · {v.change_summary} · {dayjs(v.created_at).format('MM-DD HH:mm')}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Paragraph type="warning">
                提示：建议将被保存为待处理状态，但法务/管理员在合并时如仍存在版本冲突，可能被要求重新基于最新版本提交。
              </Paragraph>
            </div>
          ),
          okText: '我已知晓，继续提交',
          onOk: async () => {
            loadClause();
            message.success('建议已提交');
          }
        });
      } else {
        message.success('建议提交成功');
      }
      suggestionForm.resetFields();
      setShowNewSuggestion(false);
      loadClause();
    } catch (e: any) {
      message.error(e.response?.data?.error || '提交失败');
    }
  };

  const handleRollback = async () => {
    try {
      const values = await rollbackForm.validateFields();
      if (values.target_version >= clause!.current_version) {
        message.warning('目标版本必须小于当前版本');
        return;
      }
      const res = await clausesApi.rollback(clauseId!, values.target_version, values.reason);
      message.success(`回滚成功，新版本号为 v${res.new_version}`);
      setRollbackOpen(false);
      rollbackForm.resetFields();
      loadClause();
    } catch (e: any) {
      const err = e.response?.data;
      if (e.response?.status === 404) {
        modal.error({
          title: '回滚失败',
          content: (
            <div>
              <Paragraph strong>{err?.error}</Paragraph>
              <Paragraph type="secondary">{err?.detail}</Paragraph>
            </div>
          )
        });
      } else {
        message.error(err?.error || '回滚失败');
      }
    }
  };

  const exportHistory = async () => {
    try {
      const data = await reportsApi.clauseHistory(clauseId!);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `条款历史-${clause?.clause_number}-${dayjs().format('YYYYMMDDHHmmss')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      message.success('版本历史与决策日志导出成功');
    } catch (e: any) { message.error(e.response?.data?.error || '导出失败'); }
  };

  if (!clause) return <Empty description="加载中..." />;

  const filteredSuggestions = clause.suggestions?.filter(s => {
    if (suggestionTab === 'all') return true;
    return s.status === suggestionTab;
  }) || [];

  const pendingCount = clause.suggestions?.filter(s => s.status === 'pending').length || 0;

  const roleLabel = (role: string) => {
    if (role === 'admin') return <Tag icon={<SafetyOutlined />} color="gold">{ROLE_LABELS.admin}</Tag>;
    if (role === 'legal') return <Tag icon={<FileTextOutlined />} color="blue">{ROLE_LABELS.legal}</Tag>;
    return <Tag icon={<TeamOutlined />} color="green">{ROLE_LABELS.business}</Tag>;
  };

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Link to={`/contracts/${clause.contract_id}/clauses`}>
          <Button icon={<ArrowLeftOutlined />}>返回条款列表</Button>
        </Link>
        <Button icon={<ReloadOutlined />} onClick={loadClause}>刷新</Button>
      </Space>

      <Row gutter={16}>
        <Col span={15}>
          <Card bordered loading={loading}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <Space align="center">
                  <Tag color="geekblue" style={{ fontSize: 14, padding: '4px 10px' }}>条款 {clause.clause_number}</Tag>
                  <Tag color={RISK_COLORS[clause.risk_level]} style={{ fontSize: 12 }}>{RISK_LABELS[clause.risk_level]}</Tag>
                  <Tag color="purple">v{clause.current_version}</Tag>
                </Space>
                <Title level={3} style={{ marginTop: 8, marginBottom: 4 }}>{clause.title}</Title>
                <Text type="secondary">最后更新：{dayjs(clause.updated_at).format('YYYY-MM-DD HH:mm:ss')}</Text>
              </div>
              <Space direction="vertical" align="end">
                <Row gutter={12}>
                  <Col><Statistic title="总建议数" value={clause.suggestions?.length || 0} /></Col>
                  <Col><Statistic title="待处理" value={pendingCount} valueStyle={{ color: pendingCount > 0 ? '#cf1322' : '#3f8600' }} /></Col>
                </Row>
                {user.role === 'admin' && (
                  <Tooltip title="回滚到历史版本（会生成新版本）">
                    <Button icon={<RollbackOutlined />} onClick={() => setRollbackOpen(true)}>版本回滚</Button>
                  </Tooltip>
                )}
                <Button icon={<HistoryOutlined />} onClick={exportHistory}>导出历史与日志</Button>
              </Space>
            </div>

            <Divider style={{ margin: '16px 0' }} />

            <Title level={5}>条款内容：</Title>
            <div className="clause-content" style={{
              background: 'linear-gradient(135deg, #f5f7fa 0%, #e8ecf1 100%)',
              padding: 20, borderRadius: 8, border: '1px solid #e0e4e8'
            }}>
              {clause.content}
            </div>
          </Card>

          {restorePromptOpen && currentDraft && (
            <Alert
              style={{ marginTop: 16, boxShadow: '0 2px 8px rgba(22,119,255,0.12)' }}
              type={currentDraft.version_conflict ? 'warning' : 'success'}
              showIcon
              icon={currentDraft.version_conflict ? <WarningOutlined style={{ fontSize: 20 }} /> : <ThunderboltOutlined style={{ fontSize: 20, color: '#52c41a' }} />}
              message={
                <Space>
                  <Text strong style={{ fontSize: 15 }}>
                    {currentDraft.version_conflict ? '上次编辑的草稿存在版本变化' : '发现您上次未完成的编辑'}
                  </Text>
                </Space>
              }
              description={
                <div>
                  <Row gutter={12} style={{ marginBottom: 10 }}>
                    <Col span={12}>
                      <Card size="small" style={{ background: '#f0f5ff', border: '1px solid #d6e4ff' }}>
                        <Statistic
                          title={<span><SaveOutlined style={{ color: '#1677ff' }} /> 最近保存时间</span>}
                          value={dayjs(currentDraft.last_save_time || currentDraft.updated_at).format('YYYY-MM-DD HH:mm:ss')}
                          valueStyle={{ fontSize: 14, fontWeight: 600, color: '#1677ff' }}
                        />
                      </Card>
                    </Col>
                    <Col span={12}>
                      <Card size="small" style={{ background: '#f6ffed', border: '1px solid #b7eb8f' }}>
                        <Statistic
                          title={<span><FileTextOutlined style={{ color: '#52c41a' }} /> 草稿基于版本</span>}
                          value={`v${currentDraft.base_version}`}
                          prefix={<Tag color="blue" style={{ marginRight: 4 }}>基础</Tag>}
                          valueStyle={{ fontSize: 16, fontWeight: 700, color: '#389e0d' }}
                        />
                        {currentDraft.version_conflict && (
                          <div style={{ marginTop: 4 }}>
                            <Text type="danger" style={{ fontSize: 12 }}>
                              ⚠️ 当前版本：v{currentDraft.current_version || clause.current_version}
                            </Text>
                          </div>
                        )}
                      </Card>
                    </Col>
                  </Row>

                  {currentDraft.version_conflict && currentDraft.conflict_detail?.newer_versions && currentDraft.conflict_detail.newer_versions.length > 0 && (
                    <div style={{ marginBottom: 10, padding: '10px 14px', background: '#fffbe6', borderRadius: 6, border: '1px solid #ffe58f' }}>
                      <Row justify="space-between" align="middle" style={{ marginBottom: 6 }}>
                        <Text strong style={{ fontSize: 13 }}>
                          <WarningOutlined style={{ color: '#faad14', marginRight: 4 }} />
                          草稿保存后发生了 {currentDraft.conflict_detail.newer_versions.length} 次版本变更：
                        </Text>
                        {currentDraft.context_snapshot && (
                          <Button
                            type="link"
                            size="small"
                            icon={<EyeOutlined />}
                            onClick={() => {
                              setOldSnapshot(currentDraft.context_snapshot!);
                              setViewOldContentOpen(true);
                            }}
                          >
                            查看草稿保存时的条款内容
                          </Button>
                        )}
                      </Row>
                      <Timeline
                        style={{ padding: '4px 0 0', margin: 0 }}
                        items={currentDraft.conflict_detail!.newer_versions.map((v: any) => ({
                          color: 'blue',
                          dot: <Tag color="purple" style={{ fontSize: 11, padding: '0 6px' }}>v{v.version_number}</Tag>,
                          children: (
                            <div style={{ fontSize: 12 }}>
                              <Text strong>{v.display_name}</Text>
                              <Text type="secondary" style={{ marginLeft: 8 }}>{dayjs(v.created_at).format('MM-DD HH:mm')}</Text>
                              <div style={{ marginTop: 2, color: '#666' }}>{v.change_summary || '（无变更摘要）'}</div>
                            </div>
                          )
                        }))}
                      />
                    </div>
                  )}

                  {!currentDraft.version_conflict && (
                    <Paragraph style={{ marginBottom: 10, color: '#389e0d', fontSize: 13 }}>
                      ✅ 条款版本未发生变化（当前仍为 v{currentDraft.base_version}），可直接无缝继续编辑。
                    </Paragraph>
                  )}

                  <Space wrap size={8} style={{ marginTop: 4 }}>
                    {!currentDraft.version_conflict && (
                      <Button
                        type="primary"
                        size="large"
                        icon={<ThunderboltOutlined />}
                        loading={restoring}
                        onClick={handleRestoreContinue}
                        style={{ fontWeight: 600, boxShadow: '0 2px 6px rgba(22,119,255,0.3)' }}
                      >
                        一键继续编辑
                      </Button>
                    )}
                    {currentDraft.version_conflict && (
                      <>
                        <Button
                          type="primary"
                          icon={<CopyOutlined />}
                          loading={restoring}
                          onClick={() => handleDraftConflictAction('copy')}
                        >
                          复制内容到 v{currentDraft.current_version || clause.current_version} 继续
                        </Button>
                        <Button
                          icon={<EditOutlined />}
                          loading={restoring}
                          onClick={() => handleDraftConflictAction('continue')}
                        >
                          坚持基于 v{currentDraft.base_version} 编辑
                        </Button>
                        {currentDraft.context_snapshot && (
                          <Button
                            icon={<EyeOutlined />}
                            onClick={() => {
                              setOldSnapshot(currentDraft.context_snapshot!);
                              setViewOldContentOpen(true);
                            }}
                          >
                            查看旧内容
                          </Button>
                        )}
                      </>
                    )}
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      loading={restoring}
                      onClick={() => handleDraftConflictAction('discard')}
                    >
                      放弃草稿
                    </Button>
                    <Button
                      type="link"
                      onClick={() => setRestorePromptOpen(false)}
                    >
                      稍后处理
                    </Button>
                  </Space>
                </div>
              }
            />
          )}

          <Card
            style={{ marginTop: 16 }}
            title={
              <Space>
                <MessageOutlined style={{ color: '#1677ff' }} />
                评审建议
                <Badge count={pendingCount} style={{ backgroundColor: '#cf1322' }} />
              </Space>
            }
            extra={
              <Space>
                {currentDraft && (
                  <Tooltip title={`有未提交的草稿（基于 v${currentDraft.base_version}，${dayjs(currentDraft.updated_at).format('MM-DD HH:mm')} 保存）`}>
                    <Tag icon={<SaveOutlined />} color="orange">有草稿</Tag>
                  </Tooltip>
                )}
                <Button type="primary" icon={<PlusOutlined />} onClick={openSuggestionModal}>
                  发起建议
                </Button>
              </Space>
            }
          >
            <Tabs
              activeKey={suggestionTab}
              onChange={setSuggestionTab}
              items={[
                { key: 'pending', label: `待处理 (${pendingCount})` },
                { key: 'merged', label: `已合并 (${clause.suggestions?.filter(s => s.status === 'merged').length || 0})` },
                { key: 'approved', label: `已通过 (${clause.suggestions?.filter(s => s.status === 'approved').length || 0})` },
                { key: 'rejected', label: `已驳回 (${clause.suggestions?.filter(s => s.status === 'rejected').length || 0})` },
                { key: 'all', label: '全部' }
              ]}
            />

            {filteredSuggestions.length === 0 ? (
              <Empty description={`暂无${suggestionTab === 'all' ? '' : STATUS_LABEL(suggestionTab)}建议`} style={{ padding: '40px 0' }} />
            ) : (
              filteredSuggestions.map(s => (
                <SuggestionCard
                  key={s.id}
                  suggestion={s}
                  currentVersion={clause.current_version}
                  clauseId={clause.id}
                  onUpdated={loadClause}
                />
              ))
            )}
          </Card>
        </Col>

        <Col span={9}>
          <Card title={<span><HistoryOutlined style={{ color: '#1677ff' }} /> 版本历史</span>} bordered>
            <Timeline
              mode="left"
              items={(clause.versions || []).map((v, idx) => ({
                color: idx === 0 ? 'blue' : 'gray',
                label: (
                  <div>
                    <Text strong style={{ fontSize: 16 }}>v{v.version_number}</Text>
                    {idx === 0 && <Tag color="blue" style={{ marginLeft: 8 }}>当前</Tag>}
                    <br />
                    <Text type="secondary">{dayjs(v.created_at).format('MM-DD HH:mm')}</Text>
                  </div>
                ),
                children: (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ marginBottom: 6 }}>
                      {roleLabel(v.created_by_role || (clause.versions![0] === v ? 'legal' : 'legal'))}
                      <Text strong style={{ marginLeft: 6 }}>{v.creator_name}</Text>
                    </div>
                    <Paragraph ellipsis={{ rows: 1 }} style={{ color: '#555', margin: '4px 0' }}>
                      <FileTextOutlined /> {v.title}
                    </Paragraph>
                    <Paragraph type="secondary" style={{ margin: 0, fontSize: 12 }}>
                      {v.change_summary || '无变更摘要'}
                    </Paragraph>
                    <Space size="small" style={{ marginTop: 8 }}>
                      <Button size="small" onClick={() => setCompareVersions({ a: v, b: clause.versions?.[0] })}>
                        对比当前版
                      </Button>
                      {idx < (clause.versions?.length || 0) - 1 && (
                        <Button size="small" onClick={() => setCompareVersions({ a: v, b: clause.versions?.[idx + 1] })}>
                          对比上一版
                        </Button>
                      )}
                    </Space>
                  </div>
                )
              }))}
            />
          </Card>
        </Col>
      </Row>

      <Modal
        title={
          <Space>
            <PlusOutlined style={{ color: '#1677ff' }} />
            发起评审建议
            {roleLabel(user.role)}
            {currentDraft && <Tag icon={<SaveOutlined />} color="orange">从草稿恢复</Tag>}
          </Space>
        }
        open={showNewSuggestion}
        onCancel={() => {
          if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
          setShowNewSuggestion(false);
        }}
        onOk={handleCreateSuggestion}
        okText="提交建议"
        width={720}
        footer={(_, { OkBtn, CancelBtn }) => (
          <Space>
            <CancelBtn />
            {currentDraft && (
              <Button icon={<DeleteOutlined />} danger onClick={handleDiscardDraft}>
                丢弃草稿
              </Button>
            )}
            <OkBtn />
          </Space>
        )}
      >
        {currentDraft && currentDraft.version_conflict && !draftConflictHandled && (
          <Alert
            type="warning"
            showIcon
            icon={<WarningOutlined />}
            style={{ marginBottom: 16 }}
            message="草稿版本冲突"
            description={
              <div>
                <Paragraph>
                  您的草稿基于 <Tag color="blue">v{currentDraft.base_version}</Tag>，但条款已更新至 <Tag color="red">v{currentDraft.current_version || clause.current_version}</Tag>。
                </Paragraph>
                <Space style={{ marginTop: 8 }}>
                  <Button size="small" type="primary" onClick={() => handleDraftConflictAction('continue')}>
                    继续编辑（基于旧版本）
                  </Button>
                  <Button size="small" icon={<CopyOutlined />} onClick={() => handleDraftConflictAction('copy')}>
                    复制内容到新版本
                  </Button>
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDraftConflictAction('discard')}>
                    丢弃草稿
                  </Button>
                </Space>
              </div>
            }
          />
        )}
        {currentDraft && draftConflictHandled && currentDraft.version_conflict && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={`草稿基于 v${currentDraft.base_version}，当前条款为 v${clause.current_version}，提交时将提示版本冲突`}
          />
        )}
        {draftSaving && (
          <Alert
            type="info"
            showIcon
            icon={<SaveOutlined />}
            style={{ marginBottom: 16 }}
            message="草稿自动保存中..."
          />
        )}
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={`您正在基于条款 v${clause.current_version} 提交建议。如提交前条款已被更新，系统将自动提示冲突。编辑内容会自动保存为草稿。`}
        />
        <Form form={suggestionForm} layout="vertical" onValuesChange={handleFormChange}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="type" label="建议类型" rules={[{ required: true }]}>
                <Select options={[
                  { value: 'comment', label: '评论（仅文字说明，无内容变更）' },
                  { value: 'amendment', label: '修改建议（提供修改后的条款内容）' }
                ]} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="base_version" label="基于版本" rules={[{ required: true }]}>
                <Select options={(clause.versions || []).map(v => ({ value: v.version_number, label: `v${v.version_number}` }))} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="exclusive_role" label="可见范围" rules={[{ required: true }]}>
                <Select options={[
                  { value: 'all', label: '全部可见' },
                  { value: 'legal', label: '仅法务可决策（法务专属）' },
                  { value: 'business', label: '仅业务可决策（业务专属）' }
                ]} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.type !== cur.type}>
            {({ getFieldValue }) => (
              <Row gutter={12}>
                <Col span={getFieldValue('type') === 'amendment' ? 12 : 24}>
                  <Form.Item name="content" label="建议说明" rules={[{ required: true, message: '请填写建议说明' }]}>
                    <Input.TextArea rows={getFieldValue('type') === 'amendment' ? 4 : 8} placeholder="详细描述建议的背景、原因和意图..." />
                  </Form.Item>
                </Col>
                {getFieldValue('type') === 'amendment' && (
                  <Col span={12}>
                    <Form.Item name="amended_title" label="修改后的标题（可选）">
                      <Input placeholder="如无需修改标题可留空" />
                    </Form.Item>
                    <Form.Item name="amended_content" label="修改后的条款内容" rules={[{ required: true, message: '请填写修改后的内容' }]}>
                      <Input.TextArea rows={4} placeholder="提供完整的修改后的条款正文..." />
                    </Form.Item>
                  </Col>
                )}
              </Row>
            )}
          </Form.Item>

          <Form.Item name="risk_level" label="风险等级调整（可选，仅修改建议生效）">
            <Select allowClear options={[
              { value: 'low', label: RISK_LABELS.low },
              { value: 'medium', label: RISK_LABELS.medium },
              { value: 'high', label: RISK_LABELS.high },
              { value: 'critical', label: RISK_LABELS.critical }
            ]} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={
          <Space>
            <RollbackOutlined style={{ color: '#fa8c16' }} />
            版本回滚（管理员操作）
          </Space>
        }
        open={rollbackOpen}
        onCancel={() => setRollbackOpen(false)}
        onOk={handleRollback}
        okText="确认回滚"
        okButtonProps={{ danger: true }}
        width={560}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="回滚不会删除历史，而是创建新版本"
          description={`当前版本 v${clause.current_version}。回滚后将生成 v${clause.current_version + 1}，其内容与目标版本一致。`}
        />
        <Form form={rollbackForm} layout="vertical">
          <Form.Item
            name="target_version"
            label="目标历史版本号"
            rules={[{ required: true, message: '请选择要回滚到的版本', type: 'number', min: 1 }]}
          >
            <Select
              placeholder="选择一个历史版本"
              options={(clause.versions || []).filter(v => v.version_number < clause.current_version).map(v => ({
                value: v.version_number,
                label: `v${v.version_number} - ${v.change_summary || '无摘要'} (${dayjs(v.created_at).format('MM-DD HH:mm')})`
              }))}
            />
          </Form.Item>
          <Form.Item name="reason" label="回滚原因（必填，将记入审计日志）" rules={[{ required: true, message: '请填写原因' }]}>
            <Input.TextArea rows={4} placeholder="说明为什么要回滚到此版本..." />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={
          <Space>
            <FileTextOutlined />
            版本对比
            <Tag color="blue">{compareVersions.a && `v${compareVersions.a.version_number}`}</Tag>
            <span>vs</span>
            <Tag color="green">{compareVersions.b && `v${compareVersions.b.version_number}`}</Tag>
          </Space>
        }
        open={!!(compareVersions.a && compareVersions.b)}
        onCancel={() => setCompareVersions({})}
        footer={<Button onClick={() => setCompareVersions({})}>关闭</Button>}
        width={900}
      >
        <Row gutter={12}>
          <Col span={12}>
            <Card
              size="small"
              title={
                <Space>
                  v{compareVersions.a?.version_number}
                  <Tag color="blue">{compareVersions.a?.creator_name}</Tag>
                </Space>
              }
              style={{ background: '#fff2e8' }}
            >
              <div className="clause-content">{compareVersions.a?.content}</div>
              <Divider style={{ margin: '12px 0' }} />
              <Text type="secondary">变更摘要：{compareVersions.a?.change_summary}</Text>
            </Card>
          </Col>
          <Col span={12}>
            <Card
              size="small"
              title={
                <Space>
                  v{compareVersions.b?.version_number}
                  <Tag color="green">{compareVersions.b?.creator_name}</Tag>
                  {compareVersions.b?.version_number === clause.current_version && <Tag color="purple">当前</Tag>}
                </Space>
              }
              style={{ background: '#f6ffed' }}
            >
              <div className="clause-content">{compareVersions.b?.content}</div>
              <Divider style={{ margin: '12px 0' }} />
              <Text type="secondary">变更摘要：{compareVersions.b?.change_summary}</Text>
            </Card>
          </Col>
        </Row>
      </Modal>

      <Modal
        title={
          <Space>
            <EyeOutlined style={{ color: '#1677ff' }} />
            草稿保存时的条款内容快照
            {oldSnapshot && (
              <Tag color="orange">
                基于 v{oldSnapshot.version_number} · {dayjs(oldSnapshot.clause_updated_at).format('YYYY-MM-DD HH:mm')}
              </Tag>
            )}
          </Space>
        }
        open={viewOldContentOpen}
        onCancel={() => {
          setViewOldContentOpen(false);
          setOldSnapshot(null);
        }}
        width={820}
        footer={
          <Space>
            <Button
              icon={<CopyOutlined />}
              onClick={() => {
                if (oldSnapshot) {
                  navigator.clipboard?.writeText(oldSnapshot.version_content);
                  message.success('旧内容已复制到剪贴板');
                }
              }}
            >
              复制旧内容
            </Button>
            {oldSnapshot && clause && oldSnapshot.version_number !== clause.current_version && (
              <Button
                icon={<FileTextOutlined />}
                onClick={() => {
                  if (oldSnapshot && clause.versions) {
                    const cur = clause.versions.find(v => v.version_number === clause.current_version);
                    const snapVersion: ClauseVersion = {
                      id: 'snapshot',
                      clause_id: clause.id,
                      version_number: oldSnapshot.version_number,
                      title: oldSnapshot.version_title,
                      content: oldSnapshot.version_content,
                      risk_level: oldSnapshot.clause_risk_level,
                      created_by: '',
                      created_at: oldSnapshot.clause_updated_at,
                      change_summary: '草稿保存时的快照',
                      creator_name: '历史快照'
                    };
                    setCompareVersions({ a: snapVersion, b: cur });
                    setViewOldContentOpen(false);
                  }
                }}
              >
                与当前版本对比
              </Button>
            )}
            <Button
              type="primary"
              onClick={() => {
                setViewOldContentOpen(false);
                setOldSnapshot(null);
              }}
            >
              关闭
            </Button>
          </Space>
        }
      >
        {oldSnapshot && (
          <div>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={
                <Space>
                  <Text>这是您 <Text strong>{dayjs(oldSnapshot.clause_updated_at).format('YYYY-MM-DD HH:mm:ss')}</Text> 保存草稿时，条款 <Text strong>v{oldSnapshot.version_number}</Text> 的完整内容。</Text>
                </Space>
              }
            />
            <Card
              size="small"
              title={
                <Space>
                  <Tag color="orange">快照 v{oldSnapshot.version_number}</Tag>
                  <Text strong>{oldSnapshot.version_title}</Text>
                  <Tag color={RISK_COLORS[oldSnapshot.clause_risk_level]}>{RISK_LABELS[oldSnapshot.clause_risk_level]}</Tag>
                </Space>
              }
              style={{ background: '#fff7e6', border: '1px solid #ffd591' }}
            >
              <div
                className="clause-content"
                style={{
                  whiteSpace: 'pre-wrap',
                  padding: 16,
                  background: '#ffffff',
                  borderRadius: 6,
                  border: '1px solid #e8e8e8',
                  fontSize: 14,
                  lineHeight: 1.8
                }}
              >
                {oldSnapshot.version_content}
              </div>
            </Card>
          </div>
        )}
      </Modal>
    </div>
  );
};

function STATUS_LABEL(s: string) {
  const map: Record<string, string> = {
    pending: '待处理的', merged: '已合并的', approved: '已通过的', rejected: '已驳回的'
  };
  return map[s] || '';
}

export default ClauseDetailPage;
