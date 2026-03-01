'use client'

import { useState } from 'react'
import { FiShare, FiCopy, FiCheck } from 'react-icons/fi'

interface SocialShareButtonsProps {
    title: string
    description: string
    dueDate: string | null
    onClose?: () => void
}

export default function SocialShareButtons({ title, description, dueDate, onClose }: SocialShareButtonsProps) {
    const [copied, setCopied] = useState(false)

    const shareText = [
        `Reminder: ${title}`,
        description ? description : null,
        dueDate ? `Due: ${new Date(dueDate).toLocaleString()}` : null,
    ].filter(Boolean).join('\n')

    const encodedText = encodeURIComponent(shareText)

    const handleNativeShare = async () => {
        try {
            await navigator.share({ title: `Reminder: ${title}`, text: shareText })
            onClose?.()
        } catch {
            // User cancelled or not supported
        }
    }

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(shareText)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch { /* clipboard not available */ }
    }

    const supportsNativeShare = typeof navigator !== 'undefined' && !!navigator.share

    return (
        <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-3 w-48">
            <div className="space-y-1">
                {supportsNativeShare && (
                    <button
                        onClick={handleNativeShare}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-md transition"
                    >
                        <FiShare size={14} />
                        Share...
                    </button>
                )}
                <a
                    href={`https://wa.me/?text=${encodedText}`}
                    target="_blank" rel="noopener noreferrer"
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-green-50 rounded-md transition"
                >
                    <span className="text-green-500 font-bold text-xs">WA</span>
                    WhatsApp
                </a>
                <a
                    href={`https://www.facebook.com/sharer/sharer.php?quote=${encodedText}`}
                    target="_blank" rel="noopener noreferrer"
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-blue-50 rounded-md transition"
                >
                    <span className="text-blue-600 font-bold text-xs">FB</span>
                    Facebook
                </a>
                <a
                    href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(' ')}&summary=${encodedText}`}
                    target="_blank" rel="noopener noreferrer"
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-blue-50 rounded-md transition"
                >
                    <span className="text-blue-700 font-bold text-xs">LI</span>
                    LinkedIn
                </a>
                <button
                    onClick={handleCopy}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-md transition"
                >
                    {copied ? <FiCheck size={14} className="text-green-500" /> : <FiCopy size={14} />}
                    {copied ? 'Copied!' : 'Copy text'}
                </button>
            </div>
        </div>
    )
}
