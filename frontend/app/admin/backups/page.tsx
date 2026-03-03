'use client';

import { useState } from 'react';
import BackupDestinationsTab from './DestinationsTab';
import BackupJobsTab from './JobsTab';
import BackupHistoryTab from './HistoryTab';

const TABS = ['Jobs', 'Destinations', 'History'] as const;
type Tab = typeof TABS[number];

export default function BackupsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Jobs');

  return (
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
  );
}
