"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

const CATEGORY_COLORS: Record<string, string> = {
  newsletter: "bg-indigo-100 text-indigo-700",
  promotional: "bg-purple-100 text-purple-700",
  welcome: "bg-green-100 text-green-700",
  followup: "bg-blue-100 text-blue-700",
};

const CATEGORY_LABELS: Record<string, string> = {
  newsletter: "Newsletter",
  promotional: "Promotional",
  welcome: "Welcome",
  followup: "Follow-up",
};

export default function EmailTemplatesPage() {
  const user = authAPI.getUser();
  const token = getAuthToken();
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTemplates = async () => {
    try {
      const res = await axios.get(`${API_URL}/email-templates/`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setTemplates(res.data);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchTemplates(); }, []);

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this template?")) return;
    try {
      await axios.delete(`${API_URL}/email-templates/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setTemplates(ts => ts.filter(t => t.id !== id));
    } catch (e: any) {
      alert(e.response?.data?.detail || "Failed to delete");
    }
  };

  return (
    <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-50 pb-16 md:pb-0">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Email Templates</h1>
            <p className="text-sm text-gray-400 mt-0.5">Reusable templates for campaigns — presets cannot be edited or deleted</p>
          </div>
          <a
            href="/admin/email-templates/new"
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
          >
            + New Template
          </a>
        </div>

        {loading ? (
          <div className="flex justify-center py-24">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
          </div>
        ) : templates.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-12 text-center text-gray-400">
            <p className="text-4xl mb-3">📭</p>
            <p>No templates yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {templates.map(t => (
              <div key={t.id} className="bg-white rounded-xl shadow overflow-hidden">
                {/* Scaled preview thumbnail */}
                <div className="h-44 bg-gray-50 overflow-hidden relative">
                  <iframe
                    srcDoc={t.body_html}
                    sandbox="allow-same-origin"
                    className="w-full border-none pointer-events-none"
                    style={{
                      height: "600px",
                      transform: "scale(0.3)",
                      transformOrigin: "top left",
                      width: "333%",
                    }}
                    title={t.name}
                  />
                  {t.is_preset && (
                    <div className="absolute top-2 right-2 bg-gray-700/80 text-white text-xs px-2 py-0.5 rounded-full">
                      Preset
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <p className="font-semibold text-gray-900 text-sm mb-2">{t.name}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[t.category] || "bg-gray-100 text-gray-600"}`}>
                    {CATEGORY_LABELS[t.category] || t.category}
                  </span>
                  {!t.is_preset && (
                    <div className="flex gap-3 mt-3 pt-3 border-t border-gray-100">
                      <a href={`/admin/email-templates/${t.id}/edit`} className="text-xs text-indigo-600 hover:underline font-medium">
                        Edit
                      </a>
                      <button onClick={() => handleDelete(t.id)} className="text-xs text-red-500 hover:underline">
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
