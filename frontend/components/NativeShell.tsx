'use client'

/**
 * NativeShell
 * ===========
 *
 * Mounts once inside the dashboard providers and owns everything that makes
 * the WebView behave like an app rather than a web page:
 *
 *   • boots the native bridge (status bar tint, keyboard mode, safe areas)
 *   • hides the splash screen after the first paint
 *   • maps the Android hardware back button onto in-app navigation
 *   • reconnects / refreshes on resume
 *   • registers for push and routes notification taps
 *   • raises a local notification when a message lands while backgrounded
 *
 * Renders nothing.  It is deliberately separate from `lib/native.ts` because
 * it needs React context (branding colour, the event stream, the router).
 */

import { useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useBranding } from '@/lib/branding-context'
import { useEvents, type EventMessage } from '@/lib/events-context'
import {
  initNativeShell,
  hideSplash,
  isNative,
  isDesktopApp,
  applySafeAreaInsets,
} from '@/lib/native'
import { useUnreadCounts } from '@/lib/use-unread'
import {
  registerForPush,
  showLocalNotification,
  onLocalNotificationTap,
} from '@/lib/push'

/**
 * Routes that are the *root* of a tab.  Pressing back on one of these should
 * offer to leave the app rather than unwinding into whatever page happened to
 * be in the history stack.
 */
const TAB_ROOTS = ['/dashboard', '/workspace', '/email', '/admin', '/daily-ops']

/** Where a notification about `data` should take the agent. */
function routeForNotification(data: Record<string, any>): string | null {
  if (!data) return null
  if (data.route) return String(data.route)
  if (data.conversation_id) return `/dashboard?tab=messaging&conversation=${data.conversation_id}`
  if (data.ticket_number) {
    return `/workspace/tickets/${encodeURIComponent(String(data.ticket_number))}?from=workspace`
  }
  if (data.email_id) return `/dashboard?tab=email&email=${data.email_id}`
  // ── Desktop (Electron) ────────────────────────────────────────────────────

  // Dock badge on macOS, taskbar overlay on Windows. Mirrors the mobile tab
  // badges, so the number is the same wherever the agent is looking.
  useEffect(() => {
    if (!isDesktopApp()) return
    try {
      ;(window as any).inboxDesktop?.setBadgeCount(unreadTotal)
    } catch {
      /* older shell without this bridge method */
    }
  }, [unreadTotal])

  // The tray menu, the Go menu and socialinbox:// deep links all arrive here.
  useEffect(() => {
    if (!isDesktopApp()) return
    try {
      const off = (window as any).inboxDesktop?.onNavigate?.((target: string) => {
        if (target) router.push(target)
      })
      return typeof off === 'function' ? off : undefined
    } catch {
      return undefined
    }
  }, [router])

  return null
}

export default function NativeShell() {
  const router = useRouter()
  const pathname = usePathname()
  const { branding } = useBranding()
  const { subscribe } = useEvents()
  const { total: unreadTotal } = useUnreadCounts()

  // Refs so the long-lived native listeners always read current values
  // without being torn down and re-registered on every render.
  const pathnameRef = useRef(pathname)
  pathnameRef.current = pathname
  const appActiveRef = useRef(true)
  const backPressedAtRef = useRef(0)

  // ── Boot ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const color = branding?.primary_color || '#2563eb'
    initNativeShell(color).finally(() => {
      // Hide the splash only after the bridge is set up, so the first frame
      // the agent sees already has the right status bar and insets.
      hideSplash()
    })
  }, [branding?.primary_color])

  // ── Hardware back button (Android) ────────────────────────────────────────
  useEffect(() => {
    if (!isNative()) return
    let remove: (() => void) | undefined

    ;(async () => {
      try {
        const { App } = await import('@capacitor/app')
        const handle = await App.addListener('backButton', ({ canGoBack }) => {
          // 1. Give open UI (chat pane, drawer, modal) first refusal.  Any
          //    listener that calls preventDefault() has consumed the press.
          const consumed = !window.dispatchEvent(
            new CustomEvent('nativeback', { cancelable: true })
          )
          if (consumed) return

          // 2. Unwind in-app history when we are not sitting on a tab root.
          const atTabRoot = TAB_ROOTS.some((r) => pathnameRef.current === r)
          if (!atTabRoot && canGoBack) {
            router.back()
            return
          }

          // 3. At a tab root: first press warns, a second within 2s exits.
          const now = Date.now()
          if (now - backPressedAtRef.current < 2000) {
            App.exitApp()
          } else {
            backPressedAtRef.current = now
            window.dispatchEvent(new CustomEvent('nativebackhint'))
          }
        })
        remove = () => handle.remove()
      } catch {
        /* @capacitor/app not installed */
      }
    })()

    return () => remove?.()
  }, [router])

  // ── Resume / deep links ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isNative()) return
    const removers: Array<() => void> = []

    ;(async () => {
      try {
        const { App } = await import('@capacitor/app')

        const state = await App.addListener('appStateChange', ({ isActive }) => {
          appActiveRef.current = isActive
          if (isActive) {
            // Insets can change while backgrounded (rotation, display cutout
            // settings) and the WebSocket may have been dropped by the OS.
            applySafeAreaInsets()
            window.dispatchEvent(new CustomEvent('nativeresume'))
          }
        })
        removers.push(() => state.remove())

        // Deep links: socialinbox://... or an https link into the app.
        const urlOpen = await App.addListener('appUrlOpen', ({ url }) => {
          try {
            const parsed = new URL(url)
            const target = `${parsed.pathname}${parsed.search}`
            if (target && target !== '/') router.push(target)
          } catch {
            /* unparseable link — ignore rather than crash */
          }
        })
        removers.push(() => urlOpen.remove())
      } catch {
        /* not native */
      }
    })()

    return () => removers.forEach((r) => r())
  }, [router])

  // ── Push registration + notification taps ────────────────────────────────
  useEffect(() => {
    if (!isNative()) return

    const go = (data: Record<string, any>) => {
      const target = routeForNotification(data)
      if (target) router.push(target)
    }

    registerForPush(go)
    onLocalNotificationTap(go)
  }, [router])

  // ── Local notifications for events that arrive while backgrounded ─────────
  useEffect(() => {
    if (!isNative()) return

    const notify = (title: string, build: (d: any) => string) =>
      (event: EventMessage) => {
        // In the foreground the in-app toast (EventNotifications) already
        // shows this; a second OS banner would be noise.
        if (appActiveRef.current) return
        const d = event.data || {}
        showLocalNotification({
          title,
          body: build(d),
          threadId: d.conversation_id ?? d.ticket_number ?? d.email_id,
          route: routeForNotification(d) ?? undefined,
        })
      }

    const unsubs = [
      subscribe(
        'message_received',
        notify('New message', (d) =>
          `${d.visitor_name || d.sender_name || 'Unknown'}: ${(d.message_text || d.text || '').slice(0, 120)}`
        )
      ),
      subscribe(
        'email_received',
        notify('New email', (d) => (d.sender ? `From ${d.sender}` : 'You have new mail'))
      ),
      subscribe(
        'conversation_assigned',
        notify('Conversation assigned to you', (d) =>
          `${d.assigned_by_name || 'A teammate'} forwarded ${d.contact_name || 'a chat'} to you`
        )
      ),
      subscribe(
        'pms_task_assigned',
        notify('Task assigned', (d) => `${d.assigned_by || 'Someone'} assigned "${d.task_title || 'a task'}" to you`)
      ),
      subscribe(
        'support_ticket',
        notify('Support request', (d) => {
          const who = d.customer || 'A customer'
          const line = d.subject ? `${who}: "${d.subject}"` : who
          return d.ticket_number ? `${line} (${d.ticket_number})` : line
        })
      ),
    ]

    return () => unsubs.forEach((u) => u())
  }, [subscribe])

  // ── Desktop (Electron) ────────────────────────────────────────────────────

  // Dock badge on macOS, taskbar overlay on Windows. Mirrors the mobile tab
  // badges, so the number is the same wherever the agent is looking.
  useEffect(() => {
    if (!isDesktopApp()) return
    try {
      ;(window as any).inboxDesktop?.setBadgeCount(unreadTotal)
    } catch {
      /* older shell without this bridge method */
    }
  }, [unreadTotal])

  // The tray menu, the Go menu and socialinbox:// deep links all arrive here.
  useEffect(() => {
    if (!isDesktopApp()) return
    try {
      const off = (window as any).inboxDesktop?.onNavigate?.((target: string) => {
        if (target) router.push(target)
      })
      return typeof off === 'function' ? off : undefined
    } catch {
      return undefined
    }
  }, [router])

  return null
}
