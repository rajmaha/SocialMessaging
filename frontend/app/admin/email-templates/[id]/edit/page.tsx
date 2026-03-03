"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";
import EmailEditor from "@/components/EmailEditor";
import { useRouter, useParams } from "next/navigation";

const CATEGORIES = [
  { value: "newsletter", label: "Newsletter" },
  { value: "promotional", label: "Promotional" },
  { value: "welcome", label: "Welcome" },
  { value: "followup", label: "Follow-up" },
];

export default function EditTemplatePage() {
  const user = authAPI.getUser();
  const token = getAuthToken();
  const router = useRouter();
  const { id } = useParams();
  const [form, setForm] = useState({ name: "", category: "newsletter", body_html: "" });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    axios
      .get(`${API_URL}/email-templates/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then(res => {
        setForm({
          name: res.data.name || "",
          category: res.data.category || "newsletter",
          body_html: res.data.body_html || "",
        });
      })
      .catch(() => setError("Failed to load template"))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.body_html) {
      setError("Name and body are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await axios.patch(`${API_URL}/email-templates/${id}`, form, {
        headers: { Authorization: `Bearer ${token}` },
      });
      router.push("/admin/email-templates");
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="ml-60 pt-14 min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
      </div>
    );
  }

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8 max-w-4xl">
        <a href="/admin/email-templates" className="text-gray-400 hover:text-gray-600 text-sm">← Templates</a>
        <h1 className="text-2xl font-semibold text-gray-900 mt-2 mb-6">Edit Template</h1>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Template Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Category</label>
              <select
                value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Body *</label>
              <EmailEditor
                content={form.body_html}
                onChange={html => setForm(prev => ({ ...prev, body_html: html }))}
              />
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
            <a href="/admin/email-templates" className="px-6 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
              Cancel
            </a>
          </div>
        </form>
      </main>
    </div>
  );
}
