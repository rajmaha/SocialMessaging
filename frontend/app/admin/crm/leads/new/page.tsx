"use client";

import { useState, useEffect, useRef } from "react";
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
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState("")
  const [orgQuery, setOrgQuery] = useState("")
  const [showOrgDropdown, setShowOrgDropdown] = useState(false)
  const [orgHighlight, setOrgHighlight] = useState(-1)
  const orgRef = useRef<HTMLDivElement>(null)
  const [sourceQuery, setSourceQuery] = useState("Other")
  const [showSourceDropdown, setShowSourceDropdown] = useState(false)
  const [sourceHighlight, setSourceHighlight] = useState(-1)
  const sourceRef = useRef<HTMLDivElement>(null)
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
    tags: [] as string[],
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<any[]>([]);
  const dupTimerRef = useRef<NodeJS.Timeout | null>(null);

  const checkDuplicates = (email?: string, phone?: string, name?: string) => {
    if (dupTimerRef.current) clearTimeout(dupTimerRef.current);
    dupTimerRef.current = setTimeout(async () => {
      const params = new URLSearchParams();
      if (email) params.set("email", email);
      if (phone) params.set("phone", phone);
      if (name) params.set("name", name);
      if (!params.toString()) { setDuplicateWarning([]); return; }
      try {
        const res = await axios.get(`${API_URL}/crm/leads/check-duplicate?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setDuplicateWarning(res.data || []);
      } catch { setDuplicateWarning([]); }
    }, 500);
  };

  useEffect(() => {
    api.get('/crm/organizations?limit=200').then(r => setOrgs(r.data))
    api.get('/crm/tags').then(r => setAvailableTags(r.data)).catch(() => {})
  }, [])

  // Close dropdowns on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (orgRef.current && !orgRef.current.contains(e.target as Node)) {
        setShowOrgDropdown(false)
      }
      if (sourceRef.current && !sourceRef.current.contains(e.target as Node)) {
        setShowSourceDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filteredOrgs = orgQuery.trim()
    ? orgs.filter(o => o.organization_name.toLowerCase().includes(orgQuery.toLowerCase()))
    : orgs

  const filteredSources = sourceQuery.trim()
    ? SOURCES.filter(s => s.label.toLowerCase().includes(sourceQuery.toLowerCase()))
    : SOURCES

  const selectSource = (s: {value: string, label: string}) => {
    setForm(f => ({...f, source: s.value}));
    setSourceQuery(s.label);
    setShowSourceDropdown(false);
    setSourceHighlight(-1);
  }

  const selectOrg = (o: {id: number, organization_name: string}) => {
    setForm(f => ({...f, organization_id: o.id, company: ''}));
    setOrgQuery(o.organization_name);
    setShowOrgDropdown(false);
    setOrgHighlight(-1);
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const updated = { ...form, [e.target.name]: e.target.value };
    setForm(updated);
    if (["email", "phone", "first_name"].includes(e.target.name)) {
      checkDuplicates(updated.email, updated.phone, updated.first_name);
    }
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
      const detail = err.response?.data?.detail;
      if (Array.isArray(detail)) {
        setError(detail.map((d: any) => d.msg || JSON.stringify(d)).join(", "));
      } else {
        setError(detail || "Failed to create lead");
      }
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
            {duplicateWarning.length > 0 && (
              <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm">
                <p className="font-medium text-yellow-800">Possible duplicates found ({duplicateWarning.length}):</p>
                <ul className="mt-1 space-y-1">
                  {duplicateWarning.map((d: any) => (
                    <li key={d.id} className="text-yellow-700">
                      <a href={`/admin/crm/leads/${d.id}`} className="hover:underline" target="_blank">
                        {d.first_name} {d.last_name || ""} {d.email ? `(${d.email})` : ""} {d.company ? `- ${d.company}` : ""}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
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

              <div ref={orgRef} className="relative">
                <label className={labelClass}>Organization / Company</label>
                <div className="relative">
                  <input
                    type="text"
                    value={orgQuery}
                    onChange={e => {
                      setOrgQuery(e.target.value);
                      setForm(f => ({...f, organization_id: null, company: e.target.value}));
                      setShowOrgDropdown(true);
                      setOrgHighlight(-1);
                    }}
                    onFocus={() => { setShowOrgDropdown(true); setOrgHighlight(-1); }}
                    onKeyDown={e => {
                      if (!showOrgDropdown || form.organization_id) return;
                      const list = filteredOrgs;
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setOrgHighlight(prev => (prev < list.length - 1 ? prev + 1 : 0));
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setOrgHighlight(prev => (prev > 0 ? prev - 1 : list.length - 1));
                      } else if (e.key === 'Enter' && orgHighlight >= 0 && orgHighlight < list.length) {
                        e.preventDefault();
                        selectOrg(list[orgHighlight]);
                      } else if (e.key === 'Escape') {
                        setShowOrgDropdown(false);
                        setOrgHighlight(-1);
                      }
                    }}
                    placeholder="Type to search existing or enter new organization"
                    className={inputClass}
                    autoComplete="off"
                  />
                  {form.organization_id && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">Existing</span>
                      <button type="button" onClick={() => {
                        setForm(f => ({...f, organization_id: null, company: orgQuery}));
                      }} className="text-gray-400 hover:text-gray-600 text-sm">&times;</button>
                    </span>
                  )}
                </div>
                {showOrgDropdown && filteredOrgs.length > 0 && !form.organization_id && (
                  <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {filteredOrgs.map((o, idx) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => selectOrg(o)}
                        onMouseEnter={() => setOrgHighlight(idx)}
                        className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                          idx === orgHighlight ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'
                        }`}
                      >
                        {o.organization_name}
                      </button>
                    ))}
                  </div>
                )}
                {orgQuery.trim() && !form.organization_id && (
                  <p className="text-xs text-gray-400 mt-1">New organization &ldquo;{orgQuery.trim()}&rdquo; will be created</p>
                )}
              </div>

              <div>
                <label className={labelClass}>Position</label>
                <input name="position" value={form.position} onChange={handleChange} className={inputClass} />
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
                <div ref={sourceRef} className="relative">
                  <label className={labelClass}>Source</label>
                  <input
                    type="text"
                    value={sourceQuery}
                    onChange={e => {
                      setSourceQuery(e.target.value);
                      setShowSourceDropdown(true);
                      setSourceHighlight(-1);
                      // If typed text exactly matches a source label, select it
                      const match = SOURCES.find(s => s.label.toLowerCase() === e.target.value.toLowerCase());
                      if (match) {
                        setForm(f => ({...f, source: match.value}));
                      }
                    }}
                    onFocus={() => { setShowSourceDropdown(true); setSourceHighlight(-1); }}
                    onKeyDown={e => {
                      if (!showSourceDropdown) return;
                      const list = filteredSources;
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setSourceHighlight(prev => (prev < list.length - 1 ? prev + 1 : 0));
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setSourceHighlight(prev => (prev > 0 ? prev - 1 : list.length - 1));
                      } else if (e.key === 'Enter' && sourceHighlight >= 0 && sourceHighlight < list.length) {
                        e.preventDefault();
                        selectSource(list[sourceHighlight]);
                      } else if (e.key === 'Escape') {
                        setShowSourceDropdown(false);
                        setSourceHighlight(-1);
                      }
                    }}
                    onBlur={() => {
                      // On blur, if text doesn't match any source, reset to current selection
                      setTimeout(() => {
                        const match = SOURCES.find(s => s.label.toLowerCase() === sourceQuery.toLowerCase());
                        if (!match) {
                          const current = SOURCES.find(s => s.value === form.source);
                          setSourceQuery(current?.label || 'Other');
                        }
                      }, 200);
                    }}
                    placeholder="Search source..."
                    className={inputClass}
                    autoComplete="off"
                  />
                  {showSourceDropdown && filteredSources.length > 0 && (
                    <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {filteredSources.map((s, idx) => (
                        <button
                          key={s.value}
                          type="button"
                          onClick={() => selectSource(s)}
                          onMouseEnter={() => setSourceHighlight(idx)}
                          className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                            idx === sourceHighlight ? 'bg-blue-50 text-blue-700' : form.source === s.value ? 'bg-gray-50 font-medium' : 'hover:bg-gray-50'
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className={labelClass}>Remarks</label>
                <textarea name="remarks" value={form.remarks} onChange={(e: any) => setForm({...form, remarks: e.target.value})} rows={3} className={inputClass + " resize-none"} />
              </div>

              <div>
                <label className={labelClass}>Tags</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {form.tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      {tag}
                      <button type="button" onClick={() => setForm({...form, tags: form.tags.filter(t => t !== tag)})} className="text-blue-500 hover:text-blue-700 ml-0.5">&times;</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && tagInput.trim()) {
                        e.preventDefault();
                        const tag = tagInput.trim();
                        if (!form.tags.includes(tag)) {
                          setForm({...form, tags: [...form.tags, tag]});
                        }
                        setTagInput("");
                      }
                    }}
                    placeholder="Type a tag and press Enter"
                    className={inputClass}
                    list="tag-suggestions"
                  />
                  <datalist id="tag-suggestions">
                    {availableTags.filter(t => !form.tags.includes(t)).map(t => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </div>
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
