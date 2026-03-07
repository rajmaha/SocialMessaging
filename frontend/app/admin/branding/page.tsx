'use client'

import MainHeader from '@/components/MainHeader';
import { authAPI } from '@/lib/auth';

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import { getAuthToken } from '@/lib/auth'
import AdminNav from '@/components/AdminNav'
import { API_URL } from '@/lib/config'
import { useBranding } from '@/lib/branding-context';

interface BrandingData {
  company_name: string
  company_description: string
  logo_url: string
  favicon_url: string
  primary_color: string
  secondary_color: string
  accent_color: string
  button_primary_color: string
  button_primary_hover_color: string
  sidebar_text_color: string
  header_bg_color: string
  layout_bg_color: string
  support_url: string
  privacy_url: string
  terms_url: string
  timezone: string
  admin_email: string
  allowed_file_types: string[]
  max_file_size_mb: number
}

interface SmtpData {
  smtp_server: string
  smtp_port: number
  smtp_username: string
  smtp_password: string
  smtp_from_email: string
  smtp_from_name: string
  smtp_use_tls: boolean
  smtp_use_ssl: boolean
  email_footer_text: string
}

interface EmailValidatorData {
  email_validator_url: string
  email_validator_secret: string
  email_validator_risk_threshold: number
}

export default function BrandingAdmin() {
  const user = authAPI.getUser();
  const router = useRouter()
  const { refetch: refetchBranding } = useBranding()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [activeTab, setActiveTab] = useState<'company' | 'colors' | 'smtp' | 'links' | 'attachments' | 'email-validator'>('company')

  const [branding, setBranding] = useState<BrandingData>({
    company_name: 'Social Media Messenger',
    company_description: '',
    logo_url: '',
    favicon_url: '',
    primary_color: '#2563eb',
    secondary_color: '#1e40af',
    accent_color: '#3b82f6',
    button_primary_color: '#2563eb',
    button_primary_hover_color: '#1e40af',
    sidebar_text_color: '#ffffff',
    header_bg_color: '#ffffff',
    layout_bg_color: '#f5f5f5',
    support_url: '',
    privacy_url: '',
    terms_url: '',
    timezone: 'UTC',
    admin_email: '',
    allowed_file_types: [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
    ],
    max_file_size_mb: 10,
  })

  const [smtp, setSmtp] = useState<SmtpData>({
    smtp_server: 'smtp.gmail.com',
    smtp_port: 587,
    smtp_username: '',
    smtp_password: '',
    smtp_from_email: '',
    smtp_from_name: 'Social Media Messenger',
    smtp_use_tls: true,
    smtp_use_ssl: false,
    email_footer_text: '© 2026 Social Media Messenger. All rights reserved.',
  })

  const [testingSmtp, setTestingSmtp] = useState(false)

  const [validator, setValidator] = useState<EmailValidatorData>({
    email_validator_url: '',
    email_validator_secret: '',
    email_validator_risk_threshold: 60,
  })
  const [showSmtpPassword, setShowSmtpPassword] = useState(false)
  const [showValidatorSecret, setShowValidatorSecret] = useState(false)

  useEffect(() => {
    loadBrandingData()
  }, [])

  const loadBrandingData = async () => {
    try {
      const token = getAuthToken()
      if (!token) {
        router.push('/login')
        return
      }

      const response = await axios.get(`${API_URL}/branding/admin`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (response.data.data) {
        const data = response.data.data
        setBranding({
          company_name: data.company_name || '',
          company_description: data.company_description || '',
          logo_url: data.logo_url || '',
          favicon_url: data.favicon_url || '',
          primary_color: data.primary_color || '#2563eb',
          secondary_color: data.secondary_color || '#1e40af',
          accent_color: data.accent_color || '#3b82f6',
          support_url: data.support_url || '',
          privacy_url: data.privacy_url || '',
          terms_url: data.terms_url || '',
          timezone: data.timezone || 'UTC',
          admin_email: data.admin_email || '',
          allowed_file_types: data.allowed_file_types || ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'],
          max_file_size_mb: data.max_file_size_mb || 10,
          button_primary_color: data.button_primary_color || '#2563eb',
          button_primary_hover_color: data.button_primary_hover_color || '#1e40af',
          sidebar_text_color: data.sidebar_text_color || '#ffffff',
          header_bg_color: data.header_bg_color || '#ffffff',
          layout_bg_color: data.layout_bg_color || '#f5f5f5',
        })

        setSmtp({
          smtp_server: data.smtp_server || 'smtp.gmail.com',
          smtp_port: data.smtp_port || 587,
          smtp_username: data.smtp_username || '',
          smtp_password: data.smtp_password || '',
          smtp_from_email: data.smtp_from_email || '',
          smtp_from_name: data.smtp_from_name || '',
          smtp_use_tls: data.smtp_use_tls !== false,
          smtp_use_ssl: data.smtp_use_ssl === true,
          email_footer_text: data.email_footer_text || '',
        })

        setValidator({
          email_validator_url: data.email_validator_url || '',
          email_validator_secret: data.email_validator_secret || '',
          email_validator_risk_threshold: data.email_validator_risk_threshold ?? 60,
        })
      }
    } catch (err: any) {
      setError('Failed to load branding settings')
    } finally {
      setLoading(false)
    }
  }

  const handleBrandingChange = (field: keyof BrandingData, value: string) => {
    setBranding((prev) => ({ ...prev, [field]: value }))
  }

  const handleSmtpChange = (field: keyof SmtpData, value: any) => {
    setSmtp((prev) => ({ ...prev, [field]: value }))
  }

  const saveBranding = async () => {
    setSaving(true)
    setError('')
    setSuccess('')

    try {
      const token = getAuthToken()
      if (!token) {
        router.push('/login')
        return
      }

      await axios.post(`${API_URL}/branding/update`, branding, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      setSuccess('Company branding updated successfully!')
      setTimeout(() => setSuccess(''), 3000)
      await refetchBranding()
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to save branding')
    } finally {
      setSaving(false)
    }
  }

  const saveSmtp = async () => {
    setSaving(true)
    setError('')
    setSuccess('')

    try {
      const token = getAuthToken()
      if (!token) {
        router.push('/login')
        return
      }

      const smtpPayload = { ...smtp }

      await axios.post(`${API_URL}/branding/smtp`, smtpPayload, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      setSuccess('SMTP settings updated successfully!')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to save SMTP settings')
    } finally {
      setSaving(false)
    }
  }

  const saveValidator = async () => {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const token = getAuthToken()
      if (!token) { router.push('/login'); return }

      const payload: Record<string, unknown> = {
        email_validator_url: validator.email_validator_url,
        email_validator_risk_threshold: validator.email_validator_risk_threshold,
      }

      // Only include secret if it was explicitly changed by the user:
      // - If it looks masked (all chars before last 4 are '*', or all stars), skip it
      // - If it's empty, include it so the backend can detect the user wants to clear it
      //   (backend skips empty string via `if secret:`, so actually we skip it too —
      //    but we keep this here for explicit intent)
      const secret = validator.email_validator_secret
      if (secret) {
        const isMasked = (secret.length >= 4 && secret.slice(0, -4).split('').every(c => c === '*'))
                      || secret.split('').every(c => c === '*')
        if (!isMasked) {
          payload.email_validator_secret = secret
        }
      }

      await axios.post(
        `${API_URL}/branding/email-validator`,
        payload,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setSuccess('Email validator settings saved')
    } catch {
      setError('Failed to save validator settings')
    } finally {
      setSaving(false)
    }
  }

  const testSmtpConnection = async () => {
    setTestingSmtp(true)
    setError('')
    setSuccess('')

    try {
      const token = getAuthToken()
      if (!token) {
        router.push('/login')
        return
      }

      const response = await axios.post(`${API_URL}/branding/test-smtp`, {}, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (response.data.status === 'success') {
        setSuccess(response.data.message)
      } else {
        setError(response.data.message)
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to test SMTP connection')
    } finally {
      setTestingSmtp(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading branding settings...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />

      <main className="w-full px-6 py-8">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
            ✓ {success}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-4 border-b border-gray-200 mb-8 overflow-x-auto">
          {(['company', 'colors', 'smtp', 'links', 'attachments'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 font-medium border-b-2 ${activeTab === tab
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
          <button
            onClick={() => setActiveTab('email-validator')}
            className={`px-4 py-3 font-medium border-b-2 ${activeTab === 'email-validator'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
          >
            Email Validator
          </button>
        </div>

        {/* Company Information */}
        {activeTab === 'company' && (
          <div className="bg-white rounded-lg shadow p-6 space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Company Name
              </label>
              <input
                type="text"
                value={branding.company_name}
                onChange={(e) => handleBrandingChange('company_name', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Company Description
              </label>
              <textarea
                value={branding.company_description}
                onChange={(e) => handleBrandingChange('company_description', e.target.value)}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Logo URL
              </label>
              <input
                type="url"
                value={branding.logo_url}
                onChange={(e) => handleBrandingChange('logo_url', e.target.value)}
                placeholder="https://example.com/logo.png"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {branding.logo_url && (
                <div className="mt-2">
                  <img src={branding.logo_url} alt="Logo preview" className="max-h-20" />
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Favicon URL
              </label>
              <input
                type="url"
                value={branding.favicon_url}
                onChange={(e) => handleBrandingChange('favicon_url', e.target.value)}
                placeholder="https://example.com/favicon.ico"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Timezone
              </label>
              <select
                value={branding.timezone}
                onChange={(e) => handleBrandingChange('timezone', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="UTC">UTC (Coordinated Universal Time)</option>
                <option value="America/New_York">America/New_York (Eastern)</option>
                <option value="America/Chicago">America/Chicago (Central)</option>
                <option value="America/Denver">America/Denver (Mountain)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (Pacific)</option>
                <option value="America/Toronto">America/Toronto (Eastern Canada)</option>
                <option value="America/Mexico_City">America/Mexico_City</option>
                <option value="America/Buenos_Aires">America/Buenos_Aires</option>
                <option value="Europe/London">Europe/London (GMT/BST)</option>
                <option value="Europe/Paris">Europe/Paris (CET/CEST)</option>
                <option value="Europe/Berlin">Europe/Berlin (CET/CEST)</option>
                <option value="Europe/Madrid">Europe/Madrid (CET/CEST)</option>
                <option value="Europe/Amsterdam">Europe/Amsterdam (CET/CEST)</option>
                <option value="Europe/Moscow">Europe/Moscow (MSK)</option>
                <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                <option value="Asia/Kathmandu">Asia/Kathmandu (NPT)</option>
                <option value="Asia/Bangkok">Asia/Bangkok (ICT)</option>
                <option value="Asia/Hong_Kong">Asia/Hong_Kong (HKT)</option>
                <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
                <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
                <option value="Asia/Seoul">Asia/Seoul (KST)</option>
                <option value="Australia/Sydney">Australia/Sydney (AEDT/AEST)</option>
                <option value="Australia/Melbourne">Australia/Melbourne (AEDT/AEST)</option>
                <option value="Pacific/Auckland">Pacific/Auckland (NZDT/NZST)</option>
              </select>
              <p className="mt-2 text-sm text-gray-500">
                Used for all timestamps in the system and the Real-Time Events display.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Admin Contact Email
              </label>
              <input
                type="email"
                value={branding.admin_email}
                onChange={(e) => handleBrandingChange('admin_email', e.target.value)}
                placeholder="admin@example.com"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-2 text-sm text-gray-500">
                Users without an email account will send their setup requests to this address.
              </p>
            </div>

            <button
              onClick={saveBranding}
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {saving ? 'Saving...' : 'Save Company Info'}
            </button>
          </div>
        )}

        {/* Colors */}
        {activeTab === 'colors' && (
          <div className="bg-white rounded-lg shadow p-6 space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Primary Color
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={branding.primary_color}
                    onChange={(e) => handleBrandingChange('primary_color', e.target.value)}
                    className="w-20 h-10 rounded border border-gray-300 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={branding.primary_color}
                    onChange={(e) => handleBrandingChange('primary_color', e.target.value)}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Secondary Color
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={branding.secondary_color}
                    onChange={(e) => handleBrandingChange('secondary_color', e.target.value)}
                    className="w-20 h-10 rounded border border-gray-300 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={branding.secondary_color}
                    onChange={(e) => handleBrandingChange('secondary_color', e.target.value)}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Accent Color
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={branding.accent_color}
                    onChange={(e) => handleBrandingChange('accent_color', e.target.value)}
                    className="w-20 h-10 rounded border border-gray-300 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={branding.accent_color}
                    onChange={(e) => handleBrandingChange('accent_color', e.target.value)}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Button Primary Color
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={branding.button_primary_color}
                    onChange={(e) => handleBrandingChange('button_primary_color', e.target.value)}
                    className="w-20 h-10 rounded border border-gray-300 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={branding.button_primary_color}
                    onChange={(e) => handleBrandingChange('button_primary_color', e.target.value)}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Button Hover Color
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={branding.button_primary_hover_color}
                    onChange={(e) => handleBrandingChange('button_primary_hover_color', e.target.value)}
                    className="w-20 h-10 rounded border border-gray-300 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={branding.button_primary_hover_color}
                    onChange={(e) => handleBrandingChange('button_primary_hover_color', e.target.value)}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Sidebar Text Color
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={branding.sidebar_text_color}
                    onChange={(e) => handleBrandingChange('sidebar_text_color', e.target.value)}
                    className="w-20 h-10 rounded border border-gray-300 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={branding.sidebar_text_color}
                    onChange={(e) => handleBrandingChange('sidebar_text_color', e.target.value)}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Header Background
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={branding.header_bg_color}
                    onChange={(e) => handleBrandingChange('header_bg_color', e.target.value)}
                    className="w-20 h-10 rounded border border-gray-300 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={branding.header_bg_color}
                    onChange={(e) => handleBrandingChange('header_bg_color', e.target.value)}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Layout Background
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={branding.layout_bg_color}
                    onChange={(e) => handleBrandingChange('layout_bg_color', e.target.value)}
                    className="w-20 h-10 rounded border border-gray-300 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={branding.layout_bg_color}
                    onChange={(e) => handleBrandingChange('layout_bg_color', e.target.value)}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600 mb-4">Color Preview:</p>
              <div className="flex gap-4">
                <div
                  className="w-24 h-24 rounded-lg border border-gray-300"
                  style={{ backgroundColor: branding.primary_color }}
                  title="Primary"
                />
                <div
                  className="w-24 h-24 rounded-lg border border-gray-300"
                  style={{ backgroundColor: branding.secondary_color }}
                  title="Secondary"
                />
                <div
                  className="w-24 h-24 rounded-lg border border-gray-300"
                  style={{ backgroundColor: branding.accent_color }}
                  title="Accent"
                />
                <div
                  className="w-24 h-24 rounded-lg border border-gray-300"
                  style={{ backgroundColor: branding.button_primary_color }}
                  title="Button"
                />
                <div
                  className="w-24 h-24 rounded-lg border border-gray-300"
                  style={{ backgroundColor: branding.header_bg_color }}
                  title="Header"
                />
                <div
                  className="w-24 h-24 rounded-lg border border-gray-300 shadow-inner"
                  style={{ backgroundColor: branding.layout_bg_color }}
                  title="Layout"
                />
              </div>
            </div>

            <button
              onClick={saveBranding}
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {saving ? 'Saving...' : 'Save Colors'}
            </button>
          </div>
        )}

        {/* SMTP Settings */}
        {activeTab === 'smtp' && (
          <div className="bg-white rounded-lg shadow p-6 space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  SMTP Server
                </label>
                <input
                  type="text"
                  value={smtp.smtp_server}
                  onChange={(e) => handleSmtpChange('smtp_server', e.target.value)}
                  placeholder="smtp.gmail.com"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  SMTP Port
                </label>
                <input
                  type="number"
                  value={smtp.smtp_port}
                  onChange={(e) => handleSmtpChange('smtp_port', parseInt(e.target.value))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  SMTP Username
                </label>
                <input
                  type="email"
                  value={smtp.smtp_username}
                  onChange={(e) => handleSmtpChange('smtp_username', e.target.value)}
                  placeholder="your-email@gmail.com"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  SMTP Password
                </label>
                <div className="relative">
                  <input
                    type={showSmtpPassword ? 'text' : 'password'}
                    value={smtp.smtp_password}
                    onChange={(e) => handleSmtpChange('smtp_password', e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 pr-16"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSmtpPassword(!showSmtpPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500 hover:text-gray-700"
                  >
                    {showSmtpPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  From Email
                </label>
                <input
                  type="email"
                  value={smtp.smtp_from_email}
                  onChange={(e) => handleSmtpChange('smtp_from_email', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  From Name
                </label>
                <input
                  type="text"
                  value={smtp.smtp_from_name}
                  onChange={(e) => handleSmtpChange('smtp_from_name', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Security</label>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="smtp_security"
                    checked={!smtp.smtp_use_tls && !smtp.smtp_use_ssl}
                    onChange={() => { handleSmtpChange('smtp_use_tls', false); handleSmtpChange('smtp_use_ssl', false); }}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-gray-700">None (port 25)</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="smtp_security"
                    checked={smtp.smtp_use_tls && !smtp.smtp_use_ssl}
                    onChange={() => { handleSmtpChange('smtp_use_tls', true); handleSmtpChange('smtp_use_ssl', false); }}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-gray-700">STARTTLS (port 587)</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="smtp_security"
                    checked={smtp.smtp_use_ssl}
                    onChange={() => { handleSmtpChange('smtp_use_ssl', true); handleSmtpChange('smtp_use_tls', false); }}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-gray-700">SSL/TLS (port 465)</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email Footer Text
              </label>
              <textarea
                value={smtp.email_footer_text}
                onChange={(e) => handleSmtpChange('email_footer_text', e.target.value)}
                rows={2}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex gap-4">
              <button
                onClick={saveSmtp}
                disabled={saving}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                {saving ? 'Saving...' : 'Save SMTP Settings'}
              </button>

              <button
                onClick={testSmtpConnection}
                disabled={testingSmtp}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
              >
                {testingSmtp ? 'Testing...' : 'Test Connection'}
              </button>
            </div>

            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-900">
                <strong>Note:</strong> For Gmail, use an{' '}
                <a
                  href="https://support.google.com/accounts/answer/185833"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-medium"
                >
                  App Password
                </a>
                {' '}instead of your regular password.
              </p>
            </div>
          </div>
        )}

        {/* Links */}
        {activeTab === 'links' && (
          <div className="bg-white rounded-lg shadow p-6 space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Support URL
              </label>
              <input
                type="url"
                value={branding.support_url}
                onChange={(e) => handleBrandingChange('support_url', e.target.value)}
                placeholder="https://support.example.com"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Privacy Policy URL
              </label>
              <input
                type="url"
                value={branding.privacy_url}
                onChange={(e) => handleBrandingChange('privacy_url', e.target.value)}
                placeholder="https://example.com/privacy"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Terms of Service URL
              </label>
              <input
                type="url"
                value={branding.terms_url}
                onChange={(e) => handleBrandingChange('terms_url', e.target.value)}
                placeholder="https://example.com/terms"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <button
              onClick={saveBranding}
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {saving ? 'Saving...' : 'Save Links'}
            </button>
          </div>
        )}

        {/* Attachments */}
        {activeTab === 'attachments' && (() => {
          const FILE_TYPE_GROUPS = [
            {
              label: 'Images',
              types: [
                { mime: 'image/jpeg', label: 'JPEG (.jpg)' },
                { mime: 'image/png', label: 'PNG (.png)' },
                { mime: 'image/gif', label: 'GIF (.gif)' },
                { mime: 'image/webp', label: 'WebP (.webp)' },
              ],
            },
            {
              label: 'Documents',
              types: [
                { mime: 'application/pdf', label: 'PDF (.pdf)' },
                { mime: 'application/msword', label: 'Word (.doc)' },
                { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word (.docx)' },
                { mime: 'application/vnd.ms-excel', label: 'Excel (.xls)' },
                { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel (.xlsx)' },
              ],
            },
            {
              label: 'Archives',
              types: [
                { mime: 'application/zip', label: 'ZIP (.zip)' },
                { mime: 'application/x-zip-compressed', label: 'ZIP (x-zip-compressed)' },
              ],
            },
          ]

          const toggleType = (mime: string) => {
            setBranding((prev) => ({
              ...prev,
              allowed_file_types: prev.allowed_file_types.includes(mime)
                ? prev.allowed_file_types.filter((t) => t !== mime)
                : [...prev.allowed_file_types, mime],
            }))
          }

          return (
            <div className="bg-white rounded-lg shadow p-6 space-y-6">
              <p className="text-sm text-gray-600">
                Choose which file types agents (and webchat visitors) are allowed to send.
                These settings are enforced on every upload.
              </p>

              {FILE_TYPE_GROUPS.map((group) => (
                <div key={group.label}>
                  <h3 className="text-sm font-semibold text-gray-800 mb-3">{group.label}</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {group.types.map(({ mime, label }) => (
                      <label key={mime} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={branding.allowed_file_types.includes(mime)}
                          onChange={() => toggleType(mime)}
                          className="w-4 h-4 rounded border-gray-300 accent-blue-600"
                        />
                        <span className="text-sm text-gray-700">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Maximum file size (MB)
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={branding.max_file_size_mb}
                  onChange={(e) =>
                    setBranding((prev) => ({ ...prev, max_file_size_mb: parseInt(e.target.value) || 1 }))
                  }
                  className="w-32 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">Per-file cap applied to all uploads (max 100 MB).</p>
              </div>

              <button
                onClick={saveBranding}
                disabled={saving}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                {saving ? 'Saving...' : 'Save Attachment Settings'}
              </button>
            </div>
          )
        })()}
        {/* Email Validator */}
        {activeTab === 'email-validator' && (
          <div className="bg-white rounded-lg shadow p-6 space-y-6">
            <p className="text-sm text-gray-600">
              Configure the external email validation API. When set, emails are validated in real-time
              during compose and in bulk before campaign sends.
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Validator URL</label>
              <input
                type="url"
                value={validator.email_validator_url}
                onChange={(e) => setValidator(prev => ({ ...prev, email_validator_url: e.target.value }))}
                placeholder="https://hooks.yourdomain.com"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Base URL of the validation API (e.g. https://hooks.yourdomain.com)
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Secret Key</label>
              <div className="relative">
                <input
                  type={showValidatorSecret ? 'text' : 'password'}
                  value={validator.email_validator_secret}
                  onChange={(e) => setValidator(prev => ({ ...prev, email_validator_secret: e.target.value }))}
                  placeholder="Bearer token"
                  className="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowValidatorSecret(!showValidatorSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
                >
                  {showValidatorSecret ? 'Hide' : 'Show'}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Sent as <code>Authorization: Bearer &lt;secret&gt;</code>
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Risk Threshold</label>
              <input
                type="number"
                min={1}
                max={100}
                value={validator.email_validator_risk_threshold}
                onChange={(e) =>
                  setValidator(prev => ({ ...prev, email_validator_risk_threshold: parseInt(e.target.value) || 60 }))
                }
                className="w-32 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Emails with risk score ≥ this value will be rejected (default: 60, range: 1–100)
              </p>
            </div>

            <button
              onClick={saveValidator}
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {saving ? 'Saving...' : 'Save Validator Settings'}
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
