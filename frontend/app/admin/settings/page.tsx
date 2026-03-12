'use client';

import { useState, useEffect } from 'react';
import MainHeader from "@/components/MainHeader";
import { authAPI } from "@/lib/auth";
import { useRouter } from 'next/navigation';
import { getAuthToken } from '@/lib/auth';
import AdminNav from '@/components/AdminNav';
import { API_URL } from '@/lib/config';

interface PlatformSetting {
    id: number;
    platform: string;
    app_id: string | null;
    is_configured: number;
    webhook_registered: number;
    updated_at: string;
}

export default function AdminSettings() {
    const user = authAPI.getUser();
    const router = useRouter();
    const [platforms, setPlatforms] = useState<PlatformSetting[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [testResult, setTestResult] = useState<{
        credential_ok: boolean;
        credential_detail: string;
        webhook_status: string;
        webhook_detail: string;
    } | null>(null);
    const [testing, setTesting] = useState(false);
    const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
    const togglePassword = (key: string) => setShowPasswords(prev => ({ ...prev, [key]: !prev[key] }));

    // Form state for each platform
    const [formData, setFormData] = useState({
        facebook: {
            app_id: '',
            app_secret: '',
            access_token: '',
            verify_token: '',
            page_id: ''
        },
        whatsapp: {
            app_id: '',
            app_secret: '',
            access_token: '',
            verify_token: '',
            phone_number_id: '',
            business_account_id: ''
        },
        viber: {
            app_id: '',
            access_token: ''
        },
        linkedin: {
            app_id: '',
            app_secret: '',
            access_token: ''
        }
    });

    useEffect(() => {
        fetchPlatforms();
    }, []);

    const fetchPlatforms = async () => {
        try {
            const token = getAuthToken();
            if (!token) {
                router.push('/login');
                return;
            }
            const response = await fetch(`${API_URL}/admin/platforms`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.status === 403) {
                router.push('/dashboard');
                return;
            }

            if (!response.ok) {
                throw new Error('Failed to fetch platform settings');
            }

            const data = await response.json();
            setPlatforms(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setLoading(false);
        }
    };

    const handlePlatformSelect = async (platform: string) => {
        setSelectedPlatform(platform);
        setTestResult(null);
        try {
            const token = getAuthToken();
            if (!token) {
                setError('Not authenticated');
                return;
            }
            const response = await fetch(
                `${API_URL}/admin/platforms/${platform}`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            // 404 means not yet configured — show empty form
            if (response.status === 404) {
                setShowForm(true);
                return;
            }

            if (!response.ok) {
                throw new Error(`Failed to fetch ${platform} settings`);
            }

            const data = await response.json();

            // Populate form with existing data
            const platformKey = platform as keyof typeof formData;
            const currentData = { ...formData[platformKey] };

            if (data.app_id) (currentData as any).app_id = data.app_id;
            if (data.app_secret) (currentData as any).app_secret = data.app_secret;
            if (data.access_token) (currentData as any).access_token = data.access_token;
            if (data.verify_token) (currentData as any).verify_token = data.verify_token;
            if (data.page_id) (currentData as any).page_id = data.page_id;
            if (data.phone_number_id) (currentData as any).phone_number_id = data.phone_number_id;
            if (data.business_account_id) (currentData as any).business_account_id = data.business_account_id;

            setFormData((prev) => ({
                ...prev,
                [platformKey]: currentData
            }));

            setShowForm(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        }
    };

    const handleFormChange = (platform: string, field: string, value: string) => {
        setTestResult(null);
        const platformKey = platform as keyof typeof formData;
        setFormData((prev) => ({
            ...prev,
            [platformKey]: {
                ...prev[platformKey],
                [field]: value
            }
        }));
    };

    const handleTestConnection = async (platform: string) => {
        const token = getAuthToken();
        if (!token) { setError('Not authenticated'); return; }

        setTesting(true);
        setTestResult(null);
        try {
            const platformKey = platform as keyof typeof formData;
            const response = await fetch(`${API_URL}/admin/platforms/${platform}/test`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData[platformKey])
            });
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.detail || 'Test failed');
            }
            const result = await response.json();
            setTestResult(result);
            if (result.credential_ok) await fetchPlatforms();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setTesting(false);
        }
    };

    const handleSavePlatformSettings = async (platform: string) => {
        if (!selectedPlatform) return;

        try {
            const token = getAuthToken();
            if (!token) {
                setError('Not authenticated');
                return;
            }
            const platformKey = platform as keyof typeof formData;
            const platformData = formData[platformKey];

            const response = await fetch(
                `${API_URL}/admin/platforms/${platform}`,
                {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(platformData)
                }
            );

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.detail || 'Failed to save settings');
            }

            setShowForm(false);
            setSelectedPlatform(null);
            setTestResult(null);
            await fetchPlatforms();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        }
    };

    const isTestable = (platform: string): boolean => {
        if (platform === 'whatsapp') {
            return !!(formData.whatsapp.access_token && formData.whatsapp.phone_number_id);
        }
        if (platform === 'facebook') {
            return !!(formData.facebook.access_token && formData.facebook.page_id);
        }
        if (platform === 'viber') return !!formData.viber.access_token;
        if (platform === 'linkedin') return !!formData.linkedin.access_token;
        return false;
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
            </div>
        );
    }

    return (
        <div className="ml-60 pt-14 min-h-screen bg-gray-100">
            <MainHeader user={user!} />
            <AdminNav />

            {/* Main Content */}
            <main className="w-full p-6">
                {/* Header */}
                <div className="mb-8">
                    <h2 className="text-3xl font-bold text-gray-900">Platform Configuration</h2>
                    <p className="text-gray-600 mt-2">Manage credentials and settings for messaging platforms</p>
                </div>

                {/* Error Message */}
                {error && (
                    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
                        {error}
                    </div>
                )}

                {/* Platform Cards */}
                {!showForm ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {['facebook', 'whatsapp', 'viber', 'linkedin'].map((platform) => {
                            const setting = platforms.find(p => p.platform === platform);
                            const statusColor = setting?.is_configured === 0 ? 'red' :
                                setting?.is_configured === 1 ? 'yellow' : 'green';

                            return (
                                <div key={platform} className="bg-white rounded-lg shadow p-6">
                                    <div className="flex items-start justify-between mb-4">
                                        <div>
                                            <h3 className="text-xl font-bold text-gray-900 capitalize">{platform}</h3>
                                            <p className="text-gray-600 text-sm mt-1">
                                                {platform === 'facebook' && 'Facebook Messenger'}
                                                {platform === 'whatsapp' && 'WhatsApp Business'}
                                                {platform === 'viber' && 'Viber Bot'}
                                                {platform === 'linkedin' && 'LinkedIn Messaging'}
                                            </p>
                                        </div>
                                        <span className={`px-3 py-1 rounded-full text-sm font-semibold ${statusColor === 'green' ? 'bg-green-100 text-green-800' :
                                            statusColor === 'yellow' ? 'bg-yellow-100 text-yellow-800' :
                                                'bg-red-100 text-red-800'
                                            }`}>
                                            {setting?.is_configured === 0 ? 'Not Setup' :
                                                setting?.is_configured === 1 ? 'Configured' :
                                                    'Verified'}
                                        </span>
                                    </div>

                                    <div className="space-y-2 mb-6 text-sm text-gray-600">
                                        <p>
                                            <strong>Webhook:</strong> {setting?.webhook_registered === 1 ? '✓ Registered' : '✗ Not Registered'}
                                        </p>
                                        {setting?.updated_at && (
                                            <p>
                                                <strong>Updated:</strong> {new Date(setting.updated_at).toLocaleDateString()}
                                            </p>
                                        )}
                                    </div>

                                    <button
                                        onClick={() => handlePlatformSelect(platform)}
                                        className="w-full text-white font-semibold py-2 px-4 rounded-lg transition"
                                        style={{ backgroundColor: 'var(--button-primary)' }}
                                    >
                                        Configure
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                ) : selectedPlatform && (
                    // Platform Configuration Form
                    <div className="bg-white rounded-lg shadow p-6 mb-6">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-2xl font-bold text-gray-900 capitalize">{selectedPlatform} Configuration</h3>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowForm(false);
                                    setSelectedPlatform(null);
                                    setTestResult(null);
                                }}
                                className="text-gray-500 hover:text-gray-700"
                            >
                                ✕
                            </button>
                        </div>

                        <form onSubmit={(e) => {
                            e.preventDefault();
                            handleSavePlatformSettings(selectedPlatform);
                        }}>
                            {selectedPlatform === 'facebook' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-gray-700 text-sm font-bold mb-2">App ID</label>
                                        <input
                                            type="text"
                                            value={formData.facebook.app_id}
                                            onChange={(e) => handleFormChange('facebook', 'app_id', e.target.value)}
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                            placeholder="Your Facebook App ID"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-gray-700 text-sm font-bold mb-2">App Secret</label>
                                        <div className="relative">
                                            <input
                                                type={showPasswords['facebook_app_secret'] ? 'text' : 'password'}
                                                value={formData.facebook.app_secret}
                                                onChange={(e) => handleFormChange('facebook', 'app_secret', e.target.value)}
                                                className="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                                placeholder="Your Facebook App Secret"
                                            />
                                            <button type="button" onClick={() => togglePassword('facebook_app_secret')} className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-600">
                                                {showPasswords['facebook_app_secret'] ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg> : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>}
                                            </button>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-gray-700 text-sm font-bold mb-2">Access Token</label>
                                        <div className="relative">
                                            <input
                                                type={showPasswords['facebook_access_token'] ? 'text' : 'password'}
                                                value={formData.facebook.access_token}
                                                onChange={(e) => handleFormChange('facebook', 'access_token', e.target.value)}
                                                className="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                                placeholder="Your Facebook Access Token"
                                            />
                                            <button type="button" onClick={() => togglePassword('facebook_access_token')} className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-600">
                                                {showPasswords['facebook_access_token'] ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg> : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>}
                                            </button>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-gray-700 text-sm font-bold mb-2">Verify Token</label>
                                        <input
                                            type="text"
                                            value={formData.facebook.verify_token}
                                            onChange={(e) => handleFormChange('facebook', 'verify_token', e.target.value)}
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                            placeholder="Webhook Verify Token"
                                        />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-gray-700 text-sm font-bold mb-2">Page ID</label>
                                        <input
                                            type="text"
                                            value={formData.facebook.page_id}
                                            onChange={(e) => handleFormChange('facebook', 'page_id', e.target.value)}
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                            placeholder="Your Facebook Page ID"
                                        />
                                    </div>
                                </div>
                            )}

                            {selectedPlatform === 'whatsapp' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-gray-700 text-sm font-bold mb-2">App ID</label>
                                        <input
                                            type="text"
                                            value={formData.whatsapp.app_id}
                                            onChange={(e) => handleFormChange('whatsapp', 'app_id', e.target.value)}
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                            placeholder="Your WhatsApp App ID"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-gray-700 text-sm font-bold mb-2">App Secret</label>
                                        <div className="relative">
                                            <input
                                                type={showPasswords['whatsapp_app_secret'] ? 'text' : 'password'}
                                                value={formData.whatsapp.app_secret}
                                                onChange={(e) => handleFormChange('whatsapp', 'app_secret', e.target.value)}
                                                className="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                                placeholder="Your WhatsApp App Secret"
                                            />
                                            <button type="button" onClick={() => togglePassword('whatsapp_app_secret')} className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-600">
                                                {showPasswords['whatsapp_app_secret'] ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg> : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>}
                                            </button>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-gray-700 text-sm font-bold mb-2">Access Token</label>
                                        <div className="relative">
                                            <input
                                                type={showPasswords['whatsapp_access_token'] ? 'text' : 'password'}
                                                value={formData.whatsapp.access_token}
                                                onChange={(e) => handleFormChange('whatsapp', 'access_token', e.target.value)}
                                                className="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                                placeholder="Your WhatsApp Access Token"
                                            />
                                            <button type="button" onClick={() => togglePassword('whatsapp_access_token')} className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-600">
                                                {showPasswords['whatsapp_access_token'] ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg> : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>}
                                            </button>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-gray-700 text-sm font-bold mb-2">Verify Token</label>
                                        <input
                                            type="text"
                                            value={formData.whatsapp.verify_token}
                                            onChange={(e) => handleFormChange('whatsapp', 'verify_token', e.target.value)}
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                            placeholder="Webhook Verify Token"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-gray-700 text-sm font-bold mb-2">Phone Number ID</label>
                                        <input
                                            type="text"
                                            value={formData.whatsapp.phone_number_id}
                                            onChange={(e) => handleFormChange('whatsapp', 'phone_number_id', e.target.value)}
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                            placeholder="Your WhatsApp Phone Number ID"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-gray-700 text-sm font-bold mb-2">Business Account ID</label>
                                        <input
                                            type="text"
                                            value={formData.whatsapp.business_account_id}
                                            onChange={(e) => handleFormChange('whatsapp', 'business_account_id', e.target.value)}
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                            placeholder="Your WhatsApp Business Account ID"
                                        />
                                    </div>
                                </div>
                            )}

                            {selectedPlatform === 'viber' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-gray-700 text-sm font-bold mb-2">App ID</label>
                                        <input
                                            type="text"
                                            value={formData.viber.app_id}
                                            onChange={(e) => handleFormChange('viber', 'app_id', e.target.value)}
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                            placeholder="Your Viber App ID"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-gray-700 text-sm font-bold mb-2">Access Token</label>
                                        <div className="relative">
                                            <input
                                                type={showPasswords['viber_access_token'] ? 'text' : 'password'}
                                                value={formData.viber.access_token}
                                                onChange={(e) => handleFormChange('viber', 'access_token', e.target.value)}
                                                className="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                                placeholder="Your Viber Bot Token"
                                            />
                                            <button type="button" onClick={() => togglePassword('viber_access_token')} className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-600">
                                                {showPasswords['viber_access_token'] ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg> : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {selectedPlatform === 'linkedin' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-gray-700 text-sm font-bold mb-2">App ID</label>
                                        <input
                                            type="text"
                                            value={formData.linkedin.app_id}
                                            onChange={(e) => handleFormChange('linkedin', 'app_id', e.target.value)}
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                            placeholder="Your LinkedIn App ID"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-gray-700 text-sm font-bold mb-2">App Secret</label>
                                        <div className="relative">
                                            <input
                                                type={showPasswords['linkedin_app_secret'] ? 'text' : 'password'}
                                                value={formData.linkedin.app_secret}
                                                onChange={(e) => handleFormChange('linkedin', 'app_secret', e.target.value)}
                                                className="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                                placeholder="Your LinkedIn App Secret"
                                            />
                                            <button type="button" onClick={() => togglePassword('linkedin_app_secret')} className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-600">
                                                {showPasswords['linkedin_app_secret'] ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg> : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="md:col-span-2">
                                        <label className="block text-gray-700 text-sm font-bold mb-2">Access Token</label>
                                        <div className="relative">
                                            <input
                                                type={showPasswords['linkedin_access_token'] ? 'text' : 'password'}
                                                value={formData.linkedin.access_token}
                                                onChange={(e) => handleFormChange('linkedin', 'access_token', e.target.value)}
                                                className="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                                                placeholder="Your LinkedIn Access Token"
                                            />
                                            <button type="button" onClick={() => togglePassword('linkedin_access_token')} className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-600">
                                                {showPasswords['linkedin_access_token'] ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg> : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="flex gap-4 mt-8">
                                <button
                                    type="button"
                                    onClick={() => handleTestConnection(selectedPlatform)}
                                    disabled={!isTestable(selectedPlatform) || testing}
                                    className="flex-1 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition flex items-center justify-center gap-2"
                                >
                                    {testing ? (
                                        <>
                                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                                            </svg>
                                            Testing…
                                        </>
                                    ) : 'Test Connection'}
                                </button>
                                <button
                                    type="submit"
                                    disabled={testing}
                                    className="flex-1 bg-green-500 hover:bg-green-600 disabled:bg-green-300 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition"
                                >
                                    Save Configuration
                                </button>
                                <button
                                    type="button"
                                    disabled={testing}
                                    onClick={() => {
                                        setShowForm(false);
                                        setSelectedPlatform(null);
                                        setTestResult(null);
                                    }}
                                    className="flex-1 bg-gray-500 hover:bg-gray-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition"
                                >
                                    Cancel
                                </button>
                            </div>

                            {/* Test result panel */}
                            {testResult && (
                                <div className="mt-4 border rounded-lg overflow-hidden text-sm">
                                    <div className={`flex items-start gap-3 px-4 py-3 ${testResult.credential_ok ? 'bg-green-50 border-b border-green-100' : 'bg-red-50'}`}>
                                        <span className={`font-bold mt-0.5 ${testResult.credential_ok ? 'text-green-600' : 'text-red-600'}`}>
                                            {testResult.credential_ok ? '✓' : '✗'}
                                        </span>
                                        <div>
                                            <span className={`font-semibold ${testResult.credential_ok ? 'text-green-800' : 'text-red-800'}`}>Credentials</span>
                                            <p className={`mt-0.5 ${testResult.credential_ok ? 'text-green-700' : 'text-red-700'}`}>{testResult.credential_detail}</p>
                                        </div>
                                    </div>
                                    {testResult.credential_ok && (
                                        <div className={`flex items-start gap-3 px-4 py-3 ${
                                            testResult.webhook_status === 'registered' ? 'bg-green-50' :
                                            testResult.webhook_status === 'not_registered' ? 'bg-red-50' :
                                            'bg-gray-50'
                                        }`}>
                                            <span className={`font-bold mt-0.5 ${
                                                testResult.webhook_status === 'registered' ? 'text-green-600' :
                                                testResult.webhook_status === 'not_registered' ? 'text-red-600' :
                                                'text-gray-400'
                                            }`}>
                                                {testResult.webhook_status === 'registered' ? '✓' :
                                                 testResult.webhook_status === 'not_registered' ? '✗' : '—'}
                                            </span>
                                            <div>
                                                <span className={`font-semibold ${
                                                    testResult.webhook_status === 'registered' ? 'text-green-800' :
                                                    testResult.webhook_status === 'not_registered' ? 'text-red-800' :
                                                    'text-gray-600'
                                                }`}>Webhook</span>
                                                <p className={`mt-0.5 ${
                                                    testResult.webhook_status === 'registered' ? 'text-green-700' :
                                                    testResult.webhook_status === 'not_registered' ? 'text-red-700' :
                                                    'text-gray-500'
                                                }`}>{testResult.webhook_detail}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </form>
                    </div>
                )}
            </main>
        </div>
    );
}
