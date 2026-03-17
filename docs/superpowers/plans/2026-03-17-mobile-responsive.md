# Mobile Responsive Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all pages of the SocialMedia unified inbox mobile-friendly, targeting phones (320-390px) as primary viewport.

**Architecture:** Progressive enhancement using Tailwind responsive classes on existing components. Mobile-first defaults with `md:` breakpoints restoring desktop layout. New mobile navigation (bottom tab bar + "More" drawer) added to root layout. Dashboard and email use slide navigation (full-screen list ↔ full-screen detail).

**Tech Stack:** Tailwind CSS responsive utilities, React `useState` for mobile view toggles, existing Next.js App Router

**Spec:** `docs/superpowers/specs/2026-03-17-mobile-responsive-design.md`

---

## Chunk 1: Foundation & Navigation

### Task 1: Viewport Meta Tag

**Files:**
- Modify: `frontend/app/layout.tsx`

- [ ] **Step 1: Check and add viewport meta tag**

Next.js 14 uses the `metadata` export for the viewport. Update the existing metadata export in `layout.tsx`:

```tsx
export const metadata: Metadata = {
  title: '...existing...',
  description: '...existing...',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}
```

Add `import type { Viewport } from 'next'` at the top alongside the existing `Metadata` import.

- [ ] **Step 2: Verify the app still loads**

Run: `cd frontend && npm run dev`
Open http://localhost:3000 in browser, verify no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/layout.tsx
git commit -m "feat: add viewport meta tag for mobile responsiveness"
```

---

### Task 2: Mobile Bottom Tab Bar Component

**Files:**
- Create: `frontend/components/MobileBottomNav.tsx`
- Modify: `frontend/app/layout-client.tsx` (render MobileBottomNav)

- [ ] **Step 1: Create MobileBottomNav component**

Create `frontend/components/MobileBottomNav.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { FiMessageSquare, FiMail, FiMoreHorizontal, FiX,
         FiHeadphones, FiGrid, FiSettings, FiUser } from 'react-icons/fi'

export default function MobileBottomNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Hide on login/register/widget pages
  if (pathname.startsWith('/login') || pathname.startsWith('/register') ||
      pathname.startsWith('/widget') || pathname.startsWith('/reset')) {
    return null
  }

  const tabs = [
    { key: 'messaging', label: 'Messaging', icon: FiMessageSquare, href: '/dashboard?tab=messaging' },
    { key: 'email', label: 'Email', icon: FiMail, href: '/dashboard?tab=email' },
  ]

  const drawerItems = [
    { label: 'Workspace', icon: FiHeadphones, href: '/workspace' },
    { label: 'Admin', icon: FiGrid, href: '/admin' },
    { label: 'Settings', icon: FiSettings, href: '/settings' },
    { label: 'Profile', icon: FiUser, href: '/settings?tab=profile' },
  ]

  const isActive = (key: string) => {
    if (key === 'messaging') return pathname === '/dashboard' && !pathname.includes('tab=email')
    if (key === 'email') return pathname.includes('/email') || pathname.includes('tab=email')
    return false
  }

  return (
    <>
      {/* Drawer overlay */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[70] md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-4 pb-8 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <span className="font-semibold text-lg">More</span>
              <button onClick={() => setDrawerOpen(false)} className="p-2">
                <FiX size={20} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {drawerItems.map((item) => (
                <button
                  key={item.label}
                  onClick={() => { router.push(item.href); setDrawerOpen(false) }}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl bg-gray-50 hover:bg-gray-100 active:bg-gray-200"
                >
                  <item.icon size={24} className="text-gray-700" />
                  <span className="text-sm text-gray-700">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bottom tab bar - hidden on md+ screens */}
      <nav className="fixed bottom-0 left-0 right-0 z-[60] bg-white border-t border-gray-200 flex md:hidden safe-area-bottom">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => router.push(tab.href)}
            className={`flex-1 flex flex-col items-center gap-1 py-2 pt-3 ${
              isActive(tab.key) ? 'text-blue-600' : 'text-gray-500'
            }`}
            style={isActive(tab.key) ? { color: 'var(--primary-color)' } : undefined}
          >
            <tab.icon size={22} />
            <span className="text-xs">{tab.label}</span>
          </button>
        ))}
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex-1 flex flex-col items-center gap-1 py-2 pt-3 text-gray-500"
        >
          <FiMoreHorizontal size={22} />
          <span className="text-xs">More</span>
        </button>
      </nav>
    </>
  )
}
```

- [ ] **Step 2: Add safe-area CSS for iOS notch**

Add to `frontend/app/globals.css`:

```css
.safe-area-bottom {
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
```

- [ ] **Step 3: Render MobileBottomNav in layout-client.tsx**

In `frontend/app/layout-client.tsx`, import and render `MobileBottomNav` after the other global components:

```tsx
import MobileBottomNav from '@/components/MobileBottomNav'
// ... existing imports

// Inside the return, after <EmailComposePopover /> and before the closing providers:
<MobileBottomNav />
```

- [ ] **Step 4: Verify bottom nav shows on mobile, hidden on desktop**

Open http://localhost:3000 in Chrome DevTools mobile mode (iPhone SE / 375px). Verify:
- Bottom tab bar visible with 3 items (Messaging, Email, More)
- Tapping "More" opens drawer with Workspace, Admin, Settings, Profile
- Tab bar hidden when browser is >= 768px wide

- [ ] **Step 5: Commit**

```bash
git add frontend/components/MobileBottomNav.tsx frontend/app/layout-client.tsx frontend/app/globals.css
git commit -m "feat: add mobile bottom tab bar with More drawer"
```

---

### Task 3: Make MainHeader Responsive

**Files:**
- Modify: `frontend/components/MainHeader.tsx`

The current header is fixed at top with all nav tabs always visible. On mobile, hide the full nav tabs and show only a compact header. The bottom tab bar handles navigation on mobile.

- [ ] **Step 1: Hide desktop nav tabs on mobile**

In `MainHeader.tsx`, find the `<nav>` element containing the tab buttons and add `hidden md:flex` to it:

```tsx
// Find the nav element with gap-1 containing all the tab links
// Change from: className="flex items-center gap-1"
// Change to:   className="hidden md:flex items-center gap-1"
```

- [ ] **Step 2: Hide desktop-only right-side elements on mobile**

The todos button and profile dropdown in the header right section — add `hidden md:flex` to the container:

```tsx
// Find the right-side flex container (flex items-center gap-3)
// Change from: className="flex items-center gap-3"
// Change to:   className="hidden md:flex items-center gap-3"
```

- [ ] **Step 3: Make header padding responsive**

```tsx
// Change header padding from px-6 to:
className="... px-3 md:px-6 ..."
```

- [ ] **Step 4: Verify header is compact on mobile**

In Chrome DevTools mobile mode:
- Header shows only logo (no nav tabs, no profile dropdown)
- At desktop width (768px+), full header with tabs and profile is visible

- [ ] **Step 5: Commit**

```bash
git add frontend/components/MainHeader.tsx
git commit -m "feat: make header responsive — compact on mobile, full on desktop"
```

---

## Chunk 2: Messaging Dashboard Mobile

### Task 4: Dashboard Slide Navigation

**Files:**
- Modify: `frontend/app/dashboard/page.tsx`

The dashboard currently shows sidebar (w-80) + ChatWindow side by side. On mobile, show only one at a time: conversation list full-screen, or chat full-screen with back button.

- [ ] **Step 1: Add mobile view state**

In the `DashboardPage` component (inside the `Suspense` wrapper), add state to track whether we're viewing the chat on mobile:

```tsx
const [mobileShowChat, setMobileShowChat] = useState(false)
```

When a conversation is selected (in the existing `onClick` handler for conversations), also set `setMobileShowChat(true)`.

- [ ] **Step 2: Make sidebar responsive — full width on mobile, w-80 on desktop**

Find the sidebar container div with `className="w-80 flex flex-col border-r ..."` and change to:

```tsx
className={`${mobileShowChat ? 'hidden' : 'flex'} md:flex w-full md:w-80 flex-col border-r ...`}
```

This shows the sidebar full-width on mobile when no chat is selected, hides it when chat is open. Always visible on desktop.

- [ ] **Step 3: Make ChatWindow responsive — full width on mobile, hidden when no chat**

Find the ChatWindow wrapper and change to:

```tsx
className={`${mobileShowChat ? 'flex' : 'hidden'} md:flex flex-1 flex-col`}
```

- [ ] **Step 4: Add mobile back button to ChatWindow area**

Above the ChatWindow component, inside its container, add a mobile-only back button:

```tsx
{mobileShowChat && (
  <div className="flex md:hidden items-center gap-2 px-3 py-2 border-b bg-white">
    <button
      onClick={() => { setMobileShowChat(false) }}
      className="p-2 -ml-2 rounded-lg hover:bg-gray-100"
    >
      <FiArrowLeft size={20} />
    </button>
    <span className="font-semibold truncate">
      {conversations.find(c => c.id === selectedConversation)?.contact_name || 'Chat'}
    </span>
  </div>
)}
```

Add `import { FiArrowLeft } from 'react-icons/fi'` at the top.

- [ ] **Step 5: Add bottom padding for mobile nav bar**

The main content area needs bottom padding on mobile so content isn't hidden behind the bottom tab bar. Find the outermost content wrapper (after `pt-14`) and add:

```tsx
className="... pb-16 md:pb-0"
```

When `mobileShowChat` is true, hide the bottom nav by adding/removing a class on `document.body`:

In the dashboard component, add an effect:
```tsx
useEffect(() => {
  if (mobileShowChat) {
    document.body.classList.add('mobile-chat-open')
  } else {
    document.body.classList.remove('mobile-chat-open')
  }
  return () => document.body.classList.remove('mobile-chat-open')
}, [mobileShowChat])
```

In `MobileBottomNav.tsx`, add `mobile-bottom-nav` class to the nav element. In `globals.css`:
```css
body.mobile-chat-open .mobile-bottom-nav { display: none !important; }
```

Also add `pb-16 md:pb-0` to dashboard content for when the nav IS visible.

- [ ] **Step 6: Make filter buttons responsive**

The platform filter and status filter rows — make them horizontally scrollable on mobile:

```tsx
// Wrap filter buttons in:
className="flex overflow-x-auto gap-2 pb-2 -mx-3 px-3 md:mx-0 md:px-0 md:flex-wrap"
```

- [ ] **Step 7: Verify slide navigation works**

In Chrome DevTools mobile mode (375px):
- Conversation list shows full-width
- Tapping a conversation shows full-screen chat with back button at top
- Back button returns to conversation list
- At desktop width (768px+), both sidebar and chat show side-by-side as before

- [ ] **Step 8: Commit**

```bash
git add frontend/app/dashboard/page.tsx frontend/app/globals.css
git commit -m "feat: dashboard slide navigation — full-screen list/chat toggle on mobile"
```

---

### Task 5: ConversationList Mobile Touch Targets

**Files:**
- Modify: `frontend/components/ConversationList.tsx`

- [ ] **Step 1: Increase conversation item padding for touch**

Find conversation item padding `p-4` and make it responsive:

```tsx
// Change from: className="p-4 border-b cursor-pointer ..."
// Change to:   className="p-3 md:p-4 border-b cursor-pointer ..."
```

The items are already reasonably sized for touch. Main fix is ensuring full-width on mobile.

- [ ] **Step 2: Make badges wrap properly**

If contact info badges (account, domain, ticket count) overflow on narrow screens, add `flex-wrap` to the badge container:

```tsx
className="flex items-center gap-2 flex-wrap"
```

- [ ] **Step 3: Commit**

```bash
git add frontend/components/ConversationList.tsx
git commit -m "feat: improve conversation list touch targets and badge wrapping"
```

---

### Task 6: ChatWindow Mobile Optimization

**Files:**
- Modify: `frontend/components/ChatWindow.tsx`

- [ ] **Step 1: Make CRM sidebar a mobile overlay**

Find the CRM sidebar rendering. It's likely a side panel. Wrap it with responsive classes:

```tsx
// CRM sidebar container — make it an overlay on mobile:
className="fixed inset-0 z-50 md:relative md:inset-auto md:z-auto md:w-80 bg-white"
// Add a mobile close button inside it
```

- [ ] **Step 2: Make message input area mobile-friendly**

The input area at the bottom should have adequate padding and the send button should be easily tappable (min 44px):

```tsx
// Send button: ensure min-w-[44px] min-h-[44px]
// Input container: add responsive padding p-2 md:p-4
```

- [ ] **Step 3: Handle virtual keyboard on mobile**

For the message input, use `sticky bottom-0` instead of `fixed` to work better with virtual keyboards:

```tsx
className="sticky bottom-0 bg-white border-t ..."
```

- [ ] **Step 4: Verify chat is usable on mobile**

In Chrome DevTools mobile mode:
- Messages display properly at full width
- Input bar is at bottom, tappable
- Send button is easy to tap
- CRM sidebar opens as full-screen overlay on mobile

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ChatWindow.tsx
git commit -m "feat: mobile-optimize chat window — overlay CRM sidebar, touch-friendly input"
```

---

## Chunk 3: Email Inbox Mobile

### Task 7: Email Page Responsive Layout

**Files:**
- Modify: `frontend/app/email/page.tsx`

The email page is large (~2000+ lines). Focus on the key layout containers.

- [ ] **Step 1: Identify the email list / detail split layout**

Read the email page to find the main two-panel layout (email list on left, email detail/thread on right). This is similar to the dashboard pattern.

- [ ] **Step 2: Add mobile view state for slide navigation**

```tsx
const [mobileShowEmail, setMobileShowEmail] = useState(false)
```

When an email is selected, set `setMobileShowEmail(true)`.

- [ ] **Step 3: Make email list full-width on mobile**

```tsx
// Email list container:
className={`${mobileShowEmail ? 'hidden' : 'flex'} md:flex w-full md:w-[380px] flex-col border-r ...`}
```

- [ ] **Step 4: Make email detail full-width on mobile**

```tsx
// Email detail container:
className={`${mobileShowEmail ? 'flex' : 'hidden'} md:flex flex-1 flex-col ...`}
```

- [ ] **Step 5: Add mobile back button for email detail**

```tsx
{mobileShowEmail && (
  <div className="flex md:hidden items-center gap-2 px-3 py-2 border-b bg-white">
    <button onClick={() => setMobileShowEmail(false)} className="p-2 -ml-2 rounded-lg hover:bg-gray-100">
      <FiArrowLeft size={20} />
    </button>
    <span className="font-semibold truncate">Back to Inbox</span>
  </div>
)}
```

- [ ] **Step 6: Make folder tabs horizontally scrollable**

```tsx
// Folder tabs container:
className="flex overflow-x-auto gap-1 whitespace-nowrap ..."
```

- [ ] **Step 7: Make compose view full-screen on mobile**

If compose is a modal/overlay, make it full-screen on mobile:

```tsx
className="fixed inset-0 md:inset-auto md:relative z-50 bg-white ..."
```

- [ ] **Step 8: Make email toolbar buttons touch-friendly**

Ensure toolbar buttons have minimum 44px tap targets:

```tsx
// Change from: className="w-7 h-7 ..."
// Change to:   className="w-10 h-10 md:w-7 md:h-7 ..."
```

- [ ] **Step 8.5: Handle virtual keyboard for compose**

In the compose view, ensure the send button and toolbar use `sticky bottom-0` instead of `fixed` positioning, so they stay visible when the virtual keyboard opens on mobile:

```tsx
// Compose toolbar/send area:
className="sticky bottom-0 bg-white border-t z-10 ..."
```

- [ ] **Step 9: Add bottom padding for mobile nav**

```tsx
className="... pb-16 md:pb-0"
```

- [ ] **Step 10: Verify email works on mobile**

In Chrome DevTools mobile mode:
- Email list shows full-width
- Tapping email shows full-screen detail with back button
- Compose is full-screen on mobile
- Folder tabs scroll horizontally

- [ ] **Step 11: Commit**

```bash
git add frontend/app/email/page.tsx
git commit -m "feat: email inbox slide navigation and responsive layout for mobile"
```

---

## Chunk 4: Admin Panel Mobile

### Task 8: AdminNav Sidebar Responsive

**Files:**
- Modify: `frontend/components/AdminNav.tsx`

The AdminNav is a fixed left sidebar (240px wide). On mobile, it should be a toggleable drawer.

- [ ] **Step 1: Add mobile drawer state**

```tsx
const [mobileOpen, setMobileOpen] = useState(false)
```

- [ ] **Step 2: Make sidebar hidden on mobile by default, shown on desktop**

The sidebar `<aside>` element currently has `fixed left-0 bottom-0`. Make it responsive:

```tsx
// Outer aside:
className={`fixed left-0 bottom-0 flex flex-col border-r border-gray-700 z-40 transition-transform ${
  mobileOpen ? 'translate-x-0' : '-translate-x-full'
} md:translate-x-0`}
```

- [ ] **Step 3: Add mobile overlay backdrop**

```tsx
{mobileOpen && (
  <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setMobileOpen(false)} />
)}
```

- [ ] **Step 4: Add mobile menu toggle button**

Export a way for parent pages to open the sidebar. Simplest: add a hamburger button that's visible on mobile only, positioned at the top of the page:

```tsx
// At the top of AdminNav return, add a floating button for mobile:
<button
  className="fixed top-[60px] left-2 z-50 p-2 bg-white rounded-lg shadow-md md:hidden"
  onClick={() => setMobileOpen(!mobileOpen)}
>
  <FiMenu size={20} />
</button>
```

Add `import { FiMenu } from 'react-icons/fi'`.

- [ ] **Step 5: Verify admin sidebar works on mobile**

In Chrome DevTools mobile mode:
- Sidebar is hidden by default
- Hamburger button visible below header
- Tapping hamburger opens sidebar as overlay with backdrop
- Tapping backdrop or nav item closes sidebar
- At desktop width, sidebar is always visible

- [ ] **Step 6: Commit**

```bash
git add frontend/components/AdminNav.tsx
git commit -m "feat: admin sidebar becomes toggleable drawer on mobile"
```

---

### Task 9: Admin Pages Content Responsive

**Files:**
- Modify: `frontend/app/admin/page.tsx` (admin dashboard)
- Modify: All admin page files that use `ml-60`

- [ ] **Step 1: Make admin page content responsive — remove fixed margin on mobile**

The admin dashboard page uses `className="ml-60 pt-14 min-h-screen bg-gray-50"`. This needs to be responsive:

```tsx
// Change from: className="ml-60 pt-14 min-h-screen bg-gray-50"
// Change to:   className="ml-0 md:ml-60 pt-14 min-h-screen bg-gray-50 pb-16 md:pb-0"
```

- [ ] **Step 2: Find and fix all admin pages using ml-60**

Search for `ml-60` across all admin pages and apply the same change (`ml-0 md:ml-60 pb-16 md:pb-0`):

Run: `grep -r "ml-60" frontend/app/admin/ --include="*.tsx" -l`

Apply the responsive change to each file found.

- [ ] **Step 3: Make KPI card grids responsive**

Admin dashboard likely uses `grid-cols-4` or similar. Make it responsive:

```tsx
// Change from: className="grid grid-cols-4 gap-4"
// Change to:   className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4"
```

Apply to all grid layouts in admin pages.

- [ ] **Step 4: Make admin data tables horizontally scrollable**

Wrap any `<table>` elements in admin pages with:

```tsx
<div className="overflow-x-auto -mx-4 md:mx-0">
  <table className="min-w-full ...">
```

- [ ] **Step 5: Make admin form layouts single-column on mobile**

Find any side-by-side form layouts (e.g., `grid-cols-2`) and make them stack:

```tsx
// Change from: className="grid grid-cols-2 gap-4"
// Change to:   className="grid grid-cols-1 md:grid-cols-2 gap-4"
```

- [ ] **Step 6: Make admin action buttons full-width on mobile**

```tsx
// Change from: className="flex gap-2"
// Change to:   className="flex flex-col md:flex-row gap-2"
// Button: add "w-full md:w-auto"
```

- [ ] **Step 7: Verify admin pages on mobile**

In Chrome DevTools mobile mode:
- Content fills full width (no left margin gap)
- KPI cards stack 1 per row on small screens
- Tables scroll horizontally
- Forms are single-column

- [ ] **Step 8: Commit**

```bash
git add frontend/app/admin/
git commit -m "feat: admin pages responsive — grid layouts, tables, forms adapt to mobile"
```

---

## Chunk 5: Workspace, Settings & Polish

### Task 10: Workspace Page Cleanup

**Files:**
- Modify: `frontend/app/workspace/page.tsx`

- [ ] **Step 1: Verify existing responsive classes work**

The workspace already has some responsive patterns (`flex flex-col lg:flex-row`, `grid-cols-1 md:grid-cols-3`). Verify they work at 375px. Fix any overflow issues.

- [ ] **Step 2: Add ml-0 md:ml-60 if workspace uses AdminNav**

Check if workspace uses `ml-60`. If so, make it responsive.

- [ ] **Step 3: Add bottom padding for mobile nav**

```tsx
className="... pb-16 md:pb-0"
```

- [ ] **Step 4: Commit**

```bash
git add frontend/app/workspace/page.tsx
git commit -m "feat: workspace page mobile cleanup"
```

---

### Task 11: Settings Pages Responsive

**Files:**
- Modify: `frontend/app/settings/page.tsx`
- Modify: `frontend/app/settings/change-password/page.tsx`
- Modify: `frontend/app/settings/api-credentials/page.tsx`
- Modify: `frontend/app/settings/billing/page.tsx`

- [ ] **Step 1: Make settings pages responsive**

Apply the same patterns:
- `ml-0 md:ml-60 pb-16 md:pb-0` if they use AdminNav
- `grid-cols-1 md:grid-cols-2` for form layouts
- `overflow-x-auto` for any tables
- Full-width buttons on mobile

- [ ] **Step 2: Verify settings on mobile**

Check each settings page at 375px width.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/settings/
git commit -m "feat: settings pages responsive for mobile"
```

---

### Task 12: Global Polish

**Files:**
- Modify: `frontend/app/globals.css`

- [ ] **Step 1: Add global responsive utilities**

Add to `globals.css`:

```css
/* Prevent horizontal overflow on mobile */
html, body {
  overflow-x: hidden;
  max-width: 100vw;
}

/* Minimum readable font size on mobile */
@media (max-width: 767px) {
  body { font-size: 14px; }
}

/* Smooth touch scrolling for filter bars */
.scroll-touch {
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.scroll-touch::-webkit-scrollbar {
  display: none;
}
```

- [ ] **Step 2: Add mobile-specific modal styles**

```css
@media (max-width: 767px) {
  /* Make modals near-full-screen on mobile */
  .modal-content, [role="dialog"] > div {
    width: 100% !important;
    max-width: 100% !important;
    margin: 0 !important;
    border-radius: 0 !important;
    min-height: 50vh;
  }
}
```

- [ ] **Step 3: Verify no horizontal scroll on any page at 375px**

Check dashboard, email, admin, workspace, settings at 375px width. No horizontal scrollbar should appear.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat: global mobile CSS — prevent overflow, smooth scroll, responsive modals"
```

---

### Task 13: Final Cross-Page Verification

- [ ] **Step 1: Test all pages at 375px (iPhone SE)**

Test each page in Chrome DevTools mobile mode:
- [ ] Login page
- [ ] Dashboard — conversation list view
- [ ] Dashboard — chat view (tap a conversation)
- [ ] Dashboard — back button returns to list
- [ ] Email — email list view
- [ ] Email — email detail (tap an email)
- [ ] Email — compose
- [ ] Admin dashboard
- [ ] Admin sub-pages (users, teams, branding, bot)
- [ ] Workspace
- [ ] Settings
- [ ] Bottom tab bar visible and functional
- [ ] "More" drawer opens/closes
- [ ] No horizontal scrolling on any page

- [ ] **Step 2: Test at 390px (iPhone 14)**

Repeat key checks at 390px width.

- [ ] **Step 3: Test at 768px (verify desktop is unchanged)**

At 768px+, all pages should look exactly like they did before — bottom nav hidden, header tabs visible, side-by-side layouts restored.

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: mobile responsive polish and edge case fixes"
```
