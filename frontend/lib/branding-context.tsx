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

  const fetchBranding = async () => {
    setLoading(true)
    setError(null)
    try {
      console.log('Fetching branding from:', `${API_URL}/branding/`)
      const response = await axios.get(`${API_URL}/branding/`)
      console.log('Branding response:', response.data)
      if (response.data && response.data.data) {
        console.log('Setting branding from API response')
        setBranding(response.data.data)
        // Update favicon if available
        if (response.data.data.favicon_url) {
          const favicon = document.querySelector('link[rel="icon"]') as HTMLLinkElement
          if (favicon) {
            favicon.href = response.data.data.favicon_url
          }
        }
      } else {
        console.warn('No branding data in response, using defaults')
        setBranding(getDefaultBranding())
      }
    } catch (err) {
      console.error('Error fetching branding:', err)
      setError('Failed to load branding settings')
      // Use default branding if fetch fails
      console.log('Falling back to default branding')
      setBranding(getDefaultBranding())
    } finally {
      setLoading(false)
    }
  }
  
  const getDefaultBranding = () => ({
    company_name: 'Social Media Messenger',
    company_description: 'Unified messaging platform',
    logo_url: null,
    favicon_url: null,
    primary_color: '#2563eb',
    secondary_color: '#1e40af',
    accent_color: '#3b82f6',
    support_url: null,
    privacy_url: null,
    terms_url: null,
    timezone: 'UTC',
  })

  useEffect(() => {
    fetchBranding()
  }, [])

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
