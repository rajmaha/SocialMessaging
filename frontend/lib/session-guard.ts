import axios from 'axios'
import { API_URL } from './config'
import { endSession, getAuthToken, SESSION_ENDED_DETAIL } from './auth'

// When the backend says the signed-in session has ended (token expired, the
// password changed elsewhere, the account was switched off), forget it and go
// to the login page once, instead of leaving every screen failing quietly.
// Pages call the API with fetch() and with axios (default and lib/api.ts), so
// all three are watched. Only a 401 carrying the backend's own words counts:
// other 401s (a wrong password in a form) are the page's business.

const isApi = (url: string): boolean => {
  if (!url) return false
  if (API_URL && url.startsWith(API_URL)) return true
  return url.startsWith('/') && !url.startsWith('//')
}

const saysEnded = (detail: unknown): boolean =>
  typeof detail === 'string' && detail.startsWith(SESSION_ENDED_DETAIL)

let installed = false

export function installSessionGuard(extra: Array<{ interceptors: typeof axios.interceptors }> = []): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  const origFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await origFetch(input, init)
    if (res.status === 401) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (isApi(url) && getAuthToken()) {
        res.clone().json().then(b => { if (saysEnded(b?.detail)) endSession() }).catch(() => {})
      }
    }
    return res
  }

  for (const inst of [axios, ...extra]) {
    inst.interceptors.response.use(
      r => r,
      err => {
        if (err?.response?.status === 401 && saysEnded(err?.response?.data?.detail) && getAuthToken()) endSession()
        return Promise.reject(err)
      }
    )
  }
}
