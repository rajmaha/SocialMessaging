'use client';

import { useState, useEffect } from 'react';
import MainHeader from "@/components/MainHeader";
import AdminNav from '@/components/AdminNav';
import { authAPI, getAuthToken } from "@/lib/auth";
import { useRouter } from 'next/navigation';
import { Wifi, CheckCircle, XCircle } from 'lucide-react';
import { API_URL } from '@/lib/config';

export default function TelephonySettings() {
    const user = authAPI.getUser();
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [message, setMessage] = useState({ type: '', text: '' });
    const [testResult, setTestResult] = useState<{ status: string; message: string } | null>(null);

    const [settings, setSettings] = useState({
        pbx_type: 'freepbx',
        host: '',
        port: 443,
        ami_username: '',
        ami_secret: '',
        webrtc_wss_url: '',
        freepbx_api_key: '',
        freepbx_api_secret: '',
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
                    port: data.port || 443,
                    ami_username: data.ami_username || '',
                    ami_secret: data.ami_secret || '',
                    webrtc_wss_url: data.webrtc_wss_url || '',
                    freepbx_api_key: data.freepbx_api_key || '',
                    freepbx_api_secret: data.freepbx_api_secret || '',
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

    const inputClass = "w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 text-gray-900";
    const labelClass = "block text-sm font-medium text-gray-700 mb-2";

    return (
        <div className="ml-60 pt-14 min-h-screen bg-gray-100">
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
                                    <h3 className="text-lg font-semibold text-gray-900">FreePBX REST API Credentials</h3>
                                    <p className="text-sm text-gray-500 mt-0.5">
                                        Used to auto-create/update/delete extensions. Get API keys from FreePBX: <em>Admin → User Management → API Keys</em>.
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
                                <div className={`flex items-start gap-2 p-3 rounded-lg mb-5 text-sm ${testResult.status === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                                    {testResult.status === 'success'
                                        ? <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
                                        : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                                    }
                                    {testResult.message}
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
                                    <label className={labelClass}>FreePBX API Key (Client ID)</label>
                                    <input
                                        type="text"
                                        value={settings.freepbx_api_key}
                                        onChange={(e) => setSettings({ ...settings, freepbx_api_key: e.target.value })}
                                        className={inputClass}
                                        placeholder="API key from FreePBX User Management"
                                    />
                                </div>

                                <div>
                                    <label className={labelClass}>FreePBX API Secret</label>
                                    <input
                                        type="password"
                                        value={settings.freepbx_api_secret}
                                        onChange={(e) => setSettings({ ...settings, freepbx_api_secret: e.target.value })}
                                        className={inputClass}
                                        placeholder="••••••••••••"
                                    />
                                </div>

                                <div>
                                    <label className={labelClass}>HTTPS Port</label>
                                    <input
                                        type="number"
                                        value={settings.port}
                                        onChange={(e) => setSettings({ ...settings, port: parseInt(e.target.value) || 443 })}
                                        className={inputClass}
                                        placeholder="443"
                                    />
                                    <p className="mt-1 text-xs text-gray-500">Default 443 for HTTPS, 80 for HTTP.</p>
                                </div>
                            </div>
                        </div>

                        {/* WebRTC Section */}
                        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                            <h3 className="text-lg font-semibold text-gray-900 mb-4 border-b pb-3">WebRTC Softphone Configuration</h3>
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
                                        value={settings.port}
                                        onChange={(e) => setSettings({ ...settings, port: parseInt(e.target.value) || 5038 })}
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
