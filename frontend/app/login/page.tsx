'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { authAPI } from '@/lib/auth'
import { useBranding } from '@/lib/branding-context'

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

  if (!branding) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        background: `linear-gradient(135deg, ${branding.primary_color} 0%, ${branding.secondary_color} 100%)`,
      }}
    >
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-2xl p-8">
          {/* Header */}
          <div className="text-center mb-8">
            {branding.logo_url && (
              <img src={branding.logo_url} alt="Logo" className="h-16 mx-auto mb-4 object-contain" />
            )}
            <h1 className="text-3xl font-bold mb-2" style={{ color: branding.primary_color }}>
              {branding.company_name}
            </h1>
            <p className="text-gray-600">
              {step === 'otp'
                ? 'Enter the verification code sent to your email'
                : branding.company_description || 'Sign in to your account'}
            </p>
          </div>

          {/* Alert Messages */}
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          )}
          {success && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-green-800 text-sm">{success}</p>
            </div>
          )}

          {/* OTP Step */}
          {step === 'otp' ? (
            <form onSubmit={handleVerifyOTP} className="space-y-5">
              <div className="text-center text-sm text-gray-600 mb-2">
                Code sent to <strong>{pendingEmail}</strong>
              </div>
              <div>
                <label className="block text-gray-700 text-sm font-semibold mb-2">
                  Verification Code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="w-full px-4 py-3 text-center text-2xl font-bold tracking-widest border border-gray-300 rounded-lg focus:outline-none focus:ring-2"
                  style={{ letterSpacing: '0.5em' }}
                  autoFocus
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full text-white font-semibold py-2 px-4 rounded-lg transition duration-200 disabled:opacity-50 hover:opacity-90"
                style={{ backgroundColor: branding.primary_color }}
              >
                {loading ? 'Verifying...' : 'Verify Code'}
              </button>
              <div className="flex justify-between items-center text-sm">
                <button
                  type="button"
                  onClick={() => { setStep('form'); setOtpCode(''); setError(''); setSuccess('') }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={handleResendOTP}
                  disabled={resendCooldown > 0}
                  className="font-medium hover:opacity-80 disabled:opacity-40"
                  style={{ color: branding.primary_color }}
                >
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                </button>
              </div>
            </form>
          ) : (
            <>
              {/* Login / Register Form */}
              <form onSubmit={isLogin ? handleLogin : handleRegister} className="space-y-4">
                {!isLogin && (
                  <>
                    <div>
                      <label className="block text-gray-700 text-sm font-semibold mb-2">Full Name</label>
                      <input
                        type="text"
                        name="fullName"
                        value={formData.fullName}
                        onChange={handleChange}
                        placeholder="John Doe"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 transition"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-700 text-sm font-semibold mb-2">Username</label>
                      <input
                        type="text"
                        name="username"
                        value={formData.username}
                        onChange={handleChange}
                        placeholder="john_doe"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 transition"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-gray-700 text-sm font-semibold mb-2">Email Address</label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="your@email.com"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 transition"
                  />
                </div>

                <div>
                  <label className="block text-gray-700 text-sm font-semibold mb-2">Password</label>
                  <input
                    type="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    placeholder="••••••••"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 transition"
                  />
                  {isLogin && (
                    <div className="mt-2 text-right">
                      <Link
                        href="/forgot-password"
                        className="text-sm font-medium hover:opacity-80 transition"
                        style={{ color: branding.primary_color }}
                      >
                        Forgot password?
                      </Link>
                    </div>
                  )}
                </div>

                {!isLogin && (
                  <div>
                    <label className="block text-gray-700 text-sm font-semibold mb-2">Confirm Password</label>
                    <input
                      type="password"
                      name="confirmPassword"
                      value={formData.confirmPassword}
                      onChange={handleChange}
                      placeholder="••••••••"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 transition"
                    />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full text-white font-semibold py-2 px-4 rounded-lg transition duration-200 mt-6 disabled:opacity-50 hover:opacity-90"
                  style={{ backgroundColor: branding.primary_color }}
                >
                  {loading ? 'Please wait...' : isLogin ? 'Sign In' : 'Create Account'}
                </button>
              </form>

              <div className="mt-6 text-center">
                <p className="text-gray-600 text-sm">
                  {isLogin ? "Don't have an account?" : 'Already have an account?'}{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setIsLogin(!isLogin)
                      setError('')
                      setSuccess('')
                      setFormData({ username: '', email: '', password: '', fullName: '', confirmPassword: '' })
                    }}
                    className="font-semibold hover:opacity-80 transition"
                    style={{ color: branding.primary_color }}
                  >
                    {isLogin ? 'Sign Up' : 'Sign In'}
                  </button>
                </p>
              </div>

            </>
          )}
        </div>
      </div>
    </div>
  )
}
