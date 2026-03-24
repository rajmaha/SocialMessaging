/** Shared platform color constants used across ConversationList, ChatWindow, and PlatformFilter */

// Solid background colors (for badges, filter buttons, dot indicators)
export const PLATFORM_BADGE_COLORS: Record<string, string> = {
  whatsapp: 'bg-green-500',
  facebook: 'bg-blue-600',
  viber: 'bg-purple-600',
  linkedin: 'bg-blue-700',
  webchat: 'bg-teal-500',
  email: 'bg-orange-500',
}

// Light background + text colors (for chat header tags, status pills)
export const PLATFORM_TAG_COLORS: Record<string, string> = {
  whatsapp: 'bg-green-100 text-green-800',
  facebook: 'bg-blue-100 text-blue-800',
  viber: 'bg-purple-100 text-purple-800',
  linkedin: 'bg-blue-100 text-blue-800',
  webchat: 'bg-teal-100 text-teal-800',
  email: 'bg-orange-100 text-orange-800',
}

// Display names
export const PLATFORM_NAMES: Record<string, string> = {
  whatsapp: 'WhatsApp',
  facebook: 'Facebook',
  viber: 'Viber',
  linkedin: 'LinkedIn',
  webchat: 'Web Chat',
  email: 'Email',
}

export function getPlatformBadgeColor(platform: string): string {
  return PLATFORM_BADGE_COLORS[platform.toLowerCase()] || 'bg-gray-500'
}

export function getPlatformTagColor(platform: string): string {
  return PLATFORM_TAG_COLORS[platform.toLowerCase()] || 'bg-gray-100 text-gray-800'
}

export function getPlatformName(platform: string): string {
  return PLATFORM_NAMES[platform.toLowerCase()] || platform.charAt(0).toUpperCase() + platform.slice(1)
}
