/**
 * Preload — the only bridge between the web app and Electron.
 *
 * Runs with contextIsolation on, so the page gets exactly the small, frozen
 * surface exposed here and nothing of Node. `window.inboxDesktop` is also how
 * the shared frontend detects the desktop app (`isDesktopApp()` in
 * frontend/lib/native.ts) to hide phone-only chrome like the bottom tab bar.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('inboxDesktop', {
  // Identity — read by lib/native.ts
  isDesktop: true,
  platform: process.platform, // 'darwin' | 'win32' | 'linux'
  version: process.env.INBOX_APP_VERSION || '',

  /**
   * Unread total for the dock badge (macOS) and the taskbar overlay
   * (Windows). Call with 0 to clear it.
   */
  setBadgeCount: (count) => {
    const n = Number(count)
    ipcRenderer.send('inbox:badge', Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)
  },

  /** Bounce the dock icon / flash the taskbar button for an urgent item. */
  requestAttention: () => ipcRenderer.send('inbox:attention'),

  /** Main asks the page to navigate (tray menu, deep link, notification). */
  onNavigate: (handler) => {
    if (typeof handler !== 'function') return () => {}
    const listener = (_event, path) => handler(String(path || '/'))
    ipcRenderer.on('inbox:navigate', listener)
    return () => ipcRenderer.removeListener('inbox:navigate', listener)
  },
})
