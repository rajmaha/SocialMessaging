'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface BrandingSettings {
  company_name: string
  company_description: string
  logo_url: string | null
  favicon_url: string | null
  primary_color: string
  secondary_color: string
  accent_color: string
  button_primary_color: string
  button_primary_hover_color: string
  sidebar_text_color: string
  header_bg_color: string
  layout_bg_color: string
  support_url: string | null
  privacy_url: string | null
  terms_url: string | null
  timezone: string
}

interface BrandingContextType {
  branding: BrandingSettings | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

const BrandingContext = createContext<BrandingContextType | undefined>(undefined)

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const [branding, setBranding] = useState<BrandingSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const applyBrandingColors = (settings: BrandingSettings) => {
    if (typeof document === 'undefined') return

    const root = document.documentElement
    root.style.setProperty('--primary-color', settings.primary_color)
    root.style.setProperty('--secondary-color', settings.secondary_color)
    root.style.setProperty('--accent-color', settings.accent_color)
    root.style.setProperty('--button-primary', settings.button_primary_color)
    root.style.setProperty('--button-hover', settings.button_primary_hover_color)
    root.style.setProperty('--sidebar-text', settings.sidebar_text_color)
    root.style.setProperty('--header-bg', settings.header_bg_color)
    root.style.setProperty('--layout-bg', settings.layout_bg_color)
  }

  const fetchBranding = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await axios.get(`${API_URL}/branding/`)
      if (response.data && response.data.data) {
        setBranding(response.data.data)
        applyBrandingColors(response.data.data)

        // Update favicon if available
        if (response.data.data.favicon_url) {
          const favicon = document.querySelector('link[rel="icon"]') as HTMLLinkElement
          if (favicon) {
            favicon.href = response.data.data.favicon_url
          }
        }
      } else {
        setBranding(getDefaultBranding())
      }
    } catch (err) {
      console.error('Error fetching branding:', err)
      setError('Failed to load branding settings')
      setBranding(getDefaultBranding())
    } finally {
      setLoading(false)
    }
  }

  const getDefaultBranding = (): BrandingSettings => ({
    company_name: 'Social Media Messenger',
    company_description: 'Unified messaging platform',
    logo_url: null,
    favicon_url: null,
    primary_color: '#2563eb',
    secondary_color: '#1e40af',
    accent_color: '#3b82f6',
    button_primary_color: '#2563eb',
    button_primary_hover_color: '#1e40af',
    sidebar_text_color: '#ffffff',
    header_bg_color: '#ffffff',
    layout_bg_color: '#f5f5f5',
    support_url: null,
    privacy_url: null,
    terms_url: null,
    timezone: 'UTC',
  })

  useEffect(() => {
    fetchBranding()
  }, [])

  useEffect(() => {
    if (branding) {
      applyBrandingColors(branding)
    }
  }, [branding])

  return (
    <BrandingContext.Provider value={{ branding, loading, error, refetch: fetchBranding }}>
      {children}
    </BrandingContext.Provider>
  )
}

export function useBranding() {
  const context = useContext(BrandingContext)
  if (context === undefined) {
    throw new Error('useBranding must be used within BrandingProvider')
  }
  return context
}
