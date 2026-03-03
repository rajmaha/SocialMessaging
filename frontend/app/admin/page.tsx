"use client";

import { useState, useEffect, useCallback } from "react";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

const STAGE_COLORS: Record<string, string> = {
  prospect:    "bg-blue-100 text-blue-700",
  qualified:   "bg-cyan-100 text-cyan-700",
  proposal:    "bg-yellow-100 text-yellow-700",
  negotiation: "bg-orange-100 text-orange-700",
  close:       "bg-purple-100 text-purple-700",
  won:         "bg-green-100 text-green-700",
  lost:        "bg-red-100 text-red-700",
};

function KpiCard({ label, value, sub, color = "blue" }: { label: string; value: string | number; sub?: string; color?: string }) {
  const colors: Record<string, string> = {
    blue:   "border-blue-500   bg-blue-50   text-blue-900",
    green:  "border-green-500  bg-green-50  text-green-900",
    amber:  "border-amber-500  bg-amber-50  text-amber-900",
    purple: "border-purple-500 bg-purple-50 text-purple-900",
    red:    "border-red-500    bg-red-50    text-red-900",
  };
  const cls = colors[color] || colors.blue;
  return (
    <div className={`rounded-xl border-t-4 p-5 shadow-sm ${cls}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-60">{label}</p>
      <p className="text-3xl font-bold mt-1">{value ?? "—"}</p>
      {sub && <p className="text-xs mt-1 opacity-50">{sub}</p>}
    </div>
  );
}

export default function AdminDashboard() {
  const user = authAPI.getUser();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_URL}/reports/dashboard-summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setData(await res.json());
        setLastUpdated(new Date());
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const conv = data?.conversations;
  const crm = data?.crm;
  const leaderboard = data?.leaderboard ?? [];

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8 space-y-8">

        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Executive Dashboard</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Loading…"} · auto-refreshes every 30s
            </p>
          </div>
          <button
            onClick={fetchData}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-100 text-gray-600"
          >
            ↻ Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-24">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
          </div>
        ) : (
          <>
            {/* Messaging KPIs */}
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-widest mb-3">Conversations</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <KpiCard label="Today" value={conv?.total_today ?? 0} color="blue" />
                <KpiCard label="Open" value={conv?.open ?? 0} color="amber" />
                <KpiCard label="Pending" value={conv?.pending ?? 0} color="amber" />
                <KpiCard label="Resolved" value={conv?.resolved ?? 0} color="green" />
                <KpiCard
                  label="Avg Response"
                  value={conv?.avg_response_min != null ? `${conv.avg_response_min}m` : "—"}
                  color="blue"
                />
                <KpiCard
                  label="Avg Rating"
                  value={conv?.avg_rating != null ? `${conv.avg_rating} ★` : "—"}
                  color="purple"
                />
              </div>
            </section>

            {/* CRM KPIs */}
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-widest mb-3">CRM</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KpiCard label="New Leads (7d)" value={crm?.new_leads_week ?? 0} color="blue" />
                <KpiCard label="Total Leads" value={crm?.total_leads ?? 0} color="blue" />
                <KpiCard
                  label="Pipeline Value"
                  value={crm?.pipeline_value != null ? `$${Number(crm.pipeline_value).toLocaleString()}` : "—"}
                  color="green"
                />
                <KpiCard label="Win Rate" value={crm?.win_rate != null ? `${crm.win_rate}%` : "—"} color="purple" />
              </div>
            </section>

            {/* Pipeline by Stage + Agent Leaderboard */}
            <div className="grid grid-cols-3 gap-6">
              {/* Pipeline */}
              <div className="col-span-2 bg-white rounded-xl shadow p-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Pipeline by Stage</h2>
                <div className="space-y-2">
                  {crm?.pipeline_by_stage && Object.entries(crm.pipeline_by_stage).map(([stage, info]: [string, any]) => (
                    <div key={stage} className="flex items-center gap-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STAGE_COLORS[stage] || "bg-gray-100 text-gray-600"}`} style={{ minWidth: 90, textAlign: "center" }}>
                        {stage}
                      </span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div
                          className="bg-indigo-500 h-2 rounded-full transition-all"
                          style={{ width: `${Math.min((info.count / Math.max(crm.total_leads, 1)) * 100, 100)}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium text-gray-700 w-6 text-right">{info.count}</span>
                      <span className="text-xs text-gray-400 w-20 text-right">${info.value.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Agent Leaderboard */}
              <div className="bg-white rounded-xl shadow p-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Agent Leaderboard (today)</h2>
                {leaderboard.length === 0 ? (
                  <p className="text-gray-400 text-sm">No resolved conversations today.</p>
                ) : (
                  <ol className="space-y-3">
                    {leaderboard.map((agent: any, i: number) => (
                      <li key={agent.id} className="flex items-center gap-3">
                        <span className={`text-sm font-bold w-6 ${i === 0 ? "text-yellow-500" : i === 1 ? "text-gray-400" : i === 2 ? "text-amber-600" : "text-gray-300"}`}>
                          #{i + 1}
                        </span>
                        <span className="flex-1 text-sm text-gray-800 truncate">{agent.name}</span>
                        <span className="text-sm font-semibold text-indigo-600">{agent.resolved_today}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>

            {/* Quick links */}
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-widest mb-3">Quick Links</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { href: "/admin/reports", label: "Full Reports", icon: "📊" },
                  { href: "/admin/crm/leads", label: "Leads", icon: "👥" },
                  { href: "/admin/crm/analytics", label: "CRM Analytics", icon: "📈" },
                  { href: "/admin/users", label: "Manage Users", icon: "👤" },
                ].map(link => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="flex items-center gap-2 bg-white rounded-lg shadow px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
                  >
                    <span className="text-lg">{link.icon}</span>
                    {link.label}
                  </a>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
