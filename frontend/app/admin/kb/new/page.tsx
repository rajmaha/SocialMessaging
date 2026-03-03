"use client";

import { useState } from "react";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";
import KbEditor from "@/components/KbEditor";
import { useRouter } from "next/navigation";

export default function NewArticlePage() {
  const user = authAPI.getUser();
  const token = getAuthToken();
  const router = useRouter();

  const [form, setForm] = useState({
    title: "",
    slug: "",
    content_html: "",
    category: "",
    published: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const autoSlug = (title: string) =>
    title.toLowerCase().replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/^-+|-+$/g, "");

  const handleTitleChange = (title: string) => {
    setForm(prev => ({
      ...prev,
      title,
      slug: prev.slug === "" || prev.slug === autoSlug(prev.title) ? autoSlug(title) : prev.slug,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.content_html) {
      setError("Title and content are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await axios.post(`${API_URL}/kb/articles`, form, {
        headers: { Authorization: `Bearer ${token}` },
      });
      router.push("/admin/kb");
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8 max-w-4xl">
        <a href="/admin/kb" className="text-gray-400 hover:text-gray-600 text-sm">← Knowledge Base</a>
        <h1 className="text-2xl font-semibold text-gray-900 mt-2 mb-6">New Article</h1>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Title *</label>
              <input
                type="text"
                value={form.title}
                onChange={e => handleTitleChange(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. How to reset your password"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Slug (URL path)</label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">/help/</span>
                <input
                  type="text"
                  value={form.slug}
                  onChange={e => setForm({ ...form, slug: e.target.value })}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Category</label>
              <input
                type="text"
                value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Account, Billing, Getting Started"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Content *</label>
              <KbEditor
                content={form.content_html}
                onChange={html => setForm(prev => ({ ...prev, content_html: html }))}
              />
            </div>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="published"
                checked={form.published}
                onChange={e => setForm({ ...form, published: e.target.checked })}
                className="w-4 h-4"
              />
              <label htmlFor="published" className="text-sm text-gray-700">Publish immediately (visible on /help)</label>
            </div>
          </div>

          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50">
              {saving ? "Saving…" : "Save Article"}
            </button>
            <a href="/admin/kb" className="px-6 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</a>
          </div>
        </form>
      </main>
    </div>
  );
}
