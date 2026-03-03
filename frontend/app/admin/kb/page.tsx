"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

export default function KBAdminPage() {
  const user = authAPI.getUser();
  const token = getAuthToken();
  const [articles, setArticles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchArticles = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      const res = await axios.get(`${API_URL}/kb/articles?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setArticles(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchArticles(); }, [search]);

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this article?")) return;
    await axios.delete(`${API_URL}/kb/articles/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchArticles();
  };

  const handleTogglePublish = async (article: any) => {
    await axios.patch(`${API_URL}/kb/articles/${article.id}`, { published: !article.published }, {
      headers: { Authorization: `Bearer ${token}` },
    });
    fetchArticles();
  };

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Knowledge Base</h1>
            <p className="text-sm text-gray-500 mt-0.5">{articles.length} articles</p>
          </div>
          <div className="flex gap-3">
            <a href="/help" target="_blank" rel="noreferrer" className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
              View Public Portal →
            </a>
            <a href="/admin/kb/new" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
              + New Article
            </a>
          </div>
        </div>

        <div className="mb-4">
          <input
            type="text"
            placeholder="Search articles…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full max-w-sm px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : articles.length === 0 ? (
          <div className="bg-white rounded-lg shadow text-center py-16 text-gray-400">
            <p className="mb-2">No articles yet.</p>
            <a href="/admin/kb/new" className="text-blue-600 hover:underline text-sm">Write your first article</a>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {["Title", "Category", "Status", "Views", "Created", "Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-medium text-gray-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {articles.map(a => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{a.title}</td>
                    <td className="px-4 py-3 text-gray-500">{a.category || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        a.published ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                      }`}>
                        {a.published ? "Published" : "Draft"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{a.views}</td>
                    <td className="px-4 py-3 text-gray-400">{new Date(a.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 text-sm">
                        <a href={`/admin/kb/${a.id}/edit`} className="text-amber-600 hover:underline">Edit</a>
                        <button onClick={() => handleTogglePublish(a)} className={a.published ? "text-gray-500 hover:underline" : "text-green-600 hover:underline"}>
                          {a.published ? "Unpublish" : "Publish"}
                        </button>
                        <a href={`/help/${a.slug}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">View</a>
                        <button onClick={() => handleDelete(a.id)} className="text-red-600 hover:underline">Delete</button>
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
