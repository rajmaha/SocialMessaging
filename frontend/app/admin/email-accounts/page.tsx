'use client'

import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { useBranding } from '@/lib/branding-context'
import { getAuthToken } from '@/lib/auth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

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
  email_account?: EmailAccount
}

export default function AdminEmailAccountsPage() {
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
    smtp_security: 'STARTTLS'
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
            const accountResponse = await axios.get(
              `${API_URL}/admin/email-accounts?user_id=${user.id}`,
              { headers: { Authorization: `Bearer ${token}` } }
            )
            return {
              ...user,
              email_account: accountResponse.data[0] || null
            }
          } catch {
            return { ...user, email_account: null }
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
      smtp_security: 'STARTTLS'
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
        smtp_security: fullAccount.smtp_security || 'STARTTLS'
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
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-6xl mx-auto">
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

                  {user.email_account ? (
                    <div className="mt-3 p-3 bg-blue-50 rounded border border-blue-200">
                      <p className="text-sm font-semibold text-blue-900">
                        📧 {user.email_account.email_address}
                      </p>
                      <p className="text-xs text-blue-700 mt-1">
                        {user.email_account.account_name}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-3 p-3 bg-yellow-50 rounded border border-yellow-200">
                      <p className="text-sm text-yellow-800">⚠️ No email account configured</p>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 flex-shrink-0">
                  {user.email_account ? (
                    <>
                      <button
                        onClick={() => handleEditAccount(user, user.email_account!)}
                        className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm"
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={() => handleDeleteAccount(user.email_account!.id)}
                        className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm"
                      >
                        🗑️ Delete
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => handleAddAccount(user)}
                      className="px-4 py-2 text-white rounded-lg text-sm"
                      style={{ backgroundColor: branding.primary_color }}
                    >
                      ➕ Add Account
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {showForm && selectedUser && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg max-w-2xl w-full max-h-screen overflow-y-auto p-6">
              <h2 className="text-xl font-bold mb-4">
                {editingAccountId ? 'Edit Email Account' : `Add Email Account for ${selectedUser.full_name}`}
              </h2>

              {testResult && (
                <div className={`mb-4 p-4 rounded-lg ${testResult.status === 'success' ? 'bg-green-100' : 'bg-yellow-100'}`}>
                  <div className="text-sm">
                    <div className={testResult.imap_ok ? 'text-green-700' : 'text-red-700'}>
                      {testResult.imap_message}
                    </div>
                    <div className={testResult.smtp_ok ? 'text-green-700' : 'text-red-700'}>
                      {testResult.smtp_message}
                    </div>
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Email Address</label>
                    <input
                      type="email"
                      required
                      disabled={!!editingAccountId}
                      value={formData.email_address}
                      onChange={(e) =>
                        setFormData({ ...formData, email_address: e.target.value })
                      }
                      placeholder="user@example.com"
                      className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">Account Name</label>
                    <input
                      type="text"
                      required
                      value={formData.account_name}
                      onChange={(e) =>
                        setFormData({ ...formData, account_name: e.target.value })
                      }
                      placeholder="Work, Personal, etc."
                      className="w-full px-3 py-2 border rounded-lg"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Display Name</label>
                  <input
                    type="text"
                    value={formData.display_name}
                    onChange={(e) =>
                      setFormData({ ...formData, display_name: e.target.value })
                    }
                    placeholder="Your Name"
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>

                <div className="border-t pt-4">
                  <h3 className="font-semibold mb-3 text-sm">IMAP Settings (Incoming)</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">Host</label>
                      <input
                        type="text"
                        required
                        value={formData.imap_host}
                        onChange={(e) =>
                          setFormData({ ...formData, imap_host: e.target.value })
                        }
                        placeholder="imap.gmail.com"
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Port</label>
                      <input
                        type="number"
                        required
                        value={formData.imap_port}
                        onChange={(e) =>
                          setFormData({ ...formData, imap_port: parseInt(e.target.value) })
                        }
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Username</label>
                      <input
                        type="text"
                        required
                        value={formData.imap_username}
                        onChange={(e) =>
                          setFormData({ ...formData, imap_username: e.target.value })
                        }
                        placeholder="Email"
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-sm font-medium">
                          Password {hasExistingPasswords.imap && editingAccountId ? '🔒 (saved)' : ''}
                        </label>
                        {editingAccountId && hasExistingPasswords.imap && (
                          <button
                            type="button"
                            onClick={() => setShowPasswords({ ...showPasswords, imap: !showPasswords.imap })}
                            className="text-xs px-2 py-1 text-blue-600 hover:text-blue-800"
                          >
                            {showPasswords.imap ? '🙈 Hide' : '👁️ Show'}
                          </button>
                        )}
                      </div>
                      <input
                        type={showPasswords.imap ? 'text' : 'password'}
                        required={!editingAccountId}
                        value={formData.imap_password}
                        onChange={(e) =>
                          setFormData({ ...formData, imap_password: e.target.value })
                        }
                        placeholder={editingAccountId && hasExistingPasswords.imap ? '(leave blank to keep current)' : 'App password'}
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      />
                      {editingAccountId && hasExistingPasswords.imap && !formData.imap_password && (
                        <p className="text-xs text-green-600 mt-1">✅ Current password will be kept</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h3 className="font-semibold mb-3 text-sm">SMTP Settings (Outgoing)</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">Host</label>
                      <input
                        type="text"
                        required
                        value={formData.smtp_host}
                        onChange={(e) =>
                          setFormData({ ...formData, smtp_host: e.target.value })
                        }
                        placeholder="smtp.gmail.com"
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Port</label>
                      <input
                        type="number"
                        required
                        value={formData.smtp_port}
                        onChange={(e) =>
                          setFormData({ ...formData, smtp_port: parseInt(e.target.value) })
                        }
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Security</label>
                      <select
                        required
                        value={formData.smtp_security}
                        onChange={(e) =>
                          setFormData({ ...formData, smtp_security: e.target.value })
                        }
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      >
                        <option value="STARTTLS">STARTTLS (587)</option>
                        <option value="SSL">SSL (465)</option>
                        <option value="TLS">TLS (587/993)</option>
                        <option value="NONE">None (25/587)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Username</label>
                      <input
                        type="text"
                        required
                        value={formData.smtp_username}
                        onChange={(e) =>
                          setFormData({ ...formData, smtp_username: e.target.value })
                        }
                        placeholder="Email"
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      />
                    </div>
                    <div className="col-span-2">
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-sm font-medium">
                          Password {hasExistingPasswords.smtp && editingAccountId ? '🔒 (saved)' : ''}
                        </label>
                        {editingAccountId && hasExistingPasswords.smtp && (
                          <button
                            type="button"
                            onClick={() => setShowPasswords({ ...showPasswords, smtp: !showPasswords.smtp })}
                            className="text-xs px-2 py-1 text-blue-600 hover:text-blue-800"
                          >
                            {showPasswords.smtp ? '🙈 Hide' : '👁️ Show'}
                          </button>
                        )}
                      </div>
                      <input
                        type={showPasswords.smtp ? 'text' : 'password'}
                        required={!editingAccountId}
                        value={formData.smtp_password}
                        onChange={(e) =>
                          setFormData({ ...formData, smtp_password: e.target.value })
                        }
                        placeholder={editingAccountId && hasExistingPasswords.smtp ? '(leave blank to keep current)' : 'App password'}
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      />
                      {editingAccountId && hasExistingPasswords.smtp && !formData.smtp_password && (
                        <p className="text-xs text-green-600 mt-1">✅ Current password will be kept</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 pt-4 border-t">
                  <button
                    type="button"
                    onClick={handleTestCredentials}
                    disabled={testing || !formData.imap_host || !formData.smtp_host || !formData.imap_username || !formData.smtp_username}
                    className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50"
                  >
                    {testing ? 'Testing...' : '🧪 Test Credentials'}
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-2 text-white rounded-lg hover:opacity-90 disabled:opacity-50"
                    style={{ backgroundColor: branding.primary_color }}
                  >
                    {saving ? 'Saving...' : editingAccountId ? 'Update Account' : 'Create Account'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
