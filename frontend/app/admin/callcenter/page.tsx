'use client';

import { useState, useEffect } from 'react';
import MainHeader from "@/components/MainHeader";
import AdminNav from '@/components/AdminNav';
import { authAPI, getAuthToken } from "@/lib/auth";
import { useRouter } from 'next/navigation';

export default function CallCenterSettings() {
    const user = authAPI.getUser();
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState({ type: '', text: '' });

    const [settings, setSettings] = useState({
        application_type: 'cloud_hosting',
        support_phone: '',
        support_email: '',
        working_hours: ''
    });

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        try {
            const token = getAuthToken();
            if (!token) {
                router.push('/login');
                return;
            }

            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/callcenter/settings`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                setSettings({
                    application_type: data.application_type || 'cloud_hosting',
                    support_phone: data.support_phone || '',
                    support_email: data.support_email || '',
                    working_hours: data.working_hours || ''
                });
            }
        } catch (error) {
            console.error('Failed to fetch call center settings:', error);
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
            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/callcenter/settings`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(settings)
            });

            if (!response.ok) throw new Error('Failed to save settings');

            setMessage({ type: 'success', text: 'Settings saved successfully' });
            setTimeout(() => setMessage({ type: '', text: '' }), 3000);
        } catch (error) {
            setMessage({ type: 'error', text: 'Error saving settings. Please try again.' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="ml-60 pt-14 min-h-screen bg-gray-100">
            <MainHeader user={user!} />
            <AdminNav />

            <main className="max-w-4xl mx-auto p-6">
                <div className="mb-8">
                    <h2 className="text-3xl font-bold text-gray-900">Call Center Configuration</h2>
                    <p className="text-gray-600 mt-2">Configure application type and contact details.</p>
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
                    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">

                        <div className="grid grid-cols-1 gap-6">
                            {/* Application Type */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Application Type
                                </label>
                                <select
                                    value={settings.application_type}
                                    onChange={(e) => setSettings({ ...settings, application_type: e.target.value })}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 text-gray-900"
                                >
                                    <option value="cloud_hosting">Cloud Hosting</option>
                                    <option value="data_center">Data Center</option>
                                    <option value="banking">Banking</option>
                                    <option value="broker_investment">Broker / Investment Company</option>
                                    <option value="isp">Internet Service Provider</option>
                                    <option value="manpower">Manpower Company</option>
                                    <option value="hotels">Hotels / Resorts</option>
                                    <option value="apartments">Appartments / Colonies</option>
                                    <option value="warehouses">Wirehouses</option>
                                    <option value="hospitals">Hospitals / Nurshing Homes</option>
                                </select>
                                <p className="mt-1 text-sm text-gray-500">
                                    Select the primary use case for this call center.
                                </p>
                            </div>

                            {/* Support Email */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Support Email
                                </label>
                                <input
                                    type="email"
                                    value={settings.support_email}
                                    onChange={(e) => setSettings({ ...settings, support_email: e.target.value })}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 text-gray-900"
                                    placeholder="support@example.com"
                                />
                            </div>

                            {/* Support Phone */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Support Phone
                                </label>
                                <input
                                    type="text"
                                    value={settings.support_phone}
                                    onChange={(e) => setSettings({ ...settings, support_phone: e.target.value })}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 text-gray-900"
                                    placeholder="+1 (555) 123-4567"
                                />
                            </div>

                            {/* Working Hours */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Working Hours
                                </label>
                                <input
                                    type="text"
                                    value={settings.working_hours}
                                    onChange={(e) => setSettings({ ...settings, working_hours: e.target.value })}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 text-gray-900"
                                    placeholder="Mon-Fri 9:00 AM - 5:00 PM EST"
                                />
                            </div>
                        </div>

                        <div className="mt-8 pt-6 border-t border-gray-200">
                            <button
                                type="submit"
                                disabled={saving}
                                className="w-full md:w-auto px-6 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                            >
                                {saving ? 'Saving...' : 'Save Settings'}
                            </button>
                        </div>
                    </form>
                )}
            </main>
        </div>
    );
}
