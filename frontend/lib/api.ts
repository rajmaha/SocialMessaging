import axios from 'axios'
import { API_URL } from './config'
import { getAuthToken } from './auth'

export const conversationAPI = {
  getConversations: (userId: number, platform?: string) => {
    const params: any = { user_id: userId }
    if (platform && platform !== 'all') {
      params.platform = platform
    }
    return axios.get(`${API_URL}/conversations/`, { params })
  },

  searchConversations: (userId: number, query: string) => {
    return axios.get(`${API_URL}/conversations/search`, {
      params: { user_id: userId, query },
    })
  },

  markAsRead: (conversationId: number) => {
    return axios.put(`${API_URL}/conversations/${conversationId}`)
  },

  deleteConversation: (conversationId: number) => {
    return axios.delete(`${API_URL}/conversations/${conversationId}`)
  },
}

export const messageAPI = {
  getMessages: (conversationId: number, limit: number = 50) => {
    return axios.get(`${API_URL}/messages/conversation/${conversationId}`, {
      params: { limit },
    })
  },

  sendMessage: (
    conversationId: number,
    messageText: string,
    messageType: string = 'text',
    mediaUrl?: string
  ) => {
    return axios.post(`${API_URL}/messages/send`, null, {
      params: {
        conversation_id: conversationId,
        message_text: messageText,
        message_type: messageType,
        media_url: mediaUrl,
      },
    })
  },

  markAsRead: (messageId: number) => {
    return axios.put(`${API_URL}/messages/mark-as-read/${messageId}`)
  },
}

// ── Backups ────────────────────────────────────────────────────────────────

export const api = axios.create({ baseURL: API_URL })
api.interceptors.request.use(cfg => {
  const token = getAuthToken()
  if (token) cfg.headers = { ...cfg.headers, Authorization: `Bearer ${token}` }
  return cfg
})

export const getBackupDestinations = () =>
  api.get('/backups/destinations').then(r => r.data);

export const createBackupDestination = (data: any) =>
  api.post('/backups/destinations', data).then(r => r.data);

export const updateBackupDestination = (id: number, data: any) =>
  api.put(`/backups/destinations/${id}`, data).then(r => r.data);

export const deleteBackupDestination = (id: number) =>
  api.delete(`/backups/destinations/${id}`).then(r => r.data);

export const testBackupDestination = (data: any) =>
  api.post('/backups/destinations/test', data).then(r => r.data);

export const getBackupJobs = () =>
  api.get('/backups/jobs').then(r => r.data);

export const createBackupJob = (data: any) =>
  api.post('/backups/jobs', data).then(r => r.data);

export const updateBackupJob = (id: number, data: any) =>
  api.put(`/backups/jobs/${id}`, data).then(r => r.data);

export const deleteBackupJob = (id: number) =>
  api.delete(`/backups/jobs/${id}`).then(r => r.data);

export const runBackupJobNow = (id: number) =>
  api.post(`/backups/jobs/${id}/run`).then(r => r.data);

export const getBackupRuns = (jobId?: number, status?: string) =>
  api.get('/backups/runs', { params: { job_id: jobId, status } }).then(r => r.data);

export const getJobBackupRuns = (jobId: number) =>
  api.get(`/backups/jobs/${jobId}/runs`).then(r => r.data);

export const restoreBackupRun = (runId: number) =>
  api.post(`/backups/runs/${runId}/restore`).then(r => r.data);

// ── PMS ────────────────────────────────────────────────────────────────────

export const pmsApi = {
  // Projects
  listProjects: () => api.get('/api/pms/projects'),
  createProject: (data: any) => api.post('/api/pms/projects', data),
  getProject: (id: number) => api.get(`/api/pms/projects/${id}`),
  updateProject: (id: number, data: any) => api.put(`/api/pms/projects/${id}`, data),
  deleteProject: (id: number) => api.delete(`/api/pms/projects/${id}`),

  // Members
  listMembers: (projectId: number) => api.get(`/api/pms/projects/${projectId}/members`),
  addMember: (projectId: number, data: any) => api.post(`/api/pms/projects/${projectId}/members`, data),
  removeMember: (projectId: number, userId: number) => api.delete(`/api/pms/projects/${projectId}/members/${userId}`),

  // Milestones
  listMilestones: (projectId: number) => api.get(`/api/pms/projects/${projectId}/milestones`),
  createMilestone: (projectId: number, data: any) => api.post(`/api/pms/projects/${projectId}/milestones`, data),
  updateMilestone: (id: number, data: any) => api.put(`/api/pms/milestones/${id}`, data),
  deleteMilestone: (id: number) => api.delete(`/api/pms/milestones/${id}`),

  // Tasks
  listTasks: (projectId: number) => api.get(`/api/pms/projects/${projectId}/tasks`),
  createTask: (projectId: number, data: any) => api.post(`/api/pms/projects/${projectId}/tasks`, data),
  getTask: (id: number) => api.get(`/api/pms/tasks/${id}`),
  updateTask: (id: number, data: any) => api.put(`/api/pms/tasks/${id}`, data),
  deleteTask: (id: number) => api.delete(`/api/pms/tasks/${id}`),
  transitionTask: (id: number, data: any) => api.post(`/api/pms/tasks/${id}/transition`, data),
  getTaskHistory: (id: number) => api.get(`/api/pms/tasks/${id}/history`),

  // Dependencies
  addDependency: (taskId: number, data: any) => api.post(`/api/pms/tasks/${taskId}/dependencies`, data),
  removeDependency: (depId: number) => api.delete(`/api/pms/dependencies/${depId}`),

  // Comments
  listComments: (taskId: number) => api.get(`/api/pms/tasks/${taskId}/comments`),
  createComment: (taskId: number, data: any) => api.post(`/api/pms/tasks/${taskId}/comments`, data),
  deleteComment: (id: number) => api.delete(`/api/pms/comments/${id}`),

  // Time logs
  listTimeLogs: (taskId: number) => api.get(`/api/pms/tasks/${taskId}/timelogs`),
  logTime: (taskId: number, data: any) => api.post(`/api/pms/tasks/${taskId}/timelogs`, data),
  deleteTimeLog: (id: number) => api.delete(`/api/pms/timelogs/${id}`),

  // Attachments
  uploadAttachment: (taskId: number, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post(`/api/pms/tasks/${taskId}/attachments`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  deleteAttachment: (id: number) => api.delete(`/api/pms/attachments/${id}`),

  // Alerts
  listAlerts: () => api.get('/api/pms/alerts'),
  markAlertRead: (id: number) => api.post(`/api/pms/alerts/${id}/read`),

  // Gantt
  getGantt: (projectId: number) => api.get(`/api/pms/projects/${projectId}/gantt`),

  // Integration
  createTaskFromTicket: (ticketId: number, projectId: number) =>
    api.post(`/api/pms/tasks/from-ticket/${ticketId}?project_id=${projectId}`),
};

// ─── Roles API ───────────────────────────────────────────────────────────────
export const rolesApi = {
  list: () => api.get('/roles'),
  create: (data: { name: string; slug: string; pages: string[] }) =>
    api.post('/roles', data),
  update: (id: number, data: { name?: string; pages?: string[] }) =>
    api.put(`/roles/${id}`, data),
  delete: (id: number) => api.delete(`/roles/${id}`),
  changeUserRole: (userId: number, role: string) =>
    api.patch(`/admin/users/${userId}/role`, { role }),
}

// --- API Servers ---
export const apiServersApi = {
  list: () => api.get('/admin/api-servers'),
  create: (data: any) => api.post('/admin/api-servers', data),
  update: (id: number, data: any) => api.put(`/admin/api-servers/${id}`, data),
  delete: (id: number) => api.delete(`/admin/api-servers/${id}`),
  listCredentials: (id: number) => api.get(`/admin/api-servers/${id}/credentials`),
  createCredential: (id: number, data: any) => api.post(`/admin/api-servers/${id}/credentials`, data),
}

export const userApiCredsApi = {
  update: (id: number, data: any) => api.put(`/user/api-credentials/${id}`, data),
  login: (id: number) => api.post(`/user/api-credentials/${id}/login`),
}

// --- Forms ---
export const formsApi = {
  list: () => api.get('/admin/forms'),
  create: (data: any) => api.post('/admin/forms', data),
  get: (id: number) => api.get(`/admin/forms/${id}`),
  update: (id: number, data: any) => api.put(`/admin/forms/${id}`, data),
  delete: (id: number) => api.delete(`/admin/forms/${id}`),
  // Fields
  listFields: (formId: number) => api.get(`/admin/forms/${formId}/fields`),
  createField: (formId: number, data: any) => api.post(`/admin/forms/${formId}/fields`, data),
  updateField: (formId: number, fieldId: number, data: any) => api.put(`/admin/forms/${formId}/fields/${fieldId}`, data),
  deleteField: (formId: number, fieldId: number) => api.delete(`/admin/forms/${formId}/fields/${fieldId}`),
  reorderFields: (formId: number, fieldIds: number[]) => api.put(`/admin/forms/${formId}/fields/reorder`, { field_ids: fieldIds }),
  // Submissions
  listSubmissions: (formId: number, skip = 0, limit = 50) => api.get(`/admin/forms/${formId}/submissions`, { params: { skip, limit } }),
  getSubmission: (formId: number, subId: number) => api.get(`/admin/forms/${formId}/submissions/${subId}`),
  updateSubmission: (formId: number, subId: number, data: any) => api.put(`/admin/forms/${formId}/submissions/${subId}`, data),
  deleteSubmission: (formId: number, subId: number) => api.delete(`/admin/forms/${formId}/submissions/${subId}`),
  exportSubmissions: (formId: number) => api.get(`/admin/forms/${formId}/submissions/export`, { responseType: 'blob' }),
  // Public
  getPublicForm: (slug: string) => api.get(`/forms/${slug}`),
  submitForm: (slug: string, data: any) => api.post(`/forms/${slug}/submit`, data),
}
