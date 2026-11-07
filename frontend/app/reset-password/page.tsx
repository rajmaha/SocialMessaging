'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import axios from 'axios'
import Link from 'next/link'
import { API_URL } from '@/lib/config'
import AuthLayout, {
  AuthLabel,
  AuthInput,
  AuthPasswordInput,
  AuthButton,
  AuthLinkButton,
  AuthNotice,
} from '@/components/AuthLayout'

const MIN_PASSWORD = 6

export default function ResetPasswordWrapper() {
  return (
    <Suspense fallback={<AuthLayout title="Loading…"><Spinner /></AuthLayout>}>
      <ResetPassword />
    </Suspense>
  )
}

function Spinner() {
  return (
    <div
      className="animate-spin rounded-full h-10 w-10 border-2 border-gray-200 mx-auto my-2"
      style={{ borderBottomColor: 'var(--primary-color, #2563eb)' }}
      role="status"
      aria-label="Loading"
    />
  )
}

function ResetPassword() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const validateToken = async () => {
    if (!token) {
      setError('This page needs the link from your reset email.')
      setValidating(false)
      return
    }

    try {
      // GET, not POST: verifying is a read.
      const response = await axios.get(`${API_URL}/auth/verify-reset-token`, {
        params: { token },
      })

      if (response.data.valid) {
        setTokenValid(true)
        setEmail(response.data.email)
      } else {
        setError(response.data.message || 'This reset link is no longer valid.')
      }
    } catch (err: any) {
      setError(
        err.response?.data?.message ||
          err.response?.data?.detail ||
          'We could not check this reset link.'
      )
    } finally {
      setValidating(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!newPassword || !confirmPassword) {
      setError('Please fill in both password fields')
      return
    }
    if (newPassword.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters`)
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setResetting(true)
    try {
      await axios.post(`${API_URL}/auth/reset-password`, {
        token: token,
        new_password: newPassword,
        confirm_password: confirmPassword,
      })

      setSuccess(true)
      setNewPassword('')
      setConfirmPassword('')

      setTimeout(() => router.push('/login'), 2000)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to reset password')
    } finally {
      setResetting(false)
    }
  }

  // ── Checking the link ─────────────────────────────────────────────────────

  if (validating) {
    return (
      <AuthLayout title="Checking your link" subtitle="One moment.">
        <Spinner />
      </AuthLayout>
    )
  }

  // ── The link is no good ───────────────────────────────────────────────────

  if (!tokenValid) {
    // Arriving with no token at all is a different situation from a token the
    // server rejected: nothing expired, the person simply opened the page
    // directly. Saying "expired" there sends them hunting for a second email.
    const noToken = !token

    return (
      <AuthLayout
        title={noToken ? 'Open this from your email' : 'This link has expired'}
        subtitle={
          noToken
            ? 'This page is the last step of a password reset, so it needs the one-time link we email you.'
            : 'Reset links work once, and only for an hour. Ask for a fresh one and it will arrive in a moment.'
        }
      >
        {/* With no token the subtitle already says it; a server message, on
            the other hand, tells us something the subtitle cannot. */}
        {error && !noToken && <AuthNotice tone="error">{error}</AuthNotice>}

        <div className="space-y-3">
          <AuthLinkButton href="/forgot-password">
            {noToken ? 'Email me a reset link' : 'Send me a new link'}
          </AuthLinkButton>
          <AuthLinkButton href="/login" variant="secondary">
            Back to sign in
          </AuthLinkButton>
        </div>
      </AuthLayout>
    )
  }

  // ── Done ──────────────────────────────────────────────────────────────────

  if (success) {
    return (
      <AuthLayout
        title="Password updated"
        subtitle="You can sign in with your new password now. Taking you there…"
      >
        <AuthLinkButton href="/login">Go to sign in</AuthLinkButton>
      </AuthLayout>
    )
  }

  // ── Set a new password ────────────────────────────────────────────────────

  return (
    <AuthLayout
      title="Choose a new password"
      // The account is named by the first field, so the subtitle doesn't
      // repeat it.
      subtitle="Pick something you haven't used on this account before."
      footer={
        <>
          Changed your mind?{' '}
          <Link href="/login" className="font-semibold text-white hover:underline">
            Back to sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        {error && <AuthNotice tone="error">{error}</AuthNotice>}

        {/* Shown, and disabled, so it is clear which account this changes —
            and so password managers attach the new password to it. */}
        <div className="mb-5">
          <AuthLabel htmlFor="email">Account</AuthLabel>
          <AuthInput
            id="email"
            name="email"
            type="email"
            value={email}
            autoComplete="username"
            disabled
            readOnly
          />
        </div>

        <div className="mb-5">
          <AuthLabel htmlFor="new-password">New password</AuthLabel>
          <AuthPasswordInput
            id="new-password"
            name="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={`At least ${MIN_PASSWORD} characters`}
            autoComplete="new-password"
            disabled={resetting}
            autoFocus
          />
        </div>

        <div className="mb-6">
          <AuthLabel htmlFor="confirm-password">Confirm new password</AuthLabel>
          <AuthPasswordInput
            id="confirm-password"
            name="confirm-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Type it again"
            autoComplete="new-password"
            disabled={resetting}
          />
          {/* Told here, next to the fields, instead of in a separate
              requirements panel below the card. */}
          {confirmPassword.length > 0 && confirmPassword !== newPassword && (
            <p className="mt-1.5 text-xs text-red-600">
              These two do not match yet.
            </p>
          )}
        </div>

        <AuthButton type="submit" disabled={resetting}>
          {resetting ? 'Saving…' : 'Save new password'}
        </AuthButton>
      </form>
    </AuthLayout>
  )
}
