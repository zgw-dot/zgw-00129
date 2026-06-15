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
