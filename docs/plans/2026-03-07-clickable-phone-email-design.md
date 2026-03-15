# Clickable Phone & Email Design

**Date:** 2026-03-07
**Goal:** Make phone numbers auto-dial via in-app Softphone and email addresses open an inline compose popover across CRM and Call Center modules.

---

## Architecture

### Two React Contexts + Two Global Components

1. **SoftphoneContext** — manages Softphone visibility and auto-dial state.
   - `dial(number)` opens the panel with number pre-filled, starts calling.
   - `close()` hangs up and closes the panel.
   - Mounted in `layout-client.tsx`.

2. **EmailComposeContext** — manages floating compose popover state.
   - `openCompose(to)` opens the popover with the To field pre-filled.
   - `closeCompose()` closes it.
   - Mounted in `layout-client.tsx`.

### Two Wrapper Components

3. **`<ClickablePhone number={string} />`** — renders phone with Phone icon, hover underline, indigo color. On click calls `softphoneCtx.dial(number)`.

4. **`<ClickableEmail email={string} />`** — renders email with Mail icon, hover underline, blue color. On click calls `emailComposeCtx.openCompose(email)`.

### Global Components

5. **`<Softphone />`** (updated) — controlled by SoftphoneContext instead of internal state. When `dial(number)` is called, opens panel and auto-fills number. Existing dialpad, mute, hold, transfer features remain.

6. **`<EmailComposePopover />`** (new) — floating draggable panel (bottom-right, like Gmail compose). Full email composer: To/CC/BCC, subject, rich text body (Tiptap), file attachments. Sends via existing `POST /email/send` endpoint. Sent emails appear in agent's sent folder. Uses same email account selection as `/email` page.

---

## Where to Swap Plain Text → Clickable Wrappers

| Component | Phone field | Email field |
|-----------|-------------|-------------|
| LeadDetailPanel.tsx | `lead.phone` (line 260) | `lead.email` (line 259) |
| ChatWindow.tsx | `crmLead.phone` (line 684) | `crmLead.email` (line 683) |
| CrmSidebar.tsx | `lead.phone` (line 278) | `lead.email` (line 277) |
| Leads page (leads/page.tsx) | — | `lead.email` (line 374) |
| ContactManagement.tsx | `contact.phone_no[0]` | `contact.email` |
| Individuals page.tsx | `ind.phone_numbers[0]` | `ind.email` |
| Organizations [id]/page.tsx | org contact phones | org email |

---

## EmailComposePopover Details

- Floating panel, bottom-right corner, ~500px wide, draggable header bar
- Fields: To (pre-filled), CC/BCC (collapsible), Subject, Body (Tiptap rich text)
- Attachment support: file input, shows chips with filename/size/remove
- Email account selector (agent's configured SMTP accounts)
- Send button calls `POST /email/send` — same backend endpoint as `/email` page
- Sent emails automatically appear in agent's sent folder (backend handles this)
- Minimize/maximize toggle
- Close button with unsaved draft warning

## Softphone Updates

- Remove hardcoded `telephonySettings={{ is_active: true }}` — controlled by context
- Accept `number` prop from context to auto-fill on dial
- Auto-call when `dial(number)` is invoked (simulate calling state)
- Keep existing mock SIP logic — real WebRTC integration comes later

---

## Non-Goals

- No real SIP/WebRTC integration (Softphone remains mock)
- No changes to backend email API (reuse existing endpoints)
- No inline editing of phone/email fields — this is click-to-action only
