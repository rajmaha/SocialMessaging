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

interface ConversationListProps {
  conversations: Conversation[]
  selectedConversation: Conversation | null
  onSelectConversation: (conversation: Conversation) => void
  loading: boolean
}

export default function ConversationList({
  conversations,
  selectedConversation,
  onSelectConversation,
  loading,
}: ConversationListProps) {
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

  return (
    <div className="flex-1 overflow-y-auto">
      {conversations.map((conversation) => (
        <div
          key={conversation.id}
          onClick={() => onSelectConversation(conversation)}
          className={`p-4 border-b cursor-pointer transition ${
            selectedConversation?.id === conversation.id
              ? 'bg-blue-50 border-l-4 border-l-blue-500'
              : 'hover:bg-gray-50'
          }`}
        >
          <div className="flex justify-between items-start mb-2">
            <div className="flex items-center gap-2">
              <div
                className={`w-3 h-3 rounded-full ${getPlatformBadgeColor(
                  conversation.platform
                )}`}
              />
              <span className="font-semibold text-gray-800">
                {conversation.contact_name}
              </span>
            </div>
            {conversation.unread_count > 0 && (
              <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-full">
                {conversation.unread_count}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-600 truncate">
            {conversation.last_message || 'No messages yet'}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {conversation.platform.charAt(0).toUpperCase() +
              conversation.platform.slice(1)}{' '}
            •{' '}
            {conversation.last_message_time
              ? new Date(conversation.last_message_time).toLocaleTimeString(
                  [],
                  { hour: '2-digit', minute: '2-digit' }
                )
              : ''}
          </p>
        </div>
      ))}
    </div>
  )
}
