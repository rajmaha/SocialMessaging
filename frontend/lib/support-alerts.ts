'use client'

// Support desk alerts for agents: a chime, a desktop notice, and the header badge's count.
// The live event is `support_ticket` (backend support_service._tell_agents), sent when a
// customer raises a request, replies, or reopens one.

import { API_URL } from '@/lib/config'
import { getAuthToken } from '@/lib/auth'

export const SUPPORT_COUNTS_EVENT = 'support-counts-changed'

let audioCtx: AudioContext | null = null

/** Three rising notes -- unlike the chat's two-note blip, so a support request is told apart. */
export function playSupportChime() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return
    audioCtx = audioCtx || new Ctx()
    const ctx = audioCtx as AudioContext
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    const notes = [660, 880, 1175]
    notes.forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.14
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, t)
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.24)
    })
  } catch { }
}

// A browser plays sound only after the person has clicked or typed on the page once.
// Unlocking the audio context on the first gesture means the next chime is heard.
if (typeof window !== 'undefined') {
  const unlock = () => {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
      if (Ctx) {
        audioCtx = audioCtx || new Ctx()
        audioCtx!.resume().catch(() => {})
      }
    } catch { }
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
}

/** A desktop notice while the tab is hidden, when the browser allows notifications. */
export function desktopSupportNotice(title: string, body: string, href: string) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    if (document.visibilityState === 'visible') return
    const n = new Notification(title, { body, tag: href, icon: '/favicon.ico' })
    n.onclick = () => { window.focus(); window.location.href = href; n.close() }
  } catch { }
}

/** Ask once, on a click, for desktop notices (a browser refuses to ask without one). */
export function askDesktopNotices() {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  } catch { }
}

export interface SupportCounts { queue: number; waiting: number; total: number }

export async function fetchSupportCounts(): Promise<SupportCounts | null> {
  const token = getAuthToken()
  if (!token) return null
  try {
    const res = await fetch(`${API_URL}/api/tickets/support-counts`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/** Tell the header to read the counts again (after a take, a reply, a status change). */
export function supportCountsChanged() {
  try { window.dispatchEvent(new Event(SUPPORT_COUNTS_EVENT)) } catch { }
}
