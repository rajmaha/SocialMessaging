"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

const STAGES = ["prospect","qualified","proposal","negotiation","close","won","lost"];

export default function EditDealPage() {
  const user = authAPI.getUser();
  const { id } = useParams();
  const router = useRouter();
  const token = getAuthToken();

  const [form, setForm] = useState<any>({
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
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      axios.get(`${API_URL}/crm/deals/${id}`, { headers: { Authorization: `Bearer ${token}` } }),
      axios.get(`${API_URL}/crm/leads`, { headers: { Authorization: `Bearer ${token}` } }),
    ])
      .then(([dealRes, leadsRes]) => {
        const d = dealRes.data;
        setForm({
          name: d.name || "",
          description: d.description || "",
          stage: d.stage || "prospect",
          amount: d.amount ?? "",
          probability: d.probability ?? 50,
          expected_close_date: d.expected_close_date
            ? new Date(d.expected_close_date).toISOString().slice(0, 10)
            : "",
        });
        setLeads(leadsRes.data);
      })
      .catch(err => setError(err.response?.data?.detail || "Failed to load deal"))
      .finally(() => setFetching(false));
  }, [id, token]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const payload: any = { ...form };
      if (payload.amount !== "") payload.amount = parseFloat(payload.amount);
      else delete payload.amount;
      payload.probability = parseInt(payload.probability);
      if (!payload.expected_close_date) delete payload.expected_close_date;
      await axios.patch(`${API_URL}/crm/deals/${id}`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      router.push(`/admin/crm/deals/${id}`);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to update deal");
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
          <a href={`/admin/crm/deals/${id}`} className="text-gray-400 hover:text-gray-600 text-sm">← Deal</a>
          <h1 className="text-2xl font-semibold text-gray-900">Edit Deal</h1>
        </div>

        <div className="max-w-2xl">
          <div className="bg-white rounded-lg shadow p-6">
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
            )}
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className={labelClass}>Deal name *</label>
                <input name="name" value={form.name} onChange={handleChange} required className={inputClass} placeholder="e.g. Enterprise plan upgrade" />
              </div>

              <div>
                <label className={labelClass}>Description</label>
                <textarea name="description" value={form.description} onChange={handleChange} rows={3} className={inputClass + " resize-none"} placeholder="Optional notes about this deal" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Stage</label>
                  <select name="stage" value={form.stage} onChange={handleChange} className={inputClass}>
                    {STAGES.map(s => (
                      <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Amount ($)</label>
                  <input name="amount" type="number" min={0} value={form.amount} onChange={handleChange} className={inputClass} placeholder="0" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                  href={`/admin/crm/deals/${id}`}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
                >
                  Cancel
                </a>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                >
                  {loading ? "Saving…" : "Update Deal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
