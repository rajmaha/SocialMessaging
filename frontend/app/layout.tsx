import type { Metadata, Viewport } from 'next'
import './globals.css'
import { LayoutClient } from './layout-client'
import GlobalErrorCapture from '@/components/GlobalErrorCapture'
import ErrorBoundary from '@/components/ErrorBoundary'

// Render all pages at runtime — backend isn't available during Docker build
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Social Media Messenger',
  description: 'Unified messaging platform for all social media',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <GlobalErrorCapture />
        <ErrorBoundary>
          <LayoutClient>{children}</LayoutClient>
        </ErrorBoundary>
      </body>
    </html>
  )
}
