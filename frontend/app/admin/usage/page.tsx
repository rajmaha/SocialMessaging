"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

interface UsageEvent {
  id: number;
  event_type: string;
  metadata: any;
  created_at: string;
  user_id?: number;
}

export default function UsageAnalytics() {
  const user = authAPI.getUser();
  const [events, setEvents] = useState<UsageEvent[]>([]);

  useEffect(() => {
    const token = getAuthToken();
    axios
      .get(`${API_URL}/billing/usage-events`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" },
      })
      .then((res) => setEvents(res.data))
      .catch(console.error);
  }, []);

  return (
    <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-50 pb-16 md:pb-0">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8">
        <h1 className="text-2xl font-semibold mb-6">Usage Analytics</h1>

        {events.length === 0 ? (
          <div className="text-center py-12 text-gray-400 border rounded bg-white">
            No usage events recorded yet.
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">ID</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Data</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">User</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {events.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500">{e.id}</td>
                    <td className="px-4 py-3 font-mono text-xs">{e.event_type}</td>
                    <td className="px-4 py-3 text-gray-500 max-w-xs truncate font-mono text-xs">
                      {JSON.stringify(e.metadata)}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{e.user_id ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(e.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}
      </main>
    </div>
  );
}
