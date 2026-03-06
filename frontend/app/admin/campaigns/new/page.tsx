"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";
import EmailEditor from "@/components/EmailEditor";
import EmailTemplateGallery from "@/components/EmailTemplateGallery";
import SendTestEmailPopover from "@/components/SendTestEmailPopover";
import { useRouter } from "next/navigation";

const LEAD_STATUSES = ["new", "contacted", "qualified", "lost", "converted"];
const LEAD_SOURCES = ["conversation", "email", "website", "referral", "phone_call", "existing_client", "other"];

export default function NewCampaignPage() {
  const user = authAPI.getUser();
  const token = getAuthToken();
  const router = useRouter();

  const [form, setForm] = useState({
    name: "",
    subject: "",
    body_html: "",
    target_filter: {
      statuses: [] as string[],
      sources: [] as string[],
      tags: { include: [] as string[], exclude: [] as string[] },
      engagement: {} as Record<string, number>,
    },
    scheduled_at: "",
  });
  const [saving, setSaving] = useState(false);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [includeTagInput, setIncludeTagInput] = useState("");
  const [excludeTagInput, setExcludeTagInput] = useState("");
  const [campaignsList, setCampaignsList] = useState<{ id: number; name: string }[]>([]);
  const [engagementCampaignId, setEngagementCampaignId] = useState<number | "">("");
  const [engagementAction, setEngagementAction] = useState<string>("");

  useEffect(() => {
    axios
      .get(`${API_URL}/campaigns`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => setCampaignsList(res.data))
      .catch(() => {});
  }, [token]);

  const previewAudience = async () => {
    try {
      const res = await axios.post(`${API_URL}/campaigns/preview-audience`, form.target_filter, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setAudienceCount(res.data.count);
    } catch {}
  };

  const toggleFilter = (type: "statuses" | "sources", value: string) => {
    setForm(prev => {
      const arr = prev.target_filter[type];
      const next = arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value];
      return { ...prev, target_filter: { ...prev.target_filter, [type]: next } };
    });
    setAudienceCount(null);
  };

  const addTag = (type: "include" | "exclude", tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (!trimmed) return;
    setForm(prev => {
      const current = prev.target_filter.tags[type];
      if (current.includes(trimmed)) return prev;
      return {
        ...prev,
        target_filter: {
          ...prev.target_filter,
          tags: { ...prev.target_filter.tags, [type]: [...current, trimmed] },
        },
      };
    });
    setAudienceCount(null);
  };

  const removeTag = (type: "include" | "exclude", tag: string) => {
    setForm(prev => ({
      ...prev,
      target_filter: {
        ...prev.target_filter,
        tags: {
          ...prev.target_filter.tags,
          [type]: prev.target_filter.tags[type].filter(t => t !== tag),
        },
      },
    }));
    setAudienceCount(null);
  };

  const setEngagement = (campaignId: number | "", action: string) => {
    setEngagementCampaignId(campaignId);
    setEngagementAction(action);
    const engagement: Record<string, number> = {};
    if (campaignId && action) {
      engagement[action] = campaignId as number;
    }
    setForm(prev => ({
      ...prev,
      target_filter: { ...prev.target_filter, engagement },
    }));
    setAudienceCount(null);
  };

  const save = async (publish: boolean) => {
    if (!form.name || !form.subject || !form.body_html) {
      setError("Name, subject, and body are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
        status: publish
          ? (form.scheduled_at ? "scheduled" : "draft")
          : "draft",
      };
      const res = await axios.post(`${API_URL}/campaigns`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (publish) {
        router.push(`/admin/campaigns/${res.data.id}`);
      } else {
        router.push(`/admin/campaigns/${res.data.id}/edit`);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to save campaign");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
  };

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8 max-w-4xl">
        <a href="/admin/campaigns" className="text-gray-400 hover:text-gray-600 text-sm">← Campaigns</a>
        <h1 className="text-2xl font-semibold text-gray-900 mt-2 mb-6">New Campaign</h1>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <h2 className="font-semibold text-gray-700">Campaign Details</h2>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Campaign Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. March Newsletter"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Email Subject *</label>
              <input
                type="text"
                value={form.subject}
                onChange={e => setForm({ ...form, subject: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Special offer just for you"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-600">Email Body *</label>
                <div className="flex items-center gap-2">
                  <SendTestEmailPopover subject={form.subject} bodyHtml={form.body_html} />
                  <EmailTemplateGallery onSelect={html => setForm(prev => ({ ...prev, body_html: html }))} />
                </div>
              </div>
              <EmailEditor
                content={form.body_html}
                onChange={html => setForm(prev => ({ ...prev, body_html: html }))}
              />
              <p className="text-xs text-gray-400 mt-1">Use the template gallery to pick a pre-built design, or write your own. A tracking pixel is appended automatically on send.</p>
            </div>
          </div>

          {/* Audience */}
          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            <h2 className="font-semibold text-gray-700">Target Audience</h2>
            <p className="text-xs text-gray-500">Leave all unchecked to send to all leads with an email address.</p>

            <div>
              <label className="block text-sm font-medium text-gray-600 mb-2">Filter by Lead Status</label>
              <div className="flex flex-wrap gap-2">
                {LEAD_STATUSES.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleFilter("statuses", s)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                      form.target_filter.statuses.includes(s)
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-600 mb-2">Filter by Lead Source</label>
              <div className="flex flex-wrap gap-2">
                {LEAD_SOURCES.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleFilter("sources", s)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                      form.target_filter.sources.includes(s)
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {s.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            </div>

            {/* Tag Filters */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-2">Filter by Tags</label>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Include tags (leads must have ALL these tags)</label>
                  <div className="flex flex-wrap gap-1 mb-1">
                    {form.target_filter.tags.include.map(tag => (
                      <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        {tag}
                        <button type="button" onClick={() => removeTag("include", tag)} className="hover:text-green-600">x</button>
                      </span>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={includeTagInput}
                    onChange={e => setIncludeTagInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag("include", includeTagInput);
                        setIncludeTagInput("");
                      }
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="Type a tag and press Enter"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Exclude tags (leads must NOT have these tags)</label>
                  <div className="flex flex-wrap gap-1 mb-1">
                    {form.target_filter.tags.exclude.map(tag => (
                      <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                        {tag}
                        <button type="button" onClick={() => removeTag("exclude", tag)} className="hover:text-red-600">x</button>
                      </span>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={excludeTagInput}
                    onChange={e => setExcludeTagInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag("exclude", excludeTagInput);
                        setExcludeTagInput("");
                      }
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                    placeholder="Type a tag and press Enter"
                  />
                </div>
              </div>
            </div>

            {/* Engagement Filters */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-2">Engagement Filters</label>
              <p className="text-xs text-gray-500 mb-2">Target leads based on their interaction with a past campaign.</p>
              <div className="flex flex-wrap gap-3">
                <select
                  value={engagementCampaignId}
                  onChange={e => {
                    const val = e.target.value ? Number(e.target.value) : "";
                    setEngagement(val, engagementAction);
                  }}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select a past campaign</option>
                  {campaignsList.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <select
                  value={engagementAction}
                  onChange={e => setEngagement(engagementCampaignId, e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select action</option>
                  <option value="opened_campaign">Opened</option>
                  <option value="not_opened_campaign">Did not open</option>
                  <option value="clicked_campaign">Clicked</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={previewAudience}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
              >
                Preview Audience
              </button>
              {audienceCount !== null && (
                <span className="text-sm font-medium text-gray-700">
                  {audienceCount} lead{audienceCount !== 1 ? "s" : ""} will receive this campaign
                </span>
              )}
            </div>
          </div>

          {/* Schedule */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="font-semibold text-gray-700 mb-3">Schedule (optional)</h2>
            <p className="text-xs text-gray-500 mb-3">Leave empty to save as draft and send manually.</p>
            <input
              type="datetime-local"
              value={form.scheduled_at}
              onChange={e => setForm({ ...form, scheduled_at: e.target.value })}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => save(false)}
              disabled={saving}
              className="px-6 py-2 border border-gray-300 bg-white text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium disabled:opacity-50"
            >
              {saving ? "Saving..." : "💾 Save Draft"}
            </button>
            <button
              type="button"
              onClick={() => save(true)}
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
            >
              {saving ? "Saving..." : "✅ Publish"}
            </button>
            <a href="/admin/campaigns" className="px-6 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
              Cancel
            </a>
          </div>
        </form>
      </main>
    </div>
  );
}
