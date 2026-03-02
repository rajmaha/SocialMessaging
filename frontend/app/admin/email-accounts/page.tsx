'use client'

import MainHeader from '@/components/MainHeader';
import { authAPI } from '@/lib/auth';

import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { useBranding } from '@/lib/branding-context'
import { getAuthToken } from '@/lib/auth'
import AdminNav from '@/components/AdminNav'
import { API_URL } from '@/lib/config';

interface User {
  id: number
  username: string
  email: string
  full_name: string
  role: string
  is_active: boolean
}

interface EmailAccount {
  id: number
  user_id: number
  email_address: string
  account_name: string
  display_name?: string
  is_active: boolean
  last_sync?: string
  created_at: string
}

interface UserWithAccount extends User {
  email_accounts: EmailAccount[]
}

export default function AdminEmailAccountsPage() {
  const user = authAPI.getUser();
  const { branding } = useBranding()
  const [users, setUsers] = useState<UserWithAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [formData, setFormData] = useState({
    email_address: '',
    account_name: '',
    display_name: '',
    imap_host: '',
    imap_port: 993,
    imap_username: '',
    imap_password: '',
    smtp_host: '',
    smtp_port: 587,
    smtp_username: '',
    smtp_password: '',
    smtp_security: 'STARTTLS',
    chat_integration_enabled: true
  })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<any>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showPasswords, setShowPasswords] = useState({ imap: false, smtp: false })
  const [hasExistingPasswords, setHasExistingPasswords] = useState({ imap: false, smtp: false })

  useEffect(() => {
    fetchUsers()
  }, [])

  const fetchUsers = async () => {
    try {
      setLoading(true)
      const token = getAuthToken()
      if (!token) {
        setError('Not authenticated - please log in as admin')
        setLoading(false)
        return
      }

      const response = await axios.get(`${API_URL}/admin/users`, {
        headers: { Authorization: `Bearer ${token}` }
      })

      const usersWithAccounts = await Promise.all(
        response.data.map(async (user: User) => {
          try {
            const accountsResponse = await axios.get(
              `${API_URL}/admin/email-accounts?user_id=${user.id}`,
              { headers: { Authorization: `Bearer ${token}` } }
            )
            return {
              ...user,
              email_accounts: accountsResponse.data || []
            }
          } catch {
            return { ...user, email_accounts: [] }
          }
        })
      )

      setUsers(usersWithAccounts)
      setError('')
    } catch (err: any) {
      console.error('Error fetching users:', err)
      setError(err.response?.data?.detail || 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  const handleAddAccount = (user: User) => {
    setSelectedUser(user)
    setEditingAccountId(null)
    setFormData({
      email_address: '',
      account_name: `${user.full_name}'s Mail`,
      display_name: user.full_name || user.username,
      imap_host: '',
      imap_port: 993,
      imap_username: '',
      imap_password: '',
      smtp_host: '',
      smtp_port: 587,
      smtp_username: '',
      smtp_password: '',
      smtp_security: 'STARTTLS',
      chat_integration_enabled: true
    })
    setShowForm(true)
    setShowPasswords({ imap: false, smtp: false })
    setHasExistingPasswords({ imap: false, smtp: false })
    setTestResult(null)
  }

  const handleEditAccount = async (user: User, account: EmailAccount) => {
    try {
      setSelectedUser(user)
      setEditingAccountId(account.id)

      // Fetch full account details with credentials
      const token = getAuthToken()
      if (!token) {
        setError('Not authenticated')
        return
      }

      const fullAccountResponse = await axios.get(
        `${API_URL}/admin/email-accounts/${account.id}/full`,
        { headers: { Authorization: `Bearer ${token}` } }
      )

      const fullAccount = fullAccountResponse.data
      setFormData({
        email_address: fullAccount.email_address,
        account_name: fullAccount.account_name,
        display_name: fullAccount.display_name || '',
        imap_host: fullAccount.imap_host,
        imap_port: fullAccount.imap_port,
        imap_username: fullAccount.imap_username,
        imap_password: fullAccount.imap_password, // Show actual password for verification
        smtp_host: fullAccount.smtp_host,
        smtp_port: fullAccount.smtp_port,
        smtp_username: fullAccount.smtp_username,
        smtp_password: fullAccount.smtp_password, // Show actual password for verification
        smtp_security: fullAccount.smtp_security || 'STARTTLS',
        chat_integration_enabled: fullAccount.chat_integration_enabled ?? true
      })
      // Track that we have existing passwords
      setHasExistingPasswords({
        imap: !!fullAccount.imap_password,
        smtp: !!fullAccount.smtp_password
      })
      setShowPasswords({ imap: false, smtp: false })  // Hide passwords by default - admin must click Show button
      setShowForm(true)
      setTestResult(null)
    } catch (err: any) {
      setError('Failed to load account details for editing')
      console.error('Error fetching account details:', err)
    }
  }

  const handleTestCredentials = async () => {
    try {
      setTesting(true)
      const token = getAuthToken()
      if (!token) {
        setError('Not authenticated')
        setTesting(false)
        return
      }

      const response = await axios.post(
        `${API_URL}/admin/email-accounts/test-credentials`,
        formData,
        { headers: { Authorization: `Bearer ${token}` } }
      )

      setTestResult(response.data)
      setError('')
    } catch (err: any) {
      setTestResult({
        status: 'error',
        imap_ok: false,
        smtp_ok: false,
        imap_message: err.response?.data?.detail || 'Error testing credentials',
        smtp_message: 'Test failed'
      })
    } finally {
      setTesting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUser) return

    try {
      setSaving(true)
      setError('')
      const token = getAuthToken()
      if (!token) {
        setError('Not authenticated')
        setSaving(false)
        return
      }

      if (editingAccountId) {
        // Edit existing account
        await axios.put(
          `${API_URL}/admin/email-accounts/${editingAccountId}`,
          formData,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        setSuccess('Email account updated')
      } else {
        // Create new account
        await axios.post(
          `${API_URL}/admin/email-accounts?user_id=${selectedUser.id}`,
          formData,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        setSuccess(`Email account created for ${selectedUser.full_name}`)
      }

      setShowForm(false)
      await fetchUsers()

      setTimeout(() => setSuccess(''), 3000)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to save email account')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteAccount = async (accountId: number) => {
    if (!confirm('Delete this email account? This cannot be undone.')) return

    try {
      const token = getAuthToken()
      if (!token) {
        setError('Not authenticated')
        return
      }

      await axios.delete(`${API_URL}/admin/email-accounts/${accountId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })

      setSuccess('Email account deleted')
      await fetchUsers()

      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError('Failed to delete email account')
    }
  }

  if (!branding) {
    return <div className="p-8">Loading...</div>
  }

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-100">
      <MainHeader user={user!} />
      <AdminNav />
      <div className="max-w-6xl mx-auto p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: branding.primary_color }}>
            📧 Email Account Management
          </h1>
          <p className="text-gray-600">Configure email accounts for team members</p>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-100 text-red-700 rounded-lg">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-4 bg-green-100 text-green-700 rounded-lg">
            {success}
          </div>
        )}

        {loading ? (
          <div className="text-center py-8 text-gray-500">Loading users...</div>
        ) : users.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No users found</div>
        ) : (
          <div className="space-y-4">
            {users.map((user) => (
              <div
                key={user.id}
                className="bg-white rounded-lg shadow p-6 flex flex-wrap gap-4 justify-between items-start"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold">{user.full_name}</h3>
                    {user.role === 'admin' && (
                      <span className="px-2 py-1 bg-purple-100 text-purple-700 text-xs font-semibold rounded">
                        Admin
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">{user.email}</p>

                  {user.email_accounts && user.email_accounts.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {user.email_accounts.map((acc) => (
                        <div key={acc.id} className="p-3 bg-blue-50 rounded border border-blue-200 flex justify-between items-center group">
                          <div className="flex-1 min-w-0 mr-4">
                            <p className="text-sm font-semibold text-blue-900 truncate">
                              📧 {acc.email_address}
                            </p>
                            <p className="text-xs text-blue-700 mt-0.5 truncate">
                              {acc.account_name}
                            </p>
                          </div>
                          <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => handleEditAccount(user, acc)}
                              className="p-1.5 text-blue-600 hover:bg-blue-100 rounded transition"
                              title="Edit Account"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => handleDeleteAccount(acc.id)}
                              className="p-1.5 text-red-600 hover:bg-red-100 rounded transition"
                              title="Delete Account"
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 p-3 bg-yellow-50 rounded border border-yellow-200">
                      <p className="text-sm text-yellow-800">⚠️ No email account configured</p>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleAddAccount(user)}
                    className="px-4 py-2 text-white rounded-lg text-sm font-semibold shadow-sm hover:opacity-90 transition-all flex items-center gap-2"
                    style={{ backgroundColor: branding.primary_color }}
                  >
                    <span>➕ Add Account</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {showForm && selectedUser && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[100] animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full flex flex-col max-h-[80vh] overflow-hidden animate-in zoom-in-95 duration-200">
              {/* Header */}
              <div className="px-6 py-4 border-b bg-gray-50 flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-800">
                  {editingAccountId ? '✏️ Edit Email Account' : `➕ Add Email Account for ${selectedUser.full_name}`}
                </h2>
                <button
                  onClick={() => setShowForm(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-200 transition text-gray-500"
                >
                  ✕
                </button>
              </div>

              {/* Scrollable Body */}
              <div className="flex-1 overflow-y-auto p-6">
                {testResult && (
                  <div className={`mb-6 p-4 rounded-xl border ${testResult.status === 'success' ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
                    <div className="text-sm font-medium">
                      <div className={`flex items-center gap-2 ${testResult.imap_ok ? 'text-green-700' : 'text-red-700'}`}>
                        {testResult.imap_ok ? '✅' : '❌'} {testResult.imap_message}
                      </div>
                      <div className={`flex items-center gap-2 mt-1 ${testResult.smtp_ok ? 'text-green-700' : 'text-red-700'}`}>
                        {testResult.smtp_ok ? '✅' : '❌'} {testResult.smtp_message}
                      </div>
                    </div>
                  </div>
                )}

                <form id="email-account-form" onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Email Address</label>
                      <input
                        type="email"
                        required
                        disabled={!!editingAccountId}
                        value={formData.email_address}
                        onChange={(e) =>
                          setFormData({ ...formData, email_address: e.target.value })
                        }
                        placeholder="user@example.com"
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-gray-50 disabled:text-gray-500 transition shadow-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Account Name</label>
                      <input
                        type="text"
                        required
                        value={formData.account_name}
                        onChange={(e) =>
                          setFormData({ ...formData, account_name: e.target.value })
                        }
                        placeholder="Work, Personal, etc."
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white transition shadow-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Display Name (Sender Name)</label>
                    <input
                      type="text"
                      value={formData.display_name}
                      onChange={(e) =>
                        setFormData({ ...formData, display_name: e.target.value })
                      }
                      placeholder="Your Full Name"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white transition shadow-sm"
                    />
                  </div>

                  <div className="pt-4 border-t border-dashed border-gray-200">
                    <h3 className="flex items-center gap-2 font-bold text-gray-800 mb-4">
                      <span className="p-1 px-2 bg-blue-100 text-blue-600 rounded text-xs uppercase">Incoming</span>
                      IMAP Settings
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="md:col-span-3">
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5 ml-1">IMAP Host</label>
                        <input
                          type="text"
                          required
                          value={formData.imap_host}
                          onChange={(e) =>
                            setFormData({ ...formData, imap_host: e.target.value })
                          }
                          placeholder="imap.gmail.com"
                          className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm shadow-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Port</label>
                        <input
                          type="number"
                          required
                          value={formData.imap_port}
                          onChange={(e) =>
                            setFormData({ ...formData, imap_port: parseInt(e.target.value) })
                          }
                          className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm shadow-sm"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Username</label>
                        <input
                          type="text"
                          required
                          value={formData.imap_username}
                          onChange={(e) =>
                            setFormData({ ...formData, imap_username: e.target.value })
                          }
                          placeholder="Email address"
                          className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm shadow-sm"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <div className="flex items-center justify-between mb-1 ml-1">
                          <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">
                            Password {hasExistingPasswords.imap && editingAccountId ? '🔒 (Saved)' : ''}
                          </label>
                          <button
                            type="button"
                            onClick={() => setShowPasswords({ ...showPasswords, imap: !showPasswords.imap })}
                            className="text-[10px] uppercase font-bold text-blue-600 hover:text-blue-800"
                          >
                            {showPasswords.imap ? '🙈 Hide' : '👁️ Show'}
                          </button>
                        </div>
                        <input
                          type={showPasswords.imap ? 'text' : 'password'}
                          required={!editingAccountId}
                          value={formData.imap_password}
                          onChange={(e) =>
                            setFormData({ ...formData, imap_password: e.target.value })
                          }
                          placeholder={editingAccountId && hasExistingPasswords.imap ? '(Keep current)' : 'Password'}
                          className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm shadow-sm"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-dashed border-gray-200">
                    <h3 className="flex items-center gap-2 font-bold text-gray-800 mb-4">
                      <span className="p-1 px-2 bg-amber-100 text-amber-600 rounded text-xs uppercase">Outgoing</span>
                      SMTP Settings
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5 ml-1">SMTP Host</label>
                        <input
                          type="text"
                          required
                          value={formData.smtp_host}
                          onChange={(e) =>
                            setFormData({ ...formData, smtp_host: e.target.value })
                          }
                          placeholder="smtp.gmail.com"
                          className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm shadow-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Port</label>
                        <input
                          type="number"
                          required
                          value={formData.smtp_port}
                          onChange={(e) =>
                            setFormData({ ...formData, smtp_port: parseInt(e.target.value) })
                          }
                          className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm shadow-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Security</label>
                        <select
                          required
                          value={formData.smtp_security}
                          onChange={(e) =>
                            setFormData({ ...formData, smtp_security: e.target.value })
                          }
                          className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm shadow-sm bg-white"
                        >
                          <option value="STARTTLS">STARTTLS (587)</option>
                          <option value="SSL">SSL (465)</option>
                          <option value="TLS">TLS (587/993)</option>
                          <option value="NONE">None (25/587)</option>
                        </select>
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Username</label>
                        <input
                          type="text"
                          required
                          value={formData.smtp_username}
                          onChange={(e) =>
                            setFormData({ ...formData, smtp_username: e.target.value })
                          }
                          placeholder="Email address"
                          className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm shadow-sm"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <div className="flex items-center justify-between mb-1 ml-1">
                          <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">
                            Password {hasExistingPasswords.smtp && editingAccountId ? '🔒 (Saved)' : ''}
                          </label>
                          <button
                            type="button"
                            onClick={() => setShowPasswords({ ...showPasswords, smtp: !showPasswords.smtp })}
                            className="text-[10px] uppercase font-bold text-blue-600 hover:text-blue-800"
                          >
                            {showPasswords.smtp ? '🙈 Hide' : '👁️ Show'}
                          </button>
                        </div>
                        <input
                          type={showPasswords.smtp ? 'text' : 'password'}
                          required={!editingAccountId}
                          value={formData.smtp_password}
                          onChange={(e) =>
                            setFormData({ ...formData, smtp_password: e.target.value })
                          }
                          placeholder={editingAccountId && hasExistingPasswords.smtp ? '(Keep current)' : 'Password'}
                          className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm shadow-sm"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Chat Integration Setting */}
                  <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-bold text-indigo-900 flex items-center gap-2">
                          <span>💬</span> Chat Integration
                        </h4>
                        <p className="text-xs text-indigo-600 mt-1 max-w-md">
                          When enabled, incoming emails from senders who have an existing open ticket will automatically appear in the Chat inbox. When disabled, emails only appear in the Email inbox.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, chat_integration_enabled: !formData.chat_integration_enabled })}
                        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200 focus:outline-none flex-shrink-0 ml-4 ${formData.chat_integration_enabled ? 'bg-indigo-600' : 'bg-gray-300'
                          }`}
                        role="switch"
                        aria-checked={formData.chat_integration_enabled}
                      >
                        <span
                          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${formData.chat_integration_enabled ? 'translate-x-6' : 'translate-x-1'
                            }`}
                        />
                      </button>
                    </div>
                    <p className="text-xs font-semibold mt-2 text-indigo-700">
                      Status: {formData.chat_integration_enabled ? '✅ Enabled — emails bridge to chat' : '🔒 Disabled — emails stay in email inbox only'}
                    </p>
                  </div>
                </form>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-gray-50 border-t flex flex-wrap gap-3 justify-between items-center">
                <button
                  type="button"
                  onClick={handleTestCredentials}
                  disabled={testing || !formData.imap_host || !formData.smtp_host || !formData.imap_username || !formData.smtp_username}
                  className="px-5 py-2.5 bg-purple-600 text-white rounded-xl hover:bg-purple-700 disabled:opacity-50 disabled:bg-purple-400 transition shadow-md flex items-center gap-2 text-sm font-bold uppercase tracking-wider"
                >
                  {testing ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Testing...
                    </>
                  ) : '🧪 Test Credentials'}
                </button>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="px-6 py-2.5 border border-gray-300 rounded-xl hover:bg-white text-gray-700 font-semibold transition bg-gray-100"
                  >
                    Cancel
                  </button>
                  <button
                    form="email-account-form"
                    type="submit"
                    disabled={saving}
                    className="px-8 py-2.5 text-white rounded-xl hover:opacity-90 disabled:opacity-50 transition shadow-lg font-bold uppercase tracking-wider"
                    style={{ backgroundColor: branding.primary_color }}
                  >
                    {saving ? 'Saving...' : editingAccountId ? 'Update Account' : 'Create Account'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
