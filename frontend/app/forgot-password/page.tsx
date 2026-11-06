'use client'

import { useState } from 'react'
import axios from 'axios'
import Link from 'next/link'
import { API_URL } from '@/lib/config'
import AuthLayout, {
  AuthLabel,
  AuthInput,
  AuthButton,
  AuthLinkButton,
  AuthNotice,
} from '@/components/AuthLayout'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const trimmed = email.trim()
    if (!trimmed) {
      setError('Please enter your email address')
      return
    }
    if (!trimmed.includes('@')) {
      setError('Please enter a valid email address')
      return
    }

    setLoading(true)
    try {
      await axios.post(`${API_URL}/auth/forgot-password`, { email: trimmed })
      // Keep the address so the confirmation can name it — people mistype,
      // and seeing it back is how they notice.
      setSentTo(trimmed)
      setSuccess(true)
      setEmail('')
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to send reset email')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle={
          <>
            We sent a reset link to <span className="font-medium text-gray-700">{sentTo}</span>.
            It expires in one hour.
          </>
        }
      >
        <div className="space-y-3">
          <AuthLinkButton href="/login">Back to sign in</AuthLinkButton>
          <AuthButton
            type="button"
            variant="secondary"
            onClick={() => {
              setSuccess(false)
              setSentTo('')
            }}
          >
            Use a different address
          </AuthButton>
        </div>

        <p className="mt-6 text-xs text-gray-400 text-center leading-relaxed">
          Nothing arrived? Check your spam folder before trying again.
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter your email address and we'll send you a link to set a new one."
      footer={
        <>
          Remember your password?{' '}
          <Link href="/login" className="font-semibold text-white hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        {error && <AuthNotice tone="error">{error}</AuthNotice>}

        <div className="mb-5">
          <AuthLabel htmlFor="email">Email address</AuthLabel>
          <AuthInput
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            disabled={loading}
            autoFocus
          />
        </div>

        <AuthButton type="submit" disabled={loading}>
          {loading ? 'Sending…' : 'Send reset link'}
        </AuthButton>
      </form>

      <p className="mt-5 text-xs text-gray-400 text-center">
        You&apos;ll get a link that works once, for one hour.
      </p>
    </AuthLayout>
  )
}
