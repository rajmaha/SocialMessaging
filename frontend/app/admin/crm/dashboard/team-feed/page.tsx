"use client";
import { useState, useEffect } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";

interface ActivityItem {
  id: number;
  type: string;
  title: string;
  description?: string;
  lead_id: number;
  lead_name: string;
  created_by?: number;
  created_by_name?: string;
  created_at: string;
}

interface TeamFeedData {
  recent_activity: ActivityItem[];
  stats: {
    total_open_leads: number;
    total_pipeline_value: number;
    deals_won_this_week: number;
    team_activities_this_week: number;
  };
}

const ACTIVITY_ICONS: Record<string, string> = {
  call: "\u{1F4DE}", email: "\u{1F4E7}", meeting: "\u{1F4C5}", message: "\u{1F4AC}",
  note: "\u{1F4DD}", task_created: "\u2705", deal_stage_change: "\u{1F4CA}",
};

export default function TeamFeedPage() {
  const [data, setData] = useState<TeamFeedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const token = getAuthToken();

  useEffect(() => {
    fetchTeamFeed();
  }, []);

  const fetchTeamFeed = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API_URL}/crm/dashboard/team-feed`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(res.data);
    } catch {
      setError("Failed to load team feed");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-400">Loading team feed...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <div className="text-red-500">{error}</div>
        <button onClick={fetchTeamFeed} className="text-blue-600 hover:underline">Retry</button>
      </div>
    );
  }

  const { stats } = data;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">Team Feed</h1>

        {/* Team Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="p-4 rounded-xl border bg-blue-50 text-blue-700 border-blue-100">
            <div className="text-2xl font-bold">{stats.total_open_leads}</div>
            <div className="text-xs mt-1 opacity-70">Total Open Leads</div>
          </div>
          <div className="p-4 rounded-xl border bg-green-50 text-green-700 border-green-100">
            <div className="text-2xl font-bold">${stats.total_pipeline_value.toLocaleString()}</div>
            <div className="text-xs mt-1 opacity-70">Pipeline Value</div>
          </div>
          <div className="p-4 rounded-xl border bg-purple-50 text-purple-700 border-purple-100">
            <div className="text-2xl font-bold">{stats.deals_won_this_week}</div>
            <div className="text-xs mt-1 opacity-70">Deals Won This Week</div>
          </div>
          <div className="p-4 rounded-xl border bg-orange-50 text-orange-700 border-orange-100">
            <div className="text-2xl font-bold">{stats.team_activities_this_week}</div>
            <div className="text-xs mt-1 opacity-70">Activities This Week</div>
          </div>
        </div>

        {/* Activity Feed */}
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Recent Team Activity</h2>
          {data.recent_activity.length === 0 ? (
            <div className="text-sm text-gray-400 py-8 text-center">No team activity in the last 7 days</div>
          ) : (
            <div className="space-y-2">
              {data.recent_activity.map((act) => (
                <div
                  key={act.id}
                  onClick={() => router.push(`/admin/crm/leads/${act.lead_id}`)}
                  className="flex gap-3 p-3 bg-white rounded-lg border hover:border-blue-300 cursor-pointer transition"
                >
                  <span className="text-lg">{ACTIVITY_ICONS[act.type] || "\u{1F4CC}"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{act.title}</div>
                    {act.description && <div className="text-xs text-gray-400 truncate mt-0.5">{act.description}</div>}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-blue-600">{act.lead_name}</span>
                      {act.created_by_name && (
                        <span className="text-xs text-gray-400">by {act.created_by_name}</span>
                      )}
                      <span className="text-xs text-gray-300">
                        {new Date(act.created_at).toLocaleDateString()} {new Date(act.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
