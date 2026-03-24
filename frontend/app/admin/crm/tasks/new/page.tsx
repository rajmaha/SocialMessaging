"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

export default function NewTaskPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>}>
      <NewTaskPageContent />
    </Suspense>
  );
}

function NewTaskPageContent() {
  const user = authAPI.getUser();
  const router = useRouter();
  const params = useSearchParams();
  const token = getAuthToken();

  const [form, setForm] = useState<any>({
    lead_id: params?.get("lead_id") || "",
    deal_id: params?.get("deal_id") || "",
    title: "",
    description: "",
    status: "open",
    due_date: "",
  });
  const [leads, setLeads] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      axios.get(`${API_URL}/crm/leads`, { headers: { Authorization: `Bearer ${token}` } }),
      axios.get(`${API_URL}/crm/deals`, { headers: { Authorization: `Bearer ${token}` } }),
    ])
      .then(([lres, dres]) => { setLeads(lres.data); setDeals(dres.data); })
      .catch(() => {});
  }, [token]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const payload = {
        ...form,
        lead_id: form.lead_id ? Number(form.lead_id) : undefined,
        deal_id: form.deal_id ? Number(form.deal_id) : null,
        due_date: form.due_date || null,
        description: form.description || null,
      };
      await axios.post(`${API_URL}/crm/tasks`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      router.push("/admin/crm/tasks");
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to create task");
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm";
  const labelClass = "block text-sm font-medium text-gray-700 mb-1";

  return (
    <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-50 pb-16 md:pb-0">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8">
        <div className="mb-6 flex items-center gap-3">
          <a href="/admin/crm/tasks" className="text-gray-400 hover:text-gray-600 text-sm">← Tasks</a>
          <h1 className="text-2xl font-semibold text-gray-900">New Task</h1>
        </div>

        <div className="max-w-2xl">
          <div className="bg-white rounded-lg shadow p-6">
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
            )}
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Lead *</label>
                  <select name="lead_id" value={form.lead_id} onChange={handleChange} required className={inputClass}>
                    <option value="">— select a lead —</option>
                    {leads.map((l) => (
                      <option key={l.id} value={l.id}>{l.first_name} {l.last_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Deal (optional)</label>
                  <select name="deal_id" value={form.deal_id} onChange={handleChange} className={inputClass}>
                    <option value="">— none —</option>
                    {deals.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className={labelClass}>Title *</label>
                <input name="title" value={form.title} onChange={handleChange} required className={inputClass} placeholder="e.g. Follow up call" />
              </div>

              <div>
                <label className={labelClass}>Description</label>
                <textarea name="description" value={form.description} onChange={handleChange} rows={3} className={inputClass} placeholder="Optional details…" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Status</label>
                  <select name="status" value={form.status} onChange={handleChange} className={inputClass}>
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Due date</label>
                  <input name="due_date" type="date" value={form.due_date} onChange={handleChange} className={inputClass} />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <a
                  href="/admin/crm/tasks"
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
                >
                  Cancel
                </a>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                >
                  {loading ? "Saving…" : "Create Task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
