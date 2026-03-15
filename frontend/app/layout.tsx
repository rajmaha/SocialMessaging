import type { Metadata } from 'next'
import './globals.css'
import { LayoutClient } from './layout-client'
import GlobalErrorCapture from '@/components/GlobalErrorCapture'
import ErrorBoundary from '@/components/ErrorBoundary'

export const metadata: Metadata = {
  title: 'Social Media Messenger',
  description: 'Unified messaging platform for all social media',
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
