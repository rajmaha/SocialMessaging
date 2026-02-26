import { useEvents } from '@/lib/events-context'
import { formatDateWithTimezone } from '@/lib/date-utils'

interface Conversation {
  id: number
  platform: string
  contact_name: string
  contact_id: string
  last_message: string | null
  last_message_time: string | null
  unread_count: number
  contact_avatar: string | null
  status?: string
  assigned_to?: number | null
  assigned_to_name?: string | null
}

interface ConversationListProps {
  conversations: Conversation[]
  selectedConversation: Conversation | null
  onSelectConversation: (conversation: Conversation) => void
  loading: boolean
  activeConvIds?: Set<number>
}

export default function ConversationList({
  conversations,
  selectedConversation,
  onSelectConversation,
  loading,
  activeConvIds = new Set(),
}: ConversationListProps) {
  const { timezone } = useEvents()
  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const getPlatformBadgeColor = (platform: string) => {
    const colors: { [key: string]: string } = {
      whatsapp: 'bg-green-500',
      facebook: 'bg-blue-600',
      viber: 'bg-purple-600',
      linkedin: 'bg-blue-700',
      webchat: 'bg-teal-500',
    }
    return colors[platform.toLowerCase()] || 'bg-gray-500'
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-gray-500">Loading conversations...</div>
      </div>
    )
  }

  if (conversations.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-gray-500 text-center">
          <p>No conversations found</p>
          <p className="text-sm mt-2">Select a platform to see messages</p>
        </div>
      </div>
    )
  }

  // Sort: unassigned+unread first → active webchat → other platforms → offline webchat
  const sorted = [...conversations].sort((a, b) => {
    const rank = (c: Conversation) => {
      if (!c.assigned_to && c.unread_count > 0) return 4           // unassigned & unread — top priority
      if (c.platform === 'webchat' && activeConvIds.has(c.id)) return 3  // active webchat online
      if (c.platform !== 'webchat') return 2                        // other platforms
      if (c.platform === 'webchat' && activeConvIds.has(c.id)) return 1  // (covered above)
      return 0                                                       // offline webchat
    }
    if (rank(b) !== rank(a)) return rank(b) - rank(a)
    const parseTs = (ts: string) => new Date(!ts.endsWith('Z') && !ts.includes('+') && !ts.includes('-', 10) ? ts + 'Z' : ts)
    const aTime = a.last_message_time ? parseTs(a.last_message_time).getTime() : 0
    const bTime = b.last_message_time ? parseTs(b.last_message_time).getTime() : 0
    return bTime - aTime
  })

  return (
    <div className="flex-1 overflow-y-auto">
      {sorted.map((conversation) => (
        <div
          key={conversation.id}
          onClick={() => onSelectConversation(conversation)}
          className={`p-4 border-b cursor-pointer transition relative ${
            selectedConversation?.id === conversation.id
              ? 'bg-blue-50 border-l-4 border-l-blue-500'
              : !conversation.assigned_to && conversation.unread_count > 0
              ? 'border-l-4 border-l-orange-400 bg-orange-50 hover:bg-orange-100'
              : 'hover:bg-gray-50'
          } ${conversation.platform === 'webchat' && !activeConvIds.has(conversation.id) && conversation.assigned_to ? 'opacity-50' : ''}`}
        >
          <div className="flex justify-between items-start mb-2">
            <div className="flex items-center gap-2">
              <div className="relative">
                <div
                  className={`w-3 h-3 rounded-full ${
                    conversation.platform === 'webchat' && !activeConvIds.has(conversation.id)
                      ? 'bg-gray-300'
                      : getPlatformBadgeColor(conversation.platform)
                  }`}
                />
                {conversation.platform === 'webchat' && activeConvIds.has(conversation.id) && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-400 border border-white" />
                )}
              </div>
              <span className="font-semibold text-gray-800">
                {conversation.contact_name}
              </span>
            </div>
            {!conversation.assigned_to && conversation.unread_count > 0 ? (
              <span className="flex items-center gap-1">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500" />
                </span>
                <span className="text-[10px] font-bold text-orange-600 uppercase tracking-wide">New</span>
              </span>
            ) : conversation.unread_count > 0 ? (
              <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-full">
                {conversation.unread_count}
              </span>
            ) : null}
          </div>
          <p className="text-sm text-gray-600 truncate">
            {conversation.last_message || 'No messages yet'}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {conversation.platform.charAt(0).toUpperCase() +
              conversation.platform.slice(1)}{' '}
            •{' '}
            {conversation.last_message_time
              ? formatDateWithTimezone(conversation.last_message_time, tz, {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : ''}
            {conversation.assigned_to_name && (
              <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">
                👤 {conversation.assigned_to_name}
              </span>
            )}
            {conversation.status && conversation.status !== 'open' && (
              <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                conversation.status === 'resolved'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-amber-100 text-amber-700'
              }`}>
                {conversation.status}
              </span>
            )}
          </p>
        </div>
      ))}
    </div>
  )
}
