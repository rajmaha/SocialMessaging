"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

const SOURCES = [
  "conversation","email","website","referral","other","search_engine",
  "facebook_post","facebook_boost","linkedin","x_post","email_marketing",
  "word_of_mouth","local_agent","staff_reference","phone_call",
  "existing_client","client_reference",
];
const SOURCE_LABELS: Record<string, string> = {
  conversation:"Conversation", email:"Email", website:"Website",
  referral:"Referral", other:"Other", search_engine:"Search Engine",
  facebook_post:"Facebook Post", facebook_boost:"Facebook Boost",
  linkedin:"LinkedIn", x_post:"X Post", email_marketing:"Email Marketing",
  word_of_mouth:"Word of Mouth", local_agent:"Local Agent",
  staff_reference:"Staff Reference", phone_call:"Phone Call",
  existing_client:"Existing Client", client_reference:"Client Reference",
};
const STATUSES = ["new","contacted","qualified","lost","converted"];

export default function EditLeadPage() {
  const user = authAPI.getUser();
  const { id } = useParams();
  const router = useRouter();
  const token = getAuthToken();

  const [orgs, setOrgs] = useState<{id: number, organization_name: string}[]>([])
  const [form, setForm] = useState<any>({
    first_name: "", last_name: "", email: "", phone: "",
    company: "", position: "", address: "", inquiry_for: "", remarks: "",
    status: "new", source: "other",
    estimated_value: "", score: 0,
    organization_id: null as number | null,
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    api.get('/crm/organizations?limit=200').then(r => setOrgs(r.data));
    if (!id) return;
    axios.get(`${API_URL}/crm/leads/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => {
        const d = res.data;
        setForm({
          first_name: d.first_name || "",
          last_name: d.last_name || "",
          email: d.email || "",
          phone: d.phone || "",
          company: d.company || "",
          position: d.position || "",
          address: d.address || "",
          inquiry_for: d.inquiry_for || "",
          remarks: d.remarks || "",
          status: d.status || "new",
          source: d.source || "other",
          estimated_value: d.estimated_value ?? "",
          score: d.score ?? 0,
          organization_id: d.organization_id || null,
        });
      })
      .catch(err => setError(err.response?.data?.detail || "Failed to load lead"))
      .finally(() => setFetching(false));
  }, [id, token]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const payload: any = { ...form };
      if (payload.estimated_value !== "") payload.estimated_value = parseFloat(payload.estimated_value);
      else delete payload.estimated_value;
      payload.score = parseInt(payload.score) || 0;
      await axios.patch(`${API_URL}/crm/leads/${id}`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      router.push(`/admin/crm/leads/${id}`);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to update lead");
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm";
  const labelClass = "block text-sm font-medium text-gray-700 mb-1";

  if (fetching) return (
    <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-50 flex items-center justify-center pb-16 md:pb-0">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
    </div>
  );

  return (
    <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-50 pb-16 md:pb-0">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8">
        <div className="mb-6 flex items-center gap-3">
          <a href={`/admin/crm/leads/${id}`} className="text-gray-400 hover:text-gray-600 text-sm">← Lead</a>
          <h1 className="text-2xl font-semibold text-gray-900">Edit Lead</h1>
        </div>

        <div className="max-w-2xl">
          <div className="bg-white rounded-lg shadow p-6">
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
            )}
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>First name *</label>
                  <input name="first_name" value={form.first_name} onChange={handleChange} required className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Last name</label>
                  <input name="last_name" value={form.last_name} onChange={handleChange} className={inputClass} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Email</label>
                  <input name="email" type="email" value={form.email} onChange={handleChange} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Phone</label>
                  <input name="phone" value={form.phone} onChange={handleChange} className={inputClass} />
                </div>
              </div>

              <div>
                <label className={labelClass}>Organization (existing)</label>
                <select value={form.organization_id || ''} onChange={e => {
                  const orgId = e.target.value ? parseInt(e.target.value) : null;
                  setForm((f: any) => ({...f, organization_id: orgId, company: orgId ? '' : f.company}));
                }} className={inputClass}>
                  <option value="">— New organization —</option>
                  {orgs.map(o => <option key={o.id} value={o.id}>{o.organization_name}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Company {!form.organization_id ? '(new organization)' : ''}</label>
                  <input name="company" value={form.organization_id ? (orgs.find(o => o.id === form.organization_id)?.organization_name || '') : form.company} onChange={handleChange} disabled={!!form.organization_id} className={inputClass + (form.organization_id ? ' bg-gray-100 text-gray-500' : '')} />
                </div>
                <div>
                  <label className={labelClass}>Position</label>
                  <input name="position" value={form.position} onChange={handleChange} className={inputClass} />
                </div>
              </div>

              <div>
                <label className={labelClass}>Address</label>
                <input name="address" value={form.address} onChange={handleChange} className={inputClass} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Inquiry For</label>
                  <input name="inquiry_for" value={form.inquiry_for} onChange={handleChange} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Remarks</label>
                  <textarea name="remarks" value={form.remarks} onChange={(e: any) => setForm({...form, remarks: e.target.value})} rows={2} className={inputClass + " resize-none"} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Status</label>
                  <select name="status" value={form.status} onChange={handleChange} className={inputClass}>
                    {STATUSES.map(s => (
                      <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Source</label>
                  <select name="source" value={form.source} onChange={handleChange} className={inputClass}>
                    {SOURCES.map(s => (
                      <option key={s} value={s}>{SOURCE_LABELS[s] || s}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Estimated Value ($)</label>
                  <input name="estimated_value" type="number" min={0} value={form.estimated_value} onChange={handleChange} className={inputClass} placeholder="0" />
                </div>
                <div>
                  <label className={labelClass}>Score</label>
                  <input name="score" type="number" min={0} max={100} value={form.score} onChange={handleChange} className={inputClass} />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <a href={`/admin/crm/leads/${id}`} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium">
                  Cancel
                </a>
                <button type="submit" disabled={loading} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium">
                  {loading ? "Saving…" : "Update Lead"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
