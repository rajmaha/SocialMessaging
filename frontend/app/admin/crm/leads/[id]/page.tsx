"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-800",
  contacted: "bg-yellow-100 text-yellow-800",
  qualified: "bg-green-100 text-green-800",
  lost: "bg-red-100 text-red-800",
  converted: "bg-purple-100 text-purple-800",
};

const TASK_STATUS_COLORS: Record<string, string> = {
  open: "bg-red-100 text-red-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-gray-100 text-gray-700",
};

export default function LeadDetailPage() {
  const user = authAPI.getUser();
  const { id } = useParams();
  const router = useRouter();
  const token = getAuthToken();

  const [lead, setLead] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [activityForm, setActivityForm] = useState({ type: "note", title: "", description: "" });
  const [activityLoading, setActivityLoading] = useState(false);

  const handleStatusChange = async (newStatus: string) => {
    try {
      await axios.patch(`${API_URL}/crm/leads/${id}`, { status: newStatus }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLead({ ...lead, status: newStatus });
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to update status");
    }
  };

  const handleLogActivity = async () => {
    if (!activityForm.title.trim()) return;
    setActivityLoading(true);
    try {
      await axios.post(
        `${API_URL}/crm/activities/${id}`,
        activityForm,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      // Reload the lead to refresh the activity timeline
      const res = await axios.get(`${API_URL}/crm/leads/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      setLead(res.data);
      setShowActivityModal(false);
      setActivityForm({ type: "note", title: "", description: "" });
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to log activity");
    } finally {
      setActivityLoading(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    const fetchLead = async () => {
      setLoading(true);
      try {
        const res = await axios.get(`${API_URL}/crm/leads/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setLead(res.data);
      } catch (err: any) {
        if (err.response?.status === 404) { router.push("/admin/crm/leads"); return; }
        setError(err.response?.data?.detail || "Failed to load lead");
      } finally {
        setLoading(false);
      }
    };
    fetchLead();
  }, [id, router, token]);

  if (loading) {
    return (
      <div className="ml-60 pt-14 min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="ml-60 pt-14 min-h-screen bg-gray-50">
        <MainHeader user={user!} />
        <AdminNav />
        <main className="w-full px-6 py-8">
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>
        </main>
      </div>
    );
  }

  if (!lead) return null;

  const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div>
      <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900">{value || "—"}</dd>
    </div>
  );

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8">
        {/* Header */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <a href="/admin/crm/leads" className="text-gray-400 hover:text-gray-600 text-sm">← Leads</a>
            <h1 className="text-2xl font-semibold text-gray-900 mt-1">
              {lead.first_name} {lead.last_name}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <select
                value={lead.status}
                onChange={e => handleStatusChange(e.target.value)}
                className={`px-2 py-0.5 rounded-full text-xs font-semibold border-0 cursor-pointer ${STATUS_COLORS[lead.status] || "bg-gray-100 text-gray-800"}`}
              >
                {["new","contacted","qualified","lost","converted"].map(s => (
                  <option key={s} value={s} className="bg-white text-black">{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
              <span className="text-sm text-gray-500">Score: {lead.score}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowActivityModal(true)}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
            >
              + Log Activity
            </button>
            <a
              href={`/admin/crm/deals/new?lead_id=${lead.id}`}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
            >
              + Add Deal
            </a>
            <a
              href={`/admin/crm/leads/${lead.id}/edit`}
              className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 text-sm font-medium"
            >
              Edit
            </a>
            <button
              onClick={async () => {
                if (!confirm("Are you sure you want to delete this lead?")) return;
                try {
                  await axios.delete(`${API_URL}/crm/leads/${lead.id}`, { headers: { Authorization: `Bearer ${token}` } });
                  router.push("/admin/crm/leads");
                } catch (err: any) {
                  alert(err.response?.data?.detail || "Failed to delete lead");
                }
              }}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium"
            >
              Delete
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Main */}
          <div className="col-span-2 space-y-6">
            {/* Contact Info */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-base font-semibold text-gray-800 mb-4">Contact Information</h2>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                <Field label="Email" value={lead.email} />
                <Field label="Phone" value={lead.phone} />
                <Field label="Company" value={lead.company} />
                <Field label="Position" value={lead.position} />
                <Field label="Source" value={lead.source} />
                <Field label="Created" value={new Date(lead.created_at).toLocaleDateString()} />
              </dl>
            </div>

            {/* Deals */}
            {lead.deals && lead.deals.length > 0 && (
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-base font-semibold text-gray-800 mb-4">Deals</h2>
                <div className="space-y-2">
                  {lead.deals.map((d: any) => (
                    <div key={d.id} className="flex justify-between items-center p-3 border rounded-lg hover:bg-gray-50">
                      <div>
                        <p className="font-medium text-sm">{d.name}</p>
                        <p className="text-xs text-gray-500">{d.stage} · ${(d.amount || 0).toLocaleString()}</p>
                      </div>
                      <a href={`/admin/crm/deals/${d.id}`} className="text-blue-600 hover:underline text-sm">View</a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tasks */}
            {lead.tasks && (
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-base font-semibold text-gray-800">Tasks</h2>
                  <a
                    href={`/admin/crm/tasks/new?lead_id=${lead.id}`}
                    className="px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-xs font-medium"
                  >
                    + Add Task
                  </a>
                </div>
                {lead.tasks.length === 0 ? (
                  <p className="text-gray-400 text-sm">No tasks yet.</p>
                ) : (
                  <div className="space-y-2">
                    {lead.tasks.map((t: any) => (
                      <div key={t.id} className="flex justify-between items-center p-3 border rounded-lg">
                        <span className="text-sm">{t.title}</span>
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${TASK_STATUS_COLORS[t.status] || "bg-gray-100 text-gray-700"}`}>
                          {t.status.replace("_", " ")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sidebar: Activity */}
          <div className="col-span-1">
            <div className="bg-white rounded-lg shadow p-5">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-gray-800">Activity Timeline</h3>
                <button
                  onClick={() => setShowActivityModal(true)}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                >
                  + Log
                </button>
              </div>
              {lead.activities && lead.activities.length > 0 ? (
                <ul className="space-y-3 max-h-[500px] overflow-y-auto">
                  {lead.activities.map((act: any) => (
                    <li key={act.id} className="border-b pb-3 last:border-0">
                      <div className="flex justify-between items-start gap-2">
                        <p className="text-sm font-medium text-gray-800">{act.title}</p>
                        <span className="text-xs text-gray-400 shrink-0">{new Date(act.created_at).toLocaleDateString()}</span>
                      </div>
                      {act.description && <p className="text-xs text-gray-600 mt-1">{act.description}</p>}
                      <span className="text-xs text-blue-400 capitalize">{act.type.replace("_", " ")}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-400">No activities yet.</p>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Log Activity Modal */}
      {showActivityModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowActivityModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Log Activity</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={activityForm.type}
                  onChange={e => setActivityForm({ ...activityForm, type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  {["call","email","meeting","message","note"].map(t => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <input
                  type="text"
                  placeholder="e.g. Called to discuss proposal"
                  value={activityForm.title}
                  onChange={e => setActivityForm({ ...activityForm, title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  placeholder="Optional notes…"
                  value={activityForm.description}
                  onChange={e => setActivityForm({ ...activityForm, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowActivityModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button
                onClick={handleLogActivity}
                disabled={!activityForm.title.trim() || activityLoading}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {activityLoading ? "Saving…" : "Log Activity"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
