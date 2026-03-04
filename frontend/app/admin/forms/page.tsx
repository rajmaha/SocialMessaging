'use client';
import { useEffect, useState } from 'react';
import { formsApi, apiServersApi } from '@/lib/api';
import { authAPI } from '@/lib/auth';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';

const defaultForm = {
  title: '',
  slug: '',
  description: '',
  success_message: 'Thank you for your submission!',
  storage_type: 'local',
  api_server_id: '',
  api_method_create: '',
  api_method_list: '',
  api_method_detail: '',
  api_method_update: '',
  api_method_delete: '',
  is_published: false,
  require_otp: false,
};

export default function FormsPage() {
  const user = authAPI.getUser();
  const [forms, setForms] = useState<any[]>([]);
  const [apiServers, setApiServers] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...defaultForm });

  const load = () => formsApi.list().then(r => setForms(r.data));
  useEffect(() => {
    load();
    apiServersApi.list().then(r => setApiServers(r.data)).catch(() => {});
  }, []);

  const titleToSlug = (title: string) =>
    title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const openCreate = () => {
    setEditing(null);
    setForm({ ...defaultForm });
    setShowModal(true);
  };

  const openEdit = (item: any) => {
    setEditing(item);
    setForm({
      title: item.title || '',
      slug: item.slug || '',
      description: item.description || '',
      success_message: item.success_message || 'Thank you for your submission!',
      storage_type: item.storage_type || 'local',
      api_server_id: item.api_server_id || '',
      api_method_create: item.api_method_create || '',
      api_method_list: item.api_method_list || '',
      api_method_detail: item.api_method_detail || '',
      api_method_update: item.api_method_update || '',
      api_method_delete: item.api_method_delete || '',
      is_published: item.is_published || false,
      require_otp: item.require_otp || false,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    const payload = {
      ...form,
      api_server_id: form.api_server_id ? Number(form.api_server_id) : null,
    };
    if (editing) {
      await formsApi.update(editing.id, payload);
    } else {
      await formsApi.create(payload);
    }
    setShowModal(false);
    setEditing(null);
    setForm({ ...defaultForm });
    load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this form? All fields and submissions will be permanently removed.')) return;
    await formsApi.delete(id);
    load();
  };

  const handleTitleChange = (val: string) => {
    const updates: any = { title: val };
    if (!editing) updates.slug = titleToSlug(val);
    setForm(prev => ({ ...prev, ...updates }));
  };

  if (!user) return null;

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user} />
      <AdminNav />
      <div className="p-6 max-w-4xl">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Form Pages (Surveys)</h1>
            <p className="text-sm text-gray-500 mt-1">Create and manage dynamic forms for surveys and data collection</p>
          </div>
          <button
            onClick={openCreate}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            + Create Form
          </button>
        </div>

        <div className="space-y-3">
          {forms.map(item => (
            <div key={item.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="font-semibold text-gray-900">{item.title}</span>
                  {item.is_published ? (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Published</span>
                  ) : (
                    <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">Draft</span>
                  )}
                  <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                    {item.submission_count ?? 0} Submissions
                  </span>
                </div>
                <p className="text-xs text-indigo-600 font-mono mb-1">/forms/{item.slug}</p>
                {item.description && (
                  <p className="text-sm text-gray-500 truncate mb-1">{item.description}</p>
                )}
                {item.created_at && (
                  <p className="text-xs text-gray-400">Posted: {new Date(item.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</p>
                )}
              </div>
              <div className="flex gap-2 flex-none items-center">
                <a
                  href={`/admin/forms/${item.id}/fields`}
                  className="text-sm text-indigo-600 hover:text-indigo-800 px-3 py-1.5 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
                >
                  Fields
                </a>
                <a
                  href={`/admin/forms/${item.id}/submissions`}
                  className="text-sm text-indigo-600 hover:text-indigo-800 px-3 py-1.5 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
                >
                  Submissions
                </a>
                <button
                  onClick={() => window.open(`/forms/${item.slug}`, '_blank')}
                  title="Preview"
                  className="text-gray-400 hover:text-indigo-600 p-1.5 rounded-lg hover:bg-indigo-50 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                </button>
                <button
                  onClick={() => openEdit(item)}
                  title="Edit"
                  className="text-gray-400 hover:text-indigo-600 p-1.5 rounded-lg hover:bg-indigo-50 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                </button>
                <button
                  onClick={() => handleDelete(item.id)}
                  title="Delete"
                  className="text-red-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>
            </div>
          ))}
          {forms.length === 0 && (
            <p className="text-gray-400 text-sm py-10 text-center">No forms yet. Click &quot;+ Create Form&quot; to get started.</p>
          )}
        </div>
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-lg mb-4">{editing ? 'Edit Form' : 'Create Form'}</h2>

            <label className="block text-sm font-medium text-gray-700 mb-1">Form Title <span className="text-red-500">*</span></label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
              placeholder="e.g. Customer Satisfaction Survey"
              value={form.title}
              onChange={e => handleTitleChange(e.target.value)}
            />

            <label className="block text-sm font-medium text-gray-700 mb-1">URL Slug</label>
            <div className="flex items-center border rounded-lg mb-3 overflow-hidden">
              <span className="text-sm text-gray-500 bg-gray-50 px-3 py-2 border-r">/forms/</span>
              <input
                className="flex-1 px-3 py-2 text-sm outline-none"
                value={form.slug}
                onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
              />
            </div>

            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3 resize-none"
              rows={2}
              placeholder="Brief description of this form"
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
            />

            <label className="block text-sm font-medium text-gray-700 mb-1">Success Message</label>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm mb-3 resize-none"
              rows={2}
              value={form.success_message}
              onChange={e => setForm({ ...form, success_message: e.target.value })}
            />

            <label className="block text-sm font-medium text-gray-700 mb-2">Storage Type</label>
            <div className="flex gap-4 mb-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="storage_type"
                  value="local"
                  checked={form.storage_type === 'local'}
                  onChange={() => setForm({ ...form, storage_type: 'local' })}
                />
                Local Database
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="storage_type"
                  value="remote"
                  checked={form.storage_type === 'remote'}
                  onChange={() => setForm({ ...form, storage_type: 'remote' })}
                />
                Remote API
              </label>
            </div>

            {form.storage_type === 'remote' && (
              <div className="border border-gray-200 rounded-lg p-3 mb-3 space-y-2 bg-gray-50">
                <label className="block text-sm font-medium text-gray-700 mb-1">API Server</label>
                <select
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                  value={form.api_server_id}
                  onChange={e => setForm({ ...form, api_server_id: e.target.value })}
                >
                  <option value="">Select API Server...</option>
                  {apiServers.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>

                <label className="block text-sm font-medium text-gray-700 mt-2">Create Method</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                  placeholder="POST /api/records"
                  value={form.api_method_create}
                  onChange={e => setForm({ ...form, api_method_create: e.target.value })}
                />

                <label className="block text-sm font-medium text-gray-700 mt-2">List Method</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                  placeholder="GET /api/records"
                  value={form.api_method_list}
                  onChange={e => setForm({ ...form, api_method_list: e.target.value })}
                />

                <label className="block text-sm font-medium text-gray-700 mt-2">Detail Method</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                  placeholder="GET /api/records/{id}"
                  value={form.api_method_detail}
                  onChange={e => setForm({ ...form, api_method_detail: e.target.value })}
                />

                <label className="block text-sm font-medium text-gray-700 mt-2">Update Method</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                  placeholder="PUT /api/records/{id}"
                  value={form.api_method_update}
                  onChange={e => setForm({ ...form, api_method_update: e.target.value })}
                />

                <label className="block text-sm font-medium text-gray-700 mt-2">Delete Method</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                  placeholder="DELETE /api/records/{id}"
                  value={form.api_method_delete}
                  onChange={e => setForm({ ...form, api_method_delete: e.target.value })}
                />
              </div>
            )}

            <div className="space-y-3 mb-4">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm font-medium text-gray-700">Publish Form</span>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, is_published: !form.is_published })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.is_published ? 'bg-blue-600' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.is_published ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </label>
              <div>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm font-medium text-gray-700">Require OTP Verification</span>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, require_otp: !form.require_otp })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.require_otp ? 'bg-blue-600' : 'bg-gray-300'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.require_otp ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </label>
                <p className="text-xs text-gray-400 mt-0.5 ml-0.5">Send OTP to submitter's email before finalizing submission</p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowModal(false); setEditing(null); }}
                className="flex-1 border rounded-lg px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!form.title}
                className="flex-1 bg-blue-600 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50 hover:bg-blue-700"
              >
                {editing ? 'Save Form' : 'Create Form'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
