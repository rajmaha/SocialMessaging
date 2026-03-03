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
}

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-800",
  contacted: "bg-yellow-100 text-yellow-800",
  qualified: "bg-green-100 text-green-800",
  lost: "bg-red-100 text-red-800",
  converted: "bg-purple-100 text-purple-800",
};

const SOURCE_ICONS: Record<string, string> = {
  conversation:     "💬",
  email:            "📧",
  website:          "🌐",
  referral:         "👤",
  other:            "📌",
  search_engine:    "🔍",
  facebook_post:    "📘",
  facebook_boost:   "📣",
  linkedin:         "💼",
  x_post:           "𝕏",
  email_marketing:  "📨",
  word_of_mouth:    "🗣️",
  local_agent:      "🏠",
  staff_reference:  "👔",
  phone_call:       "📞",
  existing_client:  "⭐",
  client_reference: "🤝",
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
  const token = getAuthToken();

  useEffect(() => { fetchLeads(); }, [filter, search]);

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("status", filter);
      if (search.trim()) params.set("search", search.trim());
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

        <div className="mb-4">
          <input
            type="text"
            placeholder="Search by name, email, or company…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full max-w-sm px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
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
                  {["Name", "Email", "Company", "Status", "Score", "Value", "Source", "Actions"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left font-medium text-gray-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {leads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {lead.first_name} {lead.last_name || ""}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{lead.email || "—"}</td>
                    <td className="px-4 py-3 text-gray-500">{lead.company || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[lead.status] || "bg-gray-100 text-gray-800"}`}>
                        {lead.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-700">{lead.score}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {lead.estimated_value ? `$${lead.estimated_value.toLocaleString()}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {SOURCE_ICONS[lead.source] || "📌"} {SOURCE_LABELS[lead.source] || lead.source}
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
