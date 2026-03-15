# WebRTC Softphone / Dial — Design Spec
**Date:** 2026-03-15
**Status:** Approved

## Overview

Add a fully functional in-browser WebRTC softphone to the Agent Workspace. Agents can make outbound calls by dialling directly from the workspace and receive inbound calls in-browser without a physical desk phone. Access is controlled by the existing `callcenter → make_call` permission in the admin roles matrix — no new infrastructure required.

---

## Decisions Made

| Question | Decision |
|---|---|
| Call type | In-browser WebRTC (SIP.js) — not click-to-call AMI |
| Direction | Both inbound + outbound |
| UI placement | Collapsible panel in existing right sidebar placeholder |
| SIP library | SIP.js (TypeScript-native, actively maintained) |
| Inbound call → ticket | Auto-triggers TicketForm (same as current simulated call flow) |
| Admin access control | Existing `callcenter → make_call` permission (no new module) |

---

## Architecture

```
Agent Browser (SIP.js UserAgent)
    │  registers on workspace load (using credentials from API)
    ▼
FreePBX WSS (wss_url from TelephonySettings)
    │
    ├─ Inbound INVITE → SIP.js onInvite event
    │     → softphone-context sets activeNumber
    │     → workspace TicketForm auto-opens (same as today)
    │
    └─ Outbound INVITE ← agent dials from pad
          → FreePBX bridges to PSTN destination
```

**SIP.js loaded dynamically** via `import()` — only loaded when `GET /api/extensions/my-sip-credentials` returns 200. Unauthorised agents pay zero JS bundle cost.

---

## Backend Changes

### New endpoint: `GET /api/extensions/my-sip-credentials`

**File:** `backend/app/routes/extensions.py`

**Permission:** `Depends(require_permission("callcenter", "make_call"))`
Returns 403 if agent lacks permission or has no extension assigned.

**Response:**
```json
{
  "extension": "1001",
  "password": "secret123",
  "wss_url": "wss://pbx.example.com:8089/ws",
  "realm": "pbx.example.com"
}
```

- `extension` + `password` — from existing `AgentExtension` table (looked up by `current_user.id`)
- `wss_url` + `realm` — from existing `TelephonySettings` table

**No new models, no migrations required.**

---

## Frontend Changes

### New: `frontend/lib/softphone-context.tsx`

React context mounted in the app root layout. Manages the SIP.js `UserAgent` lifecycle.

**State exposed:**
```ts
interface SoftphoneContext {
  status: 'unauthorized' | 'unregistered' | 'registering' | 'registered' | 'error'
  callState: 'idle' | 'ringing_in' | 'ringing_out' | 'active' | 'on_hold'
  callerNumber: string | null
  callerName: string | null     // resolved from existing context lookup
  muted: boolean
  answer: () => void
  hangup: () => void
  dial: (number: string) => void
  toggleMute: () => void
  toggleHold: () => void
}
```

**Lifecycle:**
1. On mount: `GET /api/extensions/my-sip-credentials`
2. If 403 → `status = 'unauthorized'`, SIP.js never imported
3. If 200 → dynamically `import('sip.js')`, create `UserAgent`, register to FreePBX WSS
4. On inbound `onInvite`: set `callState = 'ringing_in'`, set `callerNumber`
5. On `answer()`: accept session, set `callState = 'active'`, **call `setActiveNumber(callerNumber)`** in workspace context → auto-opens TicketForm
6. On `hangup()` / session end: reset to `callState = 'idle'`, clear `activeNumber`

### New: `frontend/components/Softphone.tsx`

Fills the existing right sidebar placeholder in the workspace. Three visual states:

**Unauthorised:**
```
[🔒 Dial not available — contact admin]
```

**Collapsed (idle, authorised):**
```
[● Softphone Ready  ▼]
```
Click header to expand.

**Expanded idle:**
```
┌─────────────────────────┐
│ ● Softphone Ready    ▲  │
│  [1234567890       ] [⌫] │
│  [1][2][3]              │
│  [4][5][6]              │
│  [7][8][9]              │
│  [*][0][#]              │
│  [    📞 Call    ]      │
└─────────────────────────┘
```

**Active call:**
```
┌─────────────────────────┐
│ 🟢 On Call           ▲  │
│  Acme Corp              │
│  +1 555 123 4567        │
│  00:42                  │
│  [🔇 Mute][⏸ Hold][🔴 End] │
└─────────────────────────┘
```

**Ringing inbound:**
```
┌─────────────────────────┐
│ 📲 Incoming Call     ▲  │
│  +1 555 987 6543        │
│  Unknown Caller         │
│  [✅ Answer][❌ Reject]  │
└─────────────────────────┘
```

### Modified: `frontend/app/workspace/page.tsx`

- Remove the static "Your PBX WebRTC Softphone is currently docked" placeholder text
- Render `<Softphone />` component in its place
- The existing `activeNumber` / `setActiveNumber` state is already present and drives the TicketForm — no changes needed to that flow

### Modified: `frontend/app/layout.tsx` (or root layout)

Wrap app with `<SoftphoneProvider>` so the context (and SIP registration) persists across page navigation.

---

## Admin Access Control

| Admin action | How |
|---|---|
| Disable dial for a role | Uncheck `callcenter → make_call` in `/admin/roles` |
| Disable dial for one agent | Add `UserPermissionOverride` revoking `make_call` for that user |
| Enable dial for one agent (beyond their role) | Add `UserPermissionOverride` granting `make_call` for that user |

All of the above already work — zero new admin UI needed.

**What admin must configure before softphone works for any agent:**
1. FreePBX WSS URL + realm set in `/admin/telephony` (already exists)
2. SIP extension + password assigned per agent in `/admin/extensions` (already exists)
3. `callcenter → make_call` permission checked for the agent's role in `/admin/roles`
4. FreePBX must have WebRTC/WSS transport enabled (infrastructure prerequisite, not in-app)

---

## What Is NOT Changing

- `POST /calls/originate` (AMI click-to-call from ticket table) — unchanged
- `AgentExtension` model and admin extensions page — unchanged (reused for SIP credentials)
- `TelephonySettings` model and admin telephony page — unchanged (reused for WSS URL)
- Existing workspace `activeNumber` → TicketForm flow — unchanged
- Call simulation button (dev only) — unchanged
- `callcenter` module registry entry — unchanged

---

## npm Dependency

```bash
npm install sip.js
```

SIP.js v0.21+ (current stable). Dynamically imported so it does not bloat the initial bundle.

---

## Success Criteria

- Agent with `make_call` permission sees a working softphone in the workspace sidebar
- Agent can dial an outbound number — call rings through FreePBX to destination
- Inbound call rings in browser — agent answers — TicketForm opens pre-filled with caller number
- Agent without `make_call` permission sees "Dial not available" — no JS loaded
- Admin can toggle access per role or per user in existing `/admin/roles` page
- Mute and hold work during active calls
- Call state resets cleanly after hangup
