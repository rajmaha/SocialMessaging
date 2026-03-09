# Webcam / CCTV Photo Source Toggle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let agents choose between webcam and CCTV for visitor photo capture when a location has CCTV configured, with neither source auto-starting.

**Architecture:** Single file change — `frontend/app/admin/visitors/new/page.tsx`. A new `photoSource` state (`'cctv' | 'webcam' | null`) drives which capture UI is shown. Toggle buttons appear when `hasCctv` and no photo has been taken yet. Selecting CCTV starts the HLS stream on-demand; selecting Webcam activates `getUserMedia`. Location changes reset the source selection and stop whatever was running.

**Tech Stack:** Next.js 14 App Router (TypeScript), React hooks, hls.js, browser `getUserMedia`

---

### Task 1: Add state, update handlers, fix location-change effect

**Files:**
- Modify: `frontend/app/admin/visitors/new/page.tsx`

**Step 1: Read the file**

Read `frontend/app/admin/visitors/new/page.tsx` to have the current code fresh in context before editing.

**Step 2: Add `photoSource` state**

After the `passCardId` state on line 46, add:

```typescript
type PhotoSource = 'cctv' | 'webcam' | null
const [photoSource, setPhotoSource] = useState<PhotoSource>(null)
```

**Step 3: Add `selectPhotoSource` handler**

Add this function after `stopCctvPlayer` (around line 250):

```typescript
// Start the chosen photo source; stops the other one first
const selectPhotoSource = (source: 'cctv' | 'webcam') => {
  setPhotoSource(source)
  if (source === 'cctv') {
    stream?.getTracks().forEach(t => t.stop())
    setStream(null)
    startCctvStream(parseInt(form.location_id))
  } else {
    stopCctvPlayer()
    startCamera()
  }
}
```

**Step 4: Update the location-change `useEffect`**

Find this block (around line 291):

```typescript
// When location changes, stop any existing stream and start for the new one if it has a camera
useEffect(() => {
  stopCctvPlayer()
  if (!form.location_id) return
  const loc = locations.find(l => l.id === parseInt(form.location_id))
  if (loc?.ip_camera_url) {
    startCctvStream(loc.id)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [form.location_id])
```

Replace it with:

```typescript
// When location changes: stop everything, reset photo source selection
useEffect(() => {
  stopCctvPlayer()
  setStream(prev => { prev?.getTracks().forEach(t => t.stop()); return null })
  setPhotoSource(null)
  setCapturedDataUrl(null)
  setPhotoUrl(null)
  setPhotoPath(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [form.location_id])
```

**Step 5: Update `retakePhoto`**

Find `retakePhoto` (around line 194):

```typescript
const retakePhoto = () => {
  setCapturedDataUrl(null)
  setPhotoUrl(null)
  setPhotoPath(null)
  setImgNaturalSize(null)
  setVideoReady(false)
  // If CCTV is available, don't open webcam — the CCTV capture button will be shown
  const loc = locations.find(l => l.id === parseInt(form.location_id))
  if (!loc?.ip_camera_url) startCamera()
}
```

Replace with:

```typescript
const retakePhoto = () => {
  setCapturedDataUrl(null)
  setPhotoUrl(null)
  setPhotoPath(null)
  setImgNaturalSize(null)
  setVideoReady(false)
  const loc = locations.find(l => l.id === parseInt(form.location_id))
  if (loc?.ip_camera_url) {
    // Reset to source selection — let agent choose again
    stopCctvPlayer()
    stream?.getTracks().forEach(t => t.stop())
    setStream(null)
    setPhotoSource(null)
  } else {
    startCamera()
  }
}
```

**Step 6: Commit**

```bash
cd /Users/rajmaha/Sites/SocialMedia
git add frontend/app/admin/visitors/new/page.tsx
git commit -m "feat: add photoSource state and update retake/location-change handlers"
```

---

### Task 2: Update JSX — toggle buttons, gate CCTV, update capture area

**Files:**
- Modify: `frontend/app/admin/visitors/new/page.tsx`

**Step 1: Read the file**

Read the current file to get fresh line numbers after Task 1's changes.

**Step 2: Add toggle buttons above the photo capture area**

Find the right-column section that starts with:

```tsx
{/* ── RIGHT: Visitor Photo + CCTV ── */}
<div className="bg-white rounded-xl border p-5 flex flex-col gap-3">
  <h2 className="font-semibold text-sm text-gray-700 uppercase tracking-wide">Visitor Photo</h2>

  {/* CCTV Live Feed */}
```

Add the toggle buttons BETWEEN the `<h2>` and the CCTV Live Feed block:

```tsx
{/* Photo source toggle — only when location has CCTV and no photo in progress */}
{hasCctv && !photoUrl && !capturedDataUrl && !stream && (
  <div className="flex gap-2">
    <button
      type="button"
      onClick={() => selectPhotoSource('webcam')}
      className={`flex-1 py-2 text-sm rounded-lg border font-medium transition-colors ${
        photoSource === 'webcam'
          ? 'bg-blue-600 text-white border-blue-600'
          : 'text-gray-600 border-gray-200 hover:border-blue-400 hover:text-blue-600'
      }`}>
      📷 Webcam
    </button>
    <button
      type="button"
      onClick={() => selectPhotoSource('cctv')}
      className={`flex-1 py-2 text-sm rounded-lg border font-medium transition-colors ${
        photoSource === 'cctv'
          ? 'bg-blue-600 text-white border-blue-600'
          : 'text-gray-600 border-gray-200 hover:border-blue-400 hover:text-blue-600'
      }`}>
      📹 CCTV
    </button>
  </div>
)}
```

**Step 3: Gate the CCTV Live Feed on `photoSource === 'cctv'`**

Find this block:

```tsx
{/* CCTV Live Feed */}
{form.location_id && locations.find(l => l.id === parseInt(form.location_id))?.ip_camera_url && (
```

Replace the condition so it only shows when CCTV is the selected source:

```tsx
{/* CCTV Live Feed */}
{photoSource === 'cctv' && (
```

Keep everything inside the block unchanged (the player, spinner, error state, divider).

**Step 4: Update the capture area decision tree**

Find this block (the ternary chain at the end of the right column):

```tsx
) : hasCctv ? (
  /* ── CCTV capture prompt ── */
  <div className="flex flex-col gap-2">
    <button type="button"
      onClick={() => captureFromCctv(parseInt(form.location_id))}
      disabled={capturingCctv || cctvStatus === 'starting'}
      className="w-full bg-green-600 text-white px-4 py-3 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2">
      {capturingCctv ? (
        <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Capturing from CCTV…</>
      ) : cctvStatus === 'starting' ? (
        <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Waiting for camera feed…</>
      ) : '📸 Capture Photo from CCTV'}
    </button>
    <button type="button" onClick={startCamera}
      className="text-xs text-gray-400 hover:text-blue-500 text-center py-1">
      Use my webcam instead
    </button>
  </div>

) : (
  /* ── Open camera prompt ── */
  <button type="button" onClick={startCamera}
    className="flex-1 border-2 border-dashed border-gray-300 rounded-lg px-6 py-8 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-500 flex flex-col items-center justify-center gap-2">
    <span className="text-3xl">📷</span>
    <span>Open Camera</span>
  </button>
)}
```

Replace with:

```tsx
) : hasCctv && photoSource === 'cctv' ? (
  /* ── CCTV capture prompt ── */
  <button type="button"
    onClick={() => captureFromCctv(parseInt(form.location_id))}
    disabled={capturingCctv || cctvStatus === 'starting'}
    className="w-full bg-green-600 text-white px-4 py-3 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2">
    {capturingCctv ? (
      <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Capturing from CCTV…</>
    ) : cctvStatus === 'starting' ? (
      <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Waiting for camera feed…</>
    ) : '📸 Capture Photo from CCTV'}
  </button>

) : !hasCctv ? (
  /* ── No CCTV: open webcam prompt ── */
  <button type="button" onClick={startCamera}
    className="flex-1 border-2 border-dashed border-gray-300 rounded-lg px-6 py-8 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-500 flex flex-col items-center justify-center gap-2">
    <span className="text-3xl">📷</span>
    <span>Open Camera</span>
  </button>
) : null}
```

Note: the `null` case covers `hasCctv && photoSource === null` (toggle shown, source not yet chosen) and `hasCctv && photoSource === 'webcam'` (webcam is starting/running, handled by the `stream ?` branch above).

**Step 5: Update the crop-step "Retake" button**

Find this inline retake logic inside the crop step:

```tsx
onClick={() => { setCapturedDataUrl(null); setImgNaturalSize(null); if (!hasCctv) startCamera() }}
```

Replace with a call to `retakePhoto` (which now handles both cases correctly):

```tsx
onClick={retakePhoto}
```

**Step 6: Verify visually**

Run the frontend dev server:
```bash
cd /Users/rajmaha/Sites/SocialMedia/frontend && npm run dev
```

Open http://localhost:3000/admin/visitors/new and check:
1. Select a location with CCTV → two toggle buttons appear (`📷 Webcam` / `📹 CCTV`), nothing starts automatically
2. Click `📹 CCTV` → button turns blue, CCTV stream starts, CCTV live feed appears, capture button shown
3. Click `📷 Webcam` → button turns blue, CCTV stops, browser webcam activates
4. Change location → toggle resets to unselected, stream stops
5. Select a location without CCTV → no toggle, "Open Camera" button shown directly (unchanged)
6. Capture → crop → retake → toggle reappears (for CCTV location)

**Step 7: Commit**

```bash
cd /Users/rajmaha/Sites/SocialMedia
git add frontend/app/admin/visitors/new/page.tsx
git commit -m "feat: webcam/CCTV photo source toggle on check-in form"
```

---

### Task 3: Build verification

**Step 1: Run build**

```bash
cd /Users/rajmaha/Sites/SocialMedia/frontend && npm run build 2>&1 | tail -20
```

Expected: Build completes with no TypeScript errors.

**Step 2: Fix any errors and commit if needed**

```bash
cd /Users/rajmaha/Sites/SocialMedia
git add frontend/app/admin/visitors/new/page.tsx
git commit -m "fix: resolve build issues from photo source toggle"
```
