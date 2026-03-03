"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";

interface PricingPlan {
  id: number;
  name: string;
  amount_cents: number;
  currency: string;
  interval: string;
  description?: string;
  stripe_price_id?: string;
}

const EMPTY_FORM = {
  name: "",
  amount_cents: 0,
  currency: "npr",
  interval: "month",
  description: "",
  stripe_price_id: "",
};

export default function PricingManagement() {
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const headers = () => {
    const token = getAuthToken();
    return { Authorization: token ? `Bearer ${token}` : "" };
  };

  const fetchPlans = () => {
    axios
      .get(`${API_URL}/billing/pricing-plans`, { headers: headers() })
      .then((res) => setPlans(res.data))
      .catch(console.error);
  };

  useEffect(() => {
    fetchPlans();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await axios.post(
        `${API_URL}/billing/pricing-plans`,
        {
          ...form,
          amount_cents: Number(form.amount_cents),
          stripe_price_id: form.stripe_price_id || null,
          description: form.description || null,
        },
        { headers: headers() }
      );
      setForm(EMPTY_FORM);
      setShowForm(false);
      fetchPlans();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to create plan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-500">{plans.length} plan{plans.length !== 1 ? "s" : ""}</p>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
        >
          {showForm ? "Cancel" : "+ New Plan"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="border rounded p-4 mb-6 bg-gray-50 space-y-3">
          <h2 className="font-semibold text-gray-700">Create Pricing Plan</h2>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
              <input
                required
                className="w-full border rounded px-3 py-2 text-sm"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Pro Monthly"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Amount (cents) *</label>
              <input
                required
                type="number"
                min={0}
                className="w-full border rounded px-3 py-2 text-sm"
                value={form.amount_cents}
                onChange={(e) => setForm({ ...form, amount_cents: Number(e.target.value) })}
                placeholder="e.g. 2900 for $29.00"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Currency *</label>
              <select
                className="w-full border rounded px-3 py-2 text-sm"
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
              >
                <option value="usd">USD</option>
                <option value="eur">EUR</option>
                <option value="gbp">GBP</option>
                <option value="npr">NPR</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Interval *</label>
              <select
                className="w-full border rounded px-3 py-2 text-sm"
                value={form.interval}
                onChange={(e) => setForm({ ...form, interval: e.target.value })}
              >
                <option value="month">Monthly</option>
                <option value="year">Yearly</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Stripe Price ID</label>
            <input
              className="w-full border rounded px-3 py-2 text-sm"
              value={form.stripe_price_id}
              onChange={(e) => setForm({ ...form, stripe_price_id: e.target.value })}
              placeholder="price_..."
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
            <textarea
              className="w-full border rounded px-3 py-2 text-sm"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Optional description shown to customers"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-50"
          >
            {saving ? "Saving…" : "Create Plan"}
          </button>
        </form>
      )}

      {plans.length === 0 && !showForm ? (
        <div className="text-center py-12 text-gray-400 border rounded">
          <p className="mb-2">No pricing plans yet.</p>
          <button
            onClick={() => setShowForm(true)}
            className="text-blue-600 hover:underline text-sm"
          >
            Create your first plan
          </button>
        </div>
      ) : (
        <ul className="space-y-2">
          {plans.map((plan) => (
            <li key={plan.id} className="border rounded p-3 flex justify-between items-start">
              <div>
                <p className="font-medium">{plan.name}</p>
                {plan.description && (
                  <p className="text-sm text-gray-500">{plan.description}</p>
                )}
                {plan.stripe_price_id && (
                  <p className="text-xs text-gray-400 font-mono mt-1">{plan.stripe_price_id}</p>
                )}
              </div>
              <div className="text-right text-sm shrink-0 ml-4">
                <span className="font-semibold">
                  {(plan.amount_cents / 100).toFixed(2)} {plan.currency.toUpperCase()}
                </span>
                <span className="text-gray-400">/{plan.interval}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
