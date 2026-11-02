'use client';

/**
 * The customer's thread of a support request (tickets with source support_*),
 * shown on the workspace ticket page. Replies go to the customer by email and to
 * their site's webhook; internal notes stay on the Internal note tab.
 * Backend: /api/tickets/{number}/conversation (app/routes/tickets.py).
 */

import { useEffect, useRef, useState } from 'react';
import { getAuthToken } from '@/lib/auth';
import { API_URL } from '@/lib/config';
import { Paperclip, Send, RefreshCw, ExternalLink, AlertTriangle, Monitor } from 'lucide-react';

type Attachment = { index: number; name: string; size: number; type: string; url: string };
type Message = {
    id: number;
    author_type: 'customer' | 'agent' | 'system';
    author_name: string;
    body: string;
    attachments: Attachment[];
    created_at: string;
};
type Conversation = {
    ticket_no: string;
    subject: string;
    site: { id: number; name: string; domain: string } | null;
    customer: { name: string; email: string; phone: string; signed: boolean } | null;
    screen: string | null;
    url: string | null;
    status: 'waiting' | 'replied' | 'solved';
    messages: Message[];
    delivery: { status: string; event: string; error: string | null; tries: number } | null;
    assigned_to: number | null;
    assignee_name: string | null;
};

const MAX_FILES = 5;
const POLL_MS = 15000;

function newRequestId() {
    return (crypto as any).randomUUID ? crypto.randomUUID().replace(/-/g, '') : String(Date.now()) + Math.random().toString(16).slice(2);
}

function sizeLabel(bytes: number) {
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function SupportConversation({ ticketNumber, onChanged }: { ticketNumber: string; onChanged?: () => void }) {
    const [conv, setConv] = useState<Conversation | null>(null);
    const [error, setError] = useState('');
    const [body, setBody] = useState('');
    const [files, setFiles] = useState<File[]>([]);
    const [sending, setSending] = useState(false);
    const [resending, setResending] = useState(false);
    const requestId = useRef(newRequestId());
    const fileInput = useRef<HTMLInputElement>(null);
    const bottom = useRef<HTMLDivElement>(null);

    const headers = () => ({ Authorization: `Bearer ${getAuthToken()}` });

    const load = async () => {
        try {
            const res = await fetch(`${API_URL}/api/tickets/${encodeURIComponent(ticketNumber)}/conversation`, { headers: headers() });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Could not load the conversation.');
            setConv(await res.json());
            setError('');
        } catch (e: any) {
            setError(e.message || 'Could not load the conversation.');
        }
    };

    useEffect(() => {
        load();
        const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, POLL_MS);
        return () => clearInterval(timer);
    }, [ticketNumber]);

    const count = conv?.messages.length || 0;
    useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [count]);

    const send = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!body.trim() && files.length === 0) return;
        setSending(true);
        setError('');
        try {
            const form = new FormData();
            form.append('body', body);
            form.append('request_id', requestId.current);
            files.forEach(f => form.append('files', f));
            const res = await fetch(`${API_URL}/api/tickets/${encodeURIComponent(ticketNumber)}/conversation`, {
                method: 'POST', headers: headers(), body: form,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.detail || 'The reply was not sent.');
            setConv(data);
            setBody('');
            setFiles([]);
            requestId.current = newRequestId();   // the next reply is a new one
            onChanged?.();
        } catch (e: any) {
            setError(e.message || 'The reply was not sent.');
        } finally {
            setSending(false);
        }
    };

    const resend = async () => {
        setResending(true);
        try {
            const res = await fetch(`${API_URL}/api/tickets/${encodeURIComponent(ticketNumber)}/webhook-resend`, {
                method: 'POST', headers: headers(),
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Could not send it again.');
            await load();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setResending(false);
        }
    };

    const pickFiles = (list: FileList | null) => {
        if (!list) return;
        const next = [...files, ...Array.from(list)].slice(0, MAX_FILES);
        setFiles(next);
        if (fileInput.current) fileInput.current.value = '';
    };

    if (!conv) {
        return <div className="p-6 text-sm text-gray-500">{error || 'Loading the conversation...'}</div>;
    }

    return (
        <div className="flex flex-col h-full min-h-0">
            {/* Where it came from */}
            <div className="px-5 py-3 border-b border-gray-100 bg-white text-xs text-gray-600 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-purple-100 text-purple-800 font-bold uppercase tracking-wide">Support</span>
                    <span className="font-semibold text-gray-900">{conv.site?.name}</span>
                    {conv.site?.domain && <span className="text-gray-400">{conv.site.domain}</span>}
                    <span className="ml-auto text-gray-500">
                        {conv.status === 'waiting' ? 'Waiting for support' : conv.status === 'replied' ? 'Replied' : 'Solved'}
                    </span>
                </div>
                <p className="text-sm font-semibold text-gray-900">{conv.subject}</p>
                {conv.customer && (
                    <p>
                        {conv.customer.name}{conv.customer.email ? ` · ${conv.customer.email}` : ''}
                        {conv.customer.signed ? ' · signed in' : ' · verified email'}
                    </p>
                )}
                {(conv.screen || conv.url) && (
                    <p className="flex items-center gap-1.5">
                        <Monitor className="w-3.5 h-3.5 shrink-0" />
                        {conv.screen}
                        {conv.url && (
                            <a href={conv.url} target="_blank" rel="noopener noreferrer"
                               className="inline-flex items-center gap-1 text-indigo-600 hover:underline">
                                open page <ExternalLink className="w-3 h-3" />
                            </a>
                        )}
                    </p>
                )}
            </div>

            {/* The customer's site could not be told */}
            {conv.delivery?.status === 'failed' && (
                <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-900 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span className="flex-1">Site not told about the last change: {conv.delivery.error}</span>
                    <button onClick={resend} disabled={resending}
                            className="px-2.5 py-1 rounded-md bg-amber-600 text-white font-semibold hover:bg-amber-700 disabled:opacity-50 flex items-center gap-1">
                        <RefreshCw className={`w-3 h-3 ${resending ? 'animate-spin' : ''}`} /> Resend
                    </button>
                </div>
            )}

            {/* The thread */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-gray-50 min-h-[240px]">
                {conv.messages.map(m => m.author_type === 'system' ? (
                    <p key={m.id} className="text-center text-xs text-gray-500">
                        {m.body} · {new Date(m.created_at).toLocaleString()}
                    </p>
                ) : (
                    <div key={m.id} className={`flex ${m.author_type === 'agent' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm ${m.author_type === 'agent' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-900 border border-gray-200'}`}>
                            <p className={`text-[11px] font-semibold mb-0.5 ${m.author_type === 'agent' ? 'text-indigo-100' : 'text-gray-500'}`}>
                                {m.author_name} · {new Date(m.created_at).toLocaleString()}
                            </p>
                            {m.body && <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>}
                            {m.attachments.length > 0 && (
                                <div className="mt-2 space-y-1">
                                    {m.attachments.map(a => (
                                        <a key={a.index} href={`${API_URL}${a.url}`} target="_blank" rel="noopener noreferrer"
                                           className={`flex items-center gap-1.5 text-xs underline ${m.author_type === 'agent' ? 'text-indigo-100' : 'text-indigo-600'}`}>
                                            <Paperclip className="w-3 h-3" /> {a.name} ({sizeLabel(a.size)})
                                        </a>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                <div ref={bottom} />
            </div>

            {/* Reply */}
            <form onSubmit={send} className="border-t border-gray-100 p-4 bg-white space-y-2">
                {error && <p className="text-xs text-red-600">{error}</p>}
                <textarea
                    value={body}
                    onChange={e => setBody(e.target.value)}
                    placeholder="Reply to the customer -- they are emailed and see it in their Support tab"
                    className="w-full border-gray-300 rounded-lg p-3 text-sm focus:ring-indigo-500 focus:border-indigo-500 resize-none min-h-[90px]"
                />
                {files.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {files.map((f, i) => (
                            <span key={i} className="text-xs bg-gray-100 rounded-md px-2 py-1 flex items-center gap-1">
                                {f.name} ({sizeLabel(f.size)})
                                <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))}
                                        className="text-gray-500 hover:text-red-600" aria-label={`Remove ${f.name}`}>×</button>
                            </span>
                        ))}
                    </div>
                )}
                <div className="flex items-center gap-2">
                    <input ref={fileInput} type="file" multiple className="hidden" onChange={e => pickFiles(e.target.files)}
                           accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.csv,.xls,.xlsx,.doc,.docx" />
                    <button type="button" onClick={() => fileInput.current?.click()} disabled={files.length >= MAX_FILES}
                            className="px-3 py-2 text-xs font-semibold text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1">
                        <Paperclip className="w-3.5 h-3.5" /> Attach
                    </button>
                    <span className="text-[11px] text-gray-400">Up to {MAX_FILES} files, 10 MB each</span>
                    <button type="submit" disabled={sending || (!body.trim() && files.length === 0)}
                            className="ml-auto px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
                        <Send className="w-4 h-4" /> {sending ? 'Sending...' : 'Send reply'}
                    </button>
                </div>
            </form>
        </div>
    );
}
