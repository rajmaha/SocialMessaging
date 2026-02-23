'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import Link from 'next/link'
import { useBranding } from '@/lib/branding-context'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function ForgotPassword() {
  const router = useRouter()
  const { branding } = useBranding()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!email) {
      setError('Please enter your email address')
      return
    }

    if (!email.includes('@')) {
      setError('Please enter a valid email address')
      return
    }

    setLoading(true)
    try {
      await axios.post(`${API_URL}/auth/forgot-password`, {
        email: email,
      })

      setSuccess(true)
      setEmail('')
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to send reset email')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{
        background: `linear-gradient(135deg, ${branding.primary_color} 0%, ${branding.secondary_color} 100%)`,
      }}
    >
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-xl p-8">
          <h1 className="text-3xl font-bold mb-2 text-center" style={{ color: branding.primary_color }}>
            Reset Password
          </h1>
          <p className="text-gray-600 text-center mb-6">
            Enter your email address and we'll send you a link to reset your password
          </p>

          {error && (
            <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}

          {success ? (
            <div className="text-center">
              <div className="mb-4 p-4 bg-green-100 border border-green-400 text-green-700 rounded">
                ✓ Check your email for a password reset link. The link will expire in 1 hour.
              </div>
              <p className="text-gray-600 mb-4">
                Didn't receive the email? Check your spam folder or try again with a different email.
              </p>
              <div className="flex gap-4 justify-center">
                <Link
                  href="/login"
                  className="px-6 py-2 text-white rounded-lg hover:opacity-90 font-medium transition-colors"
                  style={{ backgroundColor: branding.primary_color }}
                >
                  Back to Login
                </Link>
                <button
                  onClick={() => setSuccess(false)}
                  className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium transition-colors"
                >
                  Try Another Email
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your.email@example.com"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 transition"
                  style={{ focusRingColor: branding.primary_color }}
                  disabled={loading}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full text-white py-2 rounded-lg hover:opacity-90 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                style={{ backgroundColor: branding.primary_color }}
              >
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>

              <div className="text-center pt-4 border-t border-gray-200">
                <p className="text-gray-600">
                  Remember your password?{' '}
                  <Link
                    href="/login"
                    className="font-medium hover:opacity-80 transition"
                    style={{ color: branding.primary_color }}
                  >
                    Back to Login
                  </Link>
                </p>
              </div>
            </form>
          )}
        </div>

        <div className="mt-6 text-center">
          <p className="text-white text-sm">
            Don't have an account?{' '}
            <Link href="/login" className="font-medium hover:underline">
              Sign up instead
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
