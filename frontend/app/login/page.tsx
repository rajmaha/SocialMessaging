'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { authAPI } from '@/lib/auth'
import { useBranding } from '@/lib/branding-context'
import AuthLayout, {
  AuthLabel,
  AuthInput,
  AuthPasswordInput,
  AuthButton,
  AuthNotice,
} from '@/components/AuthLayout'

export default function LoginPage() {
  const router = useRouter()
  const { branding } = useBranding()
  const [isLogin, setIsLogin] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Step: 'form' | 'otp'
  const [step, setStep] = useState<'form' | 'otp'>('form')
  const [otpContext, setOtpContext] = useState<'login' | 'register'>('login')
  const [pendingEmail, setPendingEmail] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)

  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    fullName: '',
    confirmPassword: '',
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const validateLogin = () => {
    if (!formData.email || !formData.password) {
      setError('Email and password are required')
      return false
    }
    return true
  }

  const validateRegister = () => {
    if (!formData.username || !formData.email || !formData.password || !formData.fullName) {
      setError('All fields are required')
      return false
    }
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match')
      return false
    }
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters')
      return false
    }
    return true
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validateLogin()) return
    setLoading(true)
    setError('')
    try {
      const result = await authAPI.login(formData.email, formData.password)
      if (result.status === 'otp_sent') {
        setPendingEmail(formData.email)
        setOtpContext('login')
        setStep('otp')
        setSuccess('A 6-digit code has been sent to your email.')
      } else {
        setError(result.detail || 'Login failed')
      }
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validateRegister()) return
    setLoading(true)
    setError('')
    try {
      const result = await authAPI.register(
        formData.username,
        formData.email,
        formData.password,
        formData.fullName
      )
      if (result.status === 'otp_sent') {
        setPendingEmail(formData.email)
        setOtpContext('register')
        setStep('otp')
        setSuccess('A verification code has been sent to your email.')
      } else {
        setError(result.detail || 'Registration failed')
      }
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!otpCode || otpCode.length !== 6) {
      setError('Please enter the 6-digit code')
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await authAPI.verifyOTP(pendingEmail, otpCode, otpContext)
      if (result.user_id) {
        const role = result.role || 'user'
        router.push(role === 'admin' ? '/admin' : '/dashboard')
      } else {
        setError(result.detail || 'Verification failed')
      }
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleResendOTP = async () => {
    if (resendCooldown > 0) return
    setError('')
    setSuccess('')
    try {
      await authAPI.resendOTP(pendingEmail, otpContext)
      setSuccess('A new code has been sent to your email.')
      setResendCooldown(60)
      const interval = setInterval(() => {
        setResendCooldown((prev) => {
          if (prev <= 1) { clearInterval(interval); return 0 }
          return prev - 1
        })
      }, 1000)
    } catch {
      setError('Failed to resend code. Please try again.')
    }
  }

  // ── Step two: the emailed code ────────────────────────────────────────────

  if (step === 'otp') {
    return (
      <AuthLayout
        title="Enter your code"
        subtitle={
          <>
            We sent a 6-digit code to{' '}
            <span className="font-medium text-gray-700">{pendingEmail}</span>
          </>
        }
      >
        <form onSubmit={handleVerifyOTP}>
          {error && <AuthNotice tone="error">{error}</AuthNotice>}
          {success && <AuthNotice tone="success">{success}</AuthNotice>}

          <div className="mb-6">
            <AuthLabel htmlFor="otp">Verification code</AuthLabel>
            <input
              id="otp"
              type="text"
              inputMode="numeric"
              // Lets iOS and Android offer the code straight from the
              // notification instead of making people switch apps.
              autoComplete="one-time-code"
              maxLength={6}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
              placeholder="······"
              className="w-full h-14 text-center text-2xl font-semibold rounded-xl border border-gray-300 bg-white
                         focus:outline-none focus:ring-2 focus:border-transparent transition
                         placeholder:text-gray-300"
              style={{
                letterSpacing: '0.4em',
                // Centre the text despite the trailing letter-space.
                textIndent: '0.4em',
                ['--tw-ring-color' as any]: branding?.primary_color || '#2563eb',
              }}
              autoFocus
            />
          </div>

          <AuthButton type="submit" disabled={loading}>
            {loading ? 'Verifying…' : 'Verify and continue'}
          </AuthButton>

          <div className="mt-5 flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => { setStep('form'); setOtpCode(''); setError(''); setSuccess('') }}
              className="h-11 px-1 -ml-1 text-gray-500 hover:text-gray-700"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={handleResendOTP}
              disabled={resendCooldown > 0}
              className="h-11 px-1 -mr-1 font-medium hover:opacity-80 disabled:opacity-40"
              style={{ color: branding?.primary_color || '#2563eb' }}
            >
              {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
            </button>
          </div>
        </form>

        <p className="mt-5 text-xs text-gray-400 text-center leading-relaxed">
          The code is good for a few minutes. Check your spam folder if it
          doesn&apos;t arrive.
        </p>
      </AuthLayout>
    )
  }

  // ── Step one: sign in, or create an account ───────────────────────────────

  const switchMode = () => {
    setIsLogin(!isLogin)
    setError('')
    setSuccess('')
    setFormData({ username: '', email: '', password: '', fullName: '', confirmPassword: '' })
  }

  return (
    <AuthLayout
      title={isLogin ? 'Sign in' : 'Create your account'}
      subtitle={
        isLogin
          ? branding?.company_description || 'Welcome back.'
          : 'It takes a minute. We’ll email you a code to confirm it’s you.'
      }
      footer={
        <>
          {isLogin ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button
            type="button"
            onClick={switchMode}
            // py/-my: a 44px hit box around text that stays on its line.
            className="font-semibold text-white hover:underline inline-block py-3 -my-3 px-1"
          >
            {isLogin ? 'Create one' : 'Sign in'}
          </button>
        </>
      }
    >
      <form onSubmit={isLogin ? handleLogin : handleRegister} noValidate>
        {error && <AuthNotice tone="error">{error}</AuthNotice>}
        {success && <AuthNotice tone="success">{success}</AuthNotice>}

        {!isLogin && (
          <>
            <div className="mb-5">
              <AuthLabel htmlFor="fullName">Full name</AuthLabel>
              <AuthInput
                id="fullName"
                type="text"
                name="fullName"
                value={formData.fullName}
                onChange={handleChange}
                placeholder="Jane Doe"
                autoComplete="name"
                disabled={loading}
              />
            </div>
            <div className="mb-5">
              <AuthLabel htmlFor="username">Username</AuthLabel>
              <AuthInput
                id="username"
                type="text"
                name="username"
                value={formData.username}
                onChange={handleChange}
                placeholder="jane"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                disabled={loading}
              />
            </div>
          </>
        )}

        <div className="mb-5">
          <AuthLabel htmlFor="email">Email address</AuthLabel>
          <AuthInput
            id="email"
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            placeholder="you@company.com"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            disabled={loading}
            autoFocus={isLogin}
          />
        </div>

        <div className="mb-5">
          {/* AuthLabel carries its own bottom margin, so the row does not. */}
          <div className="flex items-baseline justify-between">
            <AuthLabel htmlFor="password">Password</AuthLabel>
            {isLogin && (
              <Link
                href="/forgot-password"
                className="text-sm font-medium hover:opacity-80 transition inline-block py-3 -my-3 px-1 -mr-1"
                style={{ color: branding?.primary_color || '#2563eb' }}
              >
                Forgot?
              </Link>
            )}
          </div>
          <AuthPasswordInput
            id="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            placeholder={isLogin ? 'Your password' : 'At least 6 characters'}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            disabled={loading}
          />
        </div>

        {!isLogin && (
          <div className="mb-5">
            <AuthLabel htmlFor="confirmPassword">Confirm password</AuthLabel>
            <AuthPasswordInput
              id="confirmPassword"
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder="Type it again"
              autoComplete="new-password"
              disabled={loading}
            />
          </div>
        )}

        <div className="mt-6">
          <AuthButton type="submit" disabled={loading}>
            {loading ? 'Please wait…' : isLogin ? 'Sign in' : 'Create account'}
          </AuthButton>
        </div>
      </form>
    </AuthLayout>
  )
}
