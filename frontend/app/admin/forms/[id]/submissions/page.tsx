'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { formsApi, userApiCredsApi } from '@/lib/api';
import { authAPI } from '@/lib/auth';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';

const PAGE_SIZE = 50;

export default function SubmissionsPage() {
  const user = authAPI.getUser();
  const { id } = useParams();
  const formId = Number(id);

  const [form, setForm] = useState<any>(null);
  const [fields, setFields] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [loading, setLoading] = useState(true);

  // Modals
  const [detailSub, setDetailSub] = useState<any>(null);
  const [editSub, setEditSub] = useState<any>(null);
  const [editData, setEditData] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  // API login modal
  const [showLogin, setShowLogin] = useState(false);
  const [loginCreds, setLoginCreds] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');

  const loadSubmissions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await formsApi.listSubmissions(formId, skip, PAGE_SIZE);
      const data = res.data;
      if (Array.isArray(data)) {
        setSubmissions(data);
        setTotal(data.length);
      } else {
        setSubmissions(data.items ?? data.submissions ?? []);
        setTotal(data.total ?? data.count ?? 0);
      }
    } catch (err: any) {
      if (err?.response?.status === 401 && err?.response?.data?.detail === 'login_required') {
        setShowLogin(true);
      }
      setSubmissions([]);
    } finally {
      setLoading(false);
    }
  }, [formId, skip]);

  useEffect(() => {
    formsApi.get(formId).then(r => setForm(r.data)).catch(() => {});
    formsApi.listFields(formId).then(r => setFields(r.data)).catch(() => {});
  }, [formId]);

  useEffect(() => {
    loadSubmissions();
  }, [loadSubmissions]);

  // --- Export CSV ---
  const handleExport = async () => {
    const res = await formsApi.exportSubmissions(formId);
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = `form-submissions.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // --- Delete ---
  const handleDelete = async (subId: number) => {
    if (!confirm('Delete this submission? This cannot be undone.')) return;
    await formsApi.deleteSubmission(formId, subId);
    loadSubmissions();
  };

  // --- Edit ---
  const openEdit = (sub: any) => {
    setEditSub(sub);
    setEditData({ ...(sub.data || {}) });
  };

  const handleSave = async () => {
    if (!editSub) return;
    setSaving(true);
    try {
      await formsApi.updateSubmission(formId, editSub.id, { data: editData });
      setEditSub(null);
      loadSubmissions();
    } catch {
      alert('Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  // --- API Login ---
  const handleLogin = async () => {
    setLoginError('');
    try {
      await userApiCredsApi.login(form?.api_server_id);
      setShowLogin(false);
      loadSubmissions();
    } catch {
      setLoginError('Login failed. Check your credentials.');
    }
  };

  // --- Helpers ---
  const formatDate = (d: string) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const displayValue = (val: any): string => {
    if (val === null || val === undefined) return '-';
    if (Array.isArray(val)) return val.join(', ');
    return String(val);
  };

  const isLocal = form?.storage_type !== 'api' && form?.storage_type !== 'remote';
  const endIndex = Math.min(skip + PAGE_SIZE, total || submissions.length);
  const hasNext = submissions.length === PAGE_SIZE;
  const hasPrev = skip > 0;

  if (!user) return null;

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user} />
      <AdminNav />
      <div className="p-6 max-w-6xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <a
              href="/admin/forms"
              className="text-sm text-indigo-600 hover:text-indigo-800 mb-1 inline-block"
            >
              &larr; Back to Forms
            </a>
            <h1 className="text-2xl font-bold text-gray-900">
              {form?.title || 'Form'} &mdash; Submissions
            </h1>
          </div>
          {isLocal && (
            <button
              onClick={handleExport}
              className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700"
            >
              Export CSV
            </button>
          )}
        </div>

        {/* API note */}
        {!isLocal && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 text-sm text-blue-700">
            This form uses a remote API. Submissions are fetched from the external server.
          </div>
        )}

        {/* Loading */}
        {loading && (
          <p className="text-gray-400 text-sm py-10 text-center">Loading submissions...</p>
        )}

        {/* Table */}
        {!loading && submissions.length > 0 && (
          <>
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">ID</th>
                      {isLocal && fields.map(f => (
                        <th key={f.id} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">
                          {f.field_label}
                        </th>
                      ))}
                      {!isLocal && submissions.length > 0 && Object.keys(submissions[0]?.data || submissions[0] || {}).filter(k => k !== 'id').map(k => (
                        <th key={k} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">
                          {k}
                        </th>
                      ))}
                      {isLocal && (
                        <>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Email</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Submitted At</th>
                        </>
                      )}
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submissions.map((sub, idx) => {
                      const subData = sub.data || sub;
                      return (
                        <tr
                          key={sub.id ?? idx}
                          className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
                          onClick={() => setDetailSub(sub)}
                        >
                          <td className="px-4 py-3 text-gray-700 font-mono text-xs">{sub.id ?? idx + 1}</td>
                          {isLocal && fields.map(f => (
                            <td key={f.id} className="px-4 py-3 text-gray-700 max-w-[200px] truncate">
                              {displayValue(subData[f.field_key])}
                            </td>
                          ))}
                          {!isLocal && Object.keys(submissions[0]?.data || submissions[0] || {}).filter(k => k !== 'id').map(k => (
                            <td key={k} className="px-4 py-3 text-gray-700 max-w-[200px] truncate">
                              {displayValue(subData[k])}
                            </td>
                          ))}
                          {isLocal && (
                            <>
                              <td className="px-4 py-3 text-gray-500 text-xs">{sub.submitter_email || '-'}</td>
                              <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{formatDate(sub.submitted_at || sub.created_at)}</td>
                            </>
                          )}
                          <td className="px-4 py-3 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => openEdit(sub)}
                              className="text-indigo-600 hover:text-indigo-800 text-xs font-medium mr-3"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(sub.id)}
                              className="text-red-500 hover:text-red-700 text-xs font-medium"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-gray-500">
                Showing {skip + 1}&ndash;{endIndex}{total > 0 ? ` of ${total}` : ''}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setSkip(s => Math.max(0, s - PAGE_SIZE))}
                  disabled={!hasPrev}
                  className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-gray-100"
                >
                  Previous
                </button>
                <button
                  onClick={() => setSkip(s => s + PAGE_SIZE)}
                  disabled={!hasNext}
                  className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-gray-100"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}

        {/* Empty state */}
        {!loading && submissions.length === 0 && (
          <p className="text-gray-400 text-sm py-10 text-center">No submissions yet.</p>
        )}
      </div>

      {/* Detail Modal */}
      {detailSub && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setDetailSub(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-lg shadow-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg text-gray-900">Submission #{detailSub.id}</h2>
              <button onClick={() => setDetailSub(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <div className="space-y-3">
              {isLocal && fields.map(f => (
                <div key={f.id} className="flex gap-4">
                  <span className="text-sm font-medium text-gray-500 w-1/3 shrink-0">{f.field_label}</span>
                  <span className="text-sm text-gray-900 break-words">{displayValue((detailSub.data || detailSub)[f.field_key])}</span>
                </div>
              ))}
              {!isLocal && Object.entries(detailSub.data || detailSub).filter(([k]) => k !== 'id').map(([k, v]) => (
                <div key={k} className="flex gap-4">
                  <span className="text-sm font-medium text-gray-500 w-1/3 shrink-0">{k}</span>
                  <span className="text-sm text-gray-900 break-words">{displayValue(v)}</span>
                </div>
              ))}
              {isLocal && (
                <>
                  <div className="flex gap-4">
                    <span className="text-sm font-medium text-gray-500 w-1/3 shrink-0">Email</span>
                    <span className="text-sm text-gray-900">{detailSub.submitter_email || '-'}</span>
                  </div>
                  <div className="flex gap-4">
                    <span className="text-sm font-medium text-gray-500 w-1/3 shrink-0">Submitted At</span>
                    <span className="text-sm text-gray-900">{formatDate(detailSub.submitted_at || detailSub.created_at)}</span>
                  </div>
                </>
              )}
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setDetailSub(null)}
                className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editSub && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setEditSub(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-lg shadow-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg text-gray-900">Edit Submission #{editSub.id}</h2>
              <button onClick={() => setEditSub(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <div className="space-y-3">
              {(isLocal ? fields : Object.keys(editSub.data || editSub).filter(k => k !== 'id').map(k => ({ field_key: k, field_label: k, id: k }))).map((f: any) => (
                <div key={f.id}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{f.field_label}</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={editData[f.field_key] ?? ''}
                    onChange={e => setEditData(prev => ({ ...prev, [f.field_key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setEditSub(null)}
                className="flex-1 border rounded-lg px-4 py-2 text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-blue-600 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50 hover:bg-blue-700"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* API Login Modal */}
      {showLogin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="font-semibold text-lg text-gray-900 mb-1">API Login Required</h2>
            <p className="text-sm text-gray-500 mb-4">The remote server requires authentication to access submissions.</p>
            {loginError && <p className="text-sm text-red-600 mb-3">{loginError}</p>}
            <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
              value={loginCreds.username}
              onChange={e => setLoginCreds(p => ({ ...p, username: e.target.value }))}
            />
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              className="w-full border rounded-lg px-3 py-2 text-sm mb-4"
              value={loginCreds.password}
              onChange={e => setLoginCreds(p => ({ ...p, password: e.target.value }))}
            />
            <div className="flex gap-3">
              <button
                onClick={() => setShowLogin(false)}
                className="flex-1 border rounded-lg px-4 py-2 text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleLogin}
                className="flex-1 bg-blue-600 text-white rounded-lg px-4 py-2 text-sm hover:bg-blue-700"
              >
                Login
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
