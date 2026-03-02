'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import AdminNav from '@/components/AdminNav'
import MainHeader from '@/components/MainHeader'
import OrganizationForm from '@/components/OrganizationForm'
import ContactManagement from '@/components/ContactManagement'
import SubscriptionManagement from '@/components/SubscriptionManagement'
import {
    User, CreditCard, ChevronLeft, LayoutDashboard, Settings,
    Mail, MessageSquare, Phone, ChevronDown, ChevronUp, Eye, X as XIcon
} from 'lucide-react'
import TicketHistory from '@/components/TicketHistory'
import axios from 'axios'
import { useAuth, getAuthToken } from '@/lib/auth'
import { hasModuleAccess } from '@/lib/permissions'
import { API_URL } from '@/lib/config';

const PAGE_SIZE = 20

type TabType = 'overview' | 'contacts' | 'subscriptions' | 'emails' | 'conversations' | 'calls'

const PLATFORM_ICONS: Record<string, string> = {
    whatsapp: '💬', facebook: '📘', viber: '📱',
    linkedin: '💼', email: '✉️', webchat: '🌐',
}

const STATUS_COLORS: Record<string, string> = {
    open: 'bg-green-50 text-green-700 border-green-200',
    pending: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    resolved: 'bg-gray-100 text-gray-600 border-gray-200',
}

const TICKET_STATUS_COLORS: Record<string, string> = {
    pending: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    solved: 'bg-green-50 text-green-700 border-green-200',
    forwarded: 'bg-blue-50 text-blue-700 border-blue-200',
}

const PRIORITY_COLORS: Record<string, string> = {
    low: 'text-gray-500', normal: 'text-blue-600',
    high: 'text-orange-600', urgent: 'text-red-600',
}

const DISPOSITION_COLORS: Record<string, string> = {
    ANSWERED: 'bg-green-50 text-green-700 border-green-200',
    'NO ANSWER': 'bg-yellow-50 text-yellow-700 border-yellow-200',
    BUSY: 'bg-orange-50 text-orange-700 border-orange-200',
    FAILED: 'bg-red-50 text-red-700 border-red-200',
}

function formatDate(iso: string | null | undefined) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    })
}

function formatDuration(secs: number) {
    if (!secs) return '0s'
    const m = Math.floor(secs / 60), s = secs % 60
    return m ? `${m}m ${s}s` : `${s}s`
}

function stripAtSign(domain: string) {
    return (domain || '').replace(/^@+/, '')
}

export default function OrganizationDetailPage() {
    const { user } = useAuth()
    const { id } = useParams()
    const router = useRouter()

    const [organization, setOrganization] = useState<any>(null)
    const [activeTab, setActiveTab] = useState<TabType>('overview')
    const [loading, setLoading] = useState(true)

    // ── Emails tab ──
    const [emails, setEmails] = useState<any[]>([])
    const [emailsTotal, setEmailsTotal] = useState(0)
    const [emailsPage, setEmailsPage] = useState(1)
    const [emailsLoading, setEmailsLoading] = useState(false)
    const [expandedEmailId, setExpandedEmailId] = useState<number | null>(null)

    // ── Conversations tab ──
    const [convs, setConvs] = useState<any[]>([])
    const [convsTotal, setConvsTotal] = useState(0)
    const [convsPage, setConvsPage] = useState(1)
    const [convsLoading, setConvsLoading] = useState(false)
    const [expandedConvId, setExpandedConvId] = useState<number | null>(null)

    // ── Calls tab ──
    const [calls, setCalls] = useState<any[]>([])
    const [callsTotal, setCallsTotal] = useState(0)
    const [callsPage, setCallsPage] = useState(1)
    const [callsLoading, setCallsLoading] = useState(false)
    const [expandedCallId, setExpandedCallId] = useState<number | null>(null)
    // ticketThreads: map call_id → ticket array
    const [ticketThreads, setTicketThreads] = useState<Record<number, any[]>>({})
    const [ticketThreadLoading, setTicketThreadLoading] = useState<Record<number, boolean>>({})
    const [selectedCall, setSelectedCall] = useState<any | null>(null)

    useEffect(() => {
        if (user && user.role !== 'admin' && !hasModuleAccess('organizations')) {
            router.push('/dashboard')
            return
        }
        if (user) fetchOrganization()
    }, [id, user?.user_id, user?.role, router])

    const fetchOrganization = async () => {
        try {
            setLoading(true)
            const token = getAuthToken()
            const res = await axios.get(`${API_URL}/organizations/${id}`, {
                headers: { Authorization: `Bearer ${token}` }
            })
            setOrganization(res.data)
        } catch {
            router.push('/admin/organizations')
        } finally {
            setLoading(false)
        }
    }

    const fetchEmails = useCallback(async (page: number) => {
        if (!id) return
        setEmailsLoading(true)
        try {
            const token = getAuthToken()
            const res = await axios.get(`${API_URL}/organizations/${id}/emails`, {
                headers: { Authorization: `Bearer ${token}` },
                params: { skip: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE }
            })
            setEmails(res.data.emails || [])
            setEmailsTotal(res.data.total || 0)
        } catch (err) {
            console.error(err)
        } finally {
            setEmailsLoading(false)
        }
    }, [id])

    const fetchConversations = useCallback(async (page: number) => {
        if (!id) return
        setConvsLoading(true)
        try {
            const token = getAuthToken()
            const res = await axios.get(`${API_URL}/organizations/${id}/conversations`, {
                headers: { Authorization: `Bearer ${token}` },
                params: { skip: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE }
            })
            setConvs(res.data.conversations || [])
            setConvsTotal(res.data.total || 0)
        } catch (err) {
            console.error(err)
        } finally {
            setConvsLoading(false)
        }
    }, [id])

    const fetchCalls = useCallback(async (page: number) => {
        if (!id) return
        setCallsLoading(true)
        try {
            const token = getAuthToken()
            const res = await axios.get(`${API_URL}/organizations/${id}/call-records`, {
                headers: { Authorization: `Bearer ${token}` },
                params: { skip: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE }
            })
            setCalls(res.data.call_records || [])
            setCallsTotal(res.data.total || 0)
        } catch (err) {
            console.error(err)
        } finally {
            setCallsLoading(false)
        }
    }, [id])

    const fetchTicketThread = useCallback(async (callId: number) => {
        if (ticketThreads[callId] !== undefined) return  // already loaded
        setTicketThreadLoading(prev => ({ ...prev, [callId]: true }))
        try {
            const token = getAuthToken()
            const res = await axios.get(`${API_URL}/organizations/${id}/call-records/${callId}/ticket-thread`, {
                headers: { Authorization: `Bearer ${token}` }
            })
            setTicketThreads(prev => ({ ...prev, [callId]: res.data.tickets || [] }))
        } catch {
            setTicketThreads(prev => ({ ...prev, [callId]: [] }))
        } finally {
            setTicketThreadLoading(prev => ({ ...prev, [callId]: false }))
        }
    }, [id, ticketThreads])

    // Fetch data when switching tabs
    useEffect(() => {
        if (activeTab === 'emails') { setEmailsPage(1); fetchEmails(1) }
        else if (activeTab === 'conversations') { setConvsPage(1); fetchConversations(1) }
        else if (activeTab === 'calls') { setCallsPage(1); fetchCalls(1) }
    }, [activeTab])

    useEffect(() => { if (activeTab === 'emails') fetchEmails(emailsPage) }, [emailsPage])
    useEffect(() => { if (activeTab === 'conversations') fetchConversations(convsPage) }, [convsPage])
    useEffect(() => { if (activeTab === 'calls') fetchCalls(callsPage) }, [callsPage])

    const handleCallExpand = (callId: number) => {
        if (expandedCallId === callId) {
            setExpandedCallId(null)
        } else {
            setExpandedCallId(callId)
            fetchTicketThread(callId)
        }
    }

    if (loading) {
        return (
            <div className="flex flex-col h-screen bg-gray-50">
                <MainHeader user={user!} />
                <div className="flex-1 flex items-center justify-center pt-14 ml-[240px]">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                </div>
            </div>
        )
    }

    const allTabs = [
        { id: 'overview', label: 'Overview', icon: LayoutDashboard, permission: () => true },
        { id: 'contacts', label: 'Contacts', icon: User, permission: () => hasModuleAccess('contacts') },
        { id: 'subscriptions', label: 'Subscriptions', icon: CreditCard, permission: () => hasModuleAccess('subscriptions') },
        { id: 'emails', label: 'Emails', icon: Mail, permission: () => true },
        { id: 'conversations', label: 'Conversations', icon: MessageSquare, permission: () => true },
        { id: 'calls', label: 'Call Records', icon: Phone, permission: () => true },
    ]

    const tabs = allTabs.filter(tab => {
        if (!user) return false
        if (user.role === 'admin') return true
        return tab.permission()
    })

    const emailsTotalPages = Math.max(1, Math.ceil(emailsTotal / PAGE_SIZE))
    const convsTotalPages = Math.max(1, Math.ceil(convsTotal / PAGE_SIZE))
    const callsTotalPages = Math.max(1, Math.ceil(callsTotal / PAGE_SIZE))

    return (
        <div className="flex flex-col h-screen bg-gray-50">
            <MainHeader user={user!} />

            <div className="flex-1 flex overflow-hidden pt-14 ml-[240px]">
                <AdminNav />
                <main className="flex-1 overflow-y-auto p-4 md:p-8">
                    <div className="w-full">

                        {/* Header */}
                        <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={() => router.push('/admin/organizations')}
                                    className="p-2 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors shadow-sm"
                                >
                                    <ChevronLeft className="w-5 h-5 text-gray-600" />
                                </button>
                                <div>
                                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                                        {organization?.organization_name}
                                        {organization?.is_active ? (
                                            <span className="text-[10px] bg-green-50 text-green-700 px-2 py-0.5 rounded-full border border-green-100 uppercase tracking-tighter">Active</span>
                                        ) : (
                                            <span className="text-[10px] bg-red-50 text-red-700 px-2 py-0.5 rounded-full border border-red-100 uppercase tracking-tighter">Inactive</span>
                                        )}
                                    </h1>
                                    <p className="text-gray-500 text-sm font-light">ID: {organization?.id} • Domain: {organization?.domain_name || 'N/A'}</p>
                                </div>
                            </div>

                            {/* Tab Switcher */}
                            <div className="flex flex-wrap bg-white p-1 rounded-xl border border-gray-200 shadow-sm self-start md:self-auto gap-0.5">
                                {tabs.map(tab => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id as TabType)}
                                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === tab.id ? 'text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}
                                        style={activeTab === tab.id ? { backgroundColor: 'var(--button-primary)' } : {}}
                                    >
                                        <tab.icon className="w-4 h-4" />
                                        {tab.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Tab Content */}
                        <div className="bg-white rounded-3xl border border-gray-100 shadow-xl shadow-gray-200/50 min-h-[500px] overflow-hidden">

                            {/* ── Overview ── */}
                            {activeTab === 'overview' && (
                                <div className="p-8">
                                    <div className="flex items-center gap-3 mb-8">
                                        <div className="p-2 bg-indigo-50 rounded-lg"><Settings className="w-5 h-5 text-indigo-600" /></div>
                                        <h2 className="text-lg font-bold text-gray-900 leading-none">Settings & Information</h2>
                                    </div>
                                    <OrganizationForm
                                        initialData={organization}
                                        onSuccess={(data) => { setOrganization(data); alert('Settings saved successfully') }}
                                        onCancel={() => router.push('/admin/organizations')}
                                    />
                                </div>
                            )}

                            {/* ── Contacts ── */}
                            {activeTab === 'contacts' && (
                                <div className="p-8"><ContactManagement organizationId={Number(id)} /></div>
                            )}

                            {/* ── Subscriptions ── */}
                            {activeTab === 'subscriptions' && (
                                <div className="p-8"><SubscriptionManagement organizationId={Number(id)} /></div>
                            )}

                            {/* ── Emails ── */}
                            {activeTab === 'emails' && (
                                <div className="p-6">
                                    <div className="flex items-center justify-between mb-5">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-blue-50 rounded-lg"><Mail className="w-5 h-5 text-blue-600" /></div>
                                            <div>
                                                <h2 className="text-lg font-bold text-gray-900 leading-none">Emails</h2>
                                                <p className="text-xs text-gray-500 mt-0.5">
                                                    {organization?.domain_name
                                                        ? `Emails from/to *@${stripAtSign(organization.domain_name)}`
                                                        : 'No domain set'}
                                                </p>
                                            </div>
                                        </div>
                                        <span className="text-sm text-gray-500">{emailsTotal} total</span>
                                    </div>

                                    {!organization?.domain_name ? (
                                        <EmptyState icon={<Mail className="w-10 h-10 mx-auto mb-3 opacity-30" />} title="No domain configured" desc="Set a domain in the Overview tab." />
                                    ) : emailsLoading ? (
                                        <Spinner color="blue" />
                                    ) : emails.length === 0 ? (
                                        <EmptyState icon={<Mail className="w-10 h-10 mx-auto mb-3 opacity-30" />} title="No emails found" desc={`No emails from/to @${organization.domain_name} yet.`} />
                                    ) : (
                                        <>
                                            <div className="border border-gray-100 rounded-xl overflow-hidden">
                                                <div className="grid grid-cols-12 gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                                    <div className="col-span-1">Type</div>
                                                    <div className="col-span-3">From</div>
                                                    <div className="col-span-3">To</div>
                                                    <div className="col-span-3">Subject</div>
                                                    <div className="col-span-1">Date</div>
                                                    <div className="col-span-1"></div>
                                                </div>
                                                {emails.map((email, idx) => (
                                                    <div key={email.id} className={idx % 2 === 1 ? 'bg-gray-50/50' : ''}>
                                                        <div className="grid grid-cols-12 gap-2 px-4 py-3 items-center border-b border-gray-100 last:border-0">
                                                            <div className="col-span-1">
                                                                <Badge color={email.is_sent ? 'blue' : 'green'} label={email.is_sent ? 'Sent' : 'Recv'} />
                                                            </div>
                                                            <div className="col-span-3 text-xs text-gray-700 truncate" title={email.from_address}>{email.from_address || '—'}</div>
                                                            <div className="col-span-3 text-xs text-gray-600 truncate" title={email.to_address}>{email.to_address || '—'}</div>
                                                            <div className="col-span-3 text-xs font-medium text-gray-800 truncate" title={email.subject}>{email.subject || '(No Subject)'}</div>
                                                            <div className="col-span-1 text-xs text-gray-400 whitespace-nowrap">
                                                                {email.received_at ? new Date(email.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                                                            </div>
                                                            <div className="col-span-1 flex justify-end">
                                                                <ExpandBtn expanded={expandedEmailId === email.id} color="blue" onClick={() => setExpandedEmailId(expandedEmailId === email.id ? null : email.id)} />
                                                            </div>
                                                        </div>
                                                        {expandedEmailId === email.id && (
                                                            <div className="px-4 pb-5 pt-2 bg-blue-50/40 border-b border-gray-100">
                                                                <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 mb-4 text-xs">
                                                                    <MetaRow label="From" value={email.from_address} />
                                                                    <MetaRow label="To" value={email.to_address} />
                                                                    {email.cc && <MetaRow label="CC" value={email.cc} />}
                                                                    <MetaRow label="Date" value={formatDate(email.received_at)} />
                                                                    <div className="col-span-2"><MetaRow label="Subject" value={email.subject || '(No Subject)'} /></div>
                                                                </div>
                                                                <div className="border border-gray-200 rounded-xl bg-white p-4 text-sm text-gray-800 max-h-96 overflow-y-auto">
                                                                    {email.body_html ? (
                                                                        <div dangerouslySetInnerHTML={{ __html: email.body_html }} />
                                                                    ) : email.body_text ? (
                                                                        <pre className="whitespace-pre-wrap font-sans">{email.body_text}</pre>
                                                                    ) : (
                                                                        <span className="text-gray-400 italic">No content</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                            <Pagination page={emailsPage} totalPages={emailsTotalPages} total={emailsTotal} label="emails" onPrev={() => setEmailsPage(p => p - 1)} onNext={() => setEmailsPage(p => p + 1)} />
                                        </>
                                    )}
                                </div>
                            )}

                            {/* ── Conversations ── */}
                            {activeTab === 'conversations' && (
                                <div className="p-6">
                                    <div className="flex items-center justify-between mb-5">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-purple-50 rounded-lg"><MessageSquare className="w-5 h-5 text-purple-600" /></div>
                                            <div>
                                                <h2 className="text-lg font-bold text-gray-900 leading-none">Conversations</h2>
                                                <p className="text-xs text-gray-500 mt-0.5">
                                                    {organization?.domain_name
                                                        ? `Contacts matching *@${stripAtSign(organization.domain_name)}`
                                                        : 'No domain set'}
                                                </p>
                                            </div>
                                        </div>
                                        <span className="text-sm text-gray-500">{convsTotal} total</span>
                                    </div>

                                    {!organization?.domain_name ? (
                                        <EmptyState icon={<MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />} title="No domain configured" desc="Set a domain in the Overview tab." />
                                    ) : convsLoading ? (
                                        <Spinner color="purple" />
                                    ) : convs.length === 0 ? (
                                        <EmptyState icon={<MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />} title="No conversations found" desc={`No conversations from contacts @${organization.domain_name} yet.`} />
                                    ) : (
                                        <>
                                            <div className="border border-gray-100 rounded-xl overflow-hidden">
                                                <div className="grid grid-cols-12 gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                                    <div className="col-span-1">Platform</div>
                                                    <div className="col-span-2">Contact</div>
                                                    <div className="col-span-2">Contact ID</div>
                                                    <div className="col-span-3">Last Message</div>
                                                    <div className="col-span-1">Status</div>
                                                    <div className="col-span-1">Date</div>
                                                    <div className="col-span-2"></div>
                                                </div>
                                                {convs.map((conv, idx) => (
                                                    <div key={conv.id} className={idx % 2 === 1 ? 'bg-gray-50/50' : ''}>
                                                        <div className="grid grid-cols-12 gap-2 px-4 py-3 items-center border-b border-gray-100 last:border-0">
                                                            <div className="col-span-1 text-lg" title={conv.platform}>{PLATFORM_ICONS[conv.platform?.toLowerCase()] || '💬'}</div>
                                                            <div className="col-span-2 text-xs font-medium text-gray-800 truncate">{conv.contact_name || '—'}</div>
                                                            <div className="col-span-2 text-xs text-gray-500 truncate">{conv.contact_id || '—'}</div>
                                                            <div className="col-span-3 text-xs text-gray-600 truncate">{conv.last_message || <span className="italic text-gray-400">No messages</span>}</div>
                                                            <div className="col-span-1">
                                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${STATUS_COLORS[conv.status] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                                                                    {conv.status || '—'}
                                                                </span>
                                                            </div>
                                                            <div className="col-span-1 text-xs text-gray-400 whitespace-nowrap">
                                                                {conv.last_message_time ? new Date(conv.last_message_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                                                            </div>
                                                            <div className="col-span-2 flex justify-end">
                                                                <ExpandBtn expanded={expandedConvId === conv.id} color="purple" onClick={() => setExpandedConvId(expandedConvId === conv.id ? null : conv.id)} />
                                                            </div>
                                                        </div>
                                                        {expandedConvId === conv.id && (
                                                            <div className="px-4 pb-5 pt-2 bg-purple-50/30 border-b border-gray-100">
                                                                <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs">
                                                                    <MetaRow label="Platform" value={<span className="capitalize">{conv.platform}</span>} />
                                                                    <MetaRow label="Status" value={
                                                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${STATUS_COLORS[conv.status] || ''}`}>{conv.status}</span>
                                                                    } />
                                                                    <MetaRow label="Contact" value={conv.contact_name} />
                                                                    <MetaRow label="Contact ID" value={conv.contact_id} />
                                                                    {conv.category && <MetaRow label="Category" value={conv.category} />}
                                                                    {conv.rating != null && <MetaRow label="Rating" value={'★'.repeat(conv.rating) + '☆'.repeat(5 - conv.rating)} />}
                                                                    <MetaRow label="Created" value={formatDate(conv.created_at)} />
                                                                    <MetaRow label="Updated" value={formatDate(conv.updated_at)} />
                                                                    {conv.last_message && <div className="col-span-2"><MetaRow label="Last Message" value={conv.last_message} /></div>}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                            <Pagination page={convsPage} totalPages={convsTotalPages} total={convsTotal} label="conversations" onPrev={() => setConvsPage(p => p - 1)} onNext={() => setConvsPage(p => p + 1)} />
                                        </>
                                    )}
                                </div>
                            )}

                            {/* ── Call Records ── */}
                            {activeTab === 'calls' && (
                                <div className="p-6">
                                    <div className="flex items-center justify-between mb-5">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-emerald-50 rounded-lg"><Phone className="w-5 h-5 text-emerald-600" /></div>
                                            <div>
                                                <h2 className="text-lg font-bold text-gray-900 leading-none">Call Records</h2>
                                                <p className="text-xs text-gray-500 mt-0.5">Calls linked to this organization or its contact numbers</p>
                                            </div>
                                        </div>
                                        <span className="text-sm text-gray-500">{callsTotal} total</span>
                                    </div>

                                    {callsLoading ? (
                                        <Spinner color="emerald" />
                                    ) : calls.length === 0 ? (
                                        <EmptyState icon={<Phone className="w-10 h-10 mx-auto mb-3 opacity-30" />} title="No call records found" desc="No calls are linked to this organization yet." />
                                    ) : (
                                        <>
                                            <div className="border border-gray-100 rounded-xl overflow-hidden">
                                                <div className="grid grid-cols-12 gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                                    <div className="col-span-1">Dir</div>
                                                    <div className="col-span-2">Phone</div>
                                                    <div className="col-span-2">Agent</div>
                                                    <div className="col-span-2">Disposition</div>
                                                    <div className="col-span-1">Duration</div>
                                                    <div className="col-span-2">Ticket</div>
                                                    <div className="col-span-1">Date</div>
                                                    <div className="col-span-1"></div>
                                                </div>

                                                {calls.map((call, idx) => (
                                                    <div key={call.id} className={idx % 2 === 1 ? 'bg-gray-50/50' : ''}>
                                                        <div className="grid grid-cols-12 gap-2 px-4 py-3 items-center border-b border-gray-100 last:border-0">
                                                            <div className="col-span-1">
                                                                <span className={`text-[10px] font-semibold ${call.direction === 'inbound' ? 'text-green-600' : 'text-blue-600'}`}>
                                                                    {call.direction === 'inbound' ? '↙ In' : '↗ Out'}
                                                                </span>
                                                            </div>
                                                            <div className="col-span-2 text-xs font-medium text-gray-800">{call.phone_number || '—'}</div>
                                                            <div className="col-span-2 text-xs text-gray-600 truncate">{call.agent_name || '—'}</div>
                                                            <div className="col-span-2">
                                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${DISPOSITION_COLORS[call.disposition] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                                                                    {call.disposition || '—'}
                                                                </span>
                                                            </div>
                                                            <div className="col-span-1 text-xs text-gray-600">{formatDuration(call.duration_seconds)}</div>
                                                            <div className="col-span-2 text-xs text-indigo-600 font-medium truncate">{call.ticket_number || <span className="text-gray-400 italic">None</span>}</div>
                                                            <div className="col-span-1 text-xs text-gray-400 whitespace-nowrap">
                                                                {call.created_at ? new Date(call.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                                                            </div>
                                                            <div className="col-span-1 flex justify-end">
                                                                <ExpandBtn expanded={expandedCallId === call.id} color="emerald" onClick={() => handleCallExpand(call.id)} />
                                                            </div>
                                                        </div>

                                                        {/* Expanded: call details + ticket thread */}
                                                        {expandedCallId === call.id && (
                                                            <div className="px-4 pb-5 pt-2 bg-emerald-50/30 border-b border-gray-100">
                                                                {/* Call details */}
                                                                <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs mb-4">
                                                                    <MetaRow label="Phone" value={call.phone_number} />
                                                                    <MetaRow label="Direction" value={<span className="capitalize">{call.direction}</span>} />
                                                                    <MetaRow label="Agent" value={call.agent_name || '—'} />
                                                                    <MetaRow label="Disposition" value={call.disposition || '—'} />
                                                                    <MetaRow label="Duration" value={formatDuration(call.duration_seconds)} />
                                                                    <MetaRow label="Date" value={formatDate(call.created_at)} />
                                                                    {call.ticket_number && <MetaRow label="Ticket" value={call.ticket_number} />}
                                                                </div>

                                                                {/* View Ticket Thread button */}
                                                                {call.ticket_id && (
                                                                    <div className="mt-1">
                                                                        <button
                                                                            onClick={() => setSelectedCall(call)}
                                                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors border border-indigo-100"
                                                                        >
                                                                            <Eye className="w-3.5 h-3.5" /> View Ticket Thread
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                            <Pagination page={callsPage} totalPages={callsTotalPages} total={callsTotal} label="call records" onPrev={() => setCallsPage(p => p - 1)} onNext={() => setCallsPage(p => p + 1)} />
                                        </>
                                    )}
                                </div>
                            )}

                        </div>
                    </div>
                </main>

                {/* Threaded Ticket Side Panel */}
                {selectedCall && (
                    <div className="fixed top-0 right-0 bottom-0 w-[520px] bg-white shadow-2xl z-50 border-l border-gray-200 flex flex-col animate-in slide-in-from-right">
                        <div className="shrink-0 bg-white/80 backdrop-blur-md px-6 py-4 border-b flex justify-between items-center">
                            <div>
                                <h2 className="text-lg font-bold text-gray-900 leading-none">Ticket Thread</h2>
                                <p className="text-sm text-gray-500 mt-1">{selectedCall.phone_number}</p>
                            </div>
                            <button
                                onClick={() => setSelectedCall(null)}
                                className="p-2 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-full transition"
                            >
                                <XIcon className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-hidden [&>div]:max-h-full [&>div]:rounded-none [&>div]:border-0 [&>div]:shadow-none">
                            <TicketHistory
                                activeNumber={selectedCall.phone_number}
                                reloadKey={0}
                                onFollowUpClick={() => {}}
                                ticketId={selectedCall.ticket_id}
                            />
                        </div>
                    </div>
                )}
                {selectedCall && (
                    <div className="fixed inset-0 bg-gray-900/20 backdrop-blur-[2px] z-40" onClick={() => setSelectedCall(null)}></div>
                )}
            </div>
        </div>
    )
}

// ── Shared mini-components ──────────────────────────────────────────────────

function Spinner({ color }: { color: string }) {
    return (
        <div className="flex justify-center py-16">
            <div className={`animate-spin rounded-full h-7 w-7 border-b-2 border-${color}-600`}></div>
        </div>
    )
}

function EmptyState({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
    return (
        <div className="text-center py-16 text-gray-400">
            {icon}
            <p className="font-medium">{title}</p>
            <p className="text-sm mt-1">{desc}</p>
        </div>
    )
}

function Badge({ color, label }: { color: string; label: string }) {
    const colors: Record<string, string> = {
        blue: 'bg-blue-50 text-blue-700 border-blue-200',
        green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    }
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${colors[color] || ''}`}>
            {label}
        </span>
    )
}

function ExpandBtn({ expanded, color, onClick }: { expanded: boolean; color: string; onClick: () => void }) {
    const colors: Record<string, string> = {
        blue: 'text-blue-600 hover:text-blue-800 hover:bg-blue-50',
        purple: 'text-purple-600 hover:text-purple-800 hover:bg-purple-50',
        emerald: 'text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50',
    }
    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg transition ${colors[color] || ''}`}
        >
            {expanded ? <><ChevronUp className="w-3.5 h-3.5" /> Hide</> : <><ChevronDown className="w-3.5 h-3.5" /> Details</>}
        </button>
    )
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div>
            <span className="font-semibold text-gray-500">{label}: </span>
            <span className="text-gray-800">{value || '—'}</span>
        </div>
    )
}

function Pagination({ page, totalPages, total, label, onPrev, onNext }: {
    page: number; totalPages: number; total: number; label: string
    onPrev: () => void; onNext: () => void
}) {
    if (totalPages <= 1) return null
    return (
        <div className="flex items-center justify-between mt-4 px-1">
            <span className="text-xs text-gray-500">Page {page} of {totalPages} · {total} {label}</span>
            <div className="flex gap-2">
                <button onClick={onPrev} disabled={page === 1} className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition">← Prev</button>
                <button onClick={onNext} disabled={page === totalPages} className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition">Next →</button>
            </div>
        </div>
    )
}
