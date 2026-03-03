"use client";

import { useState, useEffect } from "react";
import { API_URL } from "@/lib/config";

export default function HelpPage() {
  const [articles, setArticles] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/kb/public/categories`)
      .then(r => r.json())
      .then(setCategories)
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (selectedCategory) params.set("category", selectedCategory);
    fetch(`${API_URL}/kb/public/articles?${params}`)
      .then(r => r.json())
      .then(data => { setArticles(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [search, selectedCategory]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Help Center</h1>
        <a href="/" className="text-sm text-blue-600 hover:underline">← Back to App</a>
      </div>

      {/* Hero search */}
      <div className="bg-indigo-600 text-white py-12 px-6 text-center">
        <h2 className="text-3xl font-bold mb-2">How can we help?</h2>
        <p className="text-indigo-200 mb-6">Search our knowledge base for answers</p>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search articles…"
          className="w-full max-w-lg px-5 py-3 rounded-xl text-gray-900 text-sm focus:outline-none shadow-lg"
          autoFocus
        />
      </div>

      <div className="max-w-4xl mx-auto px-6 py-10">
        {/* Category filters */}
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-8">
            <button
              onClick={() => setSelectedCategory("")}
              className={`px-4 py-1.5 rounded-full text-sm font-medium border transition ${
                selectedCategory === "" ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
              }`}
            >
              All
            </button>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat === selectedCategory ? "" : cat)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium border transition ${
                  selectedCategory === cat ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* Articles grid */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
          </div>
        ) : articles.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-lg mb-2">No articles found.</p>
            {search && <p className="text-sm">Try a different search term.</p>}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {articles.map(a => (
              <a
                key={a.id}
                href={`/help/${a.slug}`}
                className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 hover:shadow-md hover:border-indigo-200 transition group"
              >
                {a.category && (
                  <span className="text-xs font-semibold text-indigo-500 uppercase tracking-wide">{a.category}</span>
                )}
                <h3 className="text-base font-semibold text-gray-900 mt-1 group-hover:text-indigo-600 transition">
                  {a.title}
                </h3>
                <p className="text-xs text-gray-400 mt-2">{a.views} views · {new Date(a.created_at).toLocaleDateString()}</p>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
