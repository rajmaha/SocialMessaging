"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

const STATUS_COLORS: Record<string, string> = {
  draft:     "bg-gray-100 text-gray-600",
  scheduled: "bg-blue-100 text-blue-700",
  sending:   "bg-yellow-100 text-yellow-700",
  sent:      "bg-green-100 text-green-700",
  failed:    "bg-red-100 text-red-700",
};

export default function CampaignsPage() {
  const user = authAPI.getUser();
  const token = getAuthToken();
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCampaigns = async () => {
    try {
      const res = await axios.get(`${API_URL}/campaigns`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setCampaigns(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCampaigns(); }, []);

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this campaign?")) return;
    await axios.delete(`${API_URL}/campaigns/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchCampaigns();
  };

  const handleSend = async (id: number) => {
    if (!confirm("Send this campaign now to all matching leads?")) return;
    try {
      await axios.post(`${API_URL}/campaigns/${id}/send`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      alert("Campaign is sending!");
      fetchCampaigns();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to send");
    }
  };

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Email Campaigns</h1>
            <p className="text-sm text-gray-500 mt-0.5">{campaigns.length} total</p>
          </div>
          <div className="flex gap-3">
            <a
              href="/admin/campaigns/suppression"
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
            >
              Suppression List
            </a>
            <a
              href="/admin/campaigns/new"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
            >
              + New Campaign
            </a>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="bg-white rounded-lg shadow text-center py-16 text-gray-400">
            <p className="mb-2">No campaigns yet.</p>
            <a href="/admin/campaigns/new" className="text-blue-600 hover:underline text-sm">
              Create your first campaign
            </a>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {["Name", "Subject", "Status", "Sent", "Opened", "Open Rate", "Created", "Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-medium text-gray-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {campaigns.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                    <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{c.subject}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[c.status] || "bg-gray-100"}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.sent_count}</td>
                    <td className="px-4 py-3 text-gray-600">{c.opened_count}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {c.sent_count ? `${((c.opened_count / c.sent_count) * 100).toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{new Date(c.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 text-sm">
                        <a href={`/admin/campaigns/${c.id}`} className="text-blue-600 hover:underline">Stats</a>
                        <a href={`/admin/campaigns/${c.id}/edit`} className="text-amber-600 hover:underline">Edit</a>
                        {c.status === "draft" && (
                          <button onClick={() => handleSend(c.id)} className="text-green-600 hover:underline">Send</button>
                        )}
                        <button onClick={() => handleDelete(c.id)} className="text-red-600 hover:underline">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
