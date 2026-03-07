'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

interface SoftphoneContextType {
  isOpen: boolean
  dialNumber: string | null
  dial: (number: string) => void
  close: () => void
  setDialNumber: (n: string | null) => void
}

const SoftphoneContext = createContext<SoftphoneContextType>({
  isOpen: false,
  dialNumber: null,
  dial: () => {},
  close: () => {},
  setDialNumber: () => {},
})

export function SoftphoneProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [dialNumber, setDialNumber] = useState<string | null>(null)

  const dial = useCallback((number: string) => {
    setDialNumber(number)
    setIsOpen(true)
  }, [])

  const close = useCallback(() => {
    setIsOpen(false)
    setDialNumber(null)
  }, [])

  return (
    <SoftphoneContext.Provider value={{ isOpen, dialNumber, dial, close, setDialNumber }}>
      {children}
    </SoftphoneContext.Provider>
  )
}

export function useSoftphone() {
  return useContext(SoftphoneContext)
}
