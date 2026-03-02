'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import axios from 'axios'
import Link from 'next/link'
import { useBranding } from '@/lib/branding-context'
import { API_URL } from '@/lib/config';

export default function ResetPasswordWrapper() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen bg-gray-50"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div></div>}>
      <ResetPassword />
    </Suspense>
  )
}

function ResetPassword() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { branding } = useBranding()
  const token = searchParams.get('token')

  const [loading, setLoading] = useState(true)
  const [validating, setValidating] = useState(true)
  const [tokenValid, setTokenValid] = useState(false)
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resetting, setResetting] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    validateToken()
  }, [token])

  const validateToken = async () => {
    if (!token) {
      setError('No reset token provided. Please check the link in your email.')
      setValidating(false)
      return
    }

    try {
      console.log('🔄 Verifying reset token:', token)
      // Use GET instead of POST for token verification
      const response = await axios.get(
        `${API_URL}/auth/verify-reset-token`,
        {
          params: { token },
        }
      )

      console.log('✅ Token verification response:', response.data)
      if (response.data.valid) {
        setTokenValid(true)
        setEmail(response.data.email)
        console.log('✅ Token is valid, email:', response.data.email)
      } else {
        setError(response.data.message || 'Invalid or expired reset token')
        console.log('❌ Token validation failed:', response.data)
      }
    } catch (err: any) {
      console.log('❌ Error verifying token:', err)
      const errorMessage = err.response?.data?.message || err.response?.data?.detail || err.message || 'Failed to verify reset token'
      setError(errorMessage)
      console.log('Error details:', {
        status: err.response?.status,
        data: err.response?.data,
        message: errorMessage
      })
    } finally {
      setValidating(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Validate
    if (!newPassword || !confirmPassword) {
      setError('Please fill in all fields')
      return
    }

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setResetting(true)
    try {
      const response = await axios.post(`${API_URL}/auth/reset-password`, {
        token: token,
        new_password: newPassword,
        confirm_password: confirmPassword,
      })

      setSuccess(true)
      setNewPassword('')
      setConfirmPassword('')

      // Redirect to login after 2 seconds
      setTimeout(() => {
        router.push('/login')
      }, 2000)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to reset password')
    } finally {
      setResetting(false)
    }
  }

  if (validating || !branding) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-4"
        style={{
          background: branding ? `linear-gradient(135deg, ${branding.primary_color} 0%, ${branding.secondary_color} 100%)` : 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)',
        }}
      >
        <div className="bg-white rounded-lg shadow-xl p-8">
          <div className="text-center">
            <div
              className="animate-spin rounded-full h-12 w-12 border-b-2 mx-auto mb-4"
              style={{ borderBottomColor: branding?.primary_color || '#2563eb' }}
            ></div>
            <p className="text-gray-600">Verifying reset link...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!tokenValid) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-4"
        style={{
          background: branding ? `linear-gradient(135deg, ${branding.primary_color} 0%, ${branding.secondary_color} 100%)` : 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)',
        }}
      >
        <div className="w-full max-w-md">
          <div className="bg-white rounded-lg shadow-xl p-8">
            <h1 className="text-2xl font-bold mb-4 text-center" style={{ color: branding?.primary_color || '#2563eb' }}>
              Invalid Reset Link
            </h1>

            <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>

            <p className="text-gray-600 mb-6 text-center">
              This password reset link is invalid or has expired. Please request a new one.
            </p>

            <div className="flex gap-4 justify-center">
              <Link
                href="/forgot-password"
                className="px-6 py-2 text-white rounded-lg hover:opacity-90 font-medium transition-colors"
                style={{ backgroundColor: branding?.primary_color || '#2563eb' }}
              >
                Request New Link
              </Link>
              <Link
                href="/login"
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium transition-colors"
              >
                Back to Login
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{
        background: branding ? `linear-gradient(135deg, ${branding.primary_color} 0%, ${branding.secondary_color} 100%)` : 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)',
      }}
    >
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-xl p-8">
          <h1 className="text-3xl font-bold mb-2 text-center" style={{ color: branding?.primary_color || '#2563eb' }}>
            Create New Password
          </h1>
          <p className="text-gray-600 text-center mb-6">
            Enter your new password below
          </p>

          {error && (
            <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}

          {success ? (
            <div className="text-center">
              <div className="mb-4 p-4 bg-green-100 border border-green-400 text-green-700 rounded">
                ✓ Password reset successfully! Redirecting to login...
              </div>
              <p className="text-gray-600 mb-4">
                You can now log in with your new password.
              </p>
              <Link
                href="/login"
                className="inline-block px-6 py-2 text-white rounded-lg hover:opacity-90 font-medium transition-colors"
                style={{ backgroundColor: branding?.primary_color || '#2563eb' }}
              >
                Go to Login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  disabled
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 transition"
                  style={{ focusRingColor: branding?.primary_color || '#2563eb' }}
                  disabled={resetting}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 transition"
                  style={{ focusRingColor: branding?.primary_color || '#2563eb' }}
                  disabled={resetting}
                />
              </div>

              <button
                type="submit"
                disabled={resetting}
                className="w-full text-white py-2 rounded-lg hover:opacity-90 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                style={{ backgroundColor: branding?.primary_color || '#2563eb' }}
              >
                {resetting ? 'Resetting Password...' : 'Reset Password'}
              </button>

              <div className="text-center pt-4 border-t border-gray-200">
                <p className="text-gray-600 text-sm">
                  <Link
                    href="/login"
                    className="font-medium hover:opacity-80 transition"
                    style={{ color: branding?.primary_color || '#2563eb' }}
                  >
                    Back to Login
                  </Link>
                </p>
              </div>
            </form>
          )}
        </div>

        {!success && (
          <div
            className="mt-6 rounded-lg p-4 text-sm"
            style={{
              backgroundColor: branding ? `${branding.primary_color}15` : '#2563eb15',
              borderLeft: branding ? `4px solid ${branding.primary_color}` : '4px solid #2563eb',
              color: branding?.primary_color || '#2563eb',
            }}
          >
            <p className="font-medium mb-2">Password Requirements:</p>
            <ul className="space-y-1" style={{ color: branding?.primary_color || '#2563eb' }}>
              <li>✓ Minimum 6 characters</li>
              <li>✓ Both passwords must match</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
