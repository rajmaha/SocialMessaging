"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

const STAGE_COLORS: Record<string, string> = {
  prospect:    "border-blue-400",
  qualified:   "border-green-400",
  proposal:    "border-yellow-400",
  negotiation: "border-orange-400",
  close:       "border-purple-400",
  won:         "border-emerald-400",
  lost:        "border-red-400",
};

const SOURCE_ICONS: Record<string, string> = {
  conversation: "💬",
  email: "📧",
  website: "🌐",
  referral: "👤",
  other: "📌",
};

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-800",
  contacted: "bg-yellow-100 text-yellow-800",
  qualified: "bg-green-100 text-green-800",
  lost: "bg-red-100 text-red-800",
  converted: "bg-purple-100 text-purple-800",
};

export default function AnalyticsPage() {
  const user = authAPI.getUser();
  const token = getAuthToken();
  const [pipeline, setPipeline] = useState<any>(null);
  const [sources, setSources] = useState<any>(null);
  const [topLeads, setTopLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      axios.get(`${API_URL}/crm/analytics/pipeline-summary`, { headers: { Authorization: `Bearer ${token}` } }),
      axios.get(`${API_URL}/crm/analytics/lead-sources`, { headers: { Authorization: `Bearer ${token}` } }),
      axios.get(`${API_URL}/crm/analytics/lead-scoring?limit=10`, { headers: { Authorization: `Bearer ${token}` } }),
    ])
      .then(([pRes, sRes, tRes]) => {
        setPipeline(pRes.data);
        setSources(sRes.data);
        setTopLeads(tRes.data);
      })
      .catch((err) => console.error("Failed to load analytics", err))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="ml-60 pt-14 min-h-screen bg-gray-50">
        <MainHeader user={user!} />
        <AdminNav />
        <main className="w-full px-6 py-8 flex justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </main>
      </div>
    );
  }

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8 space-y-8">
        <h1 className="text-2xl font-semibold text-gray-900">CRM Analytics</h1>

        {/* Pipeline Summary */}
        <section>
          <h2 className="text-base font-semibold text-gray-700 mb-3">Pipeline by Stage</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {pipeline && Object.keys(pipeline).map((stage) => (
              <div
                key={stage}
                className={`bg-white rounded-lg shadow p-4 border-t-4 ${STAGE_COLORS[stage] || "border-gray-300"}`}
              >
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{stage}</p>
                <p className="text-2xl font-bold text-gray-900">{pipeline[stage].count}</p>
                <p className="text-sm text-gray-600 mt-1">
                  ${pipeline[stage].total_amount.toLocaleString()}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {pipeline[stage].avg_probability.toFixed(0)}% avg
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Leads by Source */}
        <section>
          <h2 className="text-base font-semibold text-gray-700 mb-3">Leads by Source</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {sources && Object.keys(sources).map((src) => (
              <div key={src} className="bg-white rounded-lg shadow p-4 flex items-center gap-3">
                <span className="text-2xl">{SOURCE_ICONS[src] || "📌"}</span>
                <div>
                  <p className="text-xs text-gray-500 capitalize">{src}</p>
                  <p className="text-xl font-bold text-gray-900">{sources[src]}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Top Leads */}
        <section>
          <h2 className="text-base font-semibold text-gray-700 mb-3">Top Leads by Score</h2>
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Score</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Est. Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {topLeads.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{l.name}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 rounded-full h-1.5 w-16">
                          <div
                            className="bg-blue-500 h-1.5 rounded-full"
                            style={{ width: `${Math.min(l.score, 100)}%` }}
                          />
                        </div>
                        <span className="text-gray-700 font-medium">{l.score}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[l.status] || "bg-gray-100 text-gray-800"}`}>
                        {l.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {l.estimated_value ? `$${Number(l.estimated_value).toLocaleString()}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
