# User Manual — Unified Social Messaging Platform

**Version 2.0 · Updated February 2026**

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Getting Started — First Login](#2-getting-started--first-login)
3. [Dashboard](#3-dashboard)
4. [Profile & Account Settings](#4-profile--account-settings)
5. [Connecting Messaging Platforms](#5-connecting-messaging-platforms)
6. [Conversations & Messaging](#6-conversations--messaging)
7. [Email Inbox](#7-email-inbox)
8. [Live Web Chat (Widget)](#8-live-web-chat-widget)
9. [Admin Panel](#9-admin-panel)
10. [Roles & Permissions](#10-roles--permissions)
11. [Troubleshooting](#11-troubleshooting)
12. [Keyboard Shortcuts](#12-keyboard-shortcuts)

---

## 1. System Overview

This platform gives your team a **single inbox** for every customer message, regardless of where it comes from:

| Channel | Direction | Notes |
|---------|-----------|-------|
| WhatsApp | Send & Receive | Requires Meta Business API |
| Facebook Messenger | Send & Receive | Requires Facebook App with webhook |
| Viber | Send & Receive | Requires Viber Bot token |
| LinkedIn | Send & Receive | Requires LinkedIn App OAuth |
| Email (SMTP/IMAP) | Send & Receive | Any email provider |
| Web Chat Widget | Send & Receive | Embeddable on any website, no external API needed |

All conversations land in the **Dashboard**, where agents reply from one place. Admins manage users, platform credentials, and branding from the **Admin Panel**.

---

## 2. Getting Started — First Login

### 2.1 Register

1. Open `http://localhost:3000` in your browser.
2. Click **"Register Now"**.
3. Fill in **Full Name**, **Email**, and **Password** (min 6 characters).
4. Click **Register** — a 6-digit OTP is sent to your email.
5. Enter the OTP code on the verification screen.
6. You are logged in and taken to the Dashboard.

> **OTP expires in 10 minutes.** Click "Resend Code" if needed.

### 2.2 Login

1. Go to `http://localhost:3000`.
2. Enter your **Email** and **Password**, then click **Sign In**.
3. A 6-digit OTP is sent to your email — enter it to complete login.

### 2.3 Forgot Password

1. Click **"Forgot Password?"** on the login page.
2. Enter your registered email and click **Send Reset Link**.
3. Open the reset link from your email (valid 1 hour).
4. Enter and confirm your new password.

### 2.4 Change Password (while logged in)

1. Go to **Settings** → **Security** tab.
2. Enter your current password, then your new password (twice).
3. Click **Change Password**.

---

## 3. Dashboard

```
┌──────────────────────────────────────────────────────────┐
│  Messages                              [Profile Avatar]  │
│  ──────────────────────────────────────────────────────  │
│  [All][WhatsApp][Facebook][Viber][LinkedIn][Web Chat]    │
│  ──────────────────────────────────────────────────────  │
│  │ Conversation List      │   Chat Window              │  │
│  │                        │                            │  │
│  │ 🟢 John (WhatsApp)     │  ← Messages appear here   │  │
│  │ 🔵 Alice (Facebook)    │                            │  │
│  │ 🟣 Bob (Viber)         │  [Type message…]  [Send]   │  │
│  │ 🩵 Widget Visitor      │                            │  │
└──────────────────────────────────────────────────────────┘
```

### 3.1 Platform Filter Bar

Click any badge to filter conversations:

| Badge | Color | Platform |
|-------|-------|----------|
| All | — | Show everything |
| WhatsApp | Green | WhatsApp Business |
| Facebook | Blue | Facebook Messenger |
| Viber | Purple | Viber |
| LinkedIn | Dark Blue | LinkedIn |
| Web Chat | Teal | Website chat widget |

### 3.2 Conversation List

Each row shows:
- **Contact name** and platform badge
- **Last message preview**
- **Unread count** (red badge)
- **Time** of last message

Click any conversation to open it on the right.

### 3.3 Chat Window

- Full message history in chronological order.
- Your replies appear on the right (blue); incoming messages on the left.
- Type in the input box at the bottom and press **Enter** or click **Send**.
- For webchat conversations, your reply is pushed directly to the visitor's browser in real time via WebSocket.

### 3.4 Profile Dropdown (top right)

Click your avatar circle (top-right corner) to open the dropdown:

- **Name & role badge** (Admin / Agent / User)
- **Email** and **phone** (if set)
- **Edit Profile** → opens Settings → Profile tab
- **Settings** → opens Settings
- **Logout** (red)

---

## 4. Profile & Account Settings

Navigate to **Settings** (`/settings`) from the profile dropdown.

### 4.1 Profile Tab

| Field | Notes |
|-------|-------|
| Avatar photo | Click the circle to upload. JPEG, PNG, GIF, WebP — max 5 MB |
| Full Name | Displayed everywhere in the UI |
| Phone | Shown in profile dropdown |
| Bio | Short description |
| Social links | Twitter/X, Facebook, LinkedIn, Instagram, YouTube |

Click **Save Profile** to apply changes.

### 4.2 Platform Accounts Tab

Add or remove your connected messaging accounts (WhatsApp, Facebook, Viber, LinkedIn). Each platform allows one account per user.

### 4.3 Security Tab

Change your password by providing the current password and a new one (minimum 6 characters).

---

## 5. Connecting Messaging Platforms

All platform credentials are entered in **Settings → Platform Accounts**.

### 5.1 WhatsApp

| Field | Example |
|-------|---------|
| Account ID / Phone Number | `+15551234567` |
| Display Name | `Support Team` |
| API Key / Access Token | From Meta Developer Console |

**Prerequisites**: Meta Business account → WhatsApp Business API → Phone Number ID and permanent access token.

### 5.2 Facebook Messenger

| Field | Example |
|-------|---------|
| Account ID | Facebook username or Page ID |
| Display Name | `Acme Support` |
| API Key | Page Access Token from Meta Developer Console |

**Prerequisites**: Facebook Developer App with Messenger product enabled, Page access token, and webhook configured.

### 5.3 Viber

| Field | Example |
|-------|---------|
| Account ID | Bot name or phone |
| Display Name | `Acme Viber Bot` |
| API Key | Bot token from Viber Admin Panel |

### 5.4 LinkedIn

| Field | Example |
|-------|---------|
| Account ID | LinkedIn username or org ID |
| Display Name | `Acme LinkedIn` |
| API Key | OAuth access token |

> For real-time, two-way messaging on any of the above platforms, webhooks must be configured so the platform can push incoming messages to your server. See `WEBHOOKS_SETUP.md` for step-by-step instructions.

---

## 6. Conversations & Messaging

### 6.1 Viewing Messages

1. Click a conversation in the list — full history opens on the right.
2. Scroll up to view older messages.

### 6.2 Sending a Message

1. Click the message input at the bottom.
2. Type your text.
3. Press **Enter** or click **Send**.

The system routes the message to the correct platform API (WhatsApp, Facebook, etc.) automatically based on which platform the conversation is on. For webchat, it is sent via WebSocket instantly.

### 6.3 Searching Conversations

Use the **search box** at the top of the conversation list. It filters by contact name in real time.

### 6.4 Unread Counts

The red badge on each conversation shows unread messages. Opening the conversation marks them as read.

### 6.5 Real-Time Events

The dashboard receives live events via a Server-Sent Events (SSE) connection. When a new message arrives on any platform (via webhook), the conversation list and chat window update automatically without a page refresh.

---

## 7. Email Inbox

The Email feature is accessible at `/email` from the dashboard navigation.

### 7.1 Connecting an Email Account

1. Go to **Admin Panel → Email Accounts** (admin) or request your admin to add one.
2. Provide SMTP and IMAP credentials:
   - **SMTP Host / Port** — for sending (e.g., `smtp.gmail.com:587`)
   - **IMAP Host / Port** — for receiving (e.g., `imap.gmail.com:993`)
   - **Username / Password** — your email credentials
   - **Security** — TLS or SSL

3. Click **Test Credentials** to verify the connection before saving.

### 7.2 Sending Email

1. Open the Email section.
2. Click **Compose** → fill in To, Subject, and Body.
3. Attach files if needed.
4. Click **Send**.

### 7.3 Auto-Sync

The backend automatically syncs all connected email accounts every **5 minutes** via a background scheduler. You can also trigger a manual sync.

### 7.4 Email Threads

Emails are grouped into threads. Replies within the same conversation are shown together.

---

## 8. Live Web Chat (Widget)

The webchat system lets website visitors start a live conversation with your agents — no third-party service required.

### 8.1 How It Works

```
Your Website                Backend              Dashboard
    │                          │                     │
    │── POST /webchat/session ─►│                     │
    │◄─ session_id + history ───│                     │
    │                          │                     │
    │══ WS /webchat/ws/{id} ══►│◄═══ SSE events ════│
    │                          │                     │
    │── {type:"message"} ─────►│─── broadcast ──────►│
    │                          │                     │
    │◄──────────── {type:"message_confirm"} ─────────│
```

1. Visitor opens your website → floating chat button appears (bottom-right).
2. Visitor clicks it → chat iframe opens → enters their name.
3. Messages flow in real time via WebSocket.
4. Agents see the conversation in the Dashboard under the **Web Chat** filter.
5. Agent replies are pushed instantly back to the visitor.

### 8.2 Embedding on Your Website

Add this single line before `</body>` on any HTML page:

```html
<script src="http://your-domain.com/chat-widget.js"></script>
```

To point to a custom backend:

```html
<script>
  window.SocialChatConfig = { serverUrl: 'https://your-domain.com' };
</script>
<script src="https://your-domain.com/chat-widget.js"></script>
```

The script:
- Adds a floating 💬 button (bottom-right, styled with your brand color from branding settings).
- Opens a 360×560 px iframe to the `/widget` page.
- Shows an unread message badge (red counter) when a new message arrives.

### 8.3 Widget Standalone Page

The widget is also accessible directly at: `http://localhost:3000/widget`

This is what loads inside the iframe. It shows:
- A name prompt screen (first visit)
- The live chat screen with message bubbles and typing indicator

### 8.4 Session Persistence

The visitor's `session_id` and `visitor_name` are stored in `localStorage`. If the visitor refreshes or reopens the tab, their chat history is restored automatically.

### 8.5 Agent Workflow for Web Chat

1. A new WebChat conversation appears in the Dashboard sidebar with a **teal** badge.
2. Click it to open — message history is on the right.
3. Type a reply and click **Send** — it is pushed to the visitor immediately.
4. When the visitor disconnects, a `webchat_visitor_offline` event is broadcast to agents.

---

## 9. Admin Panel

Admin Panel is accessible at `/admin` (only for users with `admin` role).

### 9.1 Dashboard (Overview)

- Total Users / Active Users
- Platform Accounts connected
- Total Conversations / Messages
- Recent activity

### 9.2 User Management

| Action | Steps |
|--------|-------|
| View all users | Admin → Users |
| Create a user | Click **Add User** → fill name, email, password, role → Save |
| Edit a user | Select user → Edit button → change fields → Save |
| Deactivate a user | Toggle the Active switch to Off |
| Delete a user | Select user → Delete (permanent) |
| Change a user's role | Edit user → Role dropdown → Admin / Agent / User |

### 9.3 Platform Settings

Manage global API credentials and webhook configurations for WhatsApp, Facebook, Viber, and LinkedIn that apply to the entire platform (as opposed to per-user accounts).

### 9.4 Email Accounts

Add, edit, test, and remove SMTP/IMAP email accounts for the organization. Click **Test Credentials** before saving to verify connectivity.

### 9.5 Branding

Customize how the platform and the chat widget appear:

| Setting | Description |
|---------|-------------|
| Company Name | Shown in widget header and emails |
| Primary Color | Widget button color, badge color |
| Logo URL | Displayed in widget and email headers |
| Welcome Message | First message shown to widget visitors |

Changes take effect immediately. The chat widget fetches branding on every page load.

### 9.6 RBAC — Roles

| Role | Access |
|------|--------|
| **admin** | Full access: admin panel, all users, all settings |
| **agent** | Dashboard, messaging, email — no admin panel |
| **user** | Dashboard, messaging — read-only settings |

---

## 10. Roles & Permissions

| Feature | Admin | Agent | User |
|---------|:-----:|:-----:|:----:|
| View conversations | ✅ | ✅ | ✅ |
| Send messages | ✅ | ✅ | ✅ |
| Connect platform accounts | ✅ | ✅ | ✅ |
| Edit own profile | ✅ | ✅ | ✅ |
| Change own password | ✅ | ✅ | ✅ |
| Access email inbox | ✅ | ✅ | — |
| Access Admin Panel | ✅ | — | — |
| Manage all users | ✅ | — | — |
| Change user roles | ✅ | — | — |
| Edit branding | ✅ | — | — |
| Manage platform settings | ✅ | — | — |
| Add org email accounts | ✅ | — | — |

---

## 11. Troubleshooting

### Login / Auth

| Problem | Fix |
|---------|-----|
| OTP not received | Check spam. Click "Resend Code" after 30 seconds. |
| OTP expired | Request a new one — OTPs expire in 10 minutes. |
| "Invalid email or password" | Credentials are case-sensitive. |
| Stuck on login (redirect loop) | Clear browser cookies: Cmd+Shift+Delete (Mac). |
| "Cannot connect to server" | Ensure backend is running on port 8000. |

### Platform Accounts

| Problem | Fix |
|---------|-----|
| "Account already exists" | Remove the existing account first. |
| Messages not delivering | Verify API key / token is still valid (they expire). |
| Webhook not triggering | Check platform developer console for webhook health. |
| Conversations not updating | Check SSE connection — refresh the page. |

### Web Chat Widget

| Problem | Fix |
|---------|-----|
| Widget button not appearing | Confirm `chat-widget.js` is loaded without JS errors. |
| "Session not found" WebSocket error | Ensure `POST /webchat/session` was called first. |
| Messages not reaching agent | Ensure backend is running and SSE connection is active. |
| Chat history lost | Check that `localStorage` is not cleared between visits. |

### Email

| Problem | Fix |
|---------|-----|
| "Authentication failed" on Test | Verify username/password. For Gmail, use an App Password. |
| Emails not syncing | Check IMAP credentials and firewall rules on port 993. |
| Sent emails not delivered | Check SMTP credentials and port (587 for TLS, 465 for SSL). |

### General

| Problem | Fix |
|---------|-----|
| "Loading…" never ends | Refresh (Cmd+R). Check DevTools console for errors. |
| CORS errors in console | Confirm backend is on port 8000; do not run it on a different port. |
| Avatar not loading | Ensure `backend/avatar_storage/` directory exists and is writable. |
| Backend crashes on start | Run `cat /tmp/backend.log` to see the error. |

---

## 12. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Enter | Send message |
| Cmd+R / Ctrl+R | Refresh page |
| Cmd+Shift+Delete (Mac) | Clear browser cache |
| Ctrl+Shift+Delete (Windows) | Clear browser cache |

---

**Version 2.0 · February 2026**  
For developer setup, see [SETUP_GUIDE.md](./SETUP_GUIDE.md).  
For API reference, see [API_DOCUMENTATION.md](./API_DOCUMENTATION.md).
