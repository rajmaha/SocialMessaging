"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

const STAGE_COLORS: Record<string, string> = {
  prospect:    "bg-blue-100 text-blue-800",
  qualified:   "bg-green-100 text-green-800",
  proposal:    "bg-yellow-100 text-yellow-800",
  negotiation: "bg-orange-100 text-orange-800",
  close:       "bg-purple-100 text-purple-800",
  won:         "bg-emerald-100 text-emerald-800",
  lost:        "bg-red-100 text-red-800",
};

const TASK_COLORS: Record<string, string> = {
  open:        "bg-red-100 text-red-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  completed:   "bg-green-100 text-green-700",
  cancelled:   "bg-gray-100 text-gray-700",
};

const STAGES = ["prospect", "qualified", "proposal", "negotiation", "close", "won", "lost"];

export default function DealDetailPage() {
  const user = authAPI.getUser();
  const { id } = useParams();
  const router = useRouter();
  const token = getAuthToken();

  const [deal, setDeal] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stageDropdown, setStageDropdown] = useState<string>("");

  useEffect(() => {
    if (!id) return;
    const fetchDeal = async () => {
      setLoading(true);
      try {
        const res = await axios.get(`${API_URL}/crm/deals/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setDeal(res.data);
        setStageDropdown(res.data.stage);
      } catch (err: any) {
        if (err.response?.status === 404) { router.push("/admin/crm/deals"); return; }
        setError(err.response?.data?.detail || "Failed to load deal");
      } finally {
        setLoading(false);
      }
    };
    fetchDeal();
  }, [id, router, token]);

  const handleStageChange = async (newStage: string) => {
    try {
      await axios.patch(`${API_URL}/crm/deals/${id}`, { stage: newStage }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setDeal({ ...deal, stage: newStage });
      setStageDropdown(newStage);
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to update stage");
    }
  };

  if (loading) {
    return (
      <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-50 flex items-center justify-center pb-16 md:pb-0">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (error || !deal) {
    return (
      <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-50 pb-16 md:pb-0">
        <MainHeader user={user!} />
        <AdminNav />
        <main className="w-full px-6 py-8">
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>
        </main>
      </div>
    );
  }

  const expectedValue = (deal.amount || 0) * (deal.probability / 100);

  return (
    <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-50 pb-16 md:pb-0">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8">
        {/* Header */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <a href="/admin/crm/deals" className="text-gray-400 hover:text-gray-600 text-sm">← Pipeline</a>
            <h1 className="text-2xl font-semibold text-gray-900 mt-1">{deal.name}</h1>
            <span className="text-sm text-gray-500">Deal #{deal.id}</span>
          </div>
          <div className="flex gap-2">
            <a
              href={`/admin/crm/deals/${deal.id}/edit`}
              className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 text-sm font-medium"
            >
              Edit
            </a>
            <button
              onClick={async () => {
                if (!confirm("Delete this deal?")) return;
                try {
                  await axios.delete(`${API_URL}/crm/deals/${id}`, { headers: { Authorization: `Bearer ${token}` } });
                  router.push("/admin/crm/deals");
                } catch (err: any) {
                  alert(err.response?.data?.detail || "Failed to delete deal");
                }
              }}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium"
            >
              Delete
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {/* Main */}
          <div className="col-span-2 space-y-6">
            {/* Stats */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                <div className="text-center p-4 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500 mb-1">Amount</p>
                  <p className="text-2xl font-bold text-gray-900">${(deal.amount || 0).toLocaleString()}</p>
                </div>
                <div className="text-center p-4 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500 mb-1">Probability</p>
                  <p className="text-2xl font-bold text-gray-900">{deal.probability}%</p>
                </div>
                <div className="text-center p-4 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500 mb-1">Expected Value</p>
                  <p className="text-2xl font-bold text-green-700">${expectedValue.toLocaleString()}</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Stage</label>
                <select
                  value={stageDropdown}
                  onChange={(e) => handleStageChange(e.target.value)}
                  className={`px-4 py-2 rounded-lg font-semibold text-sm border-0 ${STAGE_COLORS[stageDropdown] || "bg-gray-100"}`}
                >
                  {STAGES.map((s) => (
                    <option key={s} value={s} className="bg-white text-black">
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Linked Lead */}
            {deal.lead && (
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-base font-semibold text-gray-800 mb-3">Linked Lead</h2>
                <div className="border-l-4 border-blue-500 pl-4 py-1">
                  <a href={`/admin/crm/leads/${deal.lead.id}`} className="font-medium text-blue-600 hover:underline">
                    {deal.lead.first_name} {deal.lead.last_name}
                  </a>
                  <p className="text-sm text-gray-500">{deal.lead.email || "—"}</p>
                  <p className="text-sm text-gray-500">{deal.lead.company || "—"}</p>
                </div>
              </div>
            )}

            {/* Tasks */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-base font-semibold text-gray-800">Tasks</h2>
                <a
                  href={`/admin/crm/tasks/new?deal_id=${deal.id}&lead_id=${deal.lead_id}`}
                  className="px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-xs font-medium"
                >
                  + Add Task
                </a>
              </div>
              {deal.tasks && deal.tasks.length > 0 ? (
                <div className="space-y-2">
                  {deal.tasks.map((t: any) => (
                    <div key={t.id} className="flex justify-between items-center p-3 border rounded-lg hover:bg-gray-50">
                      <span className="text-sm text-gray-800">{t.title}</span>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${TASK_COLORS[t.status] || "bg-gray-100 text-gray-700"}`}>
                        {t.status.replace("_", " ")}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-400 text-sm">No tasks yet.</p>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="col-span-1 space-y-6">
            <div className="bg-white rounded-lg shadow p-5">
              <h3 className="font-semibold text-gray-800 mb-4">Details</h3>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Created</dt>
                  <dd className="mt-0.5 text-gray-800">{new Date(deal.created_at).toLocaleDateString()}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Updated</dt>
                  <dd className="mt-0.5 text-gray-800">{new Date(deal.updated_at).toLocaleDateString()}</dd>
                </div>
                {deal.expected_close_date && (
                  <div>
                    <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Expected Close</dt>
                    <dd className="mt-0.5 text-gray-800">{new Date(deal.expected_close_date).toLocaleDateString()}</dd>
                  </div>
                )}
              </dl>
            </div>

            {deal.activities && deal.activities.length > 0 && (
              <div className="bg-white rounded-lg shadow p-5">
                <h3 className="font-semibold text-gray-800 mb-4">Activity</h3>
                <ul className="space-y-3 max-h-96 overflow-y-auto">
                  {deal.activities.map((a: any) => (
                    <li key={a.id} className="border-b pb-3">
                      <p className="text-sm font-medium text-gray-800">{a.title}</p>
                      {a.description && <p className="text-xs text-gray-600 mt-0.5">{a.description}</p>}
                      <p className="text-xs text-gray-400 mt-1">{new Date(a.created_at).toLocaleString()}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
