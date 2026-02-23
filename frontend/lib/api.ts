import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

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
