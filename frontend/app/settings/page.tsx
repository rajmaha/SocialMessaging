'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import axios from 'axios'
import { authAPI, getAuthToken } from '@/lib/auth'
import MainHeader from '@/components/MainHeader'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface PlatformAccount {
  id: number
  user_id: number
  platform: string
  account_id: string
  account_username: string
  access_token?: string
  created_at: string
}

interface PlatformConfig {
  name: string
  color: string
  icon: string
  apiKey: string
  apiSecret: string
}

export default function SettingsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [user, setUser] = useState<any>(null)
  const [accounts, setAccounts] = useState<PlatformAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [addingPlatform, setAddingPlatform] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    account_id: '',
    account_username: '',
    access_token: '',
  })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [activeTab, setActiveTab] = useState<'profile' | 'accounts' | 'account-settings' | 'platform-settings' | 'branding' | 'users' | 'email-accounts' | 'email-messaging' | 'calendar'>('email-messaging')
  const [changePasswordForm, setChangePasswordForm] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [changePasswordError, setChangePasswordError] = useState('')
  const [changePasswordSuccess, setChangePasswordSuccess] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  const [profileData, setProfileData] = useState({
    full_name: '',
    display_name: '',
    phone: '',
    bio: '',
    social_twitter: '',
    social_facebook: '',
    social_linkedin: '',
    social_instagram: '',
    social_youtube: '',
    avatar_url: '',
  })
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileSuccess, setProfileSuccess] = useState('')
  const [avatarPreview, setAvatarPreview] = useState<string>('')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)

  const [calendarStatus, setCalendarStatus] = useState<{ google: any; microsoft: any }>({ google: null, microsoft: null })
  const [calendarLoading, setCalendarLoading] = useState(false)

  const fetchCalendarStatus = async () => {
    try {
      const token = getAuthToken()
      if (!token) return
      const resp = await axios.get(`${API_URL}/api/calendar/status`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setCalendarStatus(resp.data)
    } catch (e) {
      console.error('Failed to load calendar status', e)
    }
  }

  const connectCalendar = async (provider: 'google' | 'microsoft') => {
    try {
      setCalendarLoading(true)
      const token = getAuthToken()
      const resp = await axios.get(`${API_URL}/api/calendar/connect/${provider}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      window.location.href = resp.data.auth_url
    } catch (e: any) {
      setError(e.response?.data?.detail || `Failed to connect ${provider} calendar`)
    } finally {
      setCalendarLoading(false)
    }
  }

  const disconnectCalendar = async (provider: 'google' | 'microsoft') => {
    if (!confirm(`Disconnect ${provider === 'google' ? 'Google' : 'Microsoft'} Calendar?`)) return
    try {
      const token = getAuthToken()
      await axios.delete(`${API_URL}/api/calendar/disconnect/${provider}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      setCalendarStatus(prev => ({ ...prev, [provider]: null }))
      setSuccess(`${provider === 'google' ? 'Google' : 'Microsoft'} Calendar disconnected`)
      setTimeout(() => setSuccess(''), 3000)
    } catch (e: any) {
      setError(e.response?.data?.detail || `Failed to disconnect ${provider} calendar`)
    }
  }

  const platforms: { [key: string]: PlatformConfig } = {
    whatsapp: {
      name: 'WhatsApp',
      color: 'bg-green-100 text-green-800',
      icon: '💬',
      apiKey: 'WHATSAPP_API_KEY',
      apiSecret: 'WHATSAPP_API_SECRET',
    },
    facebook: {
      name: 'Facebook Messenger',
      color: 'bg-blue-100 text-blue-800',
      icon: '👤',
      apiKey: 'FACEBOOK_API_KEY',
      apiSecret: 'FACEBOOK_API_SECRET',
    },
    viber: {
      name: 'Viber',
      color: 'bg-purple-100 text-purple-800',
      icon: '📞',
      apiKey: 'VIBER_API_KEY',
      apiSecret: 'VIBER_API_SECRET',
    },
    linkedin: {
      name: 'LinkedIn',
      color: 'bg-blue-200 text-blue-900',
      icon: '💼',
      apiKey: 'LINKEDIN_API_KEY',
      apiSecret: 'LINKEDIN_API_SECRET',
    },
  }

  useEffect(() => {
    checkAuth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const checkAuth = async () => {
    try {
      const userData = authAPI.getUser()
      if (!userData) {
        router.push('/login')
        return
      }
      setUser(userData)
      const tab = searchParams.get('tab')
      setActiveTab((tab as any) || 'email-messaging')
      await fetchAccounts(userData.user_id)
    } catch (error) {
      console.error('Auth error:', error)
      router.push('/login')
    }
  }

  useEffect(() => {
    if (activeTab === 'profile' && user) fetchProfile()
    if (activeTab === 'calendar') fetchCalendarStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  // Handle calendar OAuth callback redirect
  useEffect(() => {
    const connected = searchParams.get('connected')
    if (connected === 'google' || connected === 'microsoft') {
      setActiveTab('calendar')
      setSuccess(`${connected === 'google' ? 'Google' : 'Microsoft'} Calendar connected successfully!`)
      fetchCalendarStatus()
      setTimeout(() => setSuccess(''), 3000)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchProfile = async () => {
    if (!user) return
    try {
      const token = getAuthToken()
      const resp = await axios.get(`${API_URL}/auth/user/${user.user_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const d = resp.data
      setProfileData({
        full_name: d.full_name || '',
        display_name: d.display_name || '',
        phone: d.phone || '',
        bio: d.bio || '',
        social_twitter: d.social_twitter || '',
        social_facebook: d.social_facebook || '',
        social_linkedin: d.social_linkedin || '',
        social_instagram: d.social_instagram || '',
        social_youtube: d.social_youtube || '',
        avatar_url: d.avatar_url || '',
      })
    } catch (e) {
      console.error('Failed to load profile', e)
    }
  }

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setProfileError('Please select an image file')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setProfileError('Image must be smaller than 5MB')
      return
    }
    setAvatarFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setAvatarPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setProfileSaving(true)
    setProfileError('')
    setProfileSuccess('')
    const token = getAuthToken()
    try {
      if (avatarFile) {
        const fd = new FormData()
        fd.append('file', avatarFile)
        const resp = await axios.post(`${API_URL}/auth/profile/avatar`, fd, {
          headers: { Authorization: `Bearer ${token}` },
        })
        setProfileData((prev) => ({ ...prev, avatar_url: resp.data.avatar_url }))
      }
      await axios.put(
        `${API_URL}/auth/profile`,
        {
          full_name: profileData.full_name || undefined,
          display_name: profileData.display_name || undefined,
          phone: profileData.phone || undefined,
          bio: profileData.bio || undefined,
          social_twitter: profileData.social_twitter || undefined,
          social_facebook: profileData.social_facebook || undefined,
          social_linkedin: profileData.social_linkedin || undefined,
          social_instagram: profileData.social_instagram || undefined,
          social_youtube: profileData.social_youtube || undefined,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setProfileSuccess('Profile saved successfully!')
      setAvatarFile(null)
      setTimeout(() => setProfileSuccess(''), 3000)
    } catch (e: any) {
      setProfileError(e.response?.data?.detail || 'Failed to save profile')
    } finally {
      setProfileSaving(false)
    }
  }

  const fetchAccounts = async (userId: number) => {
    try {
      const response = await axios.get(`${API_URL}/accounts/user/${userId}`)
      setAccounts(response.data)
      setLoading(false)
    } catch (error) {
      console.error('Error fetching accounts:', error)
      setError('Failed to load accounts')
      setLoading(false)
    }
  }

  const handleAddPlatform = (platform: string) => {
    setAddingPlatform(platform)
    setFormData({
      account_id: '',
      account_username: '',
      access_token: '',
    })
    setError('')
    setSuccess('')
  }

  const handleCancelAdd = () => {
    setAddingPlatform(null)
    setFormData({
      account_id: '',
      account_username: '',
      access_token: '',
    })
  }

  const handleSaveAccount = async () => {
    if (!addingPlatform || !formData.account_id || !formData.account_username) {
      setError('Please fill in all fields')
      return
    }

    try {
      setLoading(true)
      const response = await axios.post(`${API_URL}/accounts/`, {
        user_id: user.user_id,
        platform: addingPlatform,
        account_id: formData.account_id,
        account_username: formData.account_username,
        access_token: formData.access_token || null,
      })

      setAccounts([...accounts, response.data])
      setSuccess(`${platforms[addingPlatform].name} account added successfully!`)
      setAddingPlatform(null)

      setTimeout(() => setSuccess(''), 3000)
    } catch (error: any) {
      setError(
        error.response?.data?.detail ||
        'Failed to add account'
      )
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteAccount = async (accountId: number) => {
    if (!confirm('Are you sure you want to remove this account?')) {
      return
    }

    try {
      await axios.delete(`${API_URL}/accounts/${accountId}`)
      setAccounts(accounts.filter((acc) => acc.id !== accountId))
      setSuccess('Account removed successfully!')
      setTimeout(() => setSuccess(''), 3000)
    } catch (error) {
      setError('Failed to remove account')
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setChangePasswordError('')
    setChangePasswordSuccess('')

    // Validate form
    if (!changePasswordForm.oldPassword || !changePasswordForm.newPassword || !changePasswordForm.confirmPassword) {
      setChangePasswordError('All fields are required')
      return
    }

    if (changePasswordForm.newPassword !== changePasswordForm.confirmPassword) {
      setChangePasswordError('New passwords do not match')
      return
    }

    if (changePasswordForm.newPassword.length < 6) {
      setChangePasswordError('Password must be at least 6 characters')
      return
    }

    if (changePasswordForm.oldPassword === changePasswordForm.newPassword) {
      setChangePasswordError('New password must be different from old password')
      return
    }

    setChangingPassword(true)
    try {
      const token = getAuthToken()
      if (!token) {
        router.push('/login')
        return
      }

      await axios.post(
        `${API_URL}/auth/change-password`,
        {
          old_password: changePasswordForm.oldPassword,
          new_password: changePasswordForm.newPassword,
          confirm_password: changePasswordForm.confirmPassword,
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      )

      setChangePasswordSuccess('✓ Password changed successfully!')
      setChangePasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' })

      // Auto redirect after 2 seconds
      setTimeout(() => {
        router.push('/dashboard')
      }, 2000)
    } catch (error: any) {
      setChangePasswordError(
        error.response?.data?.detail || 'Failed to change password'
      )
    } finally {
      setChangingPassword(false)
    }
  }


  if (loading && !user) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading settings...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <MainHeader user={user} />

      <main className="max-w-6xl mx-auto px-6 pt-20 pb-8">

        {/* Alerts */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 flex justify-between items-center">
            <span>{error}</span>
            <button
              onClick={() => setError('')}
              className="text-red-500 hover:text-red-700"
            >
              ✕
            </button>
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 flex justify-between items-center">
            <span>{success}</span>
            <button
              onClick={() => setSuccess('')}
              className="text-green-500 hover:text-green-700"
            >
              ✕
            </button>
          </div>
        )}

        {/* Platform Accounts */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            {/* Tabs */}
            <div className="flex flex-wrap gap-1 -mb-4 border-b border-gray-200">
              <button
                onClick={() => setActiveTab('profile')}
                className={`px-4 py-3 font-medium transition-colors border-b-2 text-sm ${activeTab === 'profile'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
              >
                Profile
              </button>
              <button
                onClick={() => setActiveTab('email-messaging')}
                className={`px-4 py-3 font-medium transition-colors border-b-2 text-sm ${activeTab === 'email-messaging'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
              >
                Email & Messaging
              </button>
              <button
                onClick={() => setActiveTab('accounts')}
                className={`px-4 py-3 font-medium transition-colors border-b-2 text-sm ${activeTab === 'accounts'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
              >
                Connected Accounts
              </button>
              {user?.role === 'admin' && (
                <>
                  <button
                    onClick={() => setActiveTab('branding')}
                    className={`px-4 py-3 font-medium transition-colors border-b-2 text-sm ${activeTab === 'branding'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                      }`}
                  >
                    Branding
                  </button>
                  <button
                    onClick={() => setActiveTab('users')}
                    className={`px-4 py-3 font-medium transition-colors border-b-2 text-sm ${activeTab === 'users'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                      }`}
                  >
                    Users
                  </button>
                  <button
                    onClick={() => setActiveTab('email-accounts')}
                    className={`px-4 py-3 font-medium transition-colors border-b-2 text-sm ${activeTab === 'email-accounts'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                      }`}
                  >
                    Email Accounts
                  </button>
                </>
              )}
              <button
                onClick={() => setActiveTab('calendar')}
                className={`px-4 py-3 font-medium transition-colors border-b-2 text-sm ${activeTab === 'calendar'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
              >
                Calendar
              </button>
              <button
                onClick={() => setActiveTab('account-settings')}
                className={`px-4 py-3 font-medium transition-colors border-b-2 text-sm ${activeTab === 'account-settings'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
              >
                Account Settings
              </button>
            </div>
          </div>

          <div className="p-6">
            {/* Profile Tab */}
            {activeTab === 'profile' && (
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-6">Edit Profile</h2>

                {profileError && (
                  <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{profileError}</div>
                )}
                {profileSuccess && (
                  <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">{profileSuccess}</div>
                )}

                {/* Avatar */}
                <div className="flex items-center gap-6 mb-8">
                  <div className="relative">
                    <div className="w-24 h-24 rounded-full bg-blue-100 flex items-center justify-center overflow-hidden border-2 border-gray-200">
                      {avatarPreview ? (
                        <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                      ) : profileData.avatar_url ? (
                        <img src={`${API_URL}${profileData.avatar_url}`} alt="Avatar" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-3xl font-bold text-blue-400">
                          {user?.full_name?.[0]?.toUpperCase() || '?'}
                        </span>
                      )}
                    </div>
                    <label className="absolute bottom-0 right-0 bg-blue-500 hover:bg-blue-600 text-white rounded-full w-7 h-7 flex items-center justify-center cursor-pointer text-xs shadow">
                      ✏️
                      <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
                    </label>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{user?.full_name}</p>
                    <p className="text-sm text-gray-500">{user?.email}</p>
                    <p className="text-xs text-gray-400 mt-1">JPG, PNG or GIF · Max 5MB</p>
                  </div>
                </div>

                <form onSubmit={handleSaveProfile} className="space-y-6">
                  {/* Basic info */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                      <input
                        type="text"
                        value={profileData.full_name}
                        onChange={(e) => setProfileData({ ...profileData, full_name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Chat Nickname
                        <span className="ml-1 text-xs font-normal text-gray-400">(shown to visitors instead of real name)</span>
                      </label>
                      <input
                        type="text"
                        value={profileData.display_name}
                        onChange={(e) => setProfileData({ ...profileData, display_name: e.target.value })}
                        placeholder="e.g. Alex (leave blank to use real name)"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                      <input
                        type="tel"
                        value={profileData.phone}
                        onChange={(e) => setProfileData({ ...profileData, phone: e.target.value })}
                        placeholder="+1 234 567 8900"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Bio</label>
                    <textarea
                      value={profileData.bio}
                      onChange={(e) => setProfileData({ ...profileData, bio: e.target.value })}
                      rows={3}
                      placeholder="Tell us a little about yourself..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                  </div>

                  {/* Social URLs */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Social Media Links</h3>
                    <div className="space-y-3">
                      {[
                        { key: 'social_twitter', label: 'Twitter / X', icon: '𝕏', placeholder: 'https://twitter.com/yourhandle' },
                        { key: 'social_facebook', label: 'Facebook', icon: '👤', placeholder: 'https://facebook.com/yourprofile' },
                        { key: 'social_linkedin', label: 'LinkedIn', icon: '💼', placeholder: 'https://linkedin.com/in/yourprofile' },
                        { key: 'social_instagram', label: 'Instagram', icon: '📷', placeholder: 'https://instagram.com/yourhandle' },
                        { key: 'social_youtube', label: 'YouTube', icon: '▶️', placeholder: 'https://youtube.com/@yourchannel' },
                      ].map(({ key, label, icon, placeholder }) => (
                        <div key={key} className="flex items-center gap-3">
                          <span className="w-8 text-center text-lg flex-shrink-0">{icon}</span>
                          <input
                            type="url"
                            aria-label={label}
                            value={(profileData as any)[key]}
                            onChange={(e) => setProfileData({ ...profileData, [key]: e.target.value })}
                            placeholder={placeholder}
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                          />
                          <span className="text-xs text-gray-400 w-20 flex-shrink-0 hidden sm:inline">{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={profileSaving}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
                  >
                    {profileSaving ? 'Saving...' : 'Save Profile'}
                  </button>
                </form>
              </div>
            )}

            {/* Connected Accounts Tab */}
            {activeTab === 'accounts' && (
              <>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Manage your messaging platform accounts
                </h2>

                {/* Connected Accounts Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                  {Object.entries(platforms).map(([key, platform]) => {
                    const connected = accounts.find((acc) => acc.platform === key)
                    return (
                      <div
                        key={key}
                        className="border border-gray-200 rounded-lg p-4 flex justify-between items-start"
                      >
                        <div className="flex items-start gap-3">
                          <span className="text-2xl">{platform.icon}</span>
                          <div>
                            <h3 className="font-semibold text-gray-900">
                              {platform.name}
                            </h3>
                            {connected ? (
                              <div>
                                <p className="text-sm text-gray-600 mt-1">
                                  @{connected.account_username}
                                </p>
                                <p className="text-xs text-gray-500 mt-1">
                                  Connected since{' '}
                                  {new Date(connected.created_at).toLocaleDateString()}
                                </p>
                              </div>
                            ) : (
                              <p className="text-sm text-gray-500 mt-1">
                                Not connected
                              </p>
                            )}
                          </div>
                        </div>

                        {connected ? (
                          <button
                            onClick={() => handleDeleteAccount(connected.id)}
                            className="px-3 py-1 text-sm bg-red-50 text-red-600 rounded hover:bg-red-100 font-medium whitespace-nowrap"
                          >
                            Remove
                          </button>
                        ) : (
                          <button
                            onClick={() => handleAddPlatform(key)}
                            className="px-3 py-1 text-sm bg-blue-50 text-blue-600 rounded hover:bg-blue-100 font-medium whitespace-nowrap"
                          >
                            Add
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Add Account Form */}
                {addingPlatform && (
                  <div className="border-t border-gray-200 pt-6 mt-6">
                    <h3 className="font-semibold text-gray-900 mb-4">
                      Add {platforms[addingPlatform].name} Account
                    </h3>

                    <div className="space-y-4 max-w-md">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Account ID / Phone Number
                        </label>
                        <input
                          type="text"
                          placeholder={
                            addingPlatform === 'whatsapp'
                              ? '+1234567890'
                              : addingPlatform === 'facebook'
                                ? 'user123456'
                                : addingPlatform === 'viber'
                                  ? '+1234567890'
                                  : 'user@example.com'
                          }
                          value={formData.account_id}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              account_id: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Display Name / Username
                        </label>
                        <input
                          type="text"
                          placeholder="Your display name"
                          value={formData.account_username}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              account_username: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          API Key / Access Token (Optional)
                        </label>
                        <input
                          type="password"
                          placeholder="API key or access token"
                          value={formData.access_token}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              access_token: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div className="flex gap-3 pt-2">
                        <button
                          onClick={handleSaveAccount}
                          disabled={loading}
                          className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-medium disabled:opacity-50"
                        >
                          {loading ? 'Saving...' : 'Save Account'}
                        </button>
                        <button
                          onClick={handleCancelAdd}
                          className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Info Box */}
                <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
                  <p className="font-medium mb-2">💡 How to connect accounts:</p>
                  <ul className="list-disc list-inside space-y-1 text-blue-800">
                    <li>
                      <strong>WhatsApp:</strong> Use your phone number with country code
                    </li>
                    <li>
                      <strong>Facebook:</strong> Use your Facebook username or user ID
                    </li>
                    <li>
                      <strong>Viber:</strong> Use your Viber phone number
                    </li>
                    <li>
                      <strong>LinkedIn:</strong> Use your LinkedIn profile URL or email
                    </li>
                  </ul>
                </div>
              </>
            )}

            {/* Admin iframe tabs */}
            {activeTab === 'platform-settings' && (
              <iframe src="/admin/settings" className="w-full border-0 rounded-lg" style={{ height: '85vh' }} title="Platform Settings" />
            )}
            {activeTab === 'branding' && (
              <iframe src="/admin/branding" className="w-full border-0 rounded-lg" style={{ height: '85vh' }} title="Branding" />
            )}
            {activeTab === 'users' && (
              <iframe src="/admin/users" className="w-full border-0 rounded-lg" style={{ height: '85vh' }} title="Users" />
            )}
            {activeTab === 'email-accounts' && (
              <iframe src="/admin/email-accounts" className="w-full border-0 rounded-lg" style={{ height: '85vh' }} title="Email Accounts" />
            )}

            {/* Email & Messaging Tab */}
            {activeTab === 'email-messaging' && (
              <div className="space-y-8">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 mb-1">Email & Messaging</h2>
                  <p className="text-sm text-gray-500 mb-6">Manage your email accounts and connected messaging platforms.</p>

                  {/* Email Accounts Section */}
                  <div className="mb-8">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                        <span>✉️</span> Email Accounts
                      </h3>
                      {user?.role === 'admin' && (
                        <button
                          onClick={() => setActiveTab('email-accounts')}
                          className="text-sm text-blue-600 hover:underline"
                        >
                          Manage →
                        </button>
                      )}
                    </div>
                    {user?.role === 'admin' ? (
                      <iframe
                        src="/admin/email-accounts"
                        className="w-full border border-gray-200 rounded-lg"
                        style={{ height: '80vh' }}
                        title="Email Accounts"
                      />
                    ) : (
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-5 text-sm text-gray-600">
                        Email account settings are managed by your administrator.
                      </div>
                    )}
                  </div>

                  {/* Messaging Platforms section removed as it exists in Connected Accounts */}
                </div>
              </div>
            )}

            {/* Calendar Tab */}
            {activeTab === 'calendar' && (
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Calendar Integration</h2>
                <p className="text-sm text-gray-500 mb-6">Connect your calendar to sync reminders automatically.</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Google Calendar */}
                  <div className="border border-gray-200 rounded-lg p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 bg-white border border-gray-200 rounded-lg flex items-center justify-center">
                        <svg width="20" height="20" viewBox="0 0 24 24">
                          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">Google Calendar</h3>
                        <p className="text-xs text-gray-500">Sync reminders with Google Calendar</p>
                      </div>
                    </div>

                    {calendarStatus.google ? (
                      <div>
                        <div className="flex items-center gap-2 mb-3 text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg">
                          <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                          Connected
                        </div>
                        <button
                          onClick={() => disconnectCalendar('google')}
                          className="w-full px-4 py-2 text-sm bg-red-50 text-red-600 rounded-lg hover:bg-red-100 font-medium"
                        >
                          Disconnect
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => connectCalendar('google')}
                        disabled={calendarLoading}
                        className="w-full px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
                      >
                        {calendarLoading ? 'Connecting...' : 'Connect Google Calendar'}
                      </button>
                    )}
                  </div>

                  {/* Microsoft Calendar */}
                  <div className="border border-gray-200 rounded-lg p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 bg-white border border-gray-200 rounded-lg flex items-center justify-center">
                        <svg width="20" height="20" viewBox="0 0 23 23">
                          <rect fill="#F25022" x="1" y="1" width="10" height="10"/>
                          <rect fill="#7FBA00" x="12" y="1" width="10" height="10"/>
                          <rect fill="#00A4EF" x="1" y="12" width="10" height="10"/>
                          <rect fill="#FFB900" x="12" y="12" width="10" height="10"/>
                        </svg>
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">Microsoft Outlook</h3>
                        <p className="text-xs text-gray-500">Sync reminders with Outlook Calendar</p>
                      </div>
                    </div>

                    {calendarStatus.microsoft ? (
                      <div>
                        <div className="flex items-center gap-2 mb-3 text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg">
                          <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                          Connected
                        </div>
                        <button
                          onClick={() => disconnectCalendar('microsoft')}
                          className="w-full px-4 py-2 text-sm bg-red-50 text-red-600 rounded-lg hover:bg-red-100 font-medium"
                        >
                          Disconnect
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => connectCalendar('microsoft')}
                        disabled={calendarLoading}
                        className="w-full px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
                      >
                        {calendarLoading ? 'Connecting...' : 'Connect Microsoft Calendar'}
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
                  <p className="font-medium mb-2">How calendar sync works:</p>
                  <ul className="list-disc list-inside space-y-1 text-blue-800">
                    <li>New reminders with a due date are automatically added to your calendar</li>
                    <li>Rescheduling a reminder updates the calendar event</li>
                    <li>Completing a reminder removes the calendar event</li>
                    <li>You can connect both Google and Microsoft calendars simultaneously</li>
                  </ul>
                </div>
              </div>
            )}

            {/* Account Settings Tab */}
            {activeTab === 'account-settings' && (
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-6">
                  Change Password
                </h2>

                {changePasswordError && (
                  <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                    {changePasswordError}
                  </div>
                )}

                {changePasswordSuccess && (
                  <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
                    {changePasswordSuccess}
                  </div>
                )}

                <form onSubmit={handleChangePassword} className="space-y-4 max-w-md mb-8">
                  <div>
                    <label className="block text-gray-700 font-medium mb-2">
                      Current Password
                    </label>
                    <input
                      type="password"
                      value={changePasswordForm.oldPassword}
                      onChange={(e) =>
                        setChangePasswordForm({
                          ...changePasswordForm,
                          oldPassword: e.target.value,
                        })
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-gray-700 font-medium mb-2">
                      New Password
                    </label>
                    <input
                      type="password"
                      value={changePasswordForm.newPassword}
                      onChange={(e) =>
                        setChangePasswordForm({
                          ...changePasswordForm,
                          newPassword: e.target.value,
                        })
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-gray-700 font-medium mb-2">
                      Confirm Password
                    </label>
                    <input
                      type="password"
                      value={changePasswordForm.confirmPassword}
                      onChange={(e) =>
                        setChangePasswordForm({
                          ...changePasswordForm,
                          confirmPassword: e.target.value,
                        })
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={changingPassword}
                    className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {changingPassword ? 'Changing Password...' : 'Change Password'}
                  </button>
                </form>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
                  <p className="font-medium mb-3">Password Requirements:</p>
                  <ul className="space-y-2 text-blue-800">
                    <li>✓ Minimum 6 characters long</li>
                    <li>✓ Different from current password</li>
                    <li>✓ New passwords must match</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
