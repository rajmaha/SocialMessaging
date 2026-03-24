import { useEvents } from '@/lib/events-context'
import { formatDateWithTimezone } from '@/lib/date-utils'
import { getPlatformBadgeColor } from '@/lib/platform-colors'

// UUID pattern to detect and hide raw webchat session IDs
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  platform_account_id?: number | null
  widget_domain_id?: number | null
  ticket_count?: number
}

interface ConversationListProps {
  conversations: Conversation[]
  selectedConversation: Conversation | null
  onSelectConversation: (conversation: Conversation) => void
  loading: boolean
  activeConvIds?: Set<number>
  accountMap?: Record<number, string>
  domainMap?: Record<number, string>
  domainFilter?: string
}

export default function ConversationList({
  conversations,
  selectedConversation,
  onSelectConversation,
  loading,
  activeConvIds = new Set(),
  accountMap = {},
  domainMap = {},
  domainFilter = '',
}: ConversationListProps) {
  const { timezone } = useEvents()
  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

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

  // Filter by domain if a domain filter is active
  const domainFiltered = domainFilter
    ? conversations.filter(c => c.widget_domain_id != null && String(c.widget_domain_id) === domainFilter)
    : conversations

  // Sort: unassigned+unread first → active webchat → other platforms → offline webchat
  const sorted = [...domainFiltered].sort((a, b) => {
    const rank = (c: Conversation) => {
      if (!c.assigned_to && c.unread_count > 0) return 3           // unassigned & unread — top priority
      if (c.platform === 'webchat' && activeConvIds.has(c.id)) return 2  // active webchat online
      if (c.platform !== 'webchat') return 1                        // other platforms
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
          className={`p-3 md:p-4 border-b cursor-pointer transition relative ${
            selectedConversation?.id === conversation.id
              ? 'bg-blue-50 border-l-4 border-l-blue-500'
              : !conversation.assigned_to && conversation.unread_count > 0
              ? 'border-l-4 border-l-orange-400 bg-orange-50 hover:bg-orange-100'
              : 'hover:bg-gray-50'
          } ${conversation.platform === 'webchat' && !activeConvIds.has(conversation.id) && conversation.assigned_to ? 'opacity-50' : ''}`}
        >
          <div className="flex justify-between items-start mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Avatar or platform dot */}
              <div className="relative flex-shrink-0">
                {conversation.contact_avatar ? (
                  <img
                    src={conversation.contact_avatar}
                    alt=""
                    className="w-8 h-8 rounded-full object-cover"
                  />
                ) : (
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${
                      conversation.platform === 'webchat' && !activeConvIds.has(conversation.id)
                        ? 'bg-gray-300'
                        : getPlatformBadgeColor(conversation.platform)
                    }`}
                  >
                    {(conversation.contact_name || '?').charAt(0).toUpperCase()}
                  </div>
                )}
                {conversation.platform === 'webchat' && activeConvIds.has(conversation.id) && (
                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-400 border-2 border-white" />
                )}
              </div>
              <span className="font-semibold text-gray-800">
                {conversation.contact_name}
              </span>
              {/* Show contact_id only if it's meaningful (not a UUID, not same as name) */}
              {conversation.contact_id && conversation.contact_id !== conversation.contact_name && !UUID_REGEX.test(conversation.contact_id) && (
                <span className="text-[11px] text-gray-400 font-normal truncate max-w-[140px]" title={conversation.contact_id}>
                  {conversation.contact_id}
                </span>
              )}
              {(conversation.ticket_count ?? 0) > 0 && (
                <span
                  className="ml-1 inline-flex items-center gap-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full"
                  title={`${conversation.ticket_count} ticket${conversation.ticket_count === 1 ? '' : 's'}`}
                >
                  🎫 {conversation.ticket_count}
                </span>
              )}
              {conversation.platform_account_id && accountMap[conversation.platform_account_id] && (
                <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded ml-1 font-normal">
                  {accountMap[conversation.platform_account_id]}
                </span>
              )}
              {conversation.widget_domain_id && domainMap[conversation.widget_domain_id] && (
                <span className="ml-1 text-xs text-purple-400 bg-purple-900/30 px-1.5 py-0.5 rounded">
                  {domainMap[conversation.widget_domain_id]}
                </span>
              )}
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
