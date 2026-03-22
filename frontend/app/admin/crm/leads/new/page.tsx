"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

const SOURCES = [
  { value: "search_engine",    label: "Search Engine" },
  { value: "facebook_post",    label: "Facebook Post" },
  { value: "facebook_boost",   label: "Facebook Boost" },
  { value: "linkedin",         label: "LinkedIn" },
  { value: "x_post",           label: "X Post" },
  { value: "email_marketing",  label: "Email Marketing" },
  { value: "word_of_mouth",    label: "Word of Mouth" },
  { value: "local_agent",      label: "Local Agent" },
  { value: "staff_reference",  label: "Staff Reference" },
  { value: "phone_call",       label: "Phone Call" },
  { value: "existing_client",  label: "Existing Client" },
  { value: "client_reference", label: "Client Reference" },
  { value: "conversation",     label: "Conversation" },
  { value: "email",            label: "Email" },
  { value: "website",          label: "Website" },
  { value: "referral",         label: "Referral" },
  { value: "other",            label: "Other" },
];

export default function NewLeadPage() {
  const user = authAPI.getUser();
  const router = useRouter();
  const token = getAuthToken();

  const [orgs, setOrgs] = useState<{id: number, organization_name: string}[]>([])
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    company: "",
    position: "",
    address: "",
    inquiry_for: "",
    remarks: "",
    source: "other",
    organization_id: null as number | null,
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.get('/crm/organizations?limit=200').then(r => setOrgs(r.data)) }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await axios.post(`${API_URL}/crm/leads`, form, {
        headers: { Authorization: `Bearer ${token}` },
      });
      router.push("/admin/crm/leads");
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to create lead");
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm";
  const labelClass = "block text-sm font-medium text-gray-700 mb-1";

  return (
    <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-50 pb-16 md:pb-0">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8">
        <div className="mb-6 flex items-center gap-3">
          <a href="/admin/crm/leads" className="text-gray-400 hover:text-gray-600 text-sm">← Leads</a>
          <h1 className="text-2xl font-semibold text-gray-900">New Lead</h1>
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
                  <label className={labelClass}>Source</label>
                  <select name="source" value={form.source} onChange={handleChange} className={inputClass}>
                    {SOURCES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className={labelClass}>Remarks</label>
                <textarea name="remarks" value={form.remarks} onChange={(e: any) => setForm({...form, remarks: e.target.value})} rows={3} className={inputClass + " resize-none"} />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <a
                  href="/admin/crm/leads"
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
                >
                  Cancel
                </a>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                >
                  {loading ? "Saving…" : "Create Lead"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
