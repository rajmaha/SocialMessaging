'use client';

/**
 * The Support section of one widget domain (Admin -> Widget Domains -> Support).
 * Backend: PUT /admin/widget-domains/{id}/support and POST .../support-secret
 * (app/routes/widget_domains.py). The identity secret is shown once, when made.
 */

import { useEffect, useState } from 'react';
import { getAuthToken } from '@/lib/auth';
import { API_URL } from '@/lib/config';

export interface DomainSupport {
    id: number;
    domain: string;
    widget_key: string;
    support_enabled: boolean;
    chat_enabled: boolean;
    allow_anonymous: boolean;
    support_categories: string[];
    webhook_url: string | null;
    organization_id: number | null;
    has_identity_secret: boolean;
}

type Org = { id: number; organization_name: string };

export default function WidgetDomainSupport({ domain, onSaved }: { domain: DomainSupport; onSaved: () => void }) {
    const [enabled, setEnabled] = useState(domain.support_enabled);
    const [chat, setChat] = useState(domain.chat_enabled);
    const [anonymous, setAnonymous] = useState(domain.allow_anonymous);
    const [categories, setCategories] = useState((domain.support_categories || []).join('\n'));
    const [webhook, setWebhook] = useState(domain.webhook_url || '');
    const [orgId, setOrgId] = useState<string>(domain.organization_id ? String(domain.organization_id) : '');
    const [orgs, setOrgs] = useState<Org[]>([]);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
    const [secret, setSecret] = useState('');
    const [hasSecret, setHasSecret] = useState(domain.has_identity_secret);
    const [copied, setCopied] = useState(false);

    const auth = () => ({ Authorization: `Bearer ${getAuthToken()}` });

    useEffect(() => {
        fetch(`${API_URL}/organizations/`, { headers: auth() })
            .then(r => (r.ok ? r.json() : []))
            .then(d => setOrgs(Array.isArray(d) ? d : []))
            .catch(() => setOrgs([]));
    }, []);

    const save = async () => {
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch(`${API_URL}/admin/widget-domains/${domain.id}/support`, {
                method: 'PUT',
                headers: { ...auth(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    support_enabled: enabled,
                    chat_enabled: chat,
                    allow_anonymous: anonymous,
                    support_categories: categories.split('\n').map(c => c.trim()).filter(Boolean),
                    webhook_url: webhook.trim() || null,
                    organization_id: orgId ? Number(orgId) : null,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Not saved.');
            setCategories((data.support_categories || []).join('\n'));
            setMessage({ ok: true, text: 'Support settings saved.' });
            onSaved();
        } catch (e: any) {
            setMessage({ ok: false, text: e.message || 'Not saved.' });
        } finally {
            setSaving(false);
        }
    };

    const makeSecret = async () => {
        if (hasSecret && !window.confirm('Make a new secret? The site\'s current secret stops working at once, so its support sign-in and webhook checks fail until it is given the new one.')) return;
        const res = await fetch(`${API_URL}/admin/widget-domains/${domain.id}/support-secret`, { method: 'POST', headers: auth() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setMessage({ ok: false, text: data.detail || 'Could not make a secret.' }); return; }
        setSecret(data.secret);
        setHasSecret(true);
        setCopied(false);
        onSaved();
    };

    const copySecret = async () => {
        try { await navigator.clipboard.writeText(secret); setCopied(true); } catch { setCopied(false); }
    };

    const snippet = `<script>
  window.SocialChatConfig = {
    serverUrl: '${typeof window !== 'undefined' ? window.location.origin : ''}',
    identity: '<token signed by your server>'   // leave out for anonymous visitors
  };
</script>
<script src="${typeof window !== 'undefined' ? window.location.origin : ''}/chat-widget.js" data-key="${domain.widget_key}" async></script>`;

    return (
        <div className="max-w-3xl space-y-4">
            <div className="flex flex-wrap gap-x-6 gap-y-2">
                <label className="flex items-center gap-2 text-sm text-gray-800">
                    <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="rounded border-gray-300" />
                    Support requests on (a Support tab in the widget)
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-800">
                    <input type="checkbox" checked={chat} onChange={e => setChat(e.target.checked)} className="rounded border-gray-300" />
                    Chat tab on
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-800">
                    <input type="checkbox" checked={anonymous} onChange={e => setAnonymous(e.target.checked)} className="rounded border-gray-300" />
                    Visitors without a site login may ask (they verify an email)
                </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Categories, one per line</label>
                    <textarea value={categories} onChange={e => setCategories(e.target.value)} rows={5}
                              placeholder={'Bug\nHow to\nBilling'}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" />
                    <p className="text-[11px] text-gray-500 mt-1">None: the customer types their own. Up to 20.</p>
                </div>
                <div className="space-y-3">
                    <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Organization</label>
                        <select value={orgId} onChange={e => setOrgId(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                            <option value="">None</option>
                            {orgs.map(o => <option key={o.id} value={o.id}>{o.organization_name}</option>)}
                        </select>
                        <p className="text-[11px] text-gray-500 mt-1">Requests from this site are filed under it.</p>
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Webhook address (optional)</label>
                        <input value={webhook} onChange={e => setWebhook(e.target.value)} placeholder="https://site.example.com/support-hook"
                               className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" />
                        <p className="text-[11px] text-gray-500 mt-1">Told of every reply and status change, signed with the secret below.</p>
                    </div>
                </div>
            </div>

            <div className="border border-gray-200 rounded-lg bg-white p-3 space-y-2">
                <div className="flex items-center gap-3">
                    <div className="flex-1">
                        <p className="text-sm font-semibold text-gray-800">Identity secret</p>
                        <p className="text-xs text-gray-500">
                            {hasSecret ? 'Set. The site uses it to sign its signed-in users and to check webhooks.' : 'Not set. Needed for signed-in users and webhooks.'}
                        </p>
                    </div>
                    <button type="button" onClick={makeSecret}
                            className="px-3 py-1.5 text-xs font-semibold rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-800">
                        {hasSecret ? 'Make a new secret' : 'Make secret'}
                    </button>
                </div>
                {secret && (
                    <div className="bg-amber-50 border border-amber-200 rounded p-3 space-y-2">
                        <p className="text-xs font-semibold text-amber-900">Copy it now: it is not shown again.</p>
                        <div className="flex gap-2">
                            <code className="flex-1 text-xs bg-white border border-amber-200 rounded px-2 py-1.5 break-all select-all">{secret}</code>
                            <button type="button" onClick={copySecret}
                                    className="px-3 py-1 text-xs font-semibold rounded bg-amber-600 text-white hover:bg-amber-700">
                                {copied ? 'Copied' : 'Copy'}
                            </button>
                        </div>
                    </div>
                )}
                <details className="text-xs text-gray-600">
                    <summary className="cursor-pointer font-semibold">The snippet for this site</summary>
                    <pre className="mt-2 bg-gray-50 border border-gray-200 rounded p-2 overflow-x-auto whitespace-pre">{snippet}</pre>
                    <p className="mt-1">The token is made on the site's own server, never in the browser. Its format is in docs/support-desk.md.</p>
                </details>
            </div>

            <p className="text-xs text-gray-500">New requests go to the shared Support queue of the agents ticked under <b>Agents</b> for this domain.</p>

            <div className="flex items-center gap-3">
                <button type="button" onClick={save} disabled={saving}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                    {saving ? 'Saving...' : 'Save support settings'}
                </button>
                {message && <span className={`text-sm ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</span>}
            </div>
        </div>
    );
}
