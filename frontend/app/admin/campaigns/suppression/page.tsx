"use client";

import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

const REASON_COLORS: Record<string, string> = {
  unsubscribed: "bg-yellow-100 text-yellow-700",
  bounced: "bg-red-100 text-red-700",
  complaint: "bg-orange-100 text-orange-700",
};

export default function SuppressionListPage() {
  const user = authAPI.getUser();
  const token = getAuthToken();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [reasonFilter, setReasonFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: "50" });
      if (search) params.set("search", search);
      if (reasonFilter) params.set("reason", reasonFilter);
      const res = await axios.get(`${API_URL}/campaigns/suppression-list?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setItems(res.data.items);
      setTotal(res.data.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, search, reasonFilter, token]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handleRemove = async (id: number) => {
    if (!confirm("Remove this email from the suppression list? They will receive campaigns again.")) return;
    await axios.delete(`${API_URL}/campaigns/suppression-list/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchList();
  };

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-50 pb-16 md:pb-0">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Suppression List</h1>
            <p className="text-sm text-gray-500 mt-0.5">{total} suppressed email{total !== 1 ? "s" : ""}</p>
          </div>
          <a href="/admin/campaigns" className="text-sm text-blue-600 hover:underline">
            &larr; Back to Campaigns
          </a>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-4">
          <input
            type="text"
            placeholder="Search by email..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={reasonFilter}
            onChange={e => { setReasonFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All reasons</option>
            <option value="unsubscribed">Unsubscribed</option>
            <option value="bounced">Bounced</option>
            <option value="complaint">Complaint</option>
          </select>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-lg shadow text-center py-16 text-gray-400">
            No suppressed emails found.
          </div>
        ) : (
          <>
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    {["Email", "Reason", "Suppressed At", "Actions"].map(h => (
                      <th key={h} className="px-4 py-3 text-left font-medium text-gray-600">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((s: any) => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{s.email}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${REASON_COLORS[s.reason] || "bg-gray-100"}`}>
                          {s.reason}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {s.unsubscribed_at ? new Date(s.unsubscribed_at).toLocaleString() : "\u2014"}
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => handleRemove(s.id)} className="text-red-600 hover:underline text-sm">
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center gap-2 mt-4">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-gray-100"
                >
                  Previous
                </button>
                <span className="px-3 py-1.5 text-sm text-gray-600">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-gray-100"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
