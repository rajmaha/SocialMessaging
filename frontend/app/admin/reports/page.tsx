'use client';

import { useState, useEffect, useCallback } from 'react';
import MainHeader from "@/components/MainHeader";
import { authAPI } from "@/lib/auth";
import { useRouter } from 'next/navigation';
import { getAuthToken } from '@/lib/auth';
import AdminNav from '@/components/AdminNav';
import { API_URL } from '@/lib/config';


interface Summary {
  total: number;
  open: number;
  pending: number;
  resolved: number;
  forwarded: number;
  avg_first_response_min: number | null;
  avg_resolution_min: number | null;
  avg_rating: number | null;
  rated_count: number;
  by_category: Record<string, number>;
  highlights: {
    top_solver: { name: string; count: number };
    top_claimer: { name: string; count: number };
    most_complaints: { name: string; count: number };
  };
}

interface AgentStat {
  agent_id: number;
  name: string;
  real_name: string;
  role: string;
  claimed: number;
  responded: number;
  open: number;
  pending: number;
  resolved: number;
  forwarded: number;
  avg_first_response_min: number | null;
  avg_resolution_min: number | null;
  avg_rating: number | null;
  rated_count: number;
}

interface ConvItem {
  id: number;
  contact_name: string;
  contact_id: string;
  platform: string;
  status: string;
  category: string;
  assigned_to_name: string | null;
  assigned_team_name: string | null;
  forwarded_count: number;
  rating: number | null;
  rating_comment: string | null;
  created_at: string;
  resolved_at: string | null;
  first_response_at: string | null;
}

interface HandoverItem {
  id: number;
  conversation_id: number;
  visitor_name: string;
  platform: string;
  timestamp: string;
  initiator: string;
  target: string;
  reason: string;
  raw_text: string;
}

interface Message {
  id: number;
  message_text: string;
  sender_name: string;
  is_sent: number;
  timestamp: string;
  message_type: string;
}

interface EmailStat {
  agent_id: number;
  name: string;
  received_count: number;
  sent_new_count: number;
  replied_count: number;
  got_replied_count: number;
}

interface EmailItem {
  id: number;
  subject: string;
  body_snippet: string;
  from_address: string;
  to_address: string;
  received_at: string;
  is_sent: boolean;
  type: string;
  agent_name: string;
  thread_id: number | null;
  message_count: number;
}

interface Agent { id: number; full_name: string; role: string }
interface Team { id: number; name: string }

const CATEGORIES = ['General', 'Billing', 'Technical Support', 'Sales', 'Complaint', 'Other'];

const statusBadge = (s: string) => {
  const m: Record<string, string> = {
    open: 'bg-blue-100 text-blue-700',
    pending: 'bg-amber-100 text-amber-700',
    resolved: 'bg-green-100 text-green-700',
  };
  return m[s] || 'bg-gray-100 text-gray-600';
};

const platformBadge = (p: string) => {
  const m: Record<string, string> = {
    whatsapp: 'bg-green-100 text-green-800',
    facebook: 'bg-blue-100 text-blue-800',
    webchat: 'bg-teal-100 text-teal-800',
    viber: 'bg-purple-100 text-purple-800',
    email: 'bg-orange-100 text-orange-800',
  };
  return m[p.toLowerCase()] || 'bg-gray-100 text-gray-600';
};

const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
const fmtMin = (m: number | null) => m == null ? '—' : m < 60 ? `${m}m` : `${(m / 60).toFixed(1)}h`;


export default function ReportsPage() {
  const user = authAPI.getUser();
  const router = useRouter();

  // Filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [agentId, setAgentId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [visitor, setVisitor] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [emailSearch, setEmailSearch] = useState('');

  // Data
  const [summary, setSummary] = useState<Summary | null>(null);
  const [agentStats, setAgentStats] = useState<AgentStat[]>([]);
  const [convItems, setConvItems] = useState<ConvItem[]>([]);
  const [handoverItems, setHandoverItems] = useState<HandoverItem[]>([]);
  const [emailStats, setEmailStats] = useState<EmailStat[]>([]);
  const [emailItems, setEmailItems] = useState<EmailItem[]>([]);
  const [convTotal, setConvTotal] = useState(0);
  const [handoverTotal, setHandoverTotal] = useState(0);
  const [emailTotal, setEmailTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [handoverPage, setHandoverPage] = useState(1);
  const [emailPage, setEmailPage] = useState(1);
  const [agentPage, setAgentPage] = useState(1);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);

  // Sorting
  const [sortField, setSortField] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'summary' | 'agents' | 'conversations' | 'handovers' | 'emails'>('agents');

  // Modal State
  const [selectedConv, setSelectedConv] = useState<{ id: number, visitor: string } | null>(null);
  const [modalMessages, setModalMessages] = useState<Message[]>([]);
  const [modalLoading, setModalLoading] = useState(false);

  const authHeaders = useCallback(() => {
    const token = getAuthToken();
    if (!token) { router.push('/login'); return null; }
    return { Authorization: `Bearer ${token}` };
  }, [router]);

  // Load agents + teams for filter dropdowns
  useEffect(() => {
    const h = authHeaders();
    if (!h) return;
    fetch(`${API_URL}/conversations/agents`, { headers: h })
      .then(r => r.json()).then(d => setAgents(Array.isArray(d) ? d : [])).catch(() => { });
    fetch(`${API_URL}/teams/`, { headers: h })
      .then(r => r.json()).then(d => setTeams(Array.isArray(d) ? d : [])).catch(() => { });
  }, []); // eslint-disable-line

  const buildQS = (extra: Record<string, string | number> = {}) => {
    const p = new URLSearchParams();
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    if (agentId) p.set('agent_id', agentId);
    if (teamId) p.set('team_id', teamId);
    if (visitor) p.set('visitor', visitor);
    if (statusFilter) p.set('status', statusFilter);
    if (categoryFilter) p.set('category', categoryFilter);
    Object.entries(extra).forEach(([k, v]) => p.set(k, String(v)));
    return p.toString();
  };

  const loadAll = useCallback(async (pg = 1) => {
    const h = authHeaders();
    if (!h) return;
    setLoading(true);
    setError('');
    try {
      const qs = buildQS();
      const [sumR, agR, convR, handR, emailSumR, emailR] = await Promise.all([
        fetch(`${API_URL}/reports/summary?${qs}`, { headers: h }),
        fetch(`${API_URL}/reports/agents?${qs}`, { headers: h }),
        fetch(`${API_URL}/reports/conversations?${buildQS({ page: pg, limit: 25 })}`, { headers: h }),
        fetch(`${API_URL}/reports/handovers?${buildQS({ page: handoverPage, limit: 50 })}`, { headers: h }),
        fetch(`${API_URL}/reports/emails/summary?${qs}`, { headers: h }),
        fetch(`${API_URL}/reports/emails?${buildQS({ page: emailPage, limit: 50, search: emailSearch })}`, { headers: h }),
      ]);
      if (sumR.status === 403) { router.push('/dashboard'); return; }

      const [sumD, agD, convD, handD, emailSumD, emailD] = await Promise.all([
        sumR.json(), agR.json(), convR.json(), handR.json(),
        emailSumR.ok ? emailSumR.json() : [], emailR.ok ? emailR.json() : { total: 0, items: [] }
      ]);

      setSummary(sumD);
      setAgentStats(agD);
      setConvItems(convD.items || []);
      setHandoverItems(handD.items || []);
      setEmailStats(Array.isArray(emailSumD) ? emailSumD : []);
      setEmailItems(emailD.items || []);

      setConvTotal(convD.total || 0);
      setHandoverTotal(handD.total || 0);
      setEmailTotal(emailD.total || 0);
      setPage(pg);
    } catch {
      setError('Failed to load report data');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, agentId, teamId, visitor, statusFilter, categoryFilter, handoverPage, emailPage, emailSearch, authHeaders, router]); // eslint-disable-line

  useEffect(() => { loadAll(1); }, []); // eslint-disable-line

  const handleApply = () => loadAll(1);
  const handleReset = () => {
    setDateFrom(''); setDateTo(''); setAgentId(''); setTeamId('');
    setVisitor(''); setStatusFilter(''); setCategoryFilter('');
    setTimeout(() => loadAll(1), 0);
  };

  const totalPages = Math.ceil(convTotal / 25);
  const handoverPages = Math.ceil(handoverTotal / 50);
  const emailPages = Math.ceil(emailTotal / 50);
  const agentItemsPerPage = 15;
  const agentPages = Math.ceil(agentStats.length / agentItemsPerPage);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const sortedData = <T extends Record<string, any>>(data: T[]) => {
    if (!sortField) return data;
    return [...data].sort((a, b) => {
      const va = a[sortField];
      const vb = b[sortField];
      if (va === vb) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const res = va < vb ? -1 : 1;
      return sortOrder === 'asc' ? res : -res;
    });
  };

  const handleDrilldown = (category: string) => {
    setCategoryFilter(category);
    setActiveTab('conversations');
    setTimeout(() => loadAll(1), 0);
  };

  const openConversationModal = async (id: number, visitor: string) => {
    const h = authHeaders();
    if (!h) return;
    setSelectedConv({ id, visitor });
    setModalLoading(true);
    try {
      const res = await fetch(`${API_URL}/messages/conversation/${id}?limit=100`, { headers: h });
      if (res.ok) {
        const data = await res.json();
        setModalMessages(data.messages || []);
      }
    } catch {
      // Ignore
    } finally {
      setModalLoading(false);
    }
  };

  const [selectedEmailThread, setSelectedEmailThread] = useState<{ id: number, subject: string } | null>(null);
  const [emailModalMessages, setEmailModalMessages] = useState<any[]>([]);
  const [emailModalLoading, setEmailModalLoading] = useState(false);

  const openEmailModal = async (thread_id: number | null, subject: string, email_id: number) => {
    const h = authHeaders();
    if (!h) return;
    setSelectedEmailThread({ id: thread_id || email_id, subject });
    setEmailModalLoading(true);
    try {
      if (thread_id) {
        const res = await fetch(`${API_URL}/reports/emails/thread/${thread_id}`, { headers: h });
        if (res.ok) {
          const data = await res.json();
          setEmailModalMessages(data.emails || []);
        }
      } else {
        const res = await fetch(`${API_URL}/reports/emails/${email_id}`, { headers: h });
        if (res.ok) {
          const data = await res.json();
          setEmailModalMessages([data]);
        }
      }
    } catch {
      // Ignore
    } finally {
      setEmailModalLoading(false);
    }
  };

  const exportToCSV = () => {
    if (activeTab === 'agents') {
      const headers = ['Agent', 'Role', 'Claimed', 'Responded', 'Open', 'Pending', 'Resolved', 'Forwarded', 'Avg Response', 'Avg Resolution', 'Avg Rating'];
      const data = agentStats.map(a => [
        a.name,
        a.role,
        a.claimed,
        a.responded,
        a.open,
        a.pending,
        a.resolved,
        a.forwarded,
        a.avg_first_response_min || '',
        a.avg_resolution_min || '',
        a.avg_rating || ''
      ]);
      const csvContent = [headers, ...data].map(e => e.join(",")).join("\n");
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `agent_performance_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else if (activeTab === 'handovers') {
      const headers = ['ID', 'Visitor', 'Initiator', 'Target', 'Reason', 'Timestamp', 'Raw Text'];
      const data = handoverItems.map(h => [
        h.id,
        h.visitor_name,
        h.initiator,
        h.target,
        h.reason,
        h.timestamp,
        h.raw_text.replace(/,/g, ";")
      ]);
      const csvContent = [headers, ...data].map(e => e.join(",")).join("\n");
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `handover_report_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else if (activeTab === 'emails') {
      const headers = ['Agent Name', 'New Received', 'New Sent', 'Replied to Received', 'Received Replies'];
      const data = emailStats.map(e => [
        `"${e.name.replace(/"/g, '""')}"`,
        e.received_count,
        e.sent_new_count,
        e.replied_count,
        e.got_replied_count
      ]);
      const csvContent = [headers, ...data].map(row => row.join(",")).join("\n");
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `email_stats_report_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      const headers = ['ID', 'Visitor', 'Platform', 'Agent', 'Team', 'Status', 'Category', 'Forwarded', 'Rating', 'Created', 'Resolved'];
      const data = convItems.map(c => [
        c.id,
        c.contact_name,
        c.platform,
        c.assigned_to_name || '',
        c.assigned_team_name || '',
        c.status,
        c.category,
        c.forwarded_count,
        c.rating || '',
        c.created_at,
        c.resolved_at || ''
      ]);
      const csvContent = [headers, ...data].map(e => e.join(",")).join("\n");
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `conversations_report_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-100">
      <MainHeader user={user!} />
      <AdminNav />

      <main className="w-full p-6">
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-gray-900">Conversation Reports</h2>
          <p className="text-gray-500 mt-1 text-sm">Filter by date, agent, team, visitor or issue type to drill into performance metrics.</p>
        </div>

        {/* --- Filter bar --- */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Date from</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="w-full text-sm px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Date to</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="w-full text-sm px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Agent</label>
              <select value={agentId} onChange={e => setAgentId(e.target.value)}
                className="w-full text-sm px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400">
                <option value="">All agents</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Team</label>
              <select value={teamId} onChange={e => setTeamId(e.target.value)}
                className="w-full text-sm px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400">
                <option value="">All teams</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Visitor</label>
              <input type="text" value={visitor} onChange={e => setVisitor(e.target.value)} placeholder="Search name…"
                className="w-full text-sm px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                className="w-full text-sm px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400">
                <option value="">All statuses</option>
                <option value="open">Open</option>
                <option value="pending">Pending</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
              <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
                className="w-full text-sm px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400">
                <option value="">All categories</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={handleApply}
              className="px-4 py-2 text-white text-sm font-medium rounded transition"
              style={{ backgroundColor: 'var(--button-primary)' }}
            >
              Apply Filters
            </button>
            <button onClick={handleReset}
              className="px-4 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded hover:bg-gray-200 transition">
              Reset
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">{error}</div>
        )}

        {loading && (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
          </div>
        )}

        {!loading && summary && (
          <>
            {/* --- Performance Highlights --- */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="rounded-2xl shadow-xl p-6 text-white overflow-hidden relative group" style={{ background: 'linear-gradient(to bottom right, var(--primary-color), var(--secondary-color))' }}>
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                  <div className="text-6xl font-black italic uppercase tracking-tighter">Win</div>
                </div>
                <h4 className="text-sm font-bold uppercase tracking-widest text-blue-100 mb-2 flex items-center gap-2">
                  <span className="text-xl">🏆</span> Top Solver
                </h4>
                <p className="text-3xl font-black mb-1 truncate">{summary.highlights.top_solver.name}</p>
                <div className="flex items-end justify-between">
                  <p className="text-blue-100 text-sm font-medium">Resolved {summary.highlights.top_solver.count} issues</p>
                  <span className="bg-white/20 px-2 py-0.5 rounded text-[10px] font-bold uppercase">Efficiency Leader</span>
                </div>
              </div>

              <div className="rounded-2xl shadow-xl p-6 text-white overflow-hidden relative group" style={{ background: 'linear-gradient(to bottom right, var(--secondary-color), var(--primary-color))' }}>
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                  <div className="text-6xl font-black italic uppercase tracking-tighter">Fast</div>
                </div>
                <h4 className="text-sm font-bold uppercase tracking-widest text-indigo-100 mb-2 flex items-center gap-2">
                  <span className="text-xl">⚡</span> Top Claimer
                </h4>
                <p className="text-3xl font-black mb-1 truncate">{summary.highlights.top_claimer.name}</p>
                <div className="flex items-end justify-between">
                  <p className="text-indigo-100 text-sm font-medium">Claimed {summary.highlights.top_claimer.count} chats</p>
                  <span className="bg-white/20 px-2 py-0.5 rounded text-[10px] font-bold uppercase">Proactive Agent</span>
                </div>
              </div>

              <div className="bg-gradient-to-br from-red-600 to-red-700 rounded-2xl shadow-xl p-6 text-white overflow-hidden relative group">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                  <div className="text-6xl font-black italic uppercase tracking-tighter">Care</div>
                </div>
                <h4 className="text-sm font-bold uppercase tracking-widest text-red-100 mb-2 flex items-center gap-2">
                  <span className="text-xl">⚠️</span> Attention Needed
                </h4>
                <p className="text-3xl font-black mb-1 truncate">{summary.highlights.most_complaints.name}</p>
                <div className="flex items-end justify-between">
                  <p className="text-red-100 text-sm font-medium">{summary.highlights.most_complaints.count} recent complaints</p>
                  <span className="bg-white/20 px-2 py-0.5 rounded text-[10px] font-bold uppercase">Support Focus</span>
                </div>
              </div>
            </div>

            {/* --- Summary cards --- */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
              {[
                { label: 'Total', value: summary.total, color: 'text-gray-900' },
                { label: 'Open', value: summary.open, color: 'text-blue-600' },
                { label: 'Pending', value: summary.pending, color: 'text-amber-600' },
                { label: 'Resolved', value: summary.resolved, color: 'text-green-600' },
                { label: 'Forwarded', value: summary.forwarded, color: 'text-purple-600' },
                { label: 'Avg 1st Response', value: fmtMin(summary.avg_first_response_min), color: 'text-teal-600' },
                { label: 'Avg Resolution', value: fmtMin(summary.avg_resolution_min), color: 'text-indigo-600' }, { label: 'Avg Rating', value: summary.avg_rating ? `${summary.avg_rating.toFixed(1)} ★` : '—', color: 'text-amber-500' },].map(c => (
                  <div key={c.label} className="bg-white rounded-lg shadow p-4 text-center">
                    <p className="text-xs text-gray-500 font-medium mb-1">{c.label}</p>
                    <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
                  </div>
                ))}
            </div>

            {/* --- Category breakdown bar chart --- */}
            {Object.keys(summary.by_category).length > 0 && (
              <div className="bg-white rounded-lg shadow p-5 mb-6">
                <h3 className="text-base font-semibold text-gray-800 mb-4">Issues by Category</h3>
                <div className="space-y-3">
                  {Object.entries(summary.by_category)
                    .sort(([, a], [, b]) => b - a)
                    .map(([cat, count]) => {
                      const pct = summary.total ? Math.round((count / summary.total) * 100) : 0;
                      return (
                        <div key={cat} className="flex items-center gap-3 cursor-pointer group" onClick={() => handleDrilldown(cat)}>
                          <span className="text-sm text-gray-600 w-36 flex-shrink-0 group-hover:text-blue-600 group-hover:font-semibold transition-all">{cat}</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden shadow-inner">
                            <div
                              className="h-4 rounded-full bg-blue-500 group-hover:bg-blue-600 transition-all duration-500 relative"
                              style={{ width: `${pct}%` }}
                            >
                              <div className="absolute inset-0 bg-white/10 group-hover:bg-transparent" />
                            </div>
                          </div>
                          <span className="text-sm font-semibold text-gray-700 w-16 text-right group-hover:text-blue-600 transition-colors">{count} <span className="text-gray-400 font-normal">({pct}%)</span></span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* --- Tabs: Agents / Conversations --- */}
            <div className="bg-white rounded-lg shadow">
              <div className="border-b border-gray-200 px-5 pt-4 flex flex-wrap items-center justify-between">
                <div className="flex gap-1 overflow-x-auto">
                  {(['summary', 'agents', 'conversations', 'handovers', 'emails'] as const).map(t => (
                    <button key={t} onClick={() => setActiveTab(t)}
                      className={`px-4 py-2 text-sm font-medium border-b-2 transition capitalize whitespace-nowrap ${activeTab === t
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}>
                      {t === 'summary' ? 'Overview' : t === 'agents' ? 'Per-Agent Breakdown' : t === 'handovers' ? 'Handover Logs' : t === 'emails' ? 'Email Reports' : `Conversations (${convTotal})`}
                    </button>
                  ))}
                </div>
                <button
                  onClick={exportToCSV}
                  className="mb-2 px-3 py-1.5 bg-green-600 text-white text-xs font-bold rounded hover:bg-green-700 transition flex items-center gap-2 uppercase tracking-wider"
                >
                  📥 Export CSV
                </button>
              </div>

              <div className="p-5">
                {/* Summary View (Overview) */}
                {activeTab === 'summary' && (
                  <div className="space-y-6">
                    <p className="text-sm text-gray-500">Select another tab for detailed breakdown or conversations list.</p>
                    <div className="p-12 border-2 border-dashed border-gray-100 rounded-xl flex flex-col items-center justify-center text-center">
                      <div className="text-4xl mb-2">📊</div>
                      <p className="text-gray-400 max-w-xs">Detailed agent performance and conversation logs are available in the other tabs.</p>
                    </div>
                  </div>
                )}

                {/* Per-Agent table */}
                {activeTab === 'agents' && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-500 uppercase border-b">
                          <th className="pb-3 pr-4 font-bold text-gray-400">SN</th>
                          <th className="pb-3 pr-4 font-bold cursor-pointer hover:text-blue-600 transition" onClick={() => handleSort('name')}>
                            Agent {sortField === 'name' && (sortOrder === 'asc' ? '↑' : '↓')}
                          </th>
                          <th className="pb-3 pr-4 font-bold">Role</th>
                          <th className="pb-3 pr-4 font-bold text-right cursor-pointer hover:text-blue-600 transition" onClick={() => handleSort('claimed')}>
                            Claimed {sortField === 'claimed' && (sortOrder === 'asc' ? '↑' : '↓')}
                          </th>
                          <th className="pb-3 pr-4 font-bold text-right text-indigo-600 cursor-pointer hover:text-indigo-800 transition" onClick={() => handleSort('responded')}>
                            Responded {sortField === 'responded' && (sortOrder === 'asc' ? '↑' : '↓')}
                          </th>
                          <th className="pb-3 pr-4 font-bold text-right text-blue-600 cursor-pointer hover:text-blue-800 transition" onClick={() => handleSort('open')}>
                            Open {sortField === 'open' && (sortOrder === 'asc' ? '↑' : '↓')}
                          </th>
                          <th className="pb-3 pr-4 font-bold text-right text-amber-600 cursor-pointer hover:text-amber-800 transition" onClick={() => handleSort('pending')}>
                            Pending {sortField === 'pending' && (sortOrder === 'asc' ? '↑' : '↓')}
                          </th>
                          <th className="pb-3 pr-4 font-bold text-right text-green-600 cursor-pointer hover:text-green-800 transition" onClick={() => handleSort('resolved')}>
                            Total Resolved {sortField === 'resolved' && (sortOrder === 'asc' ? '↑' : '↓')}
                          </th>
                          <th className="pb-3 pr-4 font-bold text-right text-purple-600 cursor-pointer hover:text-purple-800 transition" onClick={() => handleSort('forwarded')}>
                            Total Forwarded {sortField === 'forwarded' && (sortOrder === 'asc' ? '↑' : '↓')}
                          </th>
                          <th className="pb-3 font-bold text-right cursor-pointer hover:text-blue-600 transition" onClick={() => handleSort('avg_rating')}>
                            Avg Score {sortField === 'avg_rating' && (sortOrder === 'asc' ? '↑' : '↓')}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {sortedData(agentStats).slice((agentPage - 1) * agentItemsPerPage, agentPage * agentItemsPerPage).map((a, i) => (
                          <tr key={a.agent_id} className="hover:bg-gray-50 transition border-b border-gray-50">
                            <td className="py-3 pr-4 font-mono text-gray-400 text-xs">{(agentPage - 1) * agentItemsPerPage + i + 1}</td>
                            <td className="py-3 pr-4 font-bold text-gray-900">{a.name}</td>
                            <td className="py-3 pr-4">
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter ${a.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                                {a.role}
                              </span>
                            </td>
                            <td className="py-3 pr-4 text-right font-medium text-gray-500">{a.claimed}</td>
                            <td className="py-3 pr-4 text-right font-black text-indigo-700">{a.responded}</td>
                            <td className="py-3 pr-4 text-right font-bold text-blue-600">{a.open}</td>
                            <td className="py-3 pr-4 text-right font-bold text-amber-600">{a.pending}</td>
                            <td className="py-3 pr-4 text-right font-bold text-green-600">{a.resolved}</td>
                            <td className="py-3 pr-4 text-right font-bold text-purple-600">{a.forwarded}</td>
                            <td className="py-3 pr-4 text-right text-gray-600 font-mono text-xs">{fmtMin(a.avg_first_response_min)}</td>
                            <td className="py-3 pr-4 text-right text-gray-600 font-mono text-xs">{fmtMin(a.avg_resolution_min)}</td>
                            <td className="py-3 text-right">
                              {a.avg_rating != null
                                ? <span className="text-amber-500 font-semibold">{a.avg_rating.toFixed(1)} ★ <span className="text-gray-400 font-normal text-xs">({a.rated_count})</span></span>
                                : <span className="text-gray-300">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {/* Agent Pagination */}
                    {agentPages > 1 && (
                      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                        <span className="text-sm text-gray-500">
                          Page {agentPage} of {agentPages} · {agentStats.length} agents
                        </span>
                        <div className="flex gap-2">
                          <button onClick={() => setAgentPage(p => Math.max(1, p - 1))} disabled={agentPage <= 1}
                            className="px-3 py-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                            ← Prev
                          </button>
                          <button onClick={() => setAgentPage(p => Math.min(agentPages, p + 1))} disabled={agentPage >= agentPages}
                            className="px-3 py-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                            Next →
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Conversations table */}
                {activeTab === 'conversations' && (
                  <>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-gray-500 uppercase border-b">
                            <th className="pb-3 pr-4 font-bold text-gray-400">SN</th>
                            <th className="pb-3 pr-4 font-bold">ID</th>
                            <th className="pb-3 pr-4 font-bold cursor-pointer hover:text-blue-600 transition" onClick={() => handleSort('contact_name')}>
                              Visitor {sortField === 'contact_name' && (sortOrder === 'asc' ? '↑' : '↓')}
                            </th>
                            <th className="pb-3 pr-4 font-bold">Platform</th>
                            <th className="pb-3 pr-4 font-bold cursor-pointer hover:text-blue-600 transition" onClick={() => handleSort('assigned_to_name')}>
                              Agent {sortField === 'assigned_to_name' && (sortOrder === 'asc' ? '↑' : '↓')}
                            </th>
                            <th className="pb-3 pr-4 font-bold">Team</th>
                            <th className="pb-3 pr-4 font-bold cursor-pointer hover:text-blue-600 transition" onClick={() => handleSort('status')}>
                              Status {sortField === 'status' && (sortOrder === 'asc' ? '↑' : '↓')}
                            </th>
                            <th className="pb-3 pr-4 font-bold cursor-pointer hover:text-blue-600 transition" onClick={() => handleSort('category')}>
                              Category {sortField === 'category' && (sortOrder === 'asc' ? '↑' : '↓')}
                            </th>
                            <th className="pb-3 pr-4 font-bold text-right cursor-pointer hover:text-blue-600 transition" onClick={() => handleSort('forwarded_count')}>
                              Fwd {sortField === 'forwarded_count' && (sortOrder === 'asc' ? '↑' : '↓')}
                            </th>
                            <th className="pb-3 pr-4 font-bold text-right cursor-pointer hover:text-blue-600 transition" onClick={() => handleSort('rating')}>
                              Rating {sortField === 'rating' && (sortOrder === 'asc' ? '↑' : '↓')}
                            </th>
                            <th className="pb-3 pr-4 font-bold text-right cursor-pointer hover:text-blue-600 transition" onClick={() => handleSort('created_at')}>
                              Created {sortField === 'created_at' && (sortOrder === 'asc' ? '↑' : '↓')}
                            </th>
                            <th className="pb-3 font-bold text-right">Resolved</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {sortedData(convItems).map((c, i) => (
                            <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => openConversationModal(c.id, c.contact_name)}>
                              <td className="py-2.5 pr-3 text-gray-400 font-mono text-xs">{(page - 1) * 25 + i + 1}</td>
                              <td className="py-2.5 pr-3 text-gray-400 font-mono">{c.id}</td>
                              <td className="py-2.5 pr-3 font-medium text-gray-900 max-w-[130px] truncate">{c.contact_name}</td>
                              <td className="py-2.5 pr-3">
                                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${platformBadge(c.platform)}`}>
                                  {c.platform}
                                </span>
                              </td>
                              <td className="py-2.5 pr-3 text-gray-600">{c.assigned_to_name || <span className="text-gray-300">—</span>}</td>
                              <td className="py-2.5 pr-3 text-gray-500 text-xs">{c.assigned_team_name || <span className="text-gray-300">—</span>}</td>
                              <td className="py-2.5 pr-3">
                                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold capitalize ${statusBadge(c.status)}`}>
                                  {c.status}
                                </span>
                              </td>
                              <td className="py-2.5 pr-3">
                                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{c.category}</span>
                              </td>
                              <td className="py-2.5 pr-3 text-right">
                                {c.forwarded_count > 0
                                  ? <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-semibold">{c.forwarded_count}×</span>
                                  : <span className="text-gray-300">—</span>}
                              </td>
                              <td className="py-2.5 pr-3 text-right">
                                {c.rating != null ? (
                                  <span title={c.rating_comment || ''} className="text-amber-500 font-semibold cursor-default">
                                    {'★'.repeat(c.rating)}{'☆'.repeat(5 - c.rating)}
                                  </span>
                                ) : <span className="text-gray-300">—</span>}
                              </td>
                              <td className="py-2.5 pr-3 text-gray-500 text-xs">{fmt(c.created_at)}</td>
                              <td className="py-2.5 text-gray-500 text-xs">{fmt(c.resolved_at)}</td>
                            </tr>
                          ))}
                          {convItems.length === 0 && (
                            <tr><td colSpan={12} className="py-8 text-center text-gray-400">No conversations match the selected filters</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                        <span className="text-sm text-gray-500">
                          Page {page} of {totalPages} · {convTotal} conversations
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => loadAll(page - 1)}
                            disabled={page <= 1}
                            className="px-3 py-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                          >
                            ← Prev
                          </button>
                          <button
                            onClick={() => loadAll(page + 1)}
                            disabled={page >= totalPages}
                            className="px-3 py-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                          >
                            Next →
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Handovers Table */}
                {activeTab === 'handovers' && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-500 uppercase border-b">
                          <th className="pb-3 pr-4 font-bold text-gray-400">SN</th>
                          <th className="pb-3 pr-4 font-bold italic cursor-pointer hover:text-blue-600 transition" onClick={() => handleSort('visitor_name')}>
                            Visitor {sortField === 'visitor_name' && (sortOrder === 'asc' ? '↑' : '↓')}
                          </th>
                          <th className="pb-3 pr-4 font-bold text-blue-600 cursor-pointer hover:text-blue-800 transition" onClick={() => handleSort('initiator')}>
                            From {sortField === 'initiator' && (sortOrder === 'asc' ? '↑' : '↓')}
                          </th>
                          <th className="pb-3 pr-4 font-bold text-indigo-600 cursor-pointer hover:text-indigo-800 transition" onClick={() => handleSort('target')}>
                            To {sortField === 'target' && (sortOrder === 'asc' ? '↑' : '↓')}
                          </th>
                          <th className="pb-3 pr-4 font-bold">Reason / Note</th>
                          <th className="pb-3 font-bold text-right text-gray-400 cursor-pointer hover:text-gray-600 transition" onClick={() => handleSort('timestamp')}>
                            Date/Time {sortField === 'timestamp' && (sortOrder === 'asc' ? '↑' : '↓')}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {sortedData(handoverItems).map((h, i) => (
                          <tr key={h.id} className="hover:bg-gray-50">
                            <td className="py-3 pr-4 font-mono text-gray-400 text-xs">{(handoverPage - 1) * 50 + i + 1}</td>
                            <td className="py-3 pr-4 font-medium text-gray-900">{h.visitor_name} <span className="text-[10px] text-gray-400 font-normal ml-1">#{h.conversation_id}</span></td>
                            <td className="py-3 pr-4">
                              <span className="font-bold text-blue-700">{h.initiator}</span>
                            </td>
                            <td className="py-3 pr-4">
                              <span className="font-bold text-indigo-700">{h.target}</span>
                            </td>
                            <td className="py-3 pr-4">
                              <div className="flex flex-col">
                                <span className="text-gray-800 text-sm leading-tight">{h.reason}</span>
                                <span className="text-[10px] text-gray-400 truncate max-w-xs italic uppercase tracking-tighter mt-0.5">{h.raw_text}</span>
                              </div>
                            </td>
                            <td className="py-3 text-right text-gray-500 text-xs tabular-nums font-mono">
                              {new Date(h.timestamp).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </td>
                          </tr>
                        ))}
                        {handoverItems.length === 0 && (
                          <tr><td colSpan={6} className="py-12 text-center text-gray-400 italic">No handover records found for this period.</td></tr>
                        )}
                      </tbody>
                    </table>
                    {/* Handover Pagination */}
                    {handoverPages > 1 && (
                      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                        <span className="text-sm text-gray-500">
                          Page {handoverPage} of {handoverPages} · {handoverTotal} handovers
                        </span>
                        <div className="flex gap-2">
                          <button onClick={() => setHandoverPage(p => Math.max(1, p - 1))} disabled={handoverPage <= 1}
                            className="px-3 py-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                            ← Prev
                          </button>
                          <button onClick={() => setHandoverPage(p => Math.min(handoverPages, p + 1))} disabled={handoverPage >= handoverPages}
                            className="px-3 py-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                            Next →
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {/* Emails Table */}
                {activeTab === 'emails' && (
                  <div className="space-y-8">
                    {/* Agent Email Summary */}
                    <div>
                      <h4 className="text-base font-bold text-gray-900 mb-3">Agent Email Statistics</h4>
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-sm border-b">
                          <thead>
                            <tr className="text-left text-xs bg-gray-50 text-gray-500 uppercase border-y">
                              <th className="py-2.5 pl-4 pr-3 font-semibold w-12 text-gray-400">SN</th>
                              <th className="py-2.5 pr-3 font-semibold">Agent Name</th>
                              <th className="py-2.5 pr-3 font-semibold text-center">New Received</th>
                              <th className="py-2.5 pr-3 font-semibold text-center">New Sent</th>
                              <th className="py-2.5 pr-3 font-semibold text-center">Replied to Received</th>
                              <th className="py-2.5 pr-4 font-semibold text-center">Received Replies</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {sortedData(emailStats).map((e, i) => (
                              <tr key={e.agent_id} className="hover:bg-gray-50">
                                <td className="py-3 pl-4 pr-3 font-mono text-gray-400 text-xs">{i + 1}</td>
                                <td className="py-3 pr-3 font-medium text-gray-900">{e.name}</td>
                                <td className="py-3 pr-3 text-center text-gray-700">{e.received_count}</td>
                                <td className="py-3 pr-3 text-center text-gray-700">{e.sent_new_count}</td>
                                <td className="py-3 pr-3 text-center text-gray-700">{e.replied_count}</td>
                                <td className="py-3 pr-4 text-center text-gray-700">{e.got_replied_count}</td>
                              </tr>
                            ))}
                            {emailStats.length === 0 && (
                              <tr><td colSpan={6} className="py-8 text-center text-gray-400">No email data found.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Detailed Emails List */}
                    <div>
                      <div className="flex justify-between items-center mb-3">
                        <h4 className="text-base font-bold text-gray-900">Detailed Email Logs</h4>
                        <div className="relative">
                          <input
                            type="text"
                            placeholder="Search emails..."
                            value={emailSearch}
                            onChange={e => setEmailSearch(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && loadAll(1)}
                            className="w-64 pl-9 pr-3 py-1.5 text-sm border border-gray-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          />
                          <span className="absolute left-3 top-2 text-gray-400">🔍</span>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs text-gray-500 uppercase border-b">
                              <th className="pb-3 pr-4 font-bold text-gray-400">SN</th>
                              <th className="pb-3 pr-4 font-bold cursor-pointer hover:text-blue-600 transition" onClick={() => handleSort('subject')}>
                                Subject {sortField === 'subject' && (sortOrder === 'asc' ? '↑' : '↓')}
                              </th>
                              <th className="pb-3 pr-4 font-bold cursor-pointer hover:text-blue-600 transition" onClick={() => handleSort('from_address')}>
                                From {sortField === 'from_address' && (sortOrder === 'asc' ? '↑' : '↓')}
                              </th>
                              <th className="pb-3 pr-4 font-bold cursor-pointer hover:text-blue-600 transition" onClick={() => handleSort('to_address')}>
                                To {sortField === 'to_address' && (sortOrder === 'asc' ? '↑' : '↓')}
                              </th>
                              <th className="pb-3 pr-4 font-bold cursor-pointer hover:text-blue-600 transition" onClick={() => handleSort('type')}>
                                Type {sortField === 'type' && (sortOrder === 'asc' ? '↑' : '↓')}
                              </th>
                              <th className="pb-3 pr-4 font-bold cursor-pointer hover:text-blue-600 transition" onClick={() => handleSort('agent_name')}>
                                Handled By {sortField === 'agent_name' && (sortOrder === 'asc' ? '↑' : '↓')}
                              </th>
                              <th className="pb-3 font-bold text-right cursor-pointer hover:text-blue-600 transition" onClick={() => handleSort('received_at')}>
                                Date/Time {sortField === 'received_at' && (sortOrder === 'asc' ? '↑' : '↓')}
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {sortedData(emailItems).map((email, i) => (
                              <tr key={email.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => openEmailModal(email.thread_id, email.subject, email.id)}>
                                <td className="py-3 pr-4 font-mono text-gray-400 text-xs">{(emailPage - 1) * 50 + i + 1}</td>
                                <td className="py-3 pr-4">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-semibold text-gray-900 max-w-[200px] truncate">{email.subject}</span>
                                    {email.message_count > 1 && (
                                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-blue-100 text-blue-800 rounded-full">
                                        {email.message_count} msgs
                                      </span>
                                    )}
                                  </div>
                                  {email.body_snippet && (
                                    <div className="text-xs text-gray-500 max-w-[250px] truncate">{email.body_snippet}</div>
                                  )}
                                </td>
                                <td className="py-3 pr-4 text-gray-600 max-w-[150px] truncate">{email.from_address}</td>
                                <td className="py-3 pr-4 text-gray-600 max-w-[150px] truncate">{email.to_address}</td>
                                <td className="py-3 pr-4">
                                  <span className={`px-2 py-1 text-[10px] font-bold uppercase rounded ${email.type === 'Received' ? 'bg-blue-100 text-blue-700' :
                                    email.type === 'Sent New' ? 'bg-green-100 text-green-700' :
                                      email.type === 'Replied' ? 'bg-purple-100 text-purple-700' :
                                        'bg-orange-100 text-orange-700'
                                    }`}>
                                    {email.type}
                                  </span>
                                </td>
                                <td className="py-3 pr-4 text-gray-900 font-medium">{email.agent_name}</td>
                                <td className="py-3 text-right text-gray-500 text-xs tabular-nums font-mono">
                                  {new Date(email.received_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                </td>
                              </tr>
                            ))}
                            {emailItems.length === 0 && (
                              <tr><td colSpan={7} className="py-12 text-center text-gray-400 italic">No emails found for this period.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      {/* Pagination for Detailed Emails */}
                      {emailPages > 1 && (
                        <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                          <span className="text-sm text-gray-500">
                            Page {emailPage} of {emailPages} · {emailTotal} emails
                          </span>
                          <div className="flex gap-2">
                            <button onClick={() => setEmailPage(p => Math.max(1, p - 1))} disabled={emailPage <= 1}
                              className="px-3 py-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                              ← Prev
                            </button>
                            <button onClick={() => setEmailPage(p => Math.min(emailPages, p + 1))} disabled={emailPage >= emailPages}
                              className="px-3 py-1 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                              Next →
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {/* Conversation Detail Modal */}
      {selectedConv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 rounded-t-xl">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Conversation History</h3>
                <p className="text-sm text-gray-500">Visitor: <span className="font-semibold">{selectedConv.visitor}</span> (ID: {selectedConv.id})</p>
              </div>
              <button onClick={() => setSelectedConv(null)} className="text-gray-400 hover:text-gray-600 transition">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 bg-gray-50">
              {modalLoading ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                </div>
              ) : modalMessages.length === 0 ? (
                <div className="text-center py-12 text-gray-500 italic">No messages found.</div>
              ) : (
                <div className="flex flex-col gap-4">
                  {modalMessages.map(msg => {
                    const isAgent = msg.is_sent === 1;
                    return (
                      <div key={msg.id} className={`flex flex-col max-w-[85%] ${isAgent ? 'self-end' : 'self-start'}`}>
                        <div className={`text-xs mb-1 px-1 ${isAgent ? 'text-right text-gray-400' : 'text-gray-500'}`}>
                          <span className="font-semibold">{msg.sender_name}</span> • {new Date(msg.timestamp).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <div className={`px-4 py-2.5 rounded-2xl ${isAgent
                          ? 'bg-blue-600 text-white rounded-tr-none'
                          : 'bg-white border border-gray-200 text-gray-800 rounded-tl-none shadow-sm'
                          }`}>
                          <p className="text-sm whitespace-pre-wrap">{msg.message_text}</p>
                          {msg.message_type === 'handover' && (
                            <div className="mt-2 text-xs opacity-75 italic border-t border-current pt-1">Internal Note / Handover</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-100 flex justify-end bg-white rounded-b-xl">
              <button
                onClick={() => setSelectedConv(null)}
                className="px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email Thread Modal */}
      {selectedEmailThread && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 rounded-t-xl">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Email Thread</h3>
                <p className="text-sm text-gray-500">Subject: <span className="font-semibold">{selectedEmailThread.subject}</span></p>
              </div>
              <button onClick={() => setSelectedEmailThread(null)} className="text-gray-400 hover:text-gray-600 transition">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 bg-gray-50">
              {emailModalLoading ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                </div>
              ) : emailModalMessages.length === 0 ? (
                <div className="text-center py-12 text-gray-500 italic">No emails found in this thread.</div>
              ) : (
                <div className="flex flex-col gap-6">
                  {emailModalMessages.map(msg => (
                    <div key={msg.id} className="bg-white border text-left border-gray-200 shadow-sm rounded-lg overflow-hidden">
                      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex justify-between items-start">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{msg.from_address}</p>
                          <p className="text-xs text-gray-500">To: {msg.to_address}</p>
                        </div>
                        <div className="text-right">
                          <span className="text-xs text-gray-400 block">{new Date(msg.received_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                          <span className={`mt-1 inline-block px-2 py-0.5 text-[10px] font-bold uppercase rounded ${msg.is_sent ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                            }`}>
                            {msg.is_sent ? 'Sent' : 'Received'}
                          </span>
                        </div>
                      </div>
                      <div className="p-4 text-sm text-gray-800 whitespace-pre-wrap">
                        {msg.body_text || <div dangerouslySetInnerHTML={{ __html: msg.body_html || '' }} className="prose prose-sm max-w-none" />}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-100 flex justify-end bg-white rounded-b-xl">
              <button
                onClick={() => setSelectedEmailThread(null)}
                className="px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

