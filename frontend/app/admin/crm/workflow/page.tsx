"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

interface WorkflowRule {
  id: number;
  name: string;
  is_active: boolean;
  trigger_type: string;
  conditions: Record<string, any>;
  action_type: string;
  action_config: Record<string, any>;
  created_at: string;
}

const TRIGGER_TYPES = [
  { value: "deal_stage_change", label: "Deal Stage Change" },
  { value: "lead_status_change", label: "Lead Status Change" },
  { value: "task_overdue", label: "Task Overdue" },
];

const ACTION_TYPES = [
  { value: "create_task", label: "Create Task" },
  { value: "change_status", label: "Change Lead Status" },
  { value: "send_notification", label: "Send Notification" },
];

const DEAL_STAGES = ["prospect", "qualified", "proposal", "negotiation", "close", "won", "lost"];
const LEAD_STATUSES = ["new", "contacted", "qualified", "lost", "converted"];

export default function WorkflowRulesPage() {
  const user = authAPI.getUser();
  const token = getAuthToken();
  const [rules, setRules] = useState<WorkflowRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: "",
    trigger_type: "deal_stage_change",
    conditions: {} as Record<string, any>,
    action_type: "create_task",
    action_config: {} as Record<string, any>,
    is_active: true,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchRules(); }, []);

  const fetchRules = async () => {
    try {
      const res = await axios.get(`${API_URL}/crm/workflow-rules`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setRules(res.data);
    } catch (err) {
      console.error("Failed to fetch rules:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editId) {
        await axios.patch(`${API_URL}/crm/workflow-rules/${editId}`, form, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } else {
        await axios.post(`${API_URL}/crm/workflow-rules`, form, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      setShowForm(false);
      setEditId(null);
      resetForm();
      fetchRules();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to save rule");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this workflow rule?")) return;
    try {
      await axios.delete(`${API_URL}/crm/workflow-rules/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchRules();
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  const handleToggle = async (rule: WorkflowRule) => {
    try {
      await axios.patch(`${API_URL}/crm/workflow-rules/${rule.id}`, { is_active: !rule.is_active }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchRules();
    } catch (err) {
      console.error("Toggle error:", err);
    }
  };

  const startEdit = (rule: WorkflowRule) => {
    setForm({
      name: rule.name,
      trigger_type: rule.trigger_type,
      conditions: rule.conditions || {},
      action_type: rule.action_type,
      action_config: rule.action_config || {},
      is_active: rule.is_active,
    });
    setEditId(rule.id);
    setShowForm(true);
  };

  const resetForm = () => {
    setForm({ name: "", trigger_type: "deal_stage_change", conditions: {}, action_type: "create_task", action_config: {}, is_active: true });
  };

  return (
    <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-50 pb-16 md:pb-0">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8 max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Workflow Automation</h1>
            <p className="text-sm text-gray-500 mt-0.5">Auto-trigger actions when CRM events occur</p>
          </div>
          <button
            onClick={() => { resetForm(); setEditId(null); setShowForm(true); }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
          >
            + New Rule
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : rules.length === 0 ? (
          <div className="bg-white rounded-lg shadow text-center py-16 text-gray-400">
            <p>No workflow rules yet.</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {["Name", "Trigger", "Action", "Active", "Created", "Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-medium text-gray-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rules.map(rule => (
                  <tr key={rule.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{rule.name}</td>
                    <td className="px-4 py-3 text-gray-600">{rule.trigger_type.replace(/_/g, " ")}</td>
                    <td className="px-4 py-3 text-gray-600">{rule.action_type.replace(/_/g, " ")}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggle(rule)}
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold ${rule.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}
                      >
                        {rule.is_active ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{new Date(rule.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-3 text-sm">
                        <button onClick={() => startEdit(rule)} className="text-blue-600 hover:underline">Edit</button>
                        <button onClick={() => handleDelete(rule.id)} className="text-red-600 hover:underline">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Rule Form Modal */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                {editId ? "Edit Rule" : "New Workflow Rule"}
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Rule Name</label>
                  <input
                    type="text" placeholder="e.g. Create follow-up on deal won"
                    value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Trigger</label>
                  <select value={form.trigger_type} onChange={e => setForm({ ...form, trigger_type: e.target.value, conditions: {} })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                    {TRIGGER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                {/* Conditions based on trigger type */}
                {form.trigger_type === "deal_stage_change" && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">When stage becomes</label>
                    <select value={form.conditions.new_stage || ""} onChange={e => setForm({ ...form, conditions: { new_stage: e.target.value } })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                      <option value="">Any stage</option>
                      {DEAL_STAGES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                    </select>
                  </div>
                )}
                {form.trigger_type === "lead_status_change" && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">When status becomes</label>
                    <select value={form.conditions.new_status || ""} onChange={e => setForm({ ...form, conditions: { new_status: e.target.value } })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                      <option value="">Any status</option>
                      {LEAD_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Action</label>
                  <select value={form.action_type} onChange={e => setForm({ ...form, action_type: e.target.value, action_config: {} })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                    {ACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                {/* Action config based on type */}
                {form.action_type === "create_task" && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Task Title</label>
                      <input type="text" placeholder="Follow-up call" value={form.action_config.task_title || ""}
                        onChange={e => setForm({ ...form, action_config: { ...form.action_config, task_title: e.target.value } })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Due in (days)</label>
                      <input type="number" value={form.action_config.due_days || 3}
                        onChange={e => setForm({ ...form, action_config: { ...form.action_config, due_days: parseInt(e.target.value) || 3 } })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    </div>
                  </div>
                )}
                {form.action_type === "change_status" && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">New Status</label>
                    <select value={form.action_config.new_status || ""} onChange={e => setForm({ ...form, action_config: { new_status: e.target.value } })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                      {LEAD_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                    </select>
                  </div>
                )}
                {form.action_type === "send_notification" && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Notification Message</label>
                    <input type="text" placeholder="Deal won! Time to celebrate." value={form.action_config.message || ""}
                      onChange={e => setForm({ ...form, action_config: { message: e.target.value } })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={form.is_active}
                    onChange={e => setForm({ ...form, is_active: e.target.checked })}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  <label className="text-sm text-gray-700">Active</label>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button onClick={() => { setShowForm(false); setEditId(null); }} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
                <button onClick={handleSave} disabled={!form.name.trim() || saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50">
                  {saving ? "Saving..." : editId ? "Update" : "Create"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
