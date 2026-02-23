const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export interface User {
  user_id: number
  username: string
  email: string
  full_name: string
  role: 'admin' | 'user'
}

export const getAuthToken = (): string | null => {
  if (typeof window === 'undefined') return null
  const user = localStorage.getItem('user')
  if (!user) return null
  try {
    const userData = JSON.parse(user)
    return userData.user_id ? String(userData.user_id) : null
  } catch (e) {
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
    localStorage.removeItem('user')
  },

  getUser: (): User | null => {
    if (typeof window === 'undefined') return null
    const user = localStorage.getItem('user')
    return user ? JSON.parse(user) : null
  },

  isAuthenticated: (): boolean => {
    if (typeof window === 'undefined') return false
    return !!localStorage.getItem('user')
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
