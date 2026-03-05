'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import axios from 'axios';
import { API_URL } from '@/lib/config';

interface MenuItem {
  id: number;
  label: string;
  link_type: string;
  link_value: string;
  icon: string | null;
  open_in_new_tab: boolean;
  is_active: boolean;
}

interface MenuGroup {
  id: number;
  name: string;
  slug: string;
  icon: string | null;
  items: MenuItem[];
}

export default function PortalPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<MenuGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get(`${API_URL}/menu`)
      .then(r => setGroups(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleClick = (item: MenuItem) => {
    const href = item.link_type === 'form' ? `/forms/${item.link_value}` : item.link_value;
    if (item.link_type === 'external' || item.open_in_new_tab) {
      window.open(href, '_blank', 'noopener,noreferrer');
    } else {
      router.push(href);
    }
  };

  const getLinkTypeIcon = (type: string) => {
    switch (type) {
      case 'form': return '📝';
      case 'external': return '↗';
      default: return '→';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-5">
          <h1 className="text-2xl font-bold text-gray-900">Portal</h1>
          <p className="text-sm text-gray-500 mt-0.5">Quick access to forms, tools, and resources</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {groups.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-4xl mb-3">📭</p>
            <p className="text-gray-500">No content available at the moment.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {groups.map(group => {
              const activeItems = group.items.filter(i => i.is_active);
              if (activeItems.length === 0) return null;
              return (
                <section key={group.id}>
                  <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <span>{group.icon || '📁'}</span>
                    {group.name}
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {activeItems.map(item => (
                      <button
                        key={item.id}
                        onClick={() => handleClick(item)}
                        className="bg-white border border-gray-200 rounded-xl p-4 text-left hover:border-indigo-300 hover:shadow-md transition-all group"
                      >
                        <div className="flex items-start gap-3">
                          <span className="text-xl flex-shrink-0">{item.icon || getLinkTypeIcon(item.link_type)}</span>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 group-hover:text-indigo-700 transition-colors">
                              {item.label}
                            </p>
                            <p className="text-xs text-gray-400 mt-1 capitalize">{item.link_type === 'form' ? 'Form' : item.link_type === 'external' ? 'External link' : 'Page'}</p>
                          </div>
                          {(item.link_type === 'external' || item.open_in_new_tab) && (
                            <span className="text-gray-300 group-hover:text-indigo-400 transition-colors text-sm">↗</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
