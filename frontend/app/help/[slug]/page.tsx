"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "@/lib/config";

export default function ArticlePage() {
  const { slug } = useParams();
  const [article, setArticle] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    fetch(`${API_URL}/kb/public/articles/${slug}`)
      .then(r => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.json();
      })
      .then(data => { if (data) setArticle(data); })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-500" />
    </div>
  );

  if (notFound) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-700">Article not found</h1>
        <a href="/help" className="text-indigo-600 hover:underline mt-4 block">← Back to Help Center</a>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4">
        <a href="/help" className="text-sm text-gray-500 hover:text-gray-700">← Help Center</a>
        {article?.category && (
          <span className="text-sm text-indigo-500 font-medium">{article.category}</span>
        )}
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{article?.title}</h1>
        <p className="text-sm text-gray-400 mb-8">
          {article?.views} views · Updated {article?.updated_at
            ? new Date(article.updated_at).toLocaleDateString()
            : new Date(article?.created_at).toLocaleDateString()}
        </p>
        <div
          className="prose prose-gray max-w-none"
          dangerouslySetInnerHTML={{ __html: article?.content_html || "" }}
        />
      </div>
    </div>
  );
}
