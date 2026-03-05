"use client";
import { useState, useEffect } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

interface TaskItem {
  id: number;
  title: string;
  due_date: string | null;
  lead_id: number;
  status: string;
}

interface StaleLead {
  id: number;
  first_name: string;
  last_name?: string;
  company?: string;
  status: string;
  score: number;
}

interface DealItem {
  id: number;
  name: string;
  stage: string;
  amount?: number;
  probability?: number;
  expected_close_date?: string;
}

interface ActivityItem {
  id: number;
  type: string;
  title: string;
  description?: string;
  lead_id: number;
  created_at: string;
}

interface MyDayData {
  overdue_tasks: TaskItem[];
  today_tasks: TaskItem[];
  stale_leads: StaleLead[];
  deals_closing_soon: DealItem[];
  recent_activity: ActivityItem[];
  stats: {
    open_leads_count: number;
    pipeline_value: number;
    tasks_completed_today: number;
    conversations_active: number;
  };
}

const ACTIVITY_ICONS: Record<string, string> = {
  call: "📞", email: "📧", meeting: "📅", message: "💬",
  note: "📝", task_created: "✅", deal_stage_change: "📊",
};

const STAGE_COLORS: Record<string, string> = {
  prospect: "bg-gray-100 text-gray-700",
  qualified: "bg-blue-100 text-blue-700",
  proposal: "bg-indigo-100 text-indigo-700",
  negotiation: "bg-yellow-100 text-yellow-700",
  close: "bg-orange-100 text-orange-700",
  won: "bg-green-100 text-green-700",
  lost: "bg-red-100 text-red-700",
};

export default function MyDayPage() {
  const [data, setData] = useState<MyDayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const user = authAPI.getUser();
  const token = getAuthToken();

  useEffect(() => {
    fetchMyDay();
  }, []);

  const fetchMyDay = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API_URL}/crm/dashboard/my-day`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(res.data);
    } catch {
      setError("Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="ml-60 pt-14 min-h-screen bg-gray-50">
        {user && <MainHeader user={user} />}
        <AdminNav />
        <div className="flex items-center justify-center h-96">
          <div className="text-gray-400">Loading your day...</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="ml-60 pt-14 min-h-screen bg-gray-50">
        {user && <MainHeader user={user} />}
        <AdminNav />
        <div className="flex flex-col items-center justify-center h-96 gap-4">
          <div className="text-red-500">{error}</div>
          <button onClick={fetchMyDay} className="text-blue-600 hover:underline">Retry</button>
        </div>
      </div>
    );
  }

  const { stats } = data;

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      {user && <MainHeader user={user} />}
      <AdminNav />
      <main className="w-full px-6 py-8">
        <h1 className="text-2xl font-semibold text-gray-900 mb-6">My Day</h1>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="Open Leads" value={stats.open_leads_count} color="blue" />
          <StatCard label="Pipeline Value" value={`$${stats.pipeline_value.toLocaleString()}`} color="green" />
          <StatCard label="Tasks Done Today" value={stats.tasks_completed_today} color="purple" />
          <StatCard label="Active Conversations" value={stats.conversations_active} color="orange" />
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Action Items */}
          <div className="space-y-6">
            {/* Overdue Tasks */}
            <Section title="Overdue Tasks" count={data.overdue_tasks.length} color="red">
              {data.overdue_tasks.length === 0 ? (
                <EmptyState text="No overdue tasks" />
              ) : (
                data.overdue_tasks.map((task) => (
                  <div
                    key={task.id}
                    onClick={() => router.push(`/admin/crm/leads/${task.lead_id}`)}
                    className="p-3 bg-white rounded-lg border border-red-100 hover:border-red-300 cursor-pointer transition"
                  >
                    <div className="text-sm font-medium">{task.title}</div>
                    {task.due_date && (
                      <div className="text-xs text-red-500 mt-1">
                        Due: {new Date(task.due_date).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                ))
              )}
            </Section>

            {/* Today's Tasks */}
            <Section title="Today's Tasks" count={data.today_tasks.length} color="blue">
              {data.today_tasks.length === 0 ? (
                <EmptyState text="No tasks for today" />
              ) : (
                data.today_tasks.map((task) => (
                  <div
                    key={task.id}
                    onClick={() => router.push(`/admin/crm/leads/${task.lead_id}`)}
                    className="p-3 bg-white rounded-lg border hover:border-blue-300 cursor-pointer transition"
                  >
                    <div className="text-sm font-medium">{task.title}</div>
                    <div className="text-xs text-gray-400 mt-1">{task.status}</div>
                  </div>
                ))
              )}
            </Section>

            {/* Stale Leads */}
            <Section title="Stale Leads" count={data.stale_leads.length} color="amber">
              {data.stale_leads.length === 0 ? (
                <EmptyState text="No stale leads" />
              ) : (
                data.stale_leads.map((lead) => (
                  <div
                    key={lead.id}
                    onClick={() => router.push(`/admin/crm/leads/${lead.id}`)}
                    className="p-3 bg-white rounded-lg border border-amber-100 hover:border-amber-300 cursor-pointer transition flex justify-between items-center"
                  >
                    <div>
                      <div className="text-sm font-medium">{lead.first_name} {lead.last_name}</div>
                      {lead.company && <div className="text-xs text-gray-400">{lead.company}</div>}
                    </div>
                    <span className="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded">No activity 7d+</span>
                  </div>
                ))
              )}
            </Section>
          </div>

          {/* Right: Pipeline Watch + Activity */}
          <div className="space-y-6">
            {/* Deals Closing Soon */}
            <Section title="Deals Closing Soon" count={data.deals_closing_soon.length} color="indigo">
              {data.deals_closing_soon.length === 0 ? (
                <EmptyState text="No deals closing soon" />
              ) : (
                data.deals_closing_soon.map((deal) => (
                  <div
                    key={deal.id}
                    onClick={() => router.push(`/admin/crm/deals/${deal.id}`)}
                    className="p-3 bg-white rounded-lg border hover:border-indigo-300 cursor-pointer transition"
                  >
                    <div className="text-sm font-medium">{deal.name}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${STAGE_COLORS[deal.stage] || "bg-gray-100"}`}>
                        {deal.stage}
                      </span>
                      {deal.amount && <span className="text-xs text-gray-500">${deal.amount.toLocaleString()}</span>}
                      {deal.expected_close_date && (
                        <span className="text-xs text-gray-400">
                          Closes: {new Date(deal.expected_close_date).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </Section>

            {/* Recent Activity */}
            <Section title="Recent Activity" count={data.recent_activity.length} color="gray">
              {data.recent_activity.length === 0 ? (
                <EmptyState text="No recent activity" />
              ) : (
                data.recent_activity.map((act) => (
                  <div
                    key={act.id}
                    onClick={() => router.push(`/admin/crm/leads/${act.lead_id}`)}
                    className="flex gap-2 p-2 bg-white rounded border hover:border-gray-300 cursor-pointer transition"
                  >
                    <span className="text-sm">{ACTIVITY_ICONS[act.type] || "📌"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{act.title}</div>
                      {act.description && <div className="text-xs text-gray-400 truncate">{act.description}</div>}
                      <div className="text-xs text-gray-300 mt-0.5">
                        {new Date(act.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </Section>
          </div>
        </div>
      </main>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  const colorMap: Record<string, string> = {
    blue: "bg-blue-50 text-blue-700 border-blue-100",
    green: "bg-green-50 text-green-700 border-green-100",
    purple: "bg-purple-50 text-purple-700 border-purple-100",
    orange: "bg-orange-50 text-orange-700 border-orange-100",
  };
  return (
    <div className={`p-4 rounded-xl border ${colorMap[color] || "bg-gray-50"}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs mt-1 opacity-70">{label}</div>
    </div>
  );
}

function Section({ title, count, color: _color, children }: { title: string; count: number; color: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{count}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="text-xs text-gray-400 py-4 text-center">{text}</div>;
}
