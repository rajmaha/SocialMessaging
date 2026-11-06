# Mobile and desktop apps

The inbox ships as three packaged apps on top of the same Next.js frontend:

| app | technology | lives in |
|---|---|---|
| Android | Capacitor 8 | `frontend/android/` |
| iOS | Capacitor 8 | `frontend/ios/` |
| Windows + macOS | Electron | `desktop/` |

All three load the **hosted** frontend (`https://workspace.saraloms.com` by
default) rather than bundling a copy of it. An agent's app therefore always
matches the web app their colleagues are using, and a frontend fix reaches
every platform without a store release. The trade-off is that the apps need
the network to start; they are a shell around a live service, not an offline
client.

What the shells add is everything a browser tab cannot: OS notifications,
a hardware back button that behaves, safe-area handling around notches,
haptics, a dock/taskbar badge, a tray, and deep links.

---

## 1. The shared native layer

Nothing platform-specific is scattered through the pages. Three modules carry
it, and all of them are safe to import in a plain browser build:

| file | what it owns |
|---|---|
| `frontend/lib/native.ts` | platform detection, status bar, keyboard, splash, safe-area insets, haptics |
| `frontend/lib/push.ts` | FCM/APNs registration, device tokens, local notifications |
| `frontend/components/NativeShell.tsx` | boot, hardware back, resume, deep links, notification routing, desktop badge |

`NativeShell` is mounted once in `app/layout-client.tsx`, inside the branding
and events providers. It renders nothing.

### Safe areas

`lib/native.ts` publishes `--sa-top` and `--sa-bottom` on `<html>` and tags it
with `native-app` / `native-ios` / `native-android` / `desktop-app`.

Android 15+ forces edge-to-edge, so the WebView draws under the status bar.
`env(safe-area-inset-*)` is the portable answer but some Android WebViews
still report 0, so the values are **probed at runtime** and fall back to a
constant on Android.

Rather than editing the ~40 pages that offset the fixed header, `globals.css`
redefines what `pt-14`, `top-14` and `pb-16` mean *inside the app only*:

```css
html.native-app .pt-14 { padding-top: calc(var(--topbar-height) + var(--sa-top)); }
```

If you add a page, use those existing utilities and the insets come for free.

### Hardware back button

`NativeShell` maps Android's back button onto in-app navigation in three steps:

1. It dispatches a **cancelable `nativeback` event**. Any open UI can consume
   the press with `preventDefault()` — the chat pane does this in
   `app/dashboard/page.tsx`, the "More" drawer does it in `MobileBottomNav`.
2. If nothing consumed it and we are not on a tab root, `router.back()`.
3. On a tab root, the first press shows "Press back again to exit" and a
   second press within two seconds calls `App.exitApp()`.

**Any new full-screen overlay should listen for `nativeback`**, or the back
button will navigate away instead of closing it.

---

## 2. Notifications

Two mechanisms, for two different states of the app.

**While the app is running** (foreground or background), events already arrive
over the WebSocket in `lib/events-context.tsx`. `NativeShell` raises a *local*
notification for the ones worth interrupting for, but only when the app is not
in the foreground — otherwise the in-app toast from `EventNotifications`
already covers it. This needs no credentials and works out of the box.

**While the app is killed**, only the OS push services can wake it. That path
is FCM (Android directly, iOS relayed to APNs by Firebase).

The server side hangs off one place. `EventsService.broadcast_to_user()`
already returns early when an agent has no open socket — which *is* the
"app is closed" signal — so the push fallback lives there:

```
app/services/events_service.py   PUSHABLE_EVENTS + _push_fallback()
app/services/push_service.py     FCM HTTP v1 sender
app/routes/devices.py            /devices/register, /unregister, /test
app/models/device_token.py       one row per device
```

Only events in `PUSHABLE_EVENTS` are pushed; typing indicators and status
changes are noise on a lock screen. The wording there mirrors
`components/EventNotifications.tsx` so the banner and the toast read the same.

### Setting up push (optional)

Without it the apps still notify while running — they just cannot wake from
killed. To enable it:

1. Create a Firebase project and add an Android app with package name
   `com.socialmedia.inbox`.
2. Download `google-services.json` into `frontend/android/app/`.
   (`frontend/android/app/build.gradle` already applies the plugin when the
   file is present, and ignores it when absent.)
3. For iOS, add an iOS app in the same Firebase project, download
   `GoogleService-Info.plist` into `frontend/ios/App/App/`, and upload your
   APNs key under Project settings → Cloud Messaging.
4. Create a service account (Project settings → Service accounts → Generate
   new private key) and give the backend its JSON:

   ```
   FCM_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
   ```

   or `FCM_SERVICE_ACCOUNT_FILE=/path/to/service-account.json`.

**Both variables are already named in `docker-compose.yml`'s backend
`environment:` block** — a variable set only in the deploy panel never reaches
the container (see CLAUDE.md).

Verify with `POST /devices/test` from a signed-in agent, or check
`GET /devices/push-status`.

---

## 3. Deep links

`socialinbox://dashboard?tab=email` opens the app on that screen, on all three
platforms. HTTPS links to the hosted host are also claimed on Android
(`android:autoVerify="true"`); that needs `/.well-known/assetlinks.json`
served from `workspace.saraloms.com` to stop the "open with" chooser
appearing.

Notification payloads carry `conversation_id`, `ticket_number`, `email_id` or
an explicit `route`; `routeForNotification()` in `NativeShell` turns any of
them into a path, and the same keys are used by local notifications and by
FCM, so there is one routing rule rather than two.

---

## 4. Building

### Android

**JDK 21 is required.** Gradle 8.14.3 cannot read class files newer than
Java 21 (`Unsupported class file major version 69`), and neither the system
JDK (26) nor Android Studio's bundled runtime (25) works. Install one:

```bash
brew install openjdk@21
```

Then:

```bash
cd frontend
npx cap sync android
cd android
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
ANDROID_HOME="$HOME/Library/Android/sdk" \
./gradlew assembleDebug
```

`ANDROID_HOME` matters too: the shell default here points at
`/opt/homebrew/share/android-commandlinetools`, which has only the
command-line tools and no platforms to build against.

The APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`.

For a release build, add a signing config to `android/app/build.gradle` and
run `./gradlew assembleRelease` (or `bundleRelease` for Play).

### iOS

```bash
cd frontend
npx cap sync ios
npx cap open ios      # then Run in Xcode
```

Plugins are wired through Swift Package Manager (`ios/App/CapApp-SPM`), so
there is no CocoaPods step. A device build needs a signing team set in Xcode.

### Desktop (Windows + macOS)

```bash
cd desktop
npm install
npm start             # run against the hosted app
npm run dev           # run against http://localhost:3000
npm run dist:mac      # .dmg + .zip (arm64 + x64)
npm run dist:win      # NSIS installer + portable .exe
```

Output goes to `desktop/dist/`.

Note that **`npm run dist:win` cannot run on macOS without Wine**; build the
Windows target on a Windows machine or in CI (`electron-builder --win` on a
windows-latest runner). The macOS targets build natively here.

Builds are unsigned. macOS will quarantine an unsigned `.dmg`
("app is damaged"); for distribution set `CSC_LINK`/`CSC_KEY_PASSWORD` for
signing and notarize, or tell testers to run
`xattr -cr "/Applications/SocialMedia Inbox.app"`.

### Pointing an app at a different server

- Mobile: `server.url` in `frontend/capacitor.config.ts` (also add the host to
  `allowNavigation`), then `npx cap sync`.
- Desktop: the `INBOX_URL` environment variable, or edit `APP_URL` in
  `desktop/src/main.js`.

---

## 5. Icons and splash screens

Source artwork lives in `frontend/resources/`:

| file | purpose |
|---|---|
| `logo-source.png` | the original logo, transparent, 1024×929 |
| `icon.png` | square 1024×1024 app icon on white (iOS forbids alpha) |
| `splash.png` / `splash-dark.png` | 2732×2732 launch screens |

Regenerate all 113 platform assets with:

```bash
cd frontend
npx @capacitor/assets generate \
  --iconBackgroundColor '#ffffff' --iconBackgroundColorDark '#0f172a' \
  --splashBackgroundColor '#ffffff' --splashBackgroundColorDark '#0f172a' \
  --android --ios
```

The desktop icon is `desktop/build/icon.png`; electron-builder derives the
`.icns` and `.ico` from it.

---

## 6. Things to know before changing this

- **The desktop app hides on close rather than quitting**, so the tray keeps
  the WebSocket alive and the badge current. Quit is explicit.
- **Only one Electron window is allowed** (`requestSingleInstanceLock`) — two
  would open two WebSockets and double every notification.
- **External links open in the user's browser**, not in the Electron window,
  which has no address bar to check a URL against.
- `window.inboxDesktop` (from `desktop/src/preload.js`) is the entire bridge
  between the page and Electron. `contextIsolation` and `sandbox` are on;
  keep them on.
- Unread counts come from `lib/use-unread.ts` for both the mobile tab badges
  and the desktop dock badge, so the two can never disagree.
