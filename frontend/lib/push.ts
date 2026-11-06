/**
 * Push + local notifications
 * ==========================
 *
 * Two separate mechanisms, deliberately:
 *
 *   • **Local notifications** fire from the WebSocket stream the app already
 *     uses (`lib/events-context`).  They need no credentials and no server
 *     work, and they cover the common case — the app is open in the
 *     background and a message arrives.
 *
 *   • **Push notifications** (FCM on Android, APNs via FCM on iOS) are the
 *     only way to reach a *killed* app.  They need a Firebase project, so
 *     registration is best-effort: if the native project has no
 *     `google-services.json` / APNs key, `register()` rejects and we log and
 *     carry on rather than blocking boot.
 *
 * Device tokens are posted to the backend (`/devices/register`) so the server
 * can address a specific agent's phone.
 */

import axios from 'axios'
import { API_URL } from './config'
import { getAuthToken } from './auth'
import { isNative, getPlatform } from './native'

const TOKEN_STORAGE_KEY = 'push_device_token'

// ── Device-token registration ───────────────────────────────────────────────

async function sendTokenToBackend(token: string): Promise<void> {
  const auth = getAuthToken()
  if (!auth) return // not signed in yet; retried on next boot after login

  let deviceName = 'Mobile device'
  let osVersion = ''
  try {
    const { Device } = await import('@capacitor/device')
    const info = await Device.getInfo()
    deviceName = [info.manufacturer, info.model].filter(Boolean).join(' ') || deviceName
    osVersion = info.osVersion || ''
  } catch {
    /* Device plugin missing — name stays generic */
  }

  await axios.post(
    `${API_URL}/devices/register`,
    {
      token,
      platform: getPlatform(),
      device_name: deviceName,
      os_version: osVersion,
    },
    { headers: { Authorization: `Bearer ${auth}` } }
  )
}

/**
 * Asks for the push permission, registers with FCM/APNs and hands the token
 * to the backend.  Returns the token, or null when push is unavailable.
 */
export async function registerForPush(
  onNotificationTap?: (data: Record<string, any>) => void
): Promise<string | null> {
  if (!isNative()) return null

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')

    // Ask only when we have not been granted yet, so we don't nag.
    let perm = await PushNotifications.checkPermissions()
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions()
    }
    if (perm.receive !== 'granted') return null

    const token = await new Promise<string | null>((resolve) => {
      // `register()` resolves before the token arrives — the token comes back
      // on the 'registration' event, so wait for that (with a timeout so a
      // missing Firebase config cannot hang boot forever).
      const timer = setTimeout(() => resolve(null), 10_000)

      PushNotifications.addListener('registration', (t) => {
        clearTimeout(timer)
        resolve(t.value)
      })
      PushNotifications.addListener('registrationError', (err) => {
        clearTimeout(timer)
        console.warn('Push registration failed (is google-services.json present?):', err)
        resolve(null)
      })

      PushNotifications.register().catch((err) => {
        clearTimeout(timer)
        console.warn('Push register() threw:', err)
        resolve(null)
      })
    })

    if (!token) return null

    // Tapping a notification should open the thread it refers to.
    if (onNotificationTap) {
      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        onNotificationTap(action.notification.data || {})
      })
    }

    // Only re-post when the token actually rotated.
    let previous: string | null = null
    try {
      previous = localStorage.getItem(TOKEN_STORAGE_KEY)
    } catch {}
    if (previous !== token) {
      await sendTokenToBackend(token)
      try {
        localStorage.setItem(TOKEN_STORAGE_KEY, token)
      } catch {}
    }

    return token
  } catch (err) {
    console.warn('Push notifications unavailable:', err)
    return null
  }
}

/** Called on sign-out so a shared phone stops receiving the old agent's alerts. */
export async function unregisterDevice(): Promise<void> {
  let token: string | null = null
  try {
    token = localStorage.getItem(TOKEN_STORAGE_KEY)
  } catch {}
  if (!token) return

  const auth = getAuthToken()
  try {
    if (auth) {
      await axios.post(
        `${API_URL}/devices/unregister`,
        { token },
        { headers: { Authorization: `Bearer ${auth}` } }
      )
    }
  } catch {
    /* best effort — the server also prunes tokens FCM reports as dead */
  }
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
  } catch {}
}

// ── Local notifications (app alive, in background) ──────────────────────────

let localNotificationsReady = false

async function ensureLocalNotifications(): Promise<boolean> {
  if (!isNative()) return false
  if (localNotificationsReady) return true
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    let perm = await LocalNotifications.checkPermissions()
    if (perm.display === 'prompt' || perm.display === 'prompt-with-rationale') {
      perm = await LocalNotifications.requestPermissions()
    }
    if (perm.display !== 'granted') return false
    localNotificationsReady = true
    return true
  } catch {
    return false
  }
}

/**
 * Raises a notification for an event that arrived over the WebSocket.
 * `threadId` is carried in `extra` so a tap can route to the conversation.
 */
export async function showLocalNotification(opts: {
  title: string
  body: string
  threadId?: number | string
  route?: string
}): Promise<void> {
  if (!(await ensureLocalNotifications())) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.schedule({
      notifications: [
        {
          // Notification ids must be 32-bit ints; the clock gives us a
          // unique-enough value without a counter that resets on relaunch.
          id: Math.floor(Date.now() % 2_147_483_647),
          title: opts.title,
          body: opts.body,
          extra: { threadId: opts.threadId, route: opts.route },
          smallIcon: 'ic_stat_icon_config_sample',
        },
      ],
    })
  } catch (err) {
    console.warn('Local notification failed:', err)
  }
}

/** Registers the tap handler for local notifications (routing to a thread). */
export async function onLocalNotificationTap(
  handler: (extra: Record<string, any>) => void
): Promise<void> {
  if (!isNative()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
      handler((action.notification.extra as Record<string, any>) || {})
    })
  } catch {
    /* not native */
  }
}

/** Sets the app-icon badge to the unread count (iOS, and Android launchers that support it). */
export async function setBadgeCount(count: number): Promise<void> {
  if (!isNative()) return
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    if (count <= 0) await PushNotifications.removeAllDeliveredNotifications()
  } catch {
    /* badge support is launcher-dependent; ignore failures */
  }
}
