"use client";
import { useState, useEffect } from "react";
import axios from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Lead {
  id: number;
  first_name: string;
  last_name?: string;
  email?: string;
  phone?: string;
  company?: string;
  position?: string;
  status: string;
  source: string;
  score: number;
  estimated_value?: number;
}

interface Deal {
  id: number;
  name: string;
  stage: string;
  amount?: number;
  probability?: number;
  expected_close_date?: string;
}

interface Activity {
  id: number;
  type: string;
  title: string;
  description?: string;
  created_at: string;
  created_by_name?: string;
}

interface Note {
  id: number;
  lead_id: number;
  content: string;
  is_pinned: boolean;
  created_by: number;
  created_by_name?: string;
  created_at: string;
}

interface CrmSidebarProps {
  conversationId: number | null;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  onCreateLead?: (prefill: { first_name?: string; phone?: string; email?: string; conversation_id?: number }) => void;
}

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  contacted: "bg-yellow-100 text-yellow-700",
  qualified: "bg-green-100 text-green-700",
  lost: "bg-red-100 text-red-700",
  converted: "bg-purple-100 text-purple-700",
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

const ACTIVITY_ICONS: Record<string, string> = {
  call: "📞",
  email: "📧",
  meeting: "📅",
  message: "💬",
  note: "📝",
  task_created: "✅",
  deal_stage_change: "📊",
};

export default function CrmSidebar({
  conversationId,
  contactName,
  contactPhone,
  contactEmail,
  onCreateLead,
}: CrmSidebarProps) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [matchCandidates, setMatchCandidates] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newNote, setNewNote] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "activity" | "notes">("overview");

  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    if (!conversationId && !contactPhone && !contactName) return;
    fetchLeadData();
  }, [conversationId, contactPhone, contactName]);

  const fetchLeadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Try by conversation first
      if (conversationId) {
        try {
          const res = await axios.get(`${API_URL}/crm/leads/by-conversation/${conversationId}`, { headers });
          if (res.data) {
            setLead(res.data);
            await loadLeadDetails(res.data.id);
            return;
          }
        } catch {
          // No lead linked to conversation, try auto-match
        }
      }

      // Auto-match by phone/email/name
      const params = new URLSearchParams();
      if (contactPhone) params.set("phone", contactPhone);
      if (contactEmail) params.set("email", contactEmail);
      if (contactName) params.set("name", contactName);

      if (params.toString()) {
        const res = await axios.get(`${API_URL}/crm/leads/auto-match?${params}`, { headers });
        if (res.data.length === 1) {
          setLead(res.data[0]);
          await loadLeadDetails(res.data[0].id);
        } else if (res.data.length > 1) {
          setMatchCandidates(res.data);
        }
      }
    } catch (err) {
      setError("Unable to load CRM data");
    } finally {
      setLoading(false);
    }
  };

  const loadLeadDetails = async (leadId: number) => {
    try {
      const [dealsRes, activitiesRes, notesRes] = await Promise.all([
        axios.get(`${API_URL}/crm/deals?lead_id=${leadId}&limit=5`, { headers }),
        axios.get(`${API_URL}/crm/activities/${leadId}?limit=10`, { headers }),
        axios.get(`${API_URL}/crm/leads/${leadId}/notes`, { headers }),
      ]);
      setDeals(dealsRes.data);
      setActivities(activitiesRes.data);
      setNotes(notesRes.data);
    } catch {
      // Non-critical — lead card still shows
    }
  };

  const selectCandidate = async (candidate: Lead) => {
    setLead(candidate);
    setMatchCandidates([]);
    await loadLeadDetails(candidate.id);
  };

  const handleAddNote = async () => {
    if (!newNote.trim() || !lead) return;
    try {
      const res = await axios.post(
        `${API_URL}/crm/leads/${lead.id}/notes`,
        { content: newNote.trim() },
        { headers }
      );
      setNotes((prev) => [res.data, ...prev]);
      setNewNote("");
    } catch {
      // Silently fail — user can retry
    }
  };

  const togglePin = async (noteId: number, currentPinned: boolean) => {
    try {
      await axios.patch(`${API_URL}/crm/leads/notes/${noteId}`, { is_pinned: !currentPinned }, { headers });
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, is_pinned: !currentPinned } : n))
          .sort((a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0))
      );
    } catch {}
  };

  const deleteNote = async (noteId: number) => {
    try {
      await axios.delete(`${API_URL}/crm/leads/notes/${noteId}`, { headers });
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch {}
  };

  if (loading) {
    return (
      <div className="w-80 border-l border-gray-200 bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading CRM data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-80 border-l border-gray-200 bg-gray-50 p-4">
        <div className="text-red-500 text-sm mb-2">{error}</div>
        <button onClick={fetchLeadData} className="text-sm text-blue-600 hover:underline">
          Retry
        </button>
      </div>
    );
  }

  // Multiple candidates
  if (matchCandidates.length > 0) {
    return (
      <div className="w-80 border-l border-gray-200 bg-gray-50 p-4 overflow-y-auto">
        <h3 className="font-semibold text-sm mb-3">Multiple matches found</h3>
        {matchCandidates.map((c) => (
          <button
            key={c.id}
            onClick={() => selectCandidate(c)}
            className="w-full text-left p-3 mb-2 bg-white rounded-lg border hover:border-blue-400 transition"
          >
            <div className="font-medium text-sm">{c.first_name} {c.last_name}</div>
            <div className="text-xs text-gray-500">{c.company || c.email || c.phone}</div>
          </button>
        ))}
      </div>
    );
  }

  // No lead found
  if (!lead) {
    return (
      <div className="w-80 border-l border-gray-200 bg-gray-50 p-4 flex flex-col items-center justify-center">
        <div className="text-gray-400 text-sm mb-3">No CRM contact linked</div>
        <button
          onClick={() =>
            onCreateLead?.({
              first_name: contactName?.split(" ")[0],
              phone: contactPhone,
              email: contactEmail,
              conversation_id: conversationId ?? undefined,
            })
          }
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition"
        >
          Create Lead
        </button>
      </div>
    );
  }

  // Lead found — full sidebar
  return (
    <div className="w-80 border-l border-gray-200 bg-gray-50 flex flex-col h-full overflow-hidden">
      {/* Contact Card */}
      <div className="p-4 bg-white border-b">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm truncate">
            {lead.first_name} {lead.last_name}
          </h3>
          <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[lead.status] || "bg-gray-100"}`}>
            {lead.status}
          </span>
        </div>
        {lead.company && <div className="text-xs text-gray-500">{lead.position ? `${lead.position} at ` : ""}{lead.company}</div>}
        {lead.email && <div className="text-xs text-gray-400 mt-1">{lead.email}</div>}
        {lead.phone && <div className="text-xs text-gray-400">{lead.phone}</div>}
        <div className="flex items-center gap-3 mt-2">
          <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded">Score: {lead.score}</span>
          {lead.estimated_value && (
            <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded">
              ${lead.estimated_value.toLocaleString()}
            </span>
          )}
        </div>
        <div className="flex gap-2 mt-3">
          <a href={`/admin/crm/leads/${lead.id}/edit`} className="text-xs text-blue-600 hover:underline">Edit</a>
          <a href={`/admin/crm/deals/new?lead_id=${lead.id}`} className="text-xs text-blue-600 hover:underline">+ Deal</a>
          <a href={`/admin/crm/tasks/new?lead_id=${lead.id}`} className="text-xs text-blue-600 hover:underline">+ Task</a>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b bg-white">
        {(["overview", "activity", "notes"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-xs font-medium capitalize ${
              activeTab === tab ? "text-blue-600 border-b-2 border-blue-600" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === "overview" && (
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-gray-500 uppercase">Active Deals</h4>
            {deals.length === 0 ? (
              <div className="text-xs text-gray-400">No active deals</div>
            ) : (
              deals.map((deal) => (
                <a key={deal.id} href={`/admin/crm/deals/${deal.id}`} className="block p-2 bg-white rounded border hover:border-blue-300 transition">
                  <div className="text-sm font-medium truncate">{deal.name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${STAGE_COLORS[deal.stage] || "bg-gray-100"}`}>
                      {deal.stage}
                    </span>
                    {deal.amount && <span className="text-xs text-gray-500">${deal.amount.toLocaleString()}</span>}
                    {deal.probability != null && <span className="text-xs text-gray-400">{deal.probability}%</span>}
                  </div>
                </a>
              ))
            )}
          </div>
        )}

        {activeTab === "activity" && (
          <div className="space-y-2">
            {activities.length === 0 ? (
              <div className="text-xs text-gray-400">No recent activity</div>
            ) : (
              activities.map((act) => (
                <div key={act.id} className="flex gap-2 p-2 bg-white rounded border">
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
          </div>
        )}

        {activeTab === "notes" && (
          <div className="space-y-2">
            {notes.map((note) => (
              <div key={note.id} className={`p-2 bg-white rounded border ${note.is_pinned ? "border-yellow-300" : ""}`}>
                <div className="flex items-start justify-between">
                  <p className="text-xs text-gray-700 whitespace-pre-wrap flex-1">{note.content}</p>
                  <div className="flex gap-1 ml-2 flex-shrink-0">
                    <button onClick={() => togglePin(note.id, note.is_pinned)} className="text-xs" title={note.is_pinned ? "Unpin" : "Pin"}>
                      {note.is_pinned ? "📌" : "📍"}
                    </button>
                    <button onClick={() => deleteNote(note.id)} className="text-xs text-red-400 hover:text-red-600">×</button>
                  </div>
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {note.created_by_name} · {new Date(note.created_at).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Note (always visible at bottom when on notes tab) */}
      {activeTab === "notes" && (
        <div className="p-3 border-t bg-white">
          <div className="flex gap-2">
            <input
              type="text"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddNote()}
              placeholder="Add a note..."
              className="flex-1 text-xs border rounded px-2 py-1.5 focus:outline-none focus:border-blue-400"
            />
            <button onClick={handleAddNote} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700">
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
