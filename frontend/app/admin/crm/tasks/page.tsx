"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

interface CrmTask {
  id: number;
  lead_id: number;
  title: string;
  description?: string;
  status: string;
  assigned_to?: number;
  due_date?: string;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  open:        "bg-red-100 text-red-800",
  in_progress: "bg-yellow-100 text-yellow-800",
  completed:   "bg-green-100 text-green-800",
  cancelled:   "bg-gray-100 text-gray-800",
};

const FILTERS = ["open", "in_progress", "completed", "cancelled"];

function formatDate(dateStr?: string) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function isOverdue(dateStr?: string, status?: string) {
  if (!dateStr || status === "completed" || status === "cancelled") return false;
  return new Date(dateStr) < new Date();
}

export default function TasksPage() {
  const user = authAPI.getUser();
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("open");
  const token = getAuthToken();

  useEffect(() => { fetchTasks(); }, [filter]);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const url = filter !== "all"
        ? `${API_URL}/crm/tasks?status=${filter}`
        : `${API_URL}/crm/tasks`;
      const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
      setTasks(res.data);
    } catch (err) {
      console.error("Failed to fetch tasks:", err);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (taskId: number, newStatus: string) => {
    try {
      await axios.patch(`${API_URL}/crm/tasks/${taskId}`, { status: newStatus }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchTasks();
    } catch (err) {
      console.error("Failed to update task:", err);
    }
  };

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Tasks</h1>
            <p className="text-sm text-gray-500 mt-0.5">{tasks.length} task{tasks.length !== 1 ? "s" : ""}</p>
          </div>
          <a
            href="/admin/crm/tasks/new"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
          >
            + New Task
          </a>
        </div>

        <div className="flex gap-2 mb-6">
          {FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === s
                  ? "bg-blue-600 text-white"
                  : "bg-white border border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {s.replace("_", " ").replace(/^\w/, (c) => c.toUpperCase())}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="bg-white rounded-lg shadow text-center py-16 text-gray-400">
            <p className="mb-2">No tasks found.</p>
            <a href="/admin/crm/tasks/new" className="text-blue-600 hover:underline text-sm">Create a task</a>
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => {
              const overdue = isOverdue(task.due_date, task.status);
              return (
                <div
                  key={task.id}
                  className={`bg-white rounded-lg shadow p-4 flex justify-between items-start gap-4 ${overdue ? "border-l-4 border-red-400" : ""}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900 text-sm">{task.title}</h3>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[task.status] || "bg-gray-100 text-gray-800"}`}>
                        {task.status.replace("_", " ")}
                      </span>
                      {overdue && <span className="text-xs text-red-600 font-medium">Overdue</span>}
                    </div>
                    {task.description && (
                      <p className="text-sm text-gray-500 mb-2">{task.description}</p>
                    )}
                    <p className="text-xs text-gray-400">
                      Lead #{task.lead_id} · Due {formatDate(task.due_date)}
                    </p>
                  </div>
                  <select
                    value={task.status}
                    onChange={(e) => updateStatus(task.id, e.target.value)}
                    className="px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 shrink-0"
                  >
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
