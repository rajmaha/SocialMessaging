'use client'

import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { FiSend } from 'react-icons/fi'
import { getAuthToken } from '@/lib/auth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Message {
  id: number
  conversation_id: number
  sender_name: string
  message_text: string
  message_type: string
  platform: string
  is_sent: number
  read_status: number
  timestamp: string
}

interface Conversation {
  id: number
  platform: string
  contact_name: string
  contact_id: string
  last_message: string | null
  last_message_time: string | null
  unread_count: number
  contact_avatar: string | null
}

interface ChatWindowProps {
  conversation: Conversation | null
  onRefresh: () => void
}

export default function ChatWindow({ conversation, onRefresh }: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [messageText, setMessageText] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [visitorOnline, setVisitorOnline] = useState<boolean | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (conversation) {
      fetchMessages(conversation.id)
      // Reset visitor online status when switching conversation
      setVisitorOnline(conversation.platform === 'webchat' ? false : null)
    }
  }, [conversation])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const fetchMessages = async (conversationId: number) => {
    setLoading(true)
    try {
      const response = await axios.get(
        `${API_URL}/messages/conversation/${conversationId}`,
        {
          params: { limit: 50 },
        }
      )
      setMessages(response.data)
    } catch (error) {
      console.error('Error fetching messages:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSendMessage = async () => {
    if (!messageText.trim() || !conversation) return

    setSending(true)
    try {
      const token = getAuthToken()
      const response = await axios.post(`${API_URL}/messages/send`, null, {
        params: {
          conversation_id: conversation.id,
          message_text: messageText,
        },
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })

      // For webchat, show whether the visitor received it live
      if (conversation.platform === 'webchat') {
        setVisitorOnline(response.data?.data?.delivered === true)
      }

      setMessageText('')
      // Refresh messages and conversations
      if (conversation) {
        fetchMessages(conversation.id)
      }
      onRefresh()
    } catch (error) {
      console.error('Error sending message:', error)
      alert('Failed to send message')
    } finally {
      setSending(false)
    }
  }

  if (!conversation) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-gray-800 mb-2">
            Open a conversation
          </h2>
          <p className="text-gray-600">Select a chat to start messaging</p>
        </div>
      </div>
    )
  }

  const getPlatformColor = (platform: string) => {
    const colors: { [key: string]: string } = {
      whatsapp: 'bg-green-100 text-green-800',
      facebook: 'bg-blue-100 text-blue-800',
      viber: 'bg-purple-100 text-purple-800',
      linkedin: 'bg-blue-100 text-blue-800',
      webchat: 'bg-teal-100 text-teal-800',
    }
    return colors[platform.toLowerCase()] || 'bg-gray-100 text-gray-800'
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Chat Header */}
      <div className="border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">
            {conversation.contact_name}
          </h2>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span
              className={`inline-block px-3 py-1 text-xs font-semibold rounded-full ${getPlatformColor(
                conversation.platform
              )}`}
            >
              {conversation.platform.charAt(0).toUpperCase() +
                conversation.platform.slice(1)}
            </span>
            {conversation.platform === 'webchat' && visitorOnline !== null && (
              <span className={`inline-flex items-center gap-1 text-xs font-medium ${visitorOnline ? 'text-green-600' : 'text-gray-400'}`}>
                <span className={`w-2 h-2 rounded-full ${visitorOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
                {visitorOnline ? 'Visitor online' : 'Visitor offline — message saved'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-gray-500">Loading messages...</div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-gray-500 text-center">
              <p>No messages yet</p>
              <p className="text-sm mt-2">Start a new conversation</p>
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.is_sent ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`message-bubble max-w-xs lg:max-w-md ${
                  message.is_sent
                    ? 'message-sent bg-blue-500 text-white'
                    : 'message-received bg-gray-200 text-gray-800'
                }`}
              >
                <p className="break-words">{message.message_text}</p>
                <p className={`text-xs mt-1 ${
                  message.is_sent ? 'text-blue-100' : 'text-gray-500'
                }`}>
                  {new Date(message.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input */}
      <div className="border-t px-6 py-4">
        <div className="flex gap-3">
          <input
            type="text"
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleSendMessage()
              }
            }}
            placeholder="Type a message..."
            className="flex-1 p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={sending}
          />
          <button
            onClick={handleSendMessage}
            disabled={sending || !messageText.trim()}
            className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white px-4 py-3 rounded-lg flex items-center gap-2 transition"
          >
            <FiSend size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
