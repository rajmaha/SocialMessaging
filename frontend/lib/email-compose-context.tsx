'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

interface EmailComposeContextType {
  isOpen: boolean
  prefillTo: string
  openCompose: (to?: string) => void
  closeCompose: () => void
}

const EmailComposeContext = createContext<EmailComposeContextType>({
  isOpen: false,
  prefillTo: '',
  openCompose: () => {},
  closeCompose: () => {},
})

export function EmailComposeProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [prefillTo, setPrefillTo] = useState('')

  const openCompose = useCallback((to?: string) => {
    setPrefillTo(to || '')
    setIsOpen(true)
  }, [])

  const closeCompose = useCallback(() => {
    setIsOpen(false)
    setPrefillTo('')
  }, [])

  return (
    <EmailComposeContext.Provider value={{ isOpen, prefillTo, openCompose, closeCompose }}>
      {children}
    </EmailComposeContext.Provider>
  )
}

export function useEmailCompose() {
  return useContext(EmailComposeContext)
}
