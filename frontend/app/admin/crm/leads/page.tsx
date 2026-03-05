"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

interface Lead {
  id: number;
  first_name: string;
  last_name?: string;
  email?: string;
  phone?: string;
  company?: string;
  status: string;
  source: string;
  score: number;
  estimated_value?: number;
  created_at: string;
  tags?: { id: number; name: string; color?: string }[];
}

interface Tag {
  id: number;
  name: string;
  color?: string;
}

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-800",
  contacted: "bg-yellow-100 text-yellow-800",
  qualified: "bg-green-100 text-green-800",
  lost: "bg-red-100 text-red-800",
  converted: "bg-purple-100 text-purple-800",
};

const SOURCE_ICONS: Record<string, string> = {
  conversation:     "\uD83D\uDCAC",
  email:            "\uD83D\uDCE7",
  website:          "\uD83C\uDF10",
  referral:         "\uD83D\uDC64",
  other:            "\uD83D\uDCCC",
  search_engine:    "\uD83D\uDD0D",
  facebook_post:    "\uD83D\uDCD8",
  facebook_boost:   "\uD83D\uDCE3",
  linkedin:         "\uD83D\uDCBC",
  x_post:           "\uD835\uDD4F",
  email_marketing:  "\uD83D\uDCE8",
  word_of_mouth:    "\uD83D\uDDE3\uFE0F",
  local_agent:      "\uD83C\uDFE0",
  staff_reference:  "\uD83D\uDC54",
  phone_call:       "\uD83D\uDCDE",
  existing_client:  "\u2B50",
  client_reference: "\uD83E\uDD1D",
};

const SOURCE_LABELS: Record<string, string> = {
  conversation:     "Conversation",
  email:            "Email",
  website:          "Website",
  referral:         "Referral",
  other:            "Other",
  search_engine:    "Search Engine",
  facebook_post:    "Facebook Post",
  facebook_boost:   "Facebook Boost",
  linkedin:         "LinkedIn",
  x_post:           "X Post",
  email_marketing:  "Email Marketing",
  word_of_mouth:    "Word of Mouth",
  local_agent:      "Local Agent",
  staff_reference:  "Staff Reference",
  phone_call:       "Phone Call",
  existing_client:  "Existing Client",
  client_reference: "Client Reference",
};

const FILTERS = ["all", "new", "contacted", "qualified", "lost", "converted"];

export default function LeadListPage() {
  const user = authAPI.getUser();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);
  const token = getAuthToken();

  useEffect(() => {
    fetchTags();
  }, []);

  useEffect(() => { fetchLeads(); }, [filter, search, tagFilter]);

  const fetchTags = async () => {
    try {
      const res = await axios.get(`${API_URL}/crm/tags`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setAvailableTags(res.data);
    } catch (err) {
      console.error("Failed to fetch tags:", err);
    }
  };

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("status", filter);
      if (search.trim()) params.set("search", search.trim());
      if (tagFilter) params.set("tag", tagFilter);
      const url = `${API_URL}/crm/leads?${params}`;
      const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
      setLeads(res.data);
    } catch (err) {
      console.error("Failed to fetch leads:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this lead?")) return;
    try {
      await axios.delete(`${API_URL}/crm/leads/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchLeads();
    } catch (err) {
      console.error("delete error", err);
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === leads.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(leads.map((l) => l.id)));
    }
  };

  const handleBulkAction = async (action: string) => {
    if (selectedIds.size === 0) return;

    let value = "";
    if (action === "change_status") {
      const choice = prompt("Enter new status (new, contacted, qualified, lost, converted):");
      if (!choice) return;
      value = choice.trim().toLowerCase();
    } else if (action === "assign_to") {
      const choice = prompt("Enter user ID to assign to:");
      if (!choice) return;
      value = choice.trim();
    } else if (action === "add_tag") {
      const choice = prompt("Enter tag name to add:");
      if (!choice) return;
      value = choice.trim();
    } else if (action === "remove_tag") {
      const choice = prompt("Enter tag name to remove:");
      if (!choice) return;
      value = choice.trim();
    }

    setBulkLoading(true);
    try {
      await axios.post(
        `${API_URL}/crm/leads/bulk`,
        { lead_ids: Array.from(selectedIds), action, value },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setSelectedIds(new Set());
      setBulkAction("");
      fetchLeads();
      fetchTags();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Bulk action failed");
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Leads</h1>
            <p className="text-sm text-gray-500 mt-0.5">{leads.length} total</p>
          </div>
          <a
            href="/admin/crm/leads/new"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
          >
            + New Lead
          </a>
        </div>

        <div className="flex gap-3 mb-4">
          <input
            type="text"
            placeholder="Search by name, email, or company..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full max-w-sm px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={tagFilter}
            onChange={e => setTagFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">All Tags</option>
            {availableTags.map((tag) => (
              <option key={tag.id} value={tag.name}>{tag.name}</option>
            ))}
          </select>
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
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {/* Bulk Action Toolbar */}
        {selectedIds.size > 0 && (
          <div className="mb-4 flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
            <span className="text-sm font-medium text-blue-800">
              {selectedIds.size} selected
            </span>
            <select
              value={bulkAction}
              onChange={(e) => {
                const action = e.target.value;
                setBulkAction(action);
                if (action) handleBulkAction(action);
              }}
              disabled={bulkLoading}
              className="px-3 py-1.5 border border-blue-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Choose action...</option>
              <option value="change_status">Change status</option>
              <option value="assign_to">Assign to</option>
              <option value="add_tag">Add tag</option>
              <option value="remove_tag">Remove tag</option>
            </select>
            {bulkLoading && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" />
            )}
            <button
              onClick={() => { setSelectedIds(new Set()); setBulkAction(""); }}
              className="ml-auto text-sm text-blue-600 hover:text-blue-800"
            >
              Clear selection
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : leads.length === 0 ? (
          <div className="bg-white rounded-lg shadow text-center py-16 text-gray-400">
            <p className="mb-2">No leads found.</p>
            <a href="/admin/crm/leads/new" className="text-blue-600 hover:underline text-sm">
              Create your first lead
            </a>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === leads.length && leads.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                  {["Name", "Email", "Company", "Status", "Tags", "Score", "Value", "Source", "Actions"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left font-medium text-gray-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {leads.map((lead) => (
                  <tr key={lead.id} className={`hover:bg-gray-50 ${selectedIds.has(lead.id) ? "bg-blue-50" : ""}`}>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(lead.id)}
                        onChange={() => toggleSelect(lead.id)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {lead.first_name} {lead.last_name || ""}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{lead.email || "\u2014"}</td>
                    <td className="px-4 py-3 text-gray-500">{lead.company || "\u2014"}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[lead.status] || "bg-gray-100 text-gray-800"}`}>
                        {lead.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {lead.tags && lead.tags.length > 0
                          ? lead.tags.map((tag) => (
                              <span
                                key={tag.id}
                                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700"
                                style={tag.color ? { backgroundColor: `${tag.color}20`, color: tag.color } : undefined}
                              >
                                {tag.name}
                              </span>
                            ))
                          : <span className="text-gray-300">\u2014</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-700">{lead.score}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {lead.estimated_value ? `$${lead.estimated_value.toLocaleString()}` : "\u2014"}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {SOURCE_ICONS[lead.source] || "\uD83D\uDCCC"} {SOURCE_LABELS[lead.source] || lead.source}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-3 text-sm">
                        <a href={`/admin/crm/leads/${lead.id}`} className="text-blue-600 hover:underline">View</a>
                        <a href={`/admin/crm/leads/${lead.id}/edit`} className="text-amber-600 hover:underline">Edit</a>
                        <button onClick={() => handleDelete(lead.id)} className="text-red-600 hover:underline">Delete</button>
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
