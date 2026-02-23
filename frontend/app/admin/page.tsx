'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getAuthToken } from '@/lib/auth';

interface DashboardData {
  total_users: number;
  active_users: number;
  admin_users: number;
  regular_users: number;
  platforms: {
    [key: string]: {
      is_configured: number;
      webhook_registered: number;
    };
  };
  timestamp: string;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const token = getAuthToken();
        if (!token) {
          router.push('/login');
          return;
        }
        
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/dashboard`, {
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
          throw new Error('Failed to fetch dashboard data');
        }

        const data = await response.json();
        setDashboardData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchDashboard();
  }, [router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Admin Navigation */}
      <nav className="bg-blue-700 text-white p-4">
        <div className="max-w-7xl mx-auto flex flex-wrap gap-3 justify-between items-center">
          <h1 className="text-2xl font-bold">Admin Dashboard</h1>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin" className="hover:bg-blue-600 px-3 py-2 rounded text-sm whitespace-nowrap">
              Dashboard
            </Link>
            <Link href="/admin/users" className="hover:bg-blue-600 px-3 py-2 rounded text-sm whitespace-nowrap">
              Users
            </Link>
            <Link href="/admin/email-accounts" className="hover:bg-blue-600 px-3 py-2 rounded text-sm whitespace-nowrap">
              Email Accounts
            </Link>
            <Link href="/admin/settings" className="hover:bg-blue-600 px-3 py-2 rounded text-sm whitespace-nowrap">
              Settings
            </Link>
            <Link href="/admin/branding" className="hover:bg-blue-600 px-3 py-2 rounded text-sm whitespace-nowrap">
              Branding
            </Link>
            <Link href="/dashboard" className="hover:bg-blue-600 px-3 py-2 rounded text-sm whitespace-nowrap">
              Messaging
            </Link>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-6">
        {/* Header */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900">Dashboard</h2>
          <p className="text-gray-600 mt-2">System overview and statistics</p>
        </div>

        {/* Statistics Grid */}
        {dashboardData && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {/* Total Users */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-600 text-sm font-medium">Total Users</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">
                    {dashboardData.total_users}
                  </p>
                </div>
                <div className="bg-blue-100 rounded-full p-3">
                  <svg className="w-8 h-8 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Active Users */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-600 text-sm font-medium">Active Users</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">
                    {dashboardData.active_users}
                  </p>
                </div>
                <div className="bg-green-100 rounded-full p-3">
                  <svg className="w-8 h-8 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Admin Users */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-600 text-sm font-medium">Admin Users</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">
                    {dashboardData.admin_users}
                  </p>
                </div>
                <div className="bg-purple-100 rounded-full p-3">
                  <svg className="w-8 h-8 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v2h8v-2zM16 15v2h4v-2z" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Regular Users */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-600 text-sm font-medium">Regular Users</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">
                    {dashboardData.regular_users}
                  </p>
                </div>
                <div className="bg-orange-100 rounded-full p-3">
                  <svg className="w-8 h-8 text-orange-600" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10.5 1.5H19a1 1 0 011 1v15a1 1 0 01-1 1h-17a1 1 0 01-1-1v-15a1 1 0 011-1h8.5m0 0V1a1 1 0 011-1h0a1 1 0 011 1v1.5m0 0h-4V1a1 1 0 011-1h0a1 1 0 011 1v1.5" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Platforms Status */}
        {dashboardData && (
          <div className="bg-white rounded-lg shadow p-6 mb-8">
            <h3 className="text-xl font-bold text-gray-900 mb-6">Platform Status</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {Object.entries(dashboardData.platforms).map(([platform, status]) => (
                <div key={platform} className="border border-gray-200 rounded-lg p-4">
                  <h4 className="font-semibold text-gray-900 capitalize mb-2">{platform}</h4>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Configuration:</span>
                      <span className={`font-medium ${
                        status.is_configured === 0 ? 'text-red-600' :
                        status.is_configured === 1 ? 'text-yellow-600' :
                        'text-green-600'
                      }`}>
                        {status.is_configured === 0 ? 'Not Setup' :
                         status.is_configured === 1 ? 'Configured' :
                         'Verified'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Webhook:</span>
                      <span className={`font-medium ${
                        status.webhook_registered === 1 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {status.webhook_registered === 1 ? 'Registered' : 'Not Registered'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-xl font-bold text-gray-900 mb-6">Quick Actions</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link
              href="/admin/users"
              className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3 px-6 rounded-lg transition"
            >
              Manage Users
            </Link>
            <Link
              href="/admin/settings"
              className="bg-green-500 hover:bg-green-600 text-white font-semibold py-3 px-6 rounded-lg transition"
            >
              Configure Platforms
            </Link>
            <Link
              href="/admin/branding"
              className="bg-purple-500 hover:bg-purple-600 text-white font-semibold py-3 px-6 rounded-lg transition"
            >
              Branding Settings
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
