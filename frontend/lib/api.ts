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
