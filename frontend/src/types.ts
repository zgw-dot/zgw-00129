export type UserRole = 'admin' | 'legal' | 'business';

export interface User {
  id: string;
  username: string;
  role: UserRole;
  display_name: string;
  created_at?: string;
}

export interface Contract {
  id: string;
  name: string;
  description: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  creator_name?: string;
  clause_count?: number;
  pending_suggestions?: number;
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type SuggestionStatus = 'pending' | 'approved' | 'rejected' | 'merged';
export type SuggestionType = 'comment' | 'amendment';
export type ExclusiveRole = 'all' | 'legal' | 'business';

export interface Clause {
  id: string;
  contract_id: string;
  clause_number: string;
  title: string;
  content: string;
  risk_level: RiskLevel;
  current_version: number;
  created_at: string;
  updated_at: string;
  pending_count?: number;
  total_suggestions?: number;
  versions?: ClauseVersion[];
  suggestions?: Suggestion[];
}

export interface ClauseVersion {
  id: string;
  clause_id: string;
  version_number: number;
  title: string;
  content: string;
  risk_level: RiskLevel;
  created_by: string;
  created_at: string;
  change_summary: string;
  creator_name?: string;
  created_by_role?: UserRole;
}

export interface Suggestion {
  id: string;
  clause_id: string;
  clause_version_id: string;
  base_version: number;
  type: SuggestionType;
  content: string;
  amended_title?: string | null;
  amended_content?: string | null;
  risk_level?: RiskLevel | null;
  status: SuggestionStatus;
  created_by: string;
  created_by_role: UserRole;
  exclusive_role: ExclusiveRole;
  created_at: string;
  resolved_at?: string | null;
  resolved_by?: string | null;
  decision_reason?: string | null;
  creator_name?: string;
  resolver_name?: string;
}

export interface AuditLog {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  user_id: string | null;
  user_role: string | null;
  details: Record<string, any> | null;
  created_at: string;
  user_name?: string;
}

export interface DraftContextSnapshot {
  clause_title: string;
  clause_content: string;
  clause_risk_level: RiskLevel;
  clause_updated_at: string;
  version_number: number;
  version_title: string;
  version_content: string;
}

export interface SuggestionDraft {
  id: string;
  clause_id: string;
  user_id: string;
  base_version: number;
  type: SuggestionType;
  content: string;
  amended_title?: string | null;
  amended_content?: string | null;
  risk_level?: RiskLevel | null;
  exclusive_role?: ExclusiveRole | null;
  context_snapshot?: DraftContextSnapshot | null;
  created_at: string;
  updated_at: string;
  version_conflict?: boolean;
  current_version?: number;
  last_save_time?: string;
  conflict_detail?: {
    base_version: number;
    current_version: number;
    newer_versions: Array<{
      version_number: number;
      change_summary: string;
      created_at: string;
      display_name: string;
    }>;
  } | null;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export const RISK_COLORS: Record<RiskLevel, string> = {
  low: 'green',
  medium: 'gold',
  high: 'orange',
  critical: 'red'
};

export const RISK_LABELS: Record<RiskLevel, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  critical: '严重风险'
};

export const STATUS_COLORS: Record<SuggestionStatus, string> = {
  pending: 'default',
  approved: 'green',
  rejected: 'red',
  merged: 'blue'
};

export const STATUS_LABELS: Record<SuggestionStatus, string> = {
  pending: '待处理',
  approved: '已通过',
  rejected: '已驳回',
  merged: '已合并'
};

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: '管理员',
  legal: '法务',
  business: '业务'
};

export const TYPE_LABELS: Record<SuggestionType, string> = {
  comment: '评论',
  amendment: '修改建议'
};

export const EXCLUSIVE_LABELS: Record<ExclusiveRole, string> = {
  all: '全部可见',
  legal: '法务专属',
  business: '业务专属'
};

export type CountersignRoundStatus = 'active' | 'completed' | 'withdrawn';
export type CountersignConclusion = 'pass' | 'reject' | 'need_more_info';
export type CountersignHistoryAction =
  | 'create_round' | 'acknowledge' | 'conclude' | 'withdraw_round'
  | 'replace_participant' | 'clause_version_change' | 'rereview_requested';

export interface CountersignRound {
  id: string;
  contract_id: string;
  contract_name?: string;
  round_name: string;
  description?: string;
  deadline?: string | null;
  created_by: string;
  creator_name?: string;
  status: CountersignRoundStatus;
  withdraw_reason?: string | null;
  withdrawn_at?: string | null;
  withdrawn_by?: string | null;
  withdrawer_name?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
  participant_count?: number;
  clause_count?: number;
  concluded_count?: number;
  acknowledged_count?: number;
  my_concluded?: number;
  my_acknowledged?: number;
}

export interface CountersignParticipant {
  id: string;
  round_id: string;
  user_id: string;
  username?: string;
  display_name?: string;
  role?: UserRole;
  is_replaced: number | boolean;
  replaced_by?: string | null;
  replaced_at?: string | null;
  replaced_reason?: string | null;
  original_participant_id?: string | null;
  original_user_id?: string | null;
  original_user_name?: string | null;
  created_at: string;
}

export interface CountersignClause {
  id: string;
  round_id: string;
  clause_id: string;
  clause_number?: string;
  title?: string;
  clause_version_at_create: number;
  current_version?: number;
  content?: string;
  risk_level?: RiskLevel;
  needs_rereview: number | boolean;
  rereview_reason?: string | null;
  invalidated: number | boolean;
  invalidation_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CountersignConclusionItem {
  id: string;
  round_id: string;
  participant_id: string;
  user_id: string;
  user_name?: string;
  participant_name?: string;
  clause_id: string;
  conclusion?: CountersignConclusion | null;
  comment?: string | null;
  acknowledged_at?: string | null;
  concluded_at?: string | null;
  original_version?: number;
  created_at: string;
  updated_at: string;
}

export interface CountersignHistoryItem {
  id: string;
  round_id: string;
  action: CountersignHistoryAction;
  user_id?: string | null;
  user_role?: string | null;
  user_name?: string | null;
  details: Record<string, any> | null;
  created_at: string;
}

export interface CountersignRoundDetail extends CountersignRound {
  participants: CountersignParticipant[];
  clauses: CountersignClause[];
  conclusions: CountersignConclusionItem[];
  history: CountersignHistoryItem[];
  my_participation: CountersignParticipant | null;
}

export const COUNTERSIGN_STATUS_COLORS: Record<CountersignRoundStatus, string> = {
  active: 'blue',
  completed: 'green',
  withdrawn: 'default'
};

export const COUNTERSIGN_STATUS_LABELS: Record<CountersignRoundStatus, string> = {
  active: '进行中',
  completed: '已完成',
  withdrawn: '已撤回'
};

export const COUNTERSIGN_CONCLUSION_COLORS: Record<string, string> = {
  pass: 'green',
  reject: 'red',
  need_more_info: 'orange'
};

export const COUNTERSIGN_CONCLUSION_LABELS: Record<string, string> = {
  pass: '通过',
  reject: '退回',
  need_more_info: '需补充'
};

export const COUNTERSIGN_HISTORY_ACTION_LABELS: Record<CountersignHistoryAction, string> = {
  create_round: '发起会签',
  acknowledge: '签收',
  conclude: '提交结论',
  withdraw_round: '撤回会签',
  replace_participant: '替换参与人',
  clause_version_change: '条款版本变更',
  rereview_requested: '请求重审'
};

export type HandoverStatus = 'pending' | 'signed' | 'withdrawn' | 'conflict';
export type HandoverScope = 'all' | 'drafts' | 'countersigns' | 'tickets' | 'custom';
export type HandoverItemType = 'draft' | 'countersign' | 'ticket' | 'suggestion';
export type HandoverHistoryAction = 'create' | 'sign' | 'withdraw' | 'conflict_detected' | 'conflict_resolved' | 'reconfirm';

export interface Handover {
  id: string;
  handover_no: string;
  from_user_id: string;
  to_user_id: string;
  from_user_name?: string;
  to_user_name?: string;
  scope: HandoverScope;
  reason: string;
  status: HandoverStatus;
  signed_at?: string | null;
  sign_note?: string | null;
  withdrawn_at?: string | null;
  withdraw_reason?: string | null;
  withdrawn_by?: string | null;
  conflict_detail?: string | null;
  conflict_resolved?: number | boolean;
  created_at: string;
  updated_at: string;
  item_count?: number;
}

export interface HandoverItem {
  id: string;
  handover_id: string;
  item_type: HandoverItemType;
  item_id: string;
  snapshot: Record<string, any> | null;
  status_at_handover: string;
  version_at_handover: number | null;
  transferred: number | boolean;
  created_at: string;
}

export interface HandoverHistoryItem {
  id: string;
  handover_id: string;
  action: HandoverHistoryAction;
  user_id?: string | null;
  user_role?: string | null;
  user_name?: string | null;
  details: Record<string, any> | null;
  created_at: string;
}

export interface HandoverDetail extends Handover {
  items: HandoverItem[];
  history: HandoverHistoryItem[];
}

export interface HandoverConflict {
  item_type: HandoverItemType;
  item_id: string;
  field: string;
  old_value: any;
  new_value: any;
  description: string;
}

export const HANDOVER_STATUS_COLORS: Record<HandoverStatus, string> = {
  pending: 'blue',
  signed: 'green',
  withdrawn: 'default',
  conflict: 'orange'
};

export const HANDOVER_STATUS_LABELS: Record<HandoverStatus, string> = {
  pending: '待签收',
  signed: '已签收',
  withdrawn: '已撤回',
  conflict: '有冲突'
};

export const HANDOVER_SCOPE_LABELS: Record<HandoverScope, string> = {
  all: '全部',
  drafts: '草稿',
  countersigns: '会签',
  tickets: '复查工单',
  custom: '自定义'
};

export const HANDOVER_ITEM_TYPE_LABELS: Record<HandoverItemType, string> = {
  draft: '草稿',
  countersign: '会签',
  ticket: '复查工单',
  suggestion: '建议'
};

export const HANDOVER_HISTORY_ACTION_LABELS: Record<HandoverHistoryAction, string> = {
  create: '创建交接',
  sign: '签收',
  withdraw: '撤回',
  conflict_detected: '检测到冲突',
  conflict_resolved: '冲突已解决',
  reconfirm: '重新确认'
};
