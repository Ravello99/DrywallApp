// API calls for the project-management features. One small object per feature.
import api from './api';

const get = async (url: string, params?: Record<string, any>) => (await api.get(url, { params })).data;
const post = async (url: string, body?: any) => (await api.post(url, body ?? {})).data;
const put = async (url: string, body?: any) => (await api.put(url, body ?? {})).data;
const del = async (url: string) => (await api.delete(url)).data;

export const projectsApi = {
  overview: (includeCompleted = false) => get('/projects/overview', { include_completed: includeCompleted }),
  summary: (siteId: string) => get(`/projects/${siteId}/summary`),
  flagged: () => get('/projects/flagged-clock-records'),
  reviewFlagged: (recordId: string) => post(`/projects/clock-records/${recordId}/review`),
  updateSite: (siteId: string, data: any) => put(`/sites/${siteId}`, data),
};

export const tasksApi = {
  templates: () => get('/workflows/templates'),
  applyWorkflow: (siteId: string, scopes: { scope: string; budget_hours: number }[]) =>
    post(`/sites/${siteId}/workflows`, { scopes }),
  list: (params: Record<string, any>) => get('/tasks', params),
  mine: () => get('/tasks/my-tasks'),
  clockable: (siteId: string) => get(`/tasks/clockable/${siteId}`),
  create: (data: any) => post('/tasks', data),
  update: (taskId: string, data: any) => put(`/tasks/${taskId}`, data),
  remove: (taskId: string) => del(`/tasks/${taskId}`),
  setActiveTask: async (taskId: string | null) =>
    (await api.put('/clock/active/task', null, { params: taskId ? { task_id: taskId } : {} })).data,
};

export const materialsApi = {
  requests: (params: Record<string, any> = {}) => get('/materials/requests', params),
  createRequest: (data: any) => post('/materials/requests', data),
  approve: (id: string, notes?: string) => post(`/materials/requests/${id}/approve`, { notes }),
  reject: (id: string, notes?: string) => post(`/materials/requests/${id}/reject`, { notes }),
  release: (id: string, data: any) => post(`/materials/requests/${id}/release`, data),
  delivered: (id: string) => post(`/materials/requests/${id}/delivered`),
  releases: (siteId?: string) => get('/materials/releases', siteId ? { site_id: siteId } : {}),
  createRelease: (data: any) => post('/materials/releases', data),
  deleteRelease: (id: string) => del(`/materials/releases/${id}`),
};

export const manpowerApi = {
  requests: (params: Record<string, any> = {}) => get('/manpower/requests', params),
  createRequest: (data: any) => post('/manpower/requests', data),
  available: (params: Record<string, any> = {}) => get('/manpower/available', params),
  approve: (id: string, userIds: string[], notes?: string) =>
    post(`/manpower/requests/${id}/approve`, { user_ids: userIds, notes }),
  reject: (id: string, notes?: string) => post(`/manpower/requests/${id}/reject`, { notes }),
  assignments: (params: Record<string, any> = {}) => get('/crew/assignments', params),
  assign: (data: any) => post('/crew/assignments', data),
  removeAssignment: (id: string) => del(`/crew/assignments/${id}`),
  calendar: (start?: string, end?: string) => get('/me/calendar', { start, end }),
};

export const rfiApi = {
  list: (params: Record<string, any> = {}) => get('/rfis', params),
  get: (id: string) => get(`/rfis/${id}`),
  create: (data: any) => post('/rfis', data),
  respond: (id: string, data: any) => post(`/rfis/${id}/respond`, data),
  forward: (id: string, data: any) => post(`/rfis/${id}/forward`, data),
  close: (id: string) => post(`/rfis/${id}/close`),
  reopen: (id: string) => post(`/rfis/${id}/reopen`),
};

export const changeOrderApi = {
  list: (params: Record<string, any> = {}) => get('/change-orders', params),
  create: (data: any) => post('/change-orders', data),
  update: (id: string, data: any) => put(`/change-orders/${id}`, data),
  submit: (id: string) => post(`/change-orders/${id}/submit`),
  respond: (id: string, data: any) => post(`/change-orders/${id}/respond`, data),
  remove: (id: string) => del(`/change-orders/${id}`),
};

export const drawApi = {
  list: (params: Record<string, any> = {}) => get('/invoices', params),
  summary: () => get('/invoices/summary'),
  create: (data: any) => post('/invoices', data),
  update: (id: string, data: any) => put(`/invoices/${id}`, data),
  submit: (id: string) => post(`/invoices/${id}/submit`),
  pay: (id: string, data: any) => post(`/invoices/${id}/payments`, data),
  remove: (id: string) => del(`/invoices/${id}`),
};

export const bidApi = {
  list: (params: Record<string, any> = {}) => get('/bids', params),
  stats: () => get('/bids/stats'),
  get: (id: string) => get(`/bids/${id}`),
  create: (data: any) => post('/bids', data),
  importEmail: (data: any) => post('/bids/import-email', data),
  update: (id: string, data: any) => put(`/bids/${id}`, data),
  submit: (id: string, data: any) => post(`/bids/${id}/submit`, data),
  followUp: (id: string, data: any) => post(`/bids/${id}/follow-up`, data),
  outcome: (id: string, data: any) => post(`/bids/${id}/outcome`, data),
  createProject: (id: string) => post(`/bids/${id}/create-project`),
  remove: (id: string) => del(`/bids/${id}`),
  inboxStatus: () => get('/bids/inbox/status'),
  checkInbox: () => post('/bids/inbox/check'),
};

export const notificationsApi = {
  list: (unreadOnly = false) => get('/notifications', { unread_only: unreadOnly }),
  read: (id: string) => post(`/notifications/${id}/read`),
  readAll: () => post('/notifications/read-all'),
};

export const fieldApi = {
  dashboard: () => get('/field/dashboard'),
  hours: (weeks = 8) => get('/me/hours', { weeks }),
  crewSafety: () => get('/field/crew-safety'),
};

/** Turn an API error into one readable line. */
export const apiError = (error: any, fallback = 'Something went wrong') => {
  const d = error?.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x: any) => `${(x.loc || []).slice(-1)[0] || ''} ${x.msg}`.trim()).join('\n');
  if (!error?.response) return "Can't reach the server. Check your connection.";
  return fallback;
};
