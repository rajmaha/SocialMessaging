"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

export default function NewDealPage() {
  const user = authAPI.getUser();
  const router = useRouter();
  const params = useSearchParams();
  const token = getAuthToken();

  const [form, setForm] = useState<any>({
    lead_id: params?.get("lead_id") || "",
    name: "",
    description: "",
    stage: "prospect",
    amount: "",
    probability: 50,
    expected_close_date: "",
  });
  const [leads, setLeads] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    axios
      .get(`${API_URL}/crm/leads`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setLeads(res.data))
      .catch(() => {});
  }, [token]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await axios.post(
        `${API_URL}/crm/deals`,
        { ...form, amount: form.amount ? parseFloat(form.amount) : undefined, probability: parseInt(form.probability) },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      router.push("/admin/crm/deals");
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to create deal");
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm";
  const labelClass = "block text-sm font-medium text-gray-700 mb-1";

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8">
        <div className="mb-6 flex items-center gap-3">
          <a href="/admin/crm/deals" className="text-gray-400 hover:text-gray-600 text-sm">← Pipeline</a>
          <h1 className="text-2xl font-semibold text-gray-900">New Deal</h1>
        </div>

        <div className="max-w-2xl">
          <div className="bg-white rounded-lg shadow p-6">
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
            )}
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className={labelClass}>Lead *</label>
                <select name="lead_id" value={form.lead_id} onChange={handleChange} required className={inputClass}>
                  <option value="">— select a lead —</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>{l.first_name} {l.last_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelClass}>Deal name *</label>
                <input name="name" value={form.name} onChange={handleChange} required className={inputClass} placeholder="e.g. Enterprise plan upgrade" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Stage</label>
                  <select name="stage" value={form.stage} onChange={handleChange} className={inputClass}>
                    {["prospect","qualified","proposal","negotiation","close","won","lost"].map((s) => (
                      <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Amount ($)</label>
                  <input name="amount" type="number" min={0} value={form.amount} onChange={handleChange} className={inputClass} placeholder="0" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Probability ({form.probability}%)</label>
                  <input
                    name="probability"
                    type="range"
                    min={0}
                    max={100}
                    value={form.probability}
                    onChange={handleChange}
                    className="w-full mt-2 accent-blue-600"
                  />
                </div>
                <div>
                  <label className={labelClass}>Expected close date</label>
                  <input name="expected_close_date" type="date" value={form.expected_close_date} onChange={handleChange} className={inputClass} />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <a
                  href="/admin/crm/deals"
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
                >
                  Cancel
                </a>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                >
                  {loading ? "Saving…" : "Create Deal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
