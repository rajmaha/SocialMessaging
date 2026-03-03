# Design: Campaign Template Inline Editor + Send Test Email

**Date:** 2026-03-03
**Status:** Approved

---

## Problem

1. **Template CSS lost on import** — Preset email templates are full HTML documents with inline styles (gradients, backgrounds, complex table layouts). When imported into the campaign create/edit page, `EmailEditor` (Tiptap) strips all unknown styles → raw unstyled table output.

2. **No test-before-send** — Campaign creators have no way to see how an email looks in a real inbox before sending to the full audience.

---

## Requirements

- Staff (non-technical) must be able to edit template text/images by clicking directly in the preview
- Template theme colours, backgrounds, gradients, and layout must be 100% preserved
- A "Send Test Email" button must let staff send the campaign to themselves before going live

---

## Solution Overview

### Feature 1 — Contenteditable Iframe Editor (Template Mode)

`EmailEditor` gains a **mode** concept:

| Mode | Trigger | Editor |
|------|---------|--------|
| `rich` | `body_html` is plain HTML fragment (no `<!DOCTYPE`/`<html>`) | Tiptap (existing) |
| `template` | `body_html` starts with `<!DOCTYPE` or `<html` | Contenteditable iframe |

#### Template Mode Behaviour

1. Render `body_html` in an `<iframe>` using `srcDoc` (same-origin, no sandbox).
2. After `onLoad`, inject into `contentWindow.document`:
   - `document.body.contentEditable = 'true'`
   - `document.body.spellcheck = false`
   - Click-prevention on all `<a>` tags (so links don't navigate away)
   - Click handler on `<img>` tags → prompts for new image URL via `window.prompt`
3. Listen for `input` events on `contentWindow.document` → debounced 400 ms → serialize back:
   ```
   '<!DOCTYPE html>\n' + iframe.contentWindow.document.documentElement.outerHTML
   ```
   → call parent `onChange(html)`
4. When `content` prop changes externally (new template selected), reload iframe via a `key` prop change.
5. Info bar above iframe: *"Click any text to edit. Colours and layout are preserved."* + **[Switch to basic editor]** button (warns: *"Switching may remove complex styles."*, then sets mode to `rich`).

#### Image Editing

Clicking any `<img>` inside the iframe triggers a simple `window.prompt('New image URL:')`. If the user provides a URL, `img.src` is updated and `onChange` fires.

---

### Feature 2 — Send Test Email Button

#### Frontend (Campaign create/edit page)

- **"Send Test Email"** button placed in the body section header row.
- Clicking opens a small inline popover beneath the button containing:
  - Email input pre-filled with the logged-in user's email
  - Subject preview (read-only, from `form.subject`)
  - **[Send Test →]** button + **[Cancel]**
- States: idle → loading (spinner, button disabled) → success (*"✅ Sent! Check your inbox."*) → error (*"❌ Failed: SMTP not configured"* or server error).
- Popover closes automatically 3 s after success.

#### Backend — new endpoint

```
POST /campaigns/send-test
Auth: Bearer token required
Body: { subject: str, body_html: str, to_email: str }
```

Implementation:
1. Load SMTP config via `branding_service.get_smtp_config(db)`.
2. If no `smtp_password` → return `400` with message *"SMTP not configured."*
3. Build `MIMEMultipart("alternative")` with the raw `body_html` (no merge-tag replacement, no tracking pixel).
4. Send via `smtplib` using the existing pattern from `_do_send`.
5. Return `200 { "ok": true }` on success, `500` on SMTP error.

---

## Files to Change

### Backend
| File | Change |
|------|--------|
| `backend/app/routes/campaigns.py` | Add `POST /campaigns/send-test` endpoint |

### Frontend
| File | Change |
|------|--------|
| `frontend/components/EmailEditor.tsx` | Add `template` mode with contenteditable iframe |
| `frontend/app/admin/campaigns/new/page.tsx` | Add Send Test Email button + popover |
| `frontend/app/admin/campaigns/[id]/edit/page.tsx` | Same Send Test Email button + popover |

---

## Key Technical Decisions

- **`srcDoc` without `sandbox`** — same-origin iframes allow `contentWindow.document` access; sandbox would block this.
- **Debounced onChange (400 ms)** — avoids calling parent on every keystroke; iframe re-render not triggered (DOM edited in-place).
- **Key-based iframe reset** — when parent selects a new template, change `key` prop on iframe to force a fresh mount rather than trying to update `srcDoc` on a live contenteditable document.
- **No merge-tag replacement in test send** — staff see literal `{{first_name}}` etc. so they know personalisation is active.
- **Reuse existing SMTP path** — no new email infrastructure; test send uses identical smtplib code as `_do_send`.
