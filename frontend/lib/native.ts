/**
 * Native runtime bridge (Capacitor)
 * ================================
 *
 * The mobile app is the same Next.js frontend running inside a Capacitor
 * WebView, so every module here must stay safe to import on the web.  Nothing
 * at module scope touches a Capacitor plugin: plugins are pulled in with
 * dynamic `import()` inside try/catch, so a browser build (or a native build
 * missing a plugin) degrades to a no-op instead of crashing the whole app.
 *
 * What lives here is only the *runtime facts and side effects* — which
 * platform we are on, status bar, keyboard, splash, safe-area insets.
 * Behaviour that needs React (hardware back, resume, push) lives in
 * `components/NativeShell.tsx`.
 */

import { Capacitor } from '@capacitor/core'

export type NativePlatform = 'web' | 'ios' | 'android'

/** 'ios' | 'android' inside the app; 'web' in a browser. */
export function getPlatform(): NativePlatform {
  try {
    return Capacitor.getPlatform() as NativePlatform
  } catch {
    return 'web'
  }
}

/** True only inside the packaged mobile app, not in a mobile browser. */
export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

export const isIOS = () => getPlatform() === 'ios'
export const isAndroid = () => getPlatform() === 'android'

/**
 * True in the Electron desktop app.  The preload script in `desktop/` sets
 * `window.inboxDesktop`; this lets shared UI treat desktop like native
 * (custom title bar spacing, no bottom tab bar) without loading Capacitor.
 */
export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && !!(window as any).inboxDesktop
}

/** Running inside any packaged shell (mobile app or desktop app). */
export const isAppShell = () => isNative() || isDesktopApp()

// ── Safe-area insets ────────────────────────────────────────────────────────
//
// Android 15+ forces edge-to-edge, so the WebView is drawn *under* the status
// bar and the navigation bar.  CSS `env(safe-area-inset-*)` is the portable
// answer and Capacitor 8 feeds it on both platforms, but on some Android
// WebView versions it still resolves to 0.  We probe the real computed value
// and fall back to a conservative constant so content is never hidden behind
// the status bar.

const ANDROID_STATUS_BAR_FALLBACK_PX = 24
const ANDROID_NAV_BAR_FALLBACK_PX = 16

function probeInset(side: 'top' | 'bottom'): number {
  try {
    const probe = document.createElement('div')
    probe.style.cssText =
      `position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;` +
      `height:env(safe-area-inset-${side}, 0px);`
    document.body.appendChild(probe)
    const px = probe.getBoundingClientRect().height
    probe.remove()
    return Number.isFinite(px) ? px : 0
  } catch {
    return 0
  }
}

/**
 * Publishes `--sa-top` / `--sa-bottom` on <html> for stylesheets to use.
 * Called on boot and again whenever the viewport changes (rotation, keyboard,
 * split screen), because insets differ per orientation.
 */
export function applySafeAreaInsets(): void {
  if (typeof document === 'undefined') return

  let top = probeInset('top')
  let bottom = probeInset('bottom')

  if (isAndroid()) {
    if (top <= 0) top = ANDROID_STATUS_BAR_FALLBACK_PX
    if (bottom <= 0) bottom = ANDROID_NAV_BAR_FALLBACK_PX
  }

  const root = document.documentElement
  root.style.setProperty('--sa-top', `${top}px`)
  root.style.setProperty('--sa-bottom', `${bottom}px`)
}

// ── Boot ────────────────────────────────────────────────────────────────────

/** Marks <html> so CSS can target the shell without re-checking JS. */
function tagDocument(): void {
  const root = document.documentElement
  const platform = getPlatform()
  root.classList.toggle('native-app', isNative())
  root.classList.toggle('native-ios', platform === 'ios')
  root.classList.toggle('native-android', platform === 'android')
  root.classList.toggle('desktop-app', isDesktopApp())
}

/**
 * Tints the status bar to match the brand header.  `style: 'light'` means
 * *light text on a dark bar*, so it is chosen from the background's luminance
 * rather than hard-coded.
 */
async function initStatusBar(backgroundColor: string): Promise<void> {
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    const dark = isColorDark(backgroundColor)
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light })
    if (isAndroid()) {
      // iOS throws on setBackgroundColor — Android only.
      await StatusBar.setBackgroundColor({ color: backgroundColor })
    }
  } catch {
    /* plugin absent or web build */
  }
}

/** Relative luminance test (sRGB), used to pick readable status-bar text. */
export function isColorDark(hex: string): boolean {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return true
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return L < 0.5
}

/**
 * Keyboard: we resize the WebView rather than scroll it, so a focused
 * composer stays above the keyboard and the message list keeps its own
 * scroll position.  Body classes let CSS pin/unpin the bottom tab bar.
 */
async function initKeyboard(): Promise<void> {
  try {
    const { Keyboard, KeyboardResize } = await import('@capacitor/keyboard')
    await Keyboard.setResizeMode({ mode: KeyboardResize.Native })
    if (isIOS()) await Keyboard.setAccessoryBarVisible({ isVisible: false })

    Keyboard.addListener('keyboardWillShow', (info) => {
      document.body.classList.add('keyboard-open')
      document.documentElement.style.setProperty('--keyboard-height', `${info.keyboardHeight}px`)
    })
    Keyboard.addListener('keyboardWillHide', () => {
      document.body.classList.remove('keyboard-open')
      document.documentElement.style.setProperty('--keyboard-height', '0px')
    })
  } catch {
    /* not native */
  }
}

/** Hides the launch screen once the first React paint has happened. */
export async function hideSplash(): Promise<void> {
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen')
    await SplashScreen.hide()
  } catch {
    /* not native */
  }
}

/** Short tap feedback for tab switches and sends. Silent on web. */
export async function tapFeedback(): Promise<void> {
  if (!isNative()) return
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
    await Haptics.impact({ style: ImpactStyle.Light })
  } catch {
    /* no haptics engine */
  }
}

/**
 * One-time native boot. Safe to call on web (returns immediately after
 * tagging the document, so `desktop-app` styling still applies).
 */
export async function initNativeShell(primaryColor = '#2563eb'): Promise<void> {
  if (typeof document === 'undefined') return

  tagDocument()
  applySafeAreaInsets()

  // Insets change on rotation and on keyboard show/hide.
  window.addEventListener('resize', applySafeAreaInsets)
  window.addEventListener('orientationchange', applySafeAreaInsets)

  if (!isNative()) return

  await Promise.all([initStatusBar(primaryColor), initKeyboard()])
}
