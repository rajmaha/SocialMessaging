'use client'

import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { FiSend, FiPaperclip, FiX, FiFile, FiDownload } from 'react-icons/fi'
import { getAuthToken } from '@/lib/auth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface Message {
  id: number
  conversation_id: number
  sender_name: string
  message_text: string
  message_type: string
  media_url?: string | null
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
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [allowedTypes, setAllowedTypes] = useState<string[]>([])
  const [maxFileMb, setMaxFileMb] = useState(10)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (conversation) {
      fetchMessages(conversation.id)
      // Reset visitor online status when switching conversation
      setVisitorOnline(conversation.platform === 'webchat' ? false : null)
    }
  }, [conversation])

  // Load allowed file types once on mount
  useEffect(() => {
    axios.get(`${API_URL}/messages/allowed-file-types`).then((r) => {
      setAllowedTypes(r.data.allowed_file_types || [])
      setMaxFileMb(r.data.max_file_size_mb || 10)
    }).catch(() => {})
  }, [])

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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (allowedTypes.length > 0 && !allowedTypes.includes(file.type)) {
      alert(`File type not allowed. Allowed types: ${allowedTypes.join(', ')}`)
      return
    }
    if (file.size > maxFileMb * 1024 * 1024) {
      alert(`File too large. Maximum size is ${maxFileMb} MB.`)
      return
    }
    setPendingFile(file)
    // reset input so same file can be re-selected
    e.target.value = ''
  }

  const handleSendMessage = async () => {
    if (!messageText.trim() && !pendingFile) return
    if (!conversation) return

    setSending(true)
    try {
      const token = getAuthToken()
      const headers = token ? { Authorization: `Bearer ${token}` } : {}

      let mediaUrl: string | undefined
      let attachmentName: string | undefined

      // Upload file first if one is pending
      if (pendingFile) {
        const fd = new FormData()
        fd.append('file', pendingFile)
        const uploadResp = await axios.post(`${API_URL}/messages/upload-attachment`, fd, { headers })
        mediaUrl = uploadResp.data.url
        attachmentName = uploadResp.data.filename
        setPendingFile(null)
      }

      const response = await axios.post(`${API_URL}/messages/send`, null, {
        params: {
          conversation_id: conversation.id,
          message_text: messageText,
          ...(mediaUrl ? { media_url: mediaUrl, attachment_name: attachmentName } : {}),
        },
        headers,
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
                {/* Image attachment */}
                {message.message_type === 'image' && message.media_url && (
                  <a href={`${API_URL}${message.media_url}`} target="_blank" rel="noreferrer">
                    <img
                      src={`${API_URL}${message.media_url}`}
                      alt={message.message_text}
                      className="rounded-lg max-w-full mb-1 max-h-48 object-cover"
                    />
                  </a>
                )}
                {/* File attachment */}
                {message.message_type === 'file' && message.media_url && (
                  <a
                    href={`${API_URL}${message.media_url}`}
                    target="_blank"
                    rel="noreferrer"
                    className={`flex items-center gap-2 py-1 underline text-sm ${message.is_sent ? 'text-blue-100' : 'text-blue-700'}`}
                  >
                    <FiFile size={16} />
                    <span className="break-all">{message.message_text}</span>
                    <FiDownload size={14} />
                  </a>
                )}
                {/* Text (always show for text messages; captions for attachments) */}
                {(message.message_type === 'text' || (!message.media_url)) && (
                  <p className="break-words">{message.message_text}</p>
                )}
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
        {/* Pending file preview */}
        {pendingFile && (
          <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
            <FiFile size={16} />
            <span className="flex-1 truncate">{pendingFile.name}</span>
            <button onClick={() => setPendingFile(null)} className="text-blue-500 hover:text-blue-700">
              <FiX size={16} />
            </button>
          </div>
        )}
        <div className="flex gap-3">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept={allowedTypes.join(',')}
            onChange={handleFileSelect}
            className="hidden"
          />
          {/* Paperclip button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={sending}
            title={`Attach file (max ${maxFileMb} MB)`}
            className="text-gray-500 hover:text-blue-600 disabled:opacity-40 px-2 transition"
          >
            <FiPaperclip size={20} />
          </button>
          <input
            type="text"
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleSendMessage()
              }
            }}
            placeholder={pendingFile ? 'Add a caption (optional)…' : 'Type a message...'}
            className="flex-1 p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={sending}
          />
          <button
            onClick={handleSendMessage}
            disabled={sending || (!messageText.trim() && !pendingFile)}
            className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white px-4 py-3 rounded-lg flex items-center gap-2 transition"
          >
            <FiSend size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
