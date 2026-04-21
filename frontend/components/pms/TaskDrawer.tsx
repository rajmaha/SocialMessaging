'use client';
import { useEffect, useRef, useState } from 'react';
import { pmsApi } from '@/lib/api';
import { getAuthToken } from '@/lib/auth';

const STAGE_BADGE: Record<string, string> = {
  development: 'bg-indigo-100 text-indigo-700',
  qa: 'bg-amber-100 text-amber-700',
  pm_review: 'bg-purple-100 text-purple-700',
  client_review: 'bg-cyan-100 text-cyan-700',
  approved: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-600',
};
const PRIORITY_BADGE: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
};

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return '🖼️';
  if (['pdf'].includes(ext)) return '📄';
  if (['doc', 'docx'].includes(ext)) return '📝';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️';
  if (['mp4', 'mov', 'avi', 'mkv'].includes(ext)) return '🎬';
  if (['mp3', 'wav', 'ogg'].includes(ext)) return '🎵';
  if (['js', 'ts', 'tsx', 'jsx', 'py', 'json', 'html', 'css'].includes(ext)) return '💻';
  return '📎';
}

async function downloadFile(attId: number, fileName: string) {
  const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  const token = getAuthToken();
  const res = await fetch(`${base}/api/pms/attachments/${attId}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export default function TaskDrawer({
  taskId,
  onClose,
  onReload,
}: {
  taskId: number;
  onClose: () => void;
  onReload?: () => void;
}) {
  const [task, setTask] = useState<any>(null);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [loadingTask, setLoadingTask] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = async () => {
    setLoadingTask(true);
    try {
      const [tRes, aRes] = await Promise.all([
        pmsApi.getTask(taskId),
        pmsApi.listAttachments(taskId),
      ]);
      setTask(tRes.data);
      setAttachments(aRes.data || []);
    } finally {
      setLoadingTask(false);
    }
  };

  useEffect(() => { fetchData(); }, [taskId]);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError('');
    try {
      for (const file of Array.from(files)) {
        await pmsApi.uploadAttachment(taskId, file);
      }
      const aRes = await pmsApi.listAttachments(taskId);
      setAttachments(aRes.data || []);
    } catch (err: any) {
      setUploadError(err?.response?.data?.detail || 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (attId: number) => {
    setDeletingId(attId);
    try {
      await pmsApi.deleteAttachment(attId);
      setAttachments(prev => prev.filter(a => a.id !== attId));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-white shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-none">
          <h2 className="font-semibold text-gray-900 text-base truncate pr-4">
            {loadingTask ? 'Loading…' : task?.title}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 flex-none">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loadingTask ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">Loading…</div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* Task meta */}
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="flex flex-wrap gap-2 mb-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_BADGE[task?.stage] || 'bg-gray-100 text-gray-600'}`}>
                  {task?.stage?.replace(/_/g, ' ')}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_BADGE[task?.priority] || 'bg-gray-100 text-gray-600'}`}>
                  {task?.priority}
                </span>
                {task?.labels?.map((l: any) => (
                  <span key={l.id} className="text-xs px-2 py-0.5 rounded-full font-medium text-white" style={{ background: l.color }}>{l.name}</span>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {task?.assignee_name && (
                  <div>
                    <span className="text-xs text-gray-400 block">Assignee</span>
                    <span className="text-gray-800">{task.assignee_name}</span>
                  </div>
                )}
                {task?.due_date && (
                  <div>
                    <span className="text-xs text-gray-400 block">Due Date</span>
                    <span className={task.is_overdue ? 'text-red-600 font-medium' : 'text-gray-800'}>
                      {task.due_date}{task.is_overdue ? ' (Overdue)' : ''}
                    </span>
                  </div>
                )}
                {task?.estimated_hours != null && (
                  <div>
                    <span className="text-xs text-gray-400 block">Hours</span>
                    <span className="text-gray-800">{task.actual_hours ?? 0}h / {task.estimated_hours}h est.</span>
                  </div>
                )}
              </div>

              {task?.description && (
                <div className="mt-3">
                  <span className="text-xs text-gray-400 block mb-1">Description</span>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{task.description}</p>
                </div>
              )}
            </div>

            {/* References (Attachments) */}
            <div className="px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-800">
                  References
                  {attachments.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-gray-400">{attachments.length} file{attachments.length !== 1 ? 's' : ''}</span>
                  )}
                </h3>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
                >
                  {uploading ? 'Uploading…' : '+ Upload'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={e => handleUpload(e.target.files)}
                />
              </div>

              {uploadError && (
                <p className="text-xs text-red-600 mb-3">{uploadError}</p>
              )}

              {attachments.length === 0 ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors"
                >
                  <div className="text-3xl mb-2">📎</div>
                  <p className="text-sm text-gray-400">No files yet. Click to upload references.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {attachments.map(a => (
                    <div key={a.id} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2.5 group">
                      <span className="text-xl flex-none">{fileIcon(a.file_name)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{a.file_name}</p>
                        <p className="text-xs text-gray-400">
                          {formatBytes(a.file_size)}
                          {a.version > 1 && <span className="ml-2 text-indigo-500">v{a.version}</span>}
                          {a.uploaded_by_name && <span className="ml-2">· {a.uploaded_by_name}</span>}
                          {a.created_at && <span className="ml-2">· {a.created_at.substring(0, 10)}</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-none opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => downloadFile(a.id, a.file_name)}
                          title="Download"
                          className="p-1.5 rounded hover:bg-gray-200 text-gray-500 hover:text-indigo-600"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDelete(a.id)}
                          disabled={deletingId === a.id}
                          title="Delete"
                          className="p-1.5 rounded hover:bg-gray-200 text-gray-400 hover:text-red-600 disabled:opacity-50"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Drag-and-drop zone when files exist */}
              {attachments.length > 0 && (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); handleUpload(e.dataTransfer.files); }}
                  className="mt-3 border border-dashed border-gray-200 rounded-lg p-3 text-center text-xs text-gray-400 cursor-pointer hover:border-indigo-300 hover:text-indigo-400 transition-colors"
                >
                  Drop files here or click to add more
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
