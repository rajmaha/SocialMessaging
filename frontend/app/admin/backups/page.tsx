'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import MainHeader from '@/components/MainHeader';
import AdminNav from '@/components/AdminNav';
import { authAPI } from '@/lib/auth';
import BackupDestinationsTab from './DestinationsTab';
import BackupJobsTab from './JobsTab';
import BackupHistoryTab from './HistoryTab';

const TABS = ['Jobs', 'Destinations', 'History'] as const;
type Tab = typeof TABS[number];

export default function BackupsPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<Tab>('Jobs');

  useEffect(() => {
    const u = authAPI.getUser();
    if (!u) {
      router.push('/login');
      return;
    }
    setUser(u);
  }, []);

  if (!user) {
    return <div className="ml-60 pt-14 min-h-screen bg-gray-50" />;
  }

  return (
    <div className="ml-60 pt-14 min-h-screen bg-gray-50">
      <MainHeader user={user} />
      <AdminNav />
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Remote Backups</h1>

        <div className="border-b border-gray-200 mb-6">
          <nav className="flex gap-6">
            {TABS.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab}
              </button>
            ))}
          </nav>
        </div>

        {activeTab === 'Jobs' && <BackupJobsTab />}
        {activeTab === 'Destinations' && <BackupDestinationsTab />}
        {activeTab === 'History' && <BackupHistoryTab />}
      </div>
    </div>
  );
}
