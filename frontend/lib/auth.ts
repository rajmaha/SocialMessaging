import { API_URL } from './config'

export interface User {
  token: string
  user_id: number
  username: string
  email: string
  full_name: string
  role: 'admin' | 'user'
}

// The signed token the backend issued at sign-in (verify-otp). The backend
// accepts nothing else: a user id or the stored user JSON is refused.
export const getAuthToken = (): string | null => {
  if (typeof window === 'undefined') return null
  try {
    const user = localStorage.getItem('user')
    if (!user) return null
    const userData = JSON.parse(user)
    if (typeof userData?.token === 'string' && userData.token) return userData.token
    // Signed in before tokens existed: that session cannot be used any more.
    endSession()
    return null
  } catch {
    return null
  }
}

// Areas that need a signed-in agent; ending a session there goes to /login.
const STAFF_AREAS = ['/dashboard', '/admin', '/email', '/workspace', '/settings', '/reminders', '/daily-ops', '/sse']
let ending = false

// Forget the stored session and, on a staff page, go to the login page once.
export const endSession = (): void => {
  if (typeof window === 'undefined' || ending) return
  ending = true
  authAPI.logout()
  const path = window.location.pathname
  if (path === '/' || STAFF_AREAS.some(a => path === a || path.startsWith(a + '/'))) {
    window.location.replace('/login?session=ended')
  }
}

// The backend's words when a token is missing, expired, forged or ended.
export const SESSION_ENDED_DETAIL = 'Your session has ended'

export const authAPI = {
  register: async (
    username: string,
    email: string,
    password: string,
    fullName: string
  ) => {
    const response = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        email,
        password,
        full_name: fullName,
      }),
    })
    return response.json()
  },

  login: async (email: string, password: string) => {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = await response.json()
    // Note: on success, status is 'otp_sent' — don't store user yet
    return data
  },

  verifyOTP: async (email: string, otpCode: string, context: string) => {
    const response = await fetch(`${API_URL}/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp_code: otpCode, context }),
    })
    const data = await response.json()
    if (response.ok && data.user_id && data.token) {
      ending = false
      localStorage.setItem('user', JSON.stringify(data))
      // Set role cookie for middleware route protection
      if (typeof document !== 'undefined') {
        const maxAge = 'Max-Age=2592000'  // 30 days, matches localStorage persistence
        document.cookie = `user_role=${data.role || 'support'}; path=/; SameSite=Lax; ${maxAge}`
        // Fetch and cache page permissions (await so cookie is set before navigation)
        try {
          const { fetchAndStoreUserPages } = await import('@/lib/permissions')
          const pages = await fetchAndStoreUserPages()
          document.cookie = `user_pages=${encodeURIComponent(JSON.stringify(pages))}; path=/; SameSite=Lax; ${maxAge}`
        } catch (e) {
          console.error('Failed to fetch user pages:', e)
        }
      }
    }
    return data
  },

  resendOTP: async (email: string, context: string) => {
    const response = await fetch(`${API_URL}/auth/resend-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, context }),
    })
    return response.json()
  },

  logout: () => {
    try { localStorage.removeItem('user') } catch {}
    try { localStorage.removeItem('user_pages') } catch {}
    if (typeof document !== 'undefined') {
      document.cookie = 'user_role=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
      document.cookie = 'user_pages=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
    }
  },

  // Keep a token the backend handed back (change-password ends the old one).
  replaceToken: (token: string) => {
    if (typeof window === 'undefined' || !token) return
    try {
      const user = localStorage.getItem('user')
      if (!user) return
      localStorage.setItem('user', JSON.stringify({ ...JSON.parse(user), token }))
    } catch {}
  },

  getUser: (): User | null => {
    if (typeof window === 'undefined') return null
    try {
      const user = localStorage.getItem('user')
      return user ? JSON.parse(user) : null
    } catch {
      return null
    }
  },

  isAuthenticated: (): boolean => !!getAuthToken(),
}

// React hook for authentication
export function useAuth() {
  const token = getAuthToken()
  const user = authAPI.getUser()
  const isAuthenticated = authAPI.isAuthenticated()

  return {
    token,
    user,
    isAuthenticated,
  }
}
