/**
 * Date formatting utilities with timezone support
 */

/**
 * Format a date string with timezone awareness
 * @param dateString - ISO date string
 * @param timezone - IANA timezone string (e.g., 'America/New_York', 'Europe/London')
 * @param format - Format options
 */
export function formatDateWithTimezone(
  dateString: string,
  timezone: string = 'UTC',
  options?: Intl.DateTimeFormatOptions
): string {
  try {
    const date = new Date(dateString)
    
    const defaultOptions: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: timezone,
      ...options,
    }

    return new Intl.DateTimeFormat('en-US', defaultOptions).format(date)
  } catch (err) {
    console.error('Error formatting date:', err)
    return dateString
  }
}

/**
 * Format a date string as time only with timezone awareness
 * @param dateString - ISO date string
 * @param timezone - IANA timezone string
 */
export function formatTimeWithTimezone(
  dateString: string,
  timezone: string = 'UTC'
): string {
  return formatDateWithTimezone(dateString, timezone, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

/**
 * Format a date string as date only with timezone awareness
 * @param dateString - ISO date string
 * @param timezone - IANA timezone string
 */
export function formatDateOnlyWithTimezone(
  dateString: string,
  timezone: string = 'UTC'
): string {
  return formatDateWithTimezone(dateString, timezone, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Get relative time string (e.g., "5 minutes ago")
 * @param dateString - ISO date string
 */
export function getRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString)
    const now = new Date()
    const secondsAgo = Math.floor((now.getTime() - date.getTime()) / 1000)

    if (secondsAgo < 60) {
      return 'just now'
    }

    const minutesAgo = Math.floor(secondsAgo / 60)
    if (minutesAgo < 60) {
      return `${minutesAgo}m ago`
    }

    const hoursAgo = Math.floor(minutesAgo / 60)
    if (hoursAgo < 24) {
      return `${hoursAgo}h ago`
    }

    const daysAgo = Math.floor(hoursAgo / 24)
    if (daysAgo < 7) {
      return `${daysAgo}d ago`
    }

    const weeksAgo = Math.floor(daysAgo / 7)
    return `${weeksAgo}w ago`
  } catch (err) {
    console.error('Error calculating relative time:', err)
    return dateString
  }
}

/**
 * Check if two timestamps are on the same day
 * @param date1 - First date string
 * @param date2 - Second date string
 * @param timezone - IANA timezone string
 */
export function isSameDay(
  date1: string,
  date2: string,
  timezone: string = 'UTC'
): boolean {
  try {
    const d1 = new Date(date1)
    const d2 = new Date(date2)

    const formatter = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: timezone,
    })

    return formatter.format(d1) === formatter.format(d2)
  } catch (err) {
    console.error('Error comparing dates:', err)
    return false
  }
}

/**
 * Get list of available timezones
 */
export function getAvailableTimezones(): string[] {
  const timezones = [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Toronto',
    'America/Mexico_City',
    'America/Buenos_Aires',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Madrid',
    'Europe/Amsterdam',
    'Europe/Moscow',
    'Asia/Kolkata',
    'Asia/Bangkok',
    'Asia/Hong_Kong',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Asia/Seoul',
    'Australia/Sydney',
    'Australia/Melbourne',
    'Pacific/Auckland',
  ]
  return timezones
}

/**
 * Convert ISO timestamp to user's local timezone
 * @param dateString - ISO date string
 * @param timezone - Target timezone
 */
export function convertToTimezone(
  dateString: string,
  timezone: string = 'UTC'
): string {
  try {
    const date = new Date(dateString)
    
    const formatter = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: timezone,
    })

    return formatter.format(date)
  } catch (err) {
    console.error('Error converting timezone:', err)
    return dateString
  }
}
