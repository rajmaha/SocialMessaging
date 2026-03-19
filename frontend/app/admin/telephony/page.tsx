'use client';

import { useState, useEffect } from 'react';
import MainHeader from "@/components/MainHeader";
import AdminNav from '@/components/AdminNav';
import { authAPI, getAuthToken } from "@/lib/auth";
import { useRouter } from 'next/navigation';
import { Wifi, CheckCircle, XCircle, Code2, ChevronDown, ChevronUp } from 'lucide-react';
import { API_URL } from '@/lib/config';

export default function TelephonySettings() {
    const user = authAPI.getUser();
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testingAmi, setTestingAmi] = useState(false);
    const [testingSsh, setTestingSsh] = useState(false);
    const [sshTestResult, setSshTestResult] = useState<{ status: string; message: string } | null>(null);
    const [message, setMessage] = useState({ type: '', text: '' });
    const [testResult, setTestResult] = useState<{ status: string; message: string; diagnostics?: string[]; help?: string; method?: string; instructions?: string[] } | null>(null);
    const [amiTestResult, setAmiTestResult] = useState<{ status: string; message: string } | null>(null);
    const [introspecting, setIntrospecting] = useState(false);
    const [schemaResult, setSchemaResult] = useState<{ status: string; message: string; types?: Record<string, { found: boolean; fields: { name: string; type: string; default?: string }[]; note?: string }> } | null>(null);
    const [schemaOpen, setSchemaOpen] = useState(false);

    const [settings, setSettings] = useState({
        pbx_type: 'freepbx',
        host: '',
        freepbx_port: 443,
        ami_port: 5038,
        ami_username: '',
        ami_secret: '',
        webrtc_wss_url: '',
        freepbx_api_key: '',
        freepbx_api_secret: '',
        stun_servers: '',
        turn_server: '',
        turn_username: '',
        turn_credential: '',
        ssh_port: 22,
        ssh_username: '',
        ssh_password: '',
        is_active: false
    });

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        try {
            const token = getAuthToken();
            if (!token) { router.push('/login'); return; }

            const response = await fetch(`${API_URL}/admin/telephony/settings`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const data = await response.json();
                setSettings({
                    pbx_type: data.pbx_type || 'freepbx',
                    host: data.host || '',
                    freepbx_port: data.freepbx_port || 443,
                    ami_port: data.ami_port || 5038,
                    ami_username: data.ami_username || '',
                    ami_secret: data.ami_secret || '',
                    webrtc_wss_url: data.webrtc_wss_url || '',
                    freepbx_api_key: data.freepbx_api_key || '',
                    freepbx_api_secret: data.freepbx_api_secret || '',
                    stun_servers: data.stun_servers || '',
                    turn_server: data.turn_server || '',
                    turn_username: data.turn_username || '',
                    turn_credential: data.turn_credential || '',
                    ssh_port: data.ssh_port || 22,
                    ssh_username: data.ssh_username || '',
                    ssh_password: data.ssh_password || '',
                    is_active: data.is_active || false
                });
            }
        } catch (error) {
            console.error('Failed to fetch telephony settings:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setMessage({ type: '', text: '' });

        try {
            const token = getAuthToken();
            const response = await fetch(`${API_URL}/admin/telephony/settings`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(settings)
            });

            if (!response.ok) throw new Error('Failed to save telephony settings');
            setMessage({ type: 'success', text: '✅ Telephony settings saved successfully.' });
            setTimeout(() => setMessage({ type: '', text: '' }), 4000);
        } catch (error) {
            setMessage({ type: 'error', text: '❌ Error saving settings. Please try again.' });
        } finally {
            setSaving(false);
        }
    };

    const testFreePBX = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            const token = getAuthToken();
            // Save current form values first so the test uses the latest credentials
            await fetch(`${API_URL}/admin/telephony/settings`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
            });
            const response = await fetch(`${API_URL}/admin/telephony/test-freepbx`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            setTestResult(result);
        } catch (error) {
            setTestResult({ status: 'error', message: '❌ Connection test failed. Check network/host settings.' });
        } finally {
            setTesting(false);
        }
    };

    const testAMI = async () => {
        setTestingAmi(true);
        setAmiTestResult(null);
        try {
            const token = getAuthToken();
            await fetch(`${API_URL}/admin/telephony/settings`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
            });
            const response = await fetch(`${API_URL}/admin/telephony/test-ami`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (!response.ok) {
                setAmiTestResult({ status: 'error', message: result.detail || 'Request failed.' });
            } else {
                setAmiTestResult(result);
            }
        } catch (error) {
            setAmiTestResult({ status: 'error', message: `❌ AMI test failed: ${error instanceof Error ? error.message : 'Check network/host settings.'}` });
        } finally {
            setTestingAmi(false);
        }
    };

    const testSSH = async () => {
        setTestingSsh(true);
        setSshTestResult(null);
        try {
            const token = getAuthToken();
            await fetch(`${API_URL}/admin/telephony/settings`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
            });
            const response = await fetch(`${API_URL}/admin/telephony/test-ssh`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (!response.ok) {
                setSshTestResult({ status: 'error', message: result.detail || 'Request failed.' });
            } else {
                setSshTestResult(result);
            }
        } catch (error) {
            setSshTestResult({ status: 'error', message: `❌ SSH test failed: ${error instanceof Error ? error.message : 'Check settings.'}` });
        } finally {
            setTestingSsh(false);
        }
    };

    const introspectSchema = async () => {
        setIntrospecting(true);
        setSchemaResult(null);
        try {
            const token = getAuthToken();
            // Save settings first so introspection uses latest credentials
            await fetch(`${API_URL}/admin/telephony/settings`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
            });
            const response = await fetch(`${API_URL}/admin/telephony/introspect-schema`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const result = await response.json();
            if (!response.ok) {
                setSchemaResult({ status: 'error', message: result.detail || 'Introspection failed.' });
            } else {
                setSchemaResult(result);
                setSchemaOpen(true);
            }
        } catch (error) {
            setSchemaResult({ status: 'error', message: `Introspection failed: ${error instanceof Error ? error.message : 'Check connection.'}` });
        } finally {
            setIntrospecting(false);
        }
    };

    const inputClass = "w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 text-gray-900";
    const labelClass = "block text-sm font-medium text-gray-700 mb-2";

    return (
        <div className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-100 pb-16 md:pb-0">
            <MainHeader user={user!} />
            <AdminNav />

            <main className="max-w-4xl mx-auto p-6">
                <div className="mb-8 flex items-center justify-between">
                    <div>
                        <h2 className="text-3xl font-bold text-gray-900">Telephony (VoIP) Settings</h2>
                        <p className="text-gray-600 mt-2">Configure FreePBX integration for automatic extension management and WebRTC Softphone.</p>
                    </div>
                    <div className="flex items-center space-x-3">
                        <span className="text-sm font-medium text-gray-700">Integration Active</span>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={settings.is_active}
                                onChange={(e) => setSettings({ ...settings, is_active: e.target.checked })}
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                        </label>
                    </div>
                </div>

                {message.text && (
                    <div className={`p-4 rounded-md mb-6 ${message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                        {message.text}
                    </div>
                )}

                {loading ? (
                    <div className="flex justify-center p-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-6">

                        {/* FreePBX REST API Section */}
                        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                            <div className="flex items-center justify-between mb-4 border-b pb-3">
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-900">FreePBX API Credentials</h3>
                                    <p className="text-sm text-gray-500 mt-0.5">
                                        Used to auto-create/update/delete extensions.{' '}
                                        <strong>FreePBX 17:</strong> enter your FreePBX <em>admin username &amp; password</em> — no extra module needed.{' '}
                                        <strong>FreePBX 15/16:</strong> install the free <em>REST API</em> module → <em>Admin → User Management → API Keys</em>.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={testFreePBX}
                                    disabled={testing}
                                    className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors text-sm font-medium disabled:opacity-50"
                                >
                                    <Wifi className={`w-4 h-4 ${testing ? 'animate-pulse' : ''}`} />
                                    {testing ? 'Testing…' : 'Test Connection'}
                                </button>
                            </div>

                            {testResult && (
                                <div className={`p-3 rounded-lg mb-5 text-sm ${
                                    testResult.status === 'success' ? 'bg-green-50 text-green-800 border border-green-200'
                                    : testResult.status === 'warning' ? 'bg-amber-50 text-amber-900 border border-amber-200'
                                    : 'bg-red-50 text-red-800 border border-red-200'
                                }`}>
                                    <div className="flex items-start gap-2">
                                        {testResult.status === 'success'
                                            ? <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-green-600" />
                                            : testResult.status === 'warning'
                                            ? <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                                            : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                                        }
                                        <span>{testResult.message}</span>
                                    </div>
                                    {testResult.instructions && (
                                        <div className="mt-3 ml-6 p-3 bg-white/60 rounded border border-amber-200">
                                            <p className="font-semibold mb-1 text-amber-800">Next steps to enable API access:</p>
                                            <ol className="space-y-1 text-xs text-amber-900 font-mono">
                                                {testResult.instructions.map((step, i) => (
                                                    <li key={i}>{step}</li>
                                                ))}
                                            </ol>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className={labelClass}>PBX Host / Domain</label>
                                    <input
                                        type="text"
                                        value={settings.host}
                                        onChange={(e) => setSettings({ ...settings, host: e.target.value })}
                                        className={inputClass}
                                        placeholder="https://pbx.example.com or 192.168.1.10"
                                    />
                                    <p className="mt-1 text-xs text-gray-500">Full URL or IP. HTTPS is recommended.</p>
                                </div>

                                <div>
                                    <label className={labelClass}>FreePBX Username / API Client ID</label>
                                    <input
                                        type="text"
                                        value={settings.freepbx_api_key}
                                        onChange={(e) => setSettings({ ...settings, freepbx_api_key: e.target.value })}
                                        className={inputClass}
                                        placeholder="admin"
                                    />
                                    <p className="mt-1 text-xs text-gray-500">FreePBX 17: use your admin username. FreePBX 15/16: use the API Client ID.</p>
                                </div>

                                <div>
                                    <label className={labelClass}>FreePBX Password / API Secret</label>
                                    <input
                                        type="password"
                                        value={settings.freepbx_api_secret}
                                        onChange={(e) => setSettings({ ...settings, freepbx_api_secret: e.target.value })}
                                        className={inputClass}
                                        placeholder="••••••••••••"
                                    />
                                    <p className="mt-1 text-xs text-gray-500">FreePBX 17: use your admin password. FreePBX 15/16: use the API Secret.</p>
                                </div>

                                <div>
                                    <label className={labelClass}>HTTPS Port</label>
                                    <input
                                        type="number"
                                        value={settings.freepbx_port}
                                        onChange={(e) => setSettings({ ...settings, freepbx_port: parseInt(e.target.value) || 443 })}
                                        className={inputClass}
                                        placeholder="443"
                                    />
                                    <p className="mt-1 text-xs text-gray-500">Default 443 for HTTPS, 80 for HTTP.</p>
                                </div>
                            </div>
                        </div>

                        {/* GraphQL Schema Introspection */}
                        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                            <div className="flex items-center justify-between mb-2">
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-900">FreePBX GraphQL Schema</h3>
                                    <p className="text-sm text-gray-500 mt-0.5">
                                        Discover available PJSIP/WebRTC fields in your FreePBX 17 installation.
                                        This helps verify which extension settings (transport, DTLS, codecs, ICE) are supported by the API.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={introspectSchema}
                                    disabled={introspecting}
                                    className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-medium disabled:opacity-50 shrink-0"
                                >
                                    <Code2 className={`w-4 h-4 ${introspecting ? 'animate-spin' : ''}`} />
                                    {introspecting ? 'Inspecting…' : 'Show FreePBX Schema'}
                                </button>
                            </div>

                            {schemaResult && (
                                <div className="mt-4">
                                    {schemaResult.status === 'error' || schemaResult.status === 'warning' ? (
                                        <div className={`p-3 rounded-lg text-sm border ${
                                            schemaResult.status === 'error'
                                                ? 'bg-red-50 text-red-800 border-red-200'
                                                : 'bg-amber-50 text-amber-800 border-amber-200'
                                        }`}>
                                            <div className="flex items-start gap-2">
                                                <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                                                <span>{schemaResult.message}</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div>
                                            <button
                                                type="button"
                                                onClick={() => setSchemaOpen(!schemaOpen)}
                                                className="flex items-center gap-2 text-sm font-medium text-indigo-700 hover:text-indigo-900 mb-3"
                                            >
                                                {schemaOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                                {schemaOpen ? 'Hide schema details' : 'Show schema details'}
                                            </button>

                                            {schemaOpen && schemaResult.types && (
                                                <div className="space-y-4">
                                                    {Object.entries(schemaResult.types).map(([typeName, info]) => (
                                                        <div key={typeName} className="border border-gray-200 rounded-lg overflow-hidden">
                                                            <div className={`px-4 py-2 text-sm font-semibold ${
                                                                info.found ? 'bg-green-50 text-green-800' : 'bg-gray-50 text-gray-500'
                                                            }`}>
                                                                {typeName}
                                                                {!info.found && <span className="font-normal ml-2 text-xs">({info.note || 'not found'})</span>}
                                                                {info.found && <span className="font-normal ml-2 text-xs text-green-600">({info.fields.length} fields)</span>}
                                                            </div>
                                                            {info.found && info.fields.length > 0 && (
                                                                <div className="overflow-x-auto">
                                                                    <table className="min-w-full text-xs">
                                                                        <thead className="bg-gray-50">
                                                                            <tr>
                                                                                <th className="px-4 py-1.5 text-left font-semibold text-gray-500">Field Name</th>
                                                                                <th className="px-4 py-1.5 text-left font-semibold text-gray-500">Type</th>
                                                                                <th className="px-4 py-1.5 text-left font-semibold text-gray-500">Default</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody className="divide-y divide-gray-100">
                                                                            {info.fields.map((f) => {
                                                                                const isWebRTC = ['webrtc', 'transport', 'dtlsEnable', 'dtlsVerify', 'dtlsSetup', 'dtlsCertfile', 'mediaEncryption', 'mediaUseReceivedTransport', 'iceSupport', 'allow', 'maxContacts'].includes(f.name);
                                                                                return (
                                                                                    <tr key={f.name} className={isWebRTC ? 'bg-indigo-50' : ''}>
                                                                                        <td className={`px-4 py-1 font-mono ${isWebRTC ? 'text-indigo-700 font-semibold' : 'text-gray-800'}`}>
                                                                                            {f.name}
                                                                                            {isWebRTC && <span className="ml-1.5 text-[10px] font-sans font-medium text-indigo-500 bg-indigo-100 px-1.5 py-0.5 rounded">WebRTC</span>}
                                                                                        </td>
                                                                                        <td className="px-4 py-1 text-gray-500">{f.type || '—'}</td>
                                                                                        <td className="px-4 py-1 text-gray-400">{f.default || '—'}</td>
                                                                                    </tr>
                                                                                );
                                                                            })}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}

                                                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                                                        <strong>Note:</strong> Fields highlighted in blue with the <span className="font-mono bg-indigo-100 text-indigo-600 px-1 rounded">WebRTC</span> badge are
                                                        automatically configured when extensions are created/synced.
                                                        If your FreePBX schema supports them, transport, DTLS, codecs, and ICE will be set automatically for WebRTC softphone use.
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* WebRTC Section */}
                        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                            <h3 className="text-lg font-semibold text-gray-900 mb-4 border-b pb-3">WebRTC Softphone Configuration</h3>
                            <div className="space-y-6">
                                <div>
                                    <label className={labelClass}>WebRTC WSS URL</label>
                                    <input
                                        type="text"
                                        value={settings.webrtc_wss_url}
                                        onChange={(e) => setSettings({ ...settings, webrtc_wss_url: e.target.value })}
                                        className={inputClass}
                                        placeholder="wss://pbx.yourdomain.com:8089/ws"
                                    />
                                    <p className="mt-1 text-sm text-gray-500">
                                        External WebSocket Secure URL for SIP.js softphone to connect to Asterisk.
                                    </p>
                                </div>

                                {/* STUN/TURN Configuration */}
                                <div className="pt-4 border-t border-gray-100">
                                    <h4 className="text-sm font-semibold text-gray-800 mb-3">ICE Servers (STUN / TURN)</h4>
                                    <p className="text-xs text-gray-500 mb-4">
                                        STUN helps discover public IP addresses. TURN relays media when direct connections fail (agents behind strict NAT/firewall).
                                        If left empty, Google STUN servers are used by default.
                                    </p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="md:col-span-2">
                                            <label className={labelClass}>STUN Servers</label>
                                            <input
                                                type="text"
                                                value={settings.stun_servers}
                                                onChange={(e) => setSettings({ ...settings, stun_servers: e.target.value })}
                                                className={inputClass}
                                                placeholder="stun:stun.l.google.com:19302, stun:stun.cloudflare.com:3478"
                                            />
                                            <p className="mt-1 text-xs text-gray-500">
                                                Comma-separated STUN server URLs. Leave empty to use Google STUN (default).
                                            </p>
                                        </div>
                                        <div>
                                            <label className={labelClass}>TURN Server</label>
                                            <input
                                                type="text"
                                                value={settings.turn_server}
                                                onChange={(e) => setSettings({ ...settings, turn_server: e.target.value })}
                                                className={inputClass}
                                                placeholder="turn:turn.yourdomain.com:3478"
                                            />
                                            <p className="mt-1 text-xs text-gray-500">
                                                Optional. Only needed if agents connect from behind strict firewalls.
                                            </p>
                                        </div>
                                        <div>
                                            <label className={labelClass}>TURN Username</label>
                                            <input
                                                type="text"
                                                value={settings.turn_username}
                                                onChange={(e) => setSettings({ ...settings, turn_username: e.target.value })}
                                                className={inputClass}
                                                placeholder="webrtc"
                                            />
                                        </div>
                                        <div>
                                            <label className={labelClass}>TURN Password</label>
                                            <input
                                                type="password"
                                                value={settings.turn_credential}
                                                onChange={(e) => setSettings({ ...settings, turn_credential: e.target.value })}
                                                className={inputClass}
                                                placeholder="••••••••"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* SSH Section — for PJSIP WebRTC configuration */}
                        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                            <div className="flex items-center justify-between mb-4 border-b pb-3">
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-900">SSH Access (for PJSIP / WebRTC Config)</h3>
                                    <p className="text-sm text-gray-500 mt-0.5">
                                        SSH into the FreePBX server to configure PJSIP WebRTC settings (DTLS, ICE, codecs, transport)
                                        and apply config automatically. This is the <strong>most reliable</strong> method for FreePBX 17.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={testSSH}
                                    disabled={testingSsh}
                                    className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-medium disabled:opacity-50 shrink-0"
                                >
                                    <Wifi className={`w-4 h-4 ${testingSsh ? 'animate-pulse' : ''}`} />
                                    {testingSsh ? 'Testing…' : 'Test SSH'}
                                </button>
                            </div>

                            {sshTestResult && (
                                <div className={`p-3 rounded-lg mb-5 border flex items-start gap-2 text-sm ${
                                    sshTestResult.status === 'success'
                                        ? 'bg-green-50 border-green-200 text-green-800'
                                        : sshTestResult.status === 'warning'
                                        ? 'bg-amber-50 border-amber-200 text-amber-800'
                                        : 'bg-red-50 border-red-200 text-red-800'
                                }`}>
                                    {sshTestResult.status === 'success'
                                        ? <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
                                        : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}
                                    <span>{sshTestResult.message}</span>
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div>
                                    <label className={labelClass}>SSH Username</label>
                                    <input
                                        type="text"
                                        value={settings.ssh_username}
                                        onChange={(e) => setSettings({ ...settings, ssh_username: e.target.value })}
                                        className={inputClass}
                                        placeholder="root"
                                    />
                                    <p className="mt-1 text-xs text-gray-500">Usually root for FreePBX servers.</p>
                                </div>
                                <div>
                                    <label className={labelClass}>SSH Password</label>
                                    <input
                                        type="password"
                                        value={settings.ssh_password}
                                        onChange={(e) => setSettings({ ...settings, ssh_password: e.target.value })}
                                        className={inputClass}
                                        placeholder="••••••••"
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>SSH Port</label>
                                    <input
                                        type="number"
                                        value={settings.ssh_port}
                                        onChange={(e) => setSettings({ ...settings, ssh_port: parseInt(e.target.value) || 22 })}
                                        className={inputClass}
                                        placeholder="22"
                                    />
                                </div>
                            </div>
                            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                                <strong>How it works:</strong> When you sync an extension, the system SSHs into your FreePBX server,
                                writes WebRTC PJSIP settings (DTLS, ICE, codecs, transport) directly to the MySQL <code className="bg-blue-100 px-1 rounded">pjsip</code> table,
                                then runs <code className="bg-blue-100 px-1 rounded">fwconsole reload</code> to apply the config. The PBX Host from the API section above is used as the SSH hostname.
                            </div>
                        </div>

                        {/* AMI Section */}
                        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                            <h3 className="text-lg font-semibold text-gray-900 mb-4 border-b pb-3">AMI Backend Configuration (Optional)</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className={labelClass}>PBX Type</label>
                                    <select
                                        value={settings.pbx_type}
                                        onChange={(e) => setSettings({ ...settings, pbx_type: e.target.value })}
                                        className={inputClass}
                                    >
                                        <option value="freepbx">FreePBX</option>
                                        <option value="asterisk">Asterisk (Raw)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className={labelClass}>AMI Port</label>
                                    <input
                                        type="number"
                                        value={settings.ami_port}
                                        onChange={(e) => setSettings({ ...settings, ami_port: parseInt(e.target.value) || 5038 })}
                                        className={inputClass}
                                        placeholder="5038"
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>AMI Username</label>
                                    <input
                                        type="text"
                                        value={settings.ami_username}
                                        onChange={(e) => setSettings({ ...settings, ami_username: e.target.value })}
                                        className={inputClass}
                                        placeholder="admin"
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>AMI Secret / Password</label>
                                    <input
                                        type="password"
                                        value={settings.ami_secret}
                                        onChange={(e) => setSettings({ ...settings, ami_secret: e.target.value })}
                                        className={inputClass}
                                        placeholder="••••••••"
                                    />
                                </div>
                            </div>

                            {/* AMI Test Button + Result */}
                            <div className="mt-6 pt-4 border-t border-gray-100">
                                <button
                                    type="button"
                                    onClick={testAMI}
                                    disabled={testingAmi}
                                    className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                                >
                                    <Wifi className="w-4 h-4" />
                                    {testingAmi ? 'Testing AMI…' : 'Test AMI Connection'}
                                </button>

                                {amiTestResult && (
                                    <div className={`mt-3 p-3 rounded-lg border flex items-start gap-2 text-sm ${
                                        amiTestResult.status === 'success'
                                            ? 'bg-green-50 border-green-200 text-green-800'
                                            : 'bg-red-50 border-red-200 text-red-800'
                                    }`}>
                                        {amiTestResult.status === 'success'
                                            ? <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
                                            : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}
                                        <span>{amiTestResult.message}</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex justify-end">
                            <button
                                type="submit"
                                disabled={saving}
                                className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                            >
                                {saving ? 'Saving…' : 'Save Telephony Settings'}
                            </button>
                        </div>
                    </form>
                )}
            </main>
        </div>
    );
}
