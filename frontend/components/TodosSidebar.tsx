'use client'

import { useEffect } from 'react'
import { FiX } from 'react-icons/fi'
import TodosPanel from '@/components/TodosPanel'

interface TodosSidebarProps {
    isOpen: boolean
    onClose: () => void
}

export default function TodosSidebar({ isOpen, onClose }: TodosSidebarProps) {
    // Close on Escape key
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }
        if (isOpen) document.addEventListener('keydown', handler)
        return () => document.removeEventListener('keydown', handler)
    }, [isOpen, onClose])

    if (!isOpen) return null

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/30 z-[70]"
                onClick={onClose}
            />

            {/* Drawer */}
            <div className="fixed top-14 right-0 bottom-0 w-96 bg-white shadow-2xl z-[80] flex flex-col border-l border-gray-200">
                {/* Drawer header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0">
                    <span className="text-sm font-semibold text-gray-700">My Todos</span>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition"
                    >
                        <FiX size={18} />
                    </button>
                </div>

                {/* Panel content */}
                <div className="flex-1 overflow-hidden">
                    <TodosPanel mode="sidebar" />
                </div>
            </div>
        </>
    )
}
