"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import { useCurrencySymbol } from "@/lib/branding-context";
import ClickablePhone from '@/components/ClickablePhone';
import ClickableEmail from '@/components/ClickableEmail';

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-800",
  contacted: "bg-yellow-100 text-yellow-800",
  qualified: "bg-green-100 text-green-800",
  lost: "bg-red-100 text-red-800",
  converted: "bg-purple-100 text-purple-800",
};

const QUAL_COLORS: Record<string, string> = {
  cold: "bg-blue-100 text-blue-700",
  warm: "bg-orange-100 text-orange-700",
  hot: "bg-red-100 text-red-700",
};

const TASK_STATUS_COLORS: Record<string, string> = {
  open: "bg-red-100 text-red-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-gray-100 text-gray-700",
};

interface LeadDetailPanelProps {
  leadId: number;
  onClose: () => void;
  onDeleted: () => void;
}

export default function LeadDetailPanel({ leadId, onClose, onDeleted }: LeadDetailPanelProps) {
  const token = getAuthToken();
  const cs = useCurrencySymbol();
  const [lead, setLead] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [activityForm, setActivityForm] = useState({ type: "note", title: "", description: "" });
  const [activityLoading, setActivityLoading] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"details" | "deals" | "tasks" | "activity" | "history">("details");
  const [duplicates, setDuplicates] = useState<any[]>([]);
  const [auditLog, setAuditLog] = useState<any[]>([]);

  const fetchLead = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API_URL}/crm/leads/${leadId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLead(res.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to load lead");
    } finally {
      setLoading(false);
    }
  };

  const fetchDuplicates = async () => {
    try {
      const res = await axios.get(`${API_URL}/crm/leads/duplicates/${leadId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setDuplicates(res.data || []);
    } catch { setDuplicates([]); }
  };

  const fetchAuditLog = async () => {
    try {
      const res = await axios.get(`${API_URL}/crm/audit-log/lead/${leadId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setAuditLog(res.data || []);
    } catch { setAuditLog([]); }
  };

  useEffect(() => {
    fetchLead();
    fetchDuplicates();
    setActiveTab("details");
  }, [leadId]);

  const handleStatusChange = async (newStatus: string) => {
    try {
      await axios.patch(`${API_URL}/crm/leads/${leadId}`, { status: newStatus }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLead({ ...lead, status: newStatus });
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to update status");
    }
  };

  const handleLogActivity = async () => {
    if (!activityForm.title.trim()) return;
    setActivityLoading(true);
    try {
      await axios.post(
        `${API_URL}/crm/activities/${leadId}`,
        activityForm,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      await fetchLead();
      setShowActivityModal(false);
      setActivityForm({ type: "note", title: "", description: "" });
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to log activity");
    } finally {
      setActivityLoading(false);
    }
  };

  const handleMerge = async () => {
    if (!mergeTargetId.trim()) return;
    setMergeLoading(true);
    setMergeError(null);
    try {
      await axios.post(
        `${API_URL}/crm/leads/merge`,
        { primary_lead_id: leadId, secondary_lead_id: Number(mergeTargetId) },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setShowMergeModal(false);
      setMergeTargetId("");
      await fetchLead();
    } catch (err: any) {
      setMergeError(err.response?.data?.detail || "Failed to merge leads");
    } finally {
      setMergeLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this lead?")) return;
    try {
      await axios.delete(`${API_URL}/crm/leads/${leadId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      onDeleted();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to delete lead");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>
        <button onClick={onClose} className="mt-4 text-sm text-gray-500 hover:text-gray-700">
          Close
        </button>
      </div>
    );
  }

  if (!lead) return null;

  const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div>
      <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900">{value || "\u2014"}</dd>
    </div>
  );

  const tabs = [
    { key: "details" as const, label: "Details" },
    { key: "deals" as const, label: `Deals (${lead.deals?.length || 0})` },
    { key: "tasks" as const, label: `Tasks (${lead.tasks?.length || 0})` },
    { key: "activity" as const, label: `Activity (${lead.activities?.length || 0})` },
    { key: "history" as const, label: "History" },
  ];

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Close
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowActivityModal(true)}
              className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-xs font-medium"
            >
              + Log Activity
            </button>
            <a
              href={`/admin/crm/deals/new?lead_id=${lead.id}`}
              className="px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-xs font-medium"
            >
              + Deal
            </a>
            <button
              onClick={() => setShowMergeModal(true)}
              className="text-xs px-3 py-1.5 border border-orange-300 text-orange-600 rounded-lg hover:bg-orange-50"
            >
              Merge
            </button>
            <a
              href={`/admin/crm/leads/${lead.id}/edit`}
              className="px-3 py-1.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 text-xs font-medium"
            >
              Edit
            </a>
            <button
              onClick={handleDelete}
              className="px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 text-xs font-medium"
            >
              Delete
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold flex-shrink-0">
            {lead.first_name?.charAt(0)}{lead.last_name?.charAt(0) || ""}
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 truncate">
              {lead.first_name} {lead.last_name}
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              <select
                value={lead.status}
                onChange={e => handleStatusChange(e.target.value)}
                className={`px-2 py-0.5 rounded-full text-xs font-semibold border-0 cursor-pointer ${STATUS_COLORS[lead.status] || "bg-gray-100 text-gray-800"}`}
              >
                {["new", "contacted", "qualified", "lost", "converted"].map(s => (
                  <option key={s} value={s} className="bg-white text-black">{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
              <span className="text-xs text-gray-500">Score: {lead.score}</span>
              {lead.qualification && (
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${QUAL_COLORS[lead.qualification] || "bg-gray-100 text-gray-600"}`}>
                  {lead.qualification}
                </span>
              )}
              {lead.estimated_value && (
                <span className="text-xs text-gray-500">{cs}{lead.estimated_value.toLocaleString()}</span>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4 -mb-4">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); if (tab.key === "history") fetchAuditLog(); }}
              className={`px-3 py-2 text-xs font-medium rounded-t-lg border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-blue-600 text-blue-600 bg-blue-50/50"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === "details" && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Contact Information</h3>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                <Field label="Email" value={lead.email ? <ClickableEmail email={lead.email} /> : null} />
                <Field label="Phone" value={lead.phone ? <ClickablePhone number={lead.phone} /> : null} />
                <Field label="Company" value={lead.company} />
                <Field label="Position" value={lead.position} />
                <Field label="Source" value={lead.source} />
                <Field label="Created" value={new Date(lead.created_at).toLocaleDateString()} />
              </dl>
            </div>
            {lead.tags && lead.tags.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-2">Tags</h3>
                <div className="flex flex-wrap gap-1.5">
                  {lead.tags.map((tag: any) => (
                    <span
                      key={tag.id}
                      className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700"
                      style={tag.color ? { backgroundColor: `${tag.color}20`, color: tag.color } : undefined}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Possible Duplicates */}
            {duplicates.length > 0 && (
              <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <h3 className="text-sm font-semibold text-yellow-800 mb-2">Possible Duplicates ({duplicates.length})</h3>
                <div className="space-y-2">
                  {duplicates.map((dup: any) => (
                    <div key={dup.id} className="flex justify-between items-center text-sm bg-white rounded px-3 py-2 border border-yellow-100">
                      <div>
                        <span className="font-medium text-gray-900">{dup.first_name} {dup.last_name || ""}</span>
                        <span className="text-gray-500 ml-2">{dup.email || dup.phone || ""}</span>
                        <span className="text-xs text-yellow-600 ml-2">({(dup.match_reasons || []).join(", ")})</span>
                      </div>
                      <button
                        onClick={() => { setMergeTargetId(String(dup.id)); setShowMergeModal(true); }}
                        className="text-xs text-orange-600 hover:underline"
                      >
                        Merge
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "deals" && (
          <div className="space-y-3">
            {lead.deals && lead.deals.length > 0 ? (
              lead.deals.map((d: any) => (
                <div key={d.id} className="flex justify-between items-center p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                  <div>
                    <p className="font-medium text-sm text-gray-900">{d.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {d.stage} &middot; {cs}{(d.amount || 0).toLocaleString()}
                      {d.probability != null && ` &middot; ${d.probability}%`}
                    </p>
                  </div>
                  <a href={`/admin/crm/deals/${d.id}`} className="text-blue-600 hover:underline text-xs">View</a>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-gray-400 text-sm">
                <p>No deals yet.</p>
                <a href={`/admin/crm/deals/new?lead_id=${lead.id}`} className="text-blue-600 hover:underline text-xs mt-1 inline-block">
                  Create first deal
                </a>
              </div>
            )}
          </div>
        )}

        {activeTab === "tasks" && (
          <div className="space-y-3">
            <div className="flex justify-end mb-2">
              <a
                href={`/admin/crm/tasks/new?lead_id=${lead.id}`}
                className="px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-xs font-medium"
              >
                + Add Task
              </a>
            </div>
            {lead.tasks && lead.tasks.length > 0 ? (
              lead.tasks.map((t: any) => (
                <div key={t.id} className="flex justify-between items-center p-4 border rounded-lg">
                  <div>
                    <span className="text-sm text-gray-900">{t.title}</span>
                    {t.due_date && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        Due: {new Date(t.due_date).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${TASK_STATUS_COLORS[t.status] || "bg-gray-100 text-gray-700"}`}>
                    {t.status.replace("_", " ")}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-gray-400 text-sm">No tasks yet.</div>
            )}
          </div>
        )}

        {activeTab === "activity" && (
          <div className="space-y-3">
            {lead.activities && lead.activities.length > 0 ? (
              lead.activities.map((act: any) => (
                <div key={act.id} className="border-b border-gray-100 pb-3 last:border-0">
                  <div className="flex justify-between items-start gap-2">
                    <p className="text-sm font-medium text-gray-800">{act.title}</p>
                    <span className="text-xs text-gray-400 shrink-0">
                      {new Date(act.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  {act.description && <p className="text-xs text-gray-600 mt-1">{act.description}</p>}
                  <span className="text-xs text-blue-500 capitalize mt-1 inline-block">
                    {act.type.replace("_", " ")}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-gray-400 text-sm">No activities yet.</div>
            )}
          </div>
        )}

        {activeTab === "history" && (
          <div className="space-y-3">
            {auditLog.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">No change history yet.</div>
            ) : (
              auditLog.map((log: any) => (
                <div key={log.id} className="border-b border-gray-100 pb-3 last:border-0">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <span className="text-sm font-medium text-gray-800">{log.field_name}</span>
                      <span className="text-xs text-gray-500 ml-2">
                        {log.old_value || "—"} → {log.new_value || "—"}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400 shrink-0">
                      {new Date(log.changed_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    by {log.changed_by_name || `User #${log.changed_by}`}
                  </p>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Log Activity Modal */}
      {showActivityModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowActivityModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Log Activity</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={activityForm.type}
                  onChange={e => setActivityForm({ ...activityForm, type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  {["call", "email", "meeting", "message", "note"].map(t => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <input
                  type="text"
                  placeholder="e.g. Called to discuss proposal"
                  value={activityForm.title}
                  onChange={e => setActivityForm({ ...activityForm, title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  placeholder="Optional notes..."
                  value={activityForm.description}
                  onChange={e => setActivityForm({ ...activityForm, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowActivityModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button
                onClick={handleLogActivity}
                disabled={!activityForm.title.trim() || activityLoading}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {activityLoading ? "Saving..." : "Log Activity"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Merge Lead Modal */}
      {showMergeModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => { setShowMergeModal(false); setMergeError(null); }}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Merge Lead</h2>
            <p className="text-sm text-gray-600 mb-3">
              Merge another lead into <strong>{lead.first_name} {lead.last_name}</strong>. The secondary lead&apos;s data will be transferred here.
            </p>
            <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg mb-4">
              <p className="text-sm text-orange-700 font-medium">This action cannot be undone.</p>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Secondary Lead ID</label>
              <input
                type="number"
                placeholder="Enter lead ID to merge"
                value={mergeTargetId}
                onChange={e => setMergeTargetId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {mergeError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg mb-4">
                <p className="text-sm text-red-700">{mergeError}</p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowMergeModal(false); setMergeError(null); setMergeTargetId(""); }} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button
                onClick={handleMerge}
                disabled={!mergeTargetId.trim() || mergeLoading}
                className="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
              >
                {mergeLoading ? "Merging..." : "Merge"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
