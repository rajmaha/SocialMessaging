# Mobile Responsive Design — SocialMedia Unified Inbox

## Overview

Make all pages of the SocialMedia unified inbox mobile-friendly, targeting phone screens (320-390px) as the primary mobile viewport. Uses progressive enhancement with Tailwind responsive classes — no new files or component duplication.

## Approach

- **Mobile-first**: Default styles target phones, `md:` breakpoints (768px+) restore desktop layout
- **Progressive enhancement**: Add responsive classes to existing components
- **Minimal state additions**: `useState` for mobile toggles (sidebar, nav drawer)
- **No new dependencies**: Pure Tailwind + React state

## Breakpoint Strategy

| Range | Target | Prefix |
|-------|--------|--------|
| < 768px | Phones | (default) |
| >= 768px | Desktop | `md:` |

## 1. Foundation

### Viewport Meta Tag
Verify `frontend/app/layout.tsx` has a viewport meta tag. Next.js 14 may auto-inject one — if so, skip. If not, add via the `metadata` export:
```ts
export const metadata = { viewport: 'width=device-width, initial-scale=1' }
```

### Navigation — Bottom Tab Bar (mobile only)
- Fixed to bottom of screen, hidden at `md:` (`flex md:hidden`)
- 3 items: **Messaging**, **Email**, **More**
- "More" opens a slide-up drawer with: Workspace, Admin, Settings, Profile
- Active tab highlighted with brand color
- Hidden when inside a chat view to maximize space

### Navigation — Desktop Header
- Unchanged on desktop
- Hidden on mobile (`hidden md:flex`), replaced by minimal top bar: logo/page title + back button when applicable

## 2. Messaging Dashboard

### Conversation List View (mobile default)
- Full-screen list below minimal top bar
- Conversation rows: platform icon, contact name, last message preview, timestamp, unread badge
- Platform filter tabs: horizontal scroll at top
- Status/assignment filters: collapse into filter icon button → dropdown
- Tap conversation → transition to chat view

### Chat View (mobile, after tap)
- Full-screen chat, replaces conversation list
- Top bar: back arrow + contact name + platform badge + actions menu
- Messages fill screen, input bar at bottom
- CRM sidebar: info icon in top bar → full-screen overlay with back button
- Bottom tab bar hides when chat is active
- Back button returns to conversation list

### State Management
- Track mobile view state: when `selectedConversationId` is set on mobile → show chat; when null → show list
- Use local `useState` in the dashboard page component (no pre-existing Zustand store to hook into)

## 3. Email Inbox

### Email List View (mobile default)
- Full-screen email list
- Rows: sender, subject, snippet, timestamp, labels
- Folder tabs: horizontal scrollable pills at top
- Search: collapses to icon, expands on tap
- Bulk actions: edit mode button

### Email Detail View (after tap)
- Full-screen with back button
- Thread messages stack vertically
- Reply/Forward buttons fixed at bottom
- Attachments as downloadable chips

### Compose
- Full-screen overlay
- To/CC/BCC fields stack vertically
- Rich text toolbar: horizontal scroll or collapse to "+" button
- Send button at top-right

## 4. Admin Panel

### Navigation
- Admin sub-pages (Users, Branding, Teams, Bot, Reports, CORS, Email Accounts) as vertical menu on landing page
- Tap into sub-page → back button to return

### Forms & Settings
- Single-column layout on mobile
- Side-by-side inputs stack vertically
- Action buttons full-width at bottom

### Data Tables
- Default: horizontal scroll with sticky first column
- Card-based reflow only for simple tables with 3 or fewer columns

### Workspace
- Already partially responsive — clean up existing breakpoints
- Grid: `grid-cols-1` mobile, `md:grid-cols-3` desktop
- Right sidebar already collapses — verify behavior

## 5. Global Patterns

### Touch Targets
- Minimum 44x44px tap area on all interactive elements
- Increase padding on conversation rows, buttons, nav items

### Scroll & Overflow
- No horizontal scroll at mobile widths
- Filter/tab bars: horizontal scroll with smooth touch scrolling

### Modals & Overlays
- Desktop modals become full-screen sheets on mobile (or near-full-width)

### Text & Spacing
- Minimum 14px body text
- Proportional padding/margins: `p-4 md:p-6`, `gap-2 md:gap-4`

### Chat Widget
- Already mobile-friendly (embeds on customer sites) — no changes needed

## 6. Mobile Keyboard & Orientation

### Virtual Keyboard
- Chat input bar and email compose: use `position: sticky` at bottom or handle `visualViewport` resize to prevent fixed elements jumping when iOS/Android keyboard opens
- Test with both iOS Safari and Android Chrome behavior

### Landscape Orientation
- Not a priority — should not break, but no special optimization
- Landscape on phones will use the same mobile layout

## Technical Notes

- No new npm dependencies
- No separate mobile components — responsive classes on existing components
- Desktop experience completely unchanged (all mobile styles are default, overridden by `md:`)
- Email page is rendered as React components (not iframe) — make the email page itself responsive
