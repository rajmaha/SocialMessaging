/**
 * SocialMedia Inbox — desktop shell (Windows + macOS)
 * ===================================================
 *
 * The desktop app is the same hosted web app the mobile wrapper loads, in a
 * Chromium window that adds the things a browser tab cannot give a support
 * agent: it stays running in the tray with a live unread badge, it keeps the
 * session across restarts in its own persistent profile, and it opens
 * socialinbox:// links on the right screen.
 *
 * It deliberately does NOT bundle the frontend. Agents must see the same
 * build as the web users they are supporting, and the app's data all comes
 * from the API anyway, so a bundled copy would only add a release to forget.
 */

const {
  app, BrowserWindow, Tray, Menu, shell, ipcMain, nativeImage, screen, dialog,
} = require('electron')
const path = require('path')
const fs = require('fs')

// ── Configuration ───────────────────────────────────────────────────────────

const APP_URL = process.env.INBOX_URL || 'https://workspace.saraloms.com'
const APP_ORIGIN = new URL(APP_URL).origin
const PROTOCOL = 'socialinbox'

// Window geometry is remembered between runs so the app reopens where the
// agent left it, on the monitor they left it on.
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json')

/** @type {BrowserWindow | null} */
let mainWindow = null
/** @type {Tray | null} */
let tray = null
let isQuitting = false

// ── Window state ────────────────────────────────────────────────────────────

function loadWindowState() {
  const fallback = { width: 1440, height: 900, x: undefined, y: undefined, maximized: false }
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
    // A monitor that is no longer attached would put the window off-screen.
    if (typeof saved.x === 'number' && typeof saved.y === 'number') {
      const visible = screen.getAllDisplays().some((d) => {
        const b = d.workArea
        return saved.x < b.x + b.width && saved.x + 200 > b.x &&
               saved.y < b.y + b.height && saved.y + 100 > b.y
      })
      if (!visible) { saved.x = undefined; saved.y = undefined }
    }
    return { ...fallback, ...saved }
  } catch {
    return fallback
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    const bounds = mainWindow.getNormalBounds()
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({ ...bounds, maximized: mainWindow.isMaximized() })
    )
  } catch {
    /* a failed write just means the next launch uses defaults */
  }
}

// ── Main window ─────────────────────────────────────────────────────────────

function createWindow() {
  const state = loadWindowState()

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 900,
    minHeight: 600,
    show: false, // revealed on ready-to-show to avoid a white flash
    backgroundColor: '#f5f5f5',
    title: 'SocialMedia Inbox',
    // Keep the traffic lights but drop the title bar chrome on macOS; Windows
    // keeps its standard frame because agents expect snap and the system menu.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    icon: path.join(__dirname, '..', 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  })

  if (state.maximized) mainWindow.maximize()

  mainWindow.loadURL(APP_URL)

  mainWindow.once('ready-to-show', () => mainWindow.show())

  // A failed load would otherwise leave a blank window with no explanation.
  mainWindow.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* aborted, e.g. a redirect */) return
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Cannot reach the server',
      message: `Could not load ${url}`,
      detail: `${description} (${code})\n\nCheck your connection, then choose Retry.`,
      buttons: ['Retry', 'Quit'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) mainWindow.loadURL(APP_URL)
      else { isQuitting = true; app.quit() }
    })
  })

  // Anything outside the app's own origin belongs in the user's browser, not
  // in a chrome-less Electron window where the address bar cannot be checked.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_ORIGIN)) return { action: 'allow' }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_ORIGIN)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  // Closing hides to the tray: agents leave the inbox "closed" but still want
  // to be notified. Quit is explicit (tray menu, Cmd/Ctrl+Q, or app.quit()).
  mainWindow.on('close', (event) => {
    if (isQuitting) { saveWindowState(); return }
    event.preventDefault()
    saveWindowState()
    mainWindow.hide()
    if (process.platform === 'darwin') app.dock?.hide()
  })

  mainWindow.on('resize', saveWindowState)
  mainWindow.on('move', saveWindowState)
  mainWindow.on('closed', () => { mainWindow = null })
}

function showWindow() {
  if (!mainWindow) { createWindow(); return }
  if (process.platform === 'darwin') app.dock?.show()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** Sends the page to a route; used by the tray menu and deep links. */
function navigate(routePath) {
  showWindow()
  mainWindow?.webContents.send('inbox:navigate', routePath)
  // The renderer handles this when it is ready; if the page has not loaded
  // yet, load the URL directly instead.
  if (mainWindow && mainWindow.webContents.isLoading()) {
    mainWindow.loadURL(`${APP_ORIGIN}${routePath}`)
  }
}

// ── Tray ────────────────────────────────────────────────────────────────────

function createTray() {
  const iconPath = path.join(__dirname, '..', 'resources', 'trayTemplate.png')
  let image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) {
    image = nativeImage.createFromPath(path.join(__dirname, '..', 'resources', 'icon.png'))
    image = image.resize({ width: 16, height: 16 })
  }
  // A "Template" image is recoloured by macOS for light/dark menu bars.
  if (process.platform === 'darwin') image.setTemplateImage(true)

  tray = new Tray(image)
  tray.setToolTip('SocialMedia Inbox')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Inbox', click: () => showWindow() },
    { type: 'separator' },
    { label: 'Messaging', click: () => navigate('/dashboard?tab=messaging') },
    { label: 'Email', click: () => navigate('/dashboard?tab=email') },
    { label: 'Workspace', click: () => navigate('/workspace') },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit() } },
  ]))

  // Windows/Linux: a plain click should open the window, not just the menu.
  tray.on('click', () => {
    if (process.platform !== 'darwin') showWindow()
  })
}

// ── Application menu ────────────────────────────────────────────────────────

function buildMenu() {
  const isMac = process.platform === 'darwin'

  /** @type {import('electron').MenuItemConstructorOptions[]} */
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'Cmd+Q', click: () => { isQuitting = true; app.quit() } },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.reload() },
        { type: 'separator' },
        isMac
          ? { label: 'Close Window', accelerator: 'Cmd+W', click: () => mainWindow?.hide() }
          : { label: 'Quit', accelerator: 'Ctrl+Q', click: () => { isQuitting = true; app.quit() } },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Go',
      submenu: [
        { label: 'Messaging', accelerator: 'CmdOrCtrl+1', click: () => navigate('/dashboard?tab=messaging') },
        { label: 'Email', accelerator: 'CmdOrCtrl+2', click: () => navigate('/dashboard?tab=email') },
        { label: 'Workspace', accelerator: 'CmdOrCtrl+3', click: () => navigate('/workspace') },
        { type: 'separator' },
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: () => mainWindow?.webContents.navigationHistory.canGoBack() && mainWindow.webContents.navigationHistory.goBack() },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: () => mainWindow?.webContents.navigationHistory.canGoForward() && mainWindow.webContents.navigationHistory.goForward() },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ── Deep links ──────────────────────────────────────────────────────────────

/** socialinbox://dashboard?tab=email  →  /dashboard?tab=email */
function routeFromDeepLink(url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== `${PROTOCOL}:`) return null
    // In socialinbox://dashboard the "dashboard" lands in host, not pathname.
    const route = `${parsed.hostname || ''}${parsed.pathname || ''}`.replace(/^\/+/, '')
    return `/${route}${parsed.search || ''}`
  } catch {
    return null
  }
}

function handleDeepLink(url) {
  const route = routeFromDeepLink(url)
  if (route) navigate(route)
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

// A second launch must focus the running app rather than open a rival window
// with a competing WebSocket.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    showWindow()
    // Windows delivers the deep link as an argv entry on the second launch.
    const link = argv.find((a) => a.startsWith(`${PROTOCOL}://`))
    if (link) handleDeepLink(link)
  })

  app.whenReady().then(() => {
    // Register socialinbox:// for this app. In development the executable is
    // Electron itself, so the path of the script has to be passed along.
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])])
    } else {
      app.setAsDefaultProtocolClient(PROTOCOL)
    }

    createWindow()
    createTray()
    buildMenu()

    app.on('activate', () => showWindow())
  })

  // macOS delivers deep links as an event rather than through argv.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleDeepLink(url)
  })

  app.on('before-quit', () => { isQuitting = true; saveWindowState() })

  // The window hides rather than closes, so the app stays alive on purpose.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') { /* tray keeps it running */ }
  })
}

// ── Renderer IPC ────────────────────────────────────────────────────────────

ipcMain.on('inbox:badge', (_event, count) => {
  const n = Number(count) || 0

  if (process.platform === 'darwin') {
    app.dock?.setBadge(n > 0 ? String(n > 99 ? '99+' : n) : '')
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    // Windows has no numeric badge; a small overlay on the taskbar button is
    // the platform's equivalent.
    if (n > 0) {
      const label = String(n > 99 ? '99+' : n)
      mainWindow.setOverlayIcon(buildOverlayIcon(label), `${n} unread`)
    } else {
      mainWindow.setOverlayIcon(null, '')
    }
  }

  if (tray) tray.setToolTip(n > 0 ? `SocialMedia Inbox — ${n} unread` : 'SocialMedia Inbox')
})

/** Red circle with the unread count, drawn as an SVG data URL. */
function buildOverlayIcon(label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
    <circle cx="16" cy="16" r="15" fill="#ef4444"/>
    <text x="16" y="22" font-family="Segoe UI, sans-serif" font-size="${label.length > 2 ? 12 : 16}"
          font-weight="bold" fill="#ffffff" text-anchor="middle">${label}</text>
  </svg>`
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  )
}

ipcMain.on('inbox:attention', () => {
  if (process.platform === 'darwin') app.dock?.bounce('informational')
  else mainWindow?.flashFrame(true)
})
