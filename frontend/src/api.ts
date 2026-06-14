import axios from 'axios';
import { LoginResponse, Contract, Clause, Suggestion, AuditLog, ClauseVersion, User } from './types';

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

export const contractsApi = {
  list: () => api.get<Contract[]>('/contracts').then(r => r.data),
  create: (data: { name: string; description?: string }) =>
    api.post<Contract>('/contracts', data).then(r => r.data),
  get: (id: string) => api.get<Contract>(`/contracts/${id}`).then(r => r.data),
  delete: (id: string) => api.delete(`/contracts/${id}`).then(r => r.data),
  importClauses: (contractId: string, clauses: any[]) =>
    api.post(`/contracts/${contractId}/import`, { clauses }).then(r => r.data)
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
    api.post(`/clauses/${clauseId}/rollback`, { target_version, reason }).then(r => r.data)
};

export const reportsApi = {
  auditLogs: (params?: any) => api.get<AuditLog[]>('/reports/audit-logs', { params }).then(r => r.data),
  exportContract: (contractId: string) =>
    api.get(`/reports/contract/${contractId}/export`, { responseType: 'blob' }).then(r => r.data),
  clauseHistory: (clauseId: string) =>
    api.get(`/reports/clause/${clauseId}/version-history`).then(r => r.data)
};

export default api;
