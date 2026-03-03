"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

interface Deal {
  id: number;
  lead_id: number;
  name: string;
  amount?: number;
  probability: number;
  stage: string;
  created_at: string;
}

const STAGES = ["prospect", "qualified", "proposal", "negotiation", "close", "won", "lost"];

const STAGE_META: Record<string, { label: string; header: string; card: string }> = {
  prospect:    { label: "Prospect",    header: "bg-blue-600 text-white",    card: "border-blue-200" },
  qualified:   { label: "Qualified",   header: "bg-green-600 text-white",   card: "border-green-200" },
  proposal:    { label: "Proposal",    header: "bg-yellow-500 text-white",  card: "border-yellow-200" },
  negotiation: { label: "Negotiation", header: "bg-orange-500 text-white",  card: "border-orange-200" },
  close:       { label: "Close",       header: "bg-purple-600 text-white",  card: "border-purple-200" },
  won:         { label: "Won",         header: "bg-emerald-600 text-white", card: "border-emerald-200" },
  lost:        { label: "Lost",        header: "bg-red-600 text-white",     card: "border-red-200" },
};

export default function DealBoardPage() {
  const user = authAPI.getUser();
  const [deals, setDeals] = useState<Record<string, Deal[]>>(
    Object.fromEntries(STAGES.map((s) => [s, []]))
  );
  const [loading, setLoading] = useState(true);
  const token = getAuthToken();

  useEffect(() => { fetchDeals(); }, []);

  const fetchDeals = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/crm/deals`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const organized: Record<string, Deal[]> = Object.fromEntries(STAGES.map((s) => [s, []]));
      res.data.forEach((deal: Deal) => {
        if (organized[deal.stage]) organized[deal.stage].push(deal);
      });
      setDeals(organized);
    } catch (err) {
      console.error("Failed to fetch deals:", err);
    } finally {
      setLoading(false);
    }
  };

  const pipelineTotal = Object.values(deals).flat().reduce((sum, d) => sum + (d.amount || 0), 0);
  const totalDeals = Object.values(deals).flat().length;

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Sales Pipeline</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {totalDeals} deal{totalDeals !== 1 ? "s" : ""} ·{" "}
              <span className="text-green-700 font-medium">${pipelineTotal.toLocaleString()} total</span>
            </p>
          </div>
          <a
            href="/admin/crm/deals/new"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
          >
            + New Deal
          </a>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {STAGES.map((stage) => {
              const meta = STAGE_META[stage];
              const stageDeals = deals[stage];
              const stageTotal = stageDeals.reduce((s, d) => s + (d.amount || 0), 0);
              return (
                <div key={stage} className="flex-shrink-0 w-56">
                  {/* Column header */}
                  <div className={`${meta.header} rounded-t-lg px-3 py-2 flex justify-between items-center`}>
                    <span className="text-sm font-semibold">{meta.label}</span>
                    <span className="text-xs bg-black bg-opacity-20 px-1.5 py-0.5 rounded-full">
                      {stageDeals.length}
                    </span>
                  </div>
                  {/* Column body */}
                  <div className="bg-white border border-t-0 rounded-b-lg p-2 min-h-64 space-y-2">
                    {stageDeals.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-4">No deals</p>
                    ) : (
                      stageDeals.map((deal) => (
                        <a
                          key={deal.id}
                          href={`/admin/crm/deals/${deal.id}`}
                          className={`block border ${meta.card} rounded-lg p-3 hover:shadow-sm transition bg-white`}
                        >
                          <p className="font-medium text-sm text-gray-900 truncate">{deal.name}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            {deal.amount ? `$${deal.amount.toLocaleString()}` : "—"}
                          </p>
                          <div className="mt-2 flex items-center justify-between">
                            <div className="flex-1 bg-gray-200 rounded-full h-1 mr-2">
                              <div
                                className="bg-blue-500 h-1 rounded-full"
                                style={{ width: `${deal.probability}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500">{deal.probability}%</span>
                          </div>
                        </a>
                      ))
                    )}
                  </div>
                  {stageDeals.length > 0 && (
                    <p className="text-xs text-gray-500 text-right mt-1 pr-1">
                      ${stageTotal.toLocaleString()}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
