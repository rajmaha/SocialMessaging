import { API_URL } from './config'

export interface User {
  user_id: number
  username: string
  email: string
  full_name: string
  role: 'admin' | 'user'
}

export const getAuthToken = (): string | null => {
  if (typeof window === 'undefined') return null
  try {
    const user = localStorage.getItem('user')
    if (!user) return null
    const userData = JSON.parse(user)
    return userData.user_id ? String(userData.user_id) : null
  } catch {
    return null
  }
}

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
    if (response.ok && data.user_id) {
      localStorage.setItem('user', JSON.stringify(data))
      // Set role cookie for middleware route protection
      if (typeof document !== 'undefined') {
        document.cookie = `user_role=${data.role || 'support'}; path=/; SameSite=Lax`
        // Fetch and cache page permissions (await so cookie is set before navigation)
        try {
          const { fetchAndStoreUserPages } = await import('@/lib/permissions')
          const pages = await fetchAndStoreUserPages()
          document.cookie = `user_pages=${encodeURIComponent(JSON.stringify(pages))}; path=/; SameSite=Lax`
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

  getUser: (): User | null => {
    if (typeof window === 'undefined') return null
    try {
      const user = localStorage.getItem('user')
      return user ? JSON.parse(user) : null
    } catch {
      return null
    }
  },

  isAuthenticated: (): boolean => {
    if (typeof window === 'undefined') return false
    try {
      return !!localStorage.getItem('user')
    } catch {
      return false
    }
  },
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
