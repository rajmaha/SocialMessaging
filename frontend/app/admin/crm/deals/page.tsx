"use client";

import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { authAPI, getAuthToken } from "@/lib/auth";
import { API_URL } from "@/lib/config";
import { useEvents } from "@/lib/events-context";
import { useCurrencySymbol, getCurrencySymbol } from "@/lib/branding-context";
import MainHeader from "@/components/MainHeader";
import AdminNav from "@/components/AdminNav";

interface Deal {
  id: number;
  lead_id: number;
  name: string;
  amount?: number;
  probability: number;
  stage: string;
  currency?: string;
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
  const { subscribe } = useEvents();
  const cs = useCurrencySymbol();
  const [deals, setDeals] = useState<Record<string, Deal[]>>(
    Object.fromEntries(STAGES.map((s) => [s, []]))
  );
  const [loading, setLoading] = useState(true);
  const token = getAuthToken();

  const fetchDeals = useCallback(async () => {
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
  }, [token]);

  useEffect(() => { fetchDeals(); }, [fetchDeals]);

  // Real-time updates
  useEffect(() => {
    const unsub1 = subscribe("crm_deal_created", () => fetchDeals());
    const unsub2 = subscribe("crm_deal_updated", () => fetchDeals());
    const unsub3 = subscribe("crm_deal_deleted", () => fetchDeals());
    const unsub4 = subscribe("crm_deal_stage_changed", () => fetchDeals());
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, [subscribe, fetchDeals]);

  const handleDragEnd = async (result: DropResult) => {
    const { source, destination, draggableId } = result;
    if (!destination || (source.droppableId === destination.droppableId && source.index === destination.index)) return;

    const dealId = parseInt(draggableId);
    const sourceStage = source.droppableId;
    const destStage = destination.droppableId;

    // Optimistic update
    const prev = { ...deals };
    const sourceList = [...(deals[sourceStage] || [])];
    const destList = sourceStage === destStage ? sourceList : [...(deals[destStage] || [])];
    const [moved] = sourceList.splice(source.index, 1);
    if (!moved) return;
    moved.stage = destStage;
    destList.splice(destination.index, 0, moved);

    setDeals({
      ...deals,
      [sourceStage]: sourceList,
      ...(sourceStage !== destStage ? { [destStage]: destList } : {}),
    });

    try {
      await axios.patch(`${API_URL}/crm/deals/${dealId}`, { stage: destStage }, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      console.error("Failed to update deal stage:", err);
      setDeals(prev);
      alert("Failed to update deal stage");
    }
  };

  const pipelineTotal = Object.values(deals).flat().reduce((sum, d) => sum + (d.amount || 0), 0);
  const totalDeals = Object.values(deals).flat().length;

  return (
    <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-50 pb-16 md:pb-0">
      <MainHeader user={user!} />
      <AdminNav />
      <main className="w-full px-6 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Sales Pipeline</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {totalDeals} deal{totalDeals !== 1 ? "s" : ""} ·{" "}
              <span className="text-green-700 font-medium">{cs}{pipelineTotal.toLocaleString()} total</span>
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
          <DragDropContext onDragEnd={handleDragEnd}>
            <div className="flex gap-4 overflow-x-auto pb-4">
              {STAGES.map((stage) => {
                const meta = STAGE_META[stage];
                const stageDeals = deals[stage];
                const stageTotal = stageDeals.reduce((s, d) => s + (d.amount || 0), 0);
                return (
                  <div key={stage} className="flex-shrink-0 w-56">
                    <div className={`${meta.header} rounded-t-lg px-3 py-2 flex justify-between items-center`}>
                      <span className="text-sm font-semibold">{meta.label}</span>
                      <span className="text-xs bg-black bg-opacity-20 px-1.5 py-0.5 rounded-full">
                        {stageDeals.length}
                      </span>
                    </div>
                    <Droppable droppableId={stage}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`bg-white border border-t-0 rounded-b-lg p-2 min-h-64 space-y-2 transition-colors ${
                            snapshot.isDraggingOver ? "bg-blue-50" : ""
                          }`}
                        >
                          {stageDeals.length === 0 && !snapshot.isDraggingOver ? (
                            <p className="text-xs text-gray-400 text-center py-4">No deals</p>
                          ) : (
                            stageDeals.map((deal, index) => (
                              <Draggable key={deal.id} draggableId={String(deal.id)} index={index}>
                                {(provided, snapshot) => (
                                  <div
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    {...provided.dragHandleProps}
                                    onClick={() => window.location.href = `/admin/crm/deals/${deal.id}`}
                                    className={`border ${meta.card} rounded-lg p-3 hover:shadow-sm transition bg-white cursor-pointer ${
                                      snapshot.isDragging ? "shadow-lg ring-2 ring-blue-300" : ""
                                    }`}
                                  >
                                    <p className="font-medium text-sm text-gray-900 truncate">{deal.name}</p>
                                    <p className="text-xs text-gray-500 mt-1">
                                      {deal.amount ? `${getCurrencySymbol(deal.currency)}${deal.amount.toLocaleString()}` : "—"}
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
                                  </div>
                                )}
                              </Draggable>
                            ))
                          )}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                    {stageDeals.length > 0 && (
                      <p className="text-xs text-gray-500 text-right mt-1 pr-1">
                        {cs}{stageTotal.toLocaleString()}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </DragDropContext>
        )}
      </main>
    </div>
  );
}
