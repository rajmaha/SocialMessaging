"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

const DEVICE_ICONS: Record<string, string> = { desktop: "🖥️", mobile: "📱", tablet: "📟" };
const CLIENT_ICONS: Record<string, string> = { Gmail: "📧", Outlook: "📨", "Apple Mail": "🍎", Thunderbird: "🦅", "Yahoo Mail": "📬", Other: "✉️" };

function BreakdownBar({ label, count, total, icon }: { label: string; count: number; total: number; icon?: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-28 text-gray-600 truncate flex items-center gap-1.5">
        {icon && <span>{icon}</span>}
        {label}
      </span>
      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
        <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-14 text-right text-gray-500">{count} <span className="text-gray-300">({pct}%)</span></span>
    </div>
  );
}

function BreakdownCard({ title, data, icons }: { title: string; data: Record<string, number>; icons?: Record<string, string> }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return null;
  return (
    <div className="bg-white rounded-lg shadow p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      <div className="space-y-2.5">
        {sorted.map(([key, cnt]) => (
          <BreakdownBar key={key} label={key} count={cnt} total={total} icon={icons?.[key]} />
        ))}
      </div>
    </div>
  );
}

export default function CampaignStatsPage() {
  const user = authAPI.getUser();
  const { id } = useParams();
  const token = getAuthToken();
  const [campaign, setCampaign] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      axios.get(`${API_URL}/campaigns/${id}`, { headers: { Authorization: `Bearer ${token}` } }),
      axios.get(`${API_URL}/campaigns/${id}/stats`, { headers: { Authorization: `Bearer ${token}` } }),
    ]).then(([cRes, sRes]) => {
      setCampaign(cRes.data);
      setStats(sRes.data);
    }).catch(console.error).finally(() => setLoading(false));
  }, [id, token]);

  if (loading) return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
    </div>
  );

  const hasBreakdowns = stats && (
    Object.keys(stats.device_breakdown || {}).length > 0 ||
    Object.keys(stats.client_breakdown || {}).length > 0 ||
    Object.keys(stats.country_breakdown || {}).length > 0
  );

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8">
        <a href="/admin/campaigns" className="text-gray-400 hover:text-gray-600 text-sm">← Campaigns</a>
        <div className="flex justify-between items-start mt-2 mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">{campaign?.name}</h1>
            <p className="text-sm text-gray-500 mt-0.5">{campaign?.subject}</p>
          </div>
          <a href={`/admin/campaigns/${id}/edit`} className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 text-sm">Edit</a>
        </div>

        {/* Overview cards */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-5 text-center">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Sent</p>
            <p className="text-4xl font-bold text-gray-900 mt-1">{stats?.sent_count ?? 0}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-5 text-center">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Opened</p>
            <p className="text-4xl font-bold text-green-600 mt-1">{stats?.opened_count ?? 0}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-5 text-center">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Open Rate</p>
            <p className="text-4xl font-bold text-indigo-600 mt-1">{stats?.open_rate ?? 0}%</p>
            <p className="text-xs text-gray-400 mt-1">Pixel blocking may undercount</p>
          </div>
          <div className="bg-white rounded-lg shadow p-5 text-center">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Click Rate</p>
            <p className="text-4xl font-bold text-amber-600 mt-1">{stats?.click_rate ?? 0}%</p>
            <p className="text-xs text-gray-400 mt-1">{stats?.clicked_count ?? 0} clicked</p>
          </div>
        </div>

        {/* Engagement breakdowns */}
        {hasBreakdowns && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            <BreakdownCard
              title="📱 Device Type"
              data={stats.device_breakdown || {}}
              icons={DEVICE_ICONS}
            />
            <BreakdownCard
              title="✉️ Email Client"
              data={stats.client_breakdown || {}}
              icons={CLIENT_ICONS}
            />
            <BreakdownCard
              title="🌍 Top Countries"
              data={Object.fromEntries(
                Object.entries(stats.country_breakdown || {}).slice(0, 8)
              ) as Record<string, number>}
            />
          </div>
        )}

        {/* Top Links */}
        {stats?.top_links && stats.top_links.length > 0 && (
          <div className="bg-white rounded-lg shadow overflow-hidden mb-6">
            <div className="px-6 py-4 border-b">
              <h2 className="font-semibold text-gray-700">Top Links</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    {["URL", "Clicks", "First Click", "Last Click"].map(h => (
                      <th key={h} className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {stats.top_links.map((link: any, idx: number) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-700" title={link.url}>
                        <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
                          {link.url.length > 60 ? link.url.slice(0, 60) + "..." : link.url}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-gray-700 font-medium">{link.clicks}</td>
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                        {link.first_click ? new Date(link.first_click).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                        {link.last_click ? new Date(link.last_click).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Per-recipient table */}
        {stats?.recipients && stats.recipients.length > 0 ? (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b">
              <h2 className="font-semibold text-gray-700">Recipients</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    {["Name", "Email", "Sent At", "Opened", "Opens", "Clicked", "Location", "Device", "Client"].map(h => (
                      <th key={h} className="px-4 py-3 text-left font-medium text-gray-600 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {stats.recipients.map((r: any) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{r.name || "—"}</td>
                      <td className="px-4 py-3 text-gray-500">{r.email}</td>
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                        {r.sent_at ? new Date(r.sent_at).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {r.opened_at ? (
                          <span className="text-green-600 font-medium">
                            ✓ {new Date(r.opened_at).toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700 text-center">{r.open_count || 0}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {r.clicked_at ? (
                          <span className="text-amber-600 font-medium">
                            {new Date(r.clicked_at).toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {r.city && r.country ? `${r.city}, ${r.country}` : r.country || "—"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {r.device_type ? (
                          <span className="inline-flex items-center gap-1 text-gray-600">
                            {DEVICE_ICONS[r.device_type] || "💻"} {r.device_type}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {r.email_client ? (
                          <span className="inline-flex items-center gap-1 text-gray-600">
                            {CLIENT_ICONS[r.email_client] || "✉️"} {r.email_client}
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-400">
            <p className="text-4xl mb-3">📭</p>
            <p>No recipients yet. Send the campaign to see per-recipient stats.</p>
          </div>
        )}
      </main>
    </div>
  );
}
