import axios from 'axios';
import {
  LoginResponse, Contract, Clause, Suggestion, AuditLog, ClauseVersion, User, SuggestionDraft,
  CountersignRound, CountersignRoundDetail, CountersignParticipant,
  Handover, HandoverDetail, HandoverConflict
} from './types';

const API_BASE = '/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export const authApi = {
  login: (username: string, password: string) =>
    api.post<LoginResponse>('/auth/login', { username, password }).then(r => r.data),
  me: () => api.get<User>('/auth/me').then(r => r.data),
  users: () => api.get<User[]>('/auth/users').then(r => r.data)
};

export interface ImportPrecheckResult {
  contract_id: string;
  total_input: number;
  new_count: number;
  update_count: number;
  skip_count: number;
  error_count: number;
  blocked_count: number;
  new_clauses: Array<{
    clause_number: string;
    title: string;
    content: string;
    risk_level: string;
  }>;
  update_clauses: Array<{
    clause_id: string;
    clause_number: string;
    old_title: string;
    new_title: string;
    old_content: string;
    new_content: string;
    old_risk_level: string;
    new_risk_level: string;
    current_version: number;
    has_pending_suggestions: boolean;
    pending_suggestions_count: number;
    pending_suggestions: any[];
    has_drafts: boolean;
    drafts: any[];
    blocked: boolean;
  }>;
  skip_clauses: Array<{
    clause_id: string;
    clause_number: string;
    title: string;
    current_version: number;
    risk_level: string;
  }>;
  errors: string[];
}

export interface ImportConfirmOverride {
  clause_number: string;
  reason: string;
}

export interface ImportResult {
  import_mode: 'add_only' | 'update_by_number';
  imported_new: any[];
  updated: any[];
  skipped: any[];
  blocked: any[];
  errors: string[];
  new_count: number;
  update_count: number;
  skip_count: number;
  block_count: number;
  error_count: number;
}

export const contractsApi = {
  list: () => api.get<Contract[]>('/contracts').then(r => r.data),
  create: (data: { name: string; description?: string }) =>
    api.post<Contract>('/contracts', data).then(r => r.data),
  get: (id: string) => api.get<Contract>(`/contracts/${id}`).then(r => r.data),
  delete: (id: string) => api.delete(`/contracts/${id}`).then(r => r.data),
  importClauses: (contractId: string, clauses: any[]) =>
    api.post(`/contracts/${contractId}/import`, { clauses }).then(r => r.data),
  precheckImport: (contractId: string, clauses: any[]) =>
    api.post<ImportPrecheckResult>(`/contracts/${contractId}/import-precheck`, { clauses }).then(r => r.data),
  confirmImport: (contractId: string, mode: 'add_only' | 'update_by_number', clauses: any[], confirmOverrides?: ImportConfirmOverride[]) =>
    api.post<ImportResult>(`/contracts/${contractId}/import`, {
      mode,
      clauses,
      confirm_overrides: confirmOverrides || []
    }).then(r => r.data)
};

export const clausesApi = {
  list: (params?: { contract_id?: string; risk_level?: string; has_pending?: string }) =>
    api.get<Clause[]>('/clauses', { params }).then(r => r.data),
  get: (id: string) => api.get<Clause & { versions: ClauseVersion[]; suggestions: Suggestion[] }>(`/clauses/${id}`).then(r => r.data),
  versions: (id: string) => api.get<ClauseVersion[]>(`/clauses/${id}/versions`).then(r => r.data),
  createSuggestion: (id: string, data: any) =>
    api.post(`/clauses/${id}/suggestions`, data).then(r => r.data),
  listSuggestions: (id: string, params?: { status?: string }) =>
    api.get<Suggestion[]>(`/clauses/${id}/suggestions`, { params }).then(r => r.data),
  approveSuggestion: (clauseId: string, sid: string, reason: string) =>
    api.post(`/clauses/${clauseId}/suggestions/${sid}/approve`, { reason }).then(r => r.data),
  rejectSuggestion: (clauseId: string, sid: string, reason: string) =>
    api.post(`/clauses/${clauseId}/suggestions/${sid}/reject`, { reason }).then(r => r.data),
  mergeSuggestion: (clauseId: string, sid: string, reason: string) =>
    api.post(`/clauses/${clauseId}/suggestions/${sid}/merge`, { reason }).then(r => r.data),
  rollback: (clauseId: string, target_version: number, reason: string) =>
    api.post(`/clauses/${clauseId}/rollback`, { target_version, reason }).then(r => r.data),
  getDraft: (clauseId: string) =>
    api.get<SuggestionDraft | null>(`/clauses/${clauseId}/drafts`).then(r => r.data),
  saveDraft: (clauseId: string, data: any) =>
    api.post<SuggestionDraft>(`/clauses/${clauseId}/drafts`, data).then(r => r.data),
  deleteDraft: (clauseId: string, draftId: string) =>
    api.delete(`/clauses/${clauseId}/drafts/${draftId}`).then(r => r.data),
  restoreDraft: (clauseId: string) =>
    api.post<SuggestionDraft>(`/clauses/${clauseId}/drafts/restore`).then(r => r.data),
  draftConflictAction: (clauseId: string, action: 'continue' | 'copy' | 'discard') =>
    api.post(`/clauses/${clauseId}/drafts/conflict-action`, { action }).then(r => r.data)
};

export const reportsApi = {
  auditLogs: (params?: any) => api.get<AuditLog[]>('/reports/audit-logs', { params }).then(r => r.data),
  exportContract: (contractId: string) =>
    api.get(`/reports/contract/${contractId}/export`, { responseType: 'blob' }).then(r => r.data),
  clauseHistory: (clauseId: string) =>
    api.get(`/reports/clause/${clauseId}/version-history`).then(r => r.data)
};

export interface CreateCountersignRequest {
  contract_id: string;
  round_name: string;
  description?: string;
  deadline?: string;
  participant_ids: string[];
  clause_ids: string[];
}

export interface CountersignConcludeRequest {
  clause_id: string;
  conclusion: 'pass' | 'reject' | 'need_more_info';
  comment?: string;
}

export interface ReplaceParticipantRequest {
  old_participant_id: string;
  new_user_id: string;
  reason: string;
}

export interface RereviewRequest {
  clause_ids: string[];
  reason: string;
}

export const countersignApi = {
  create: (data: CreateCountersignRequest) =>
    api.post<CountersignRound>('/countersigns', data).then(r => r.data),
  listByContract: (contractId: string) =>
    api.get<CountersignRound[]>(`/countersigns/contract/${contractId}`).then(r => r.data),
  listMine: () =>
    api.get<CountersignRound[]>('/countersigns/mine').then(r => r.data),
  get: (roundId: string) =>
    api.get<CountersignRoundDetail>(`/countersigns/${roundId}`).then(r => r.data),
  acknowledge: (roundId: string) =>
    api.post(`/countersigns/${roundId}/acknowledge`).then(r => r.data),
  conclude: (roundId: string, data: CountersignConcludeRequest) =>
    api.post(`/countersigns/${roundId}/conclude`, data).then(r => r.data),
  withdraw: (roundId: string, reason: string) =>
    api.post<CountersignRound>(`/countersigns/${roundId}/withdraw`, { reason }).then(r => r.data),
  replaceParticipant: (roundId: string, data: ReplaceParticipantRequest) =>
    api.post<{ new_participant: CountersignParticipant; old_conclusions_preserved: number }>(
      `/countersigns/${roundId}/replace-participant`, data
    ).then(r => r.data),
  rerequestRereview: (roundId: string, data: RereviewRequest) =>
    api.post(`/countersigns/${roundId}/rerequest-rereview`, data).then(r => r.data)
};

export interface HandoverPreviewRequest {
  to_user_id: string;
  scope: 'all' | 'drafts' | 'countersigns' | 'tickets' | 'custom';
  custom_items?: Array<{ item_type: string; item_id: string }>;
}

export interface HandoverCreateRequest extends HandoverPreviewRequest {
  reason: string;
}

export const handoverApi = {
  preview: (data: HandoverPreviewRequest) =>
    api.post('/handovers/preview', data).then(r => r.data),
  create: (data: HandoverCreateRequest) =>
    api.post<{ handover: Handover; items: any[] }>('/handovers', data).then(r => r.data),
  list: (params?: { status?: string; from_user_id?: string; to_user_id?: string }) =>
    api.get<Handover[]>('/handovers', { params }).then(r => r.data),
  get: (id: string) =>
    api.get<HandoverDetail>(`/handovers/${id}`).then(r => r.data),
  sign: (id: string, note?: string) =>
    api.post<Handover>(`/handovers/${id}/sign`, { note }).then(r => r.data),
  withdraw: (id: string, reason: string) =>
    api.post<Handover>(`/handovers/${id}/withdraw`, { reason }).then(r => r.data),
  conflicts: (id: string) =>
    api.get<{ handover_id: string; conflict_count: number; conflicts: HandoverConflict[] }>(`/handovers/${id}/conflicts`).then(r => r.data),
  reconfirm: (id: string, data: { remove_conflict_items?: Array<{ item_type: string; item_id: string }>; force?: boolean }) =>
    api.post<Handover>(`/handovers/${id}/reconfirm`, data).then(r => r.data)
};

export default api;
