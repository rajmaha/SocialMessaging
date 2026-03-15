# Webcam / CCTV Photo Source Toggle — Design

**Date:** 2026-03-09
**Status:** Approved

## Problem

The check-in form (`/admin/visitors/new`) only offers CCTV photo capture when the selected location has an RTSP camera configured. Agents who prefer to use the laptop/desktop webcam — or whose CCTV stream is temporarily unavailable — have no option to switch sources. The webcam path exists in code but is hidden whenever a CCTV URL is present.

## Approach: On-Demand Source Toggle

Show a two-button toggle (`📷 Webcam` / `📹 CCTV`) when the selected location has a CCTV URL configured. Neither source starts until the agent actively picks one. When no CCTV URL is configured the toggle is hidden and the webcam opens directly (unchanged behaviour).

---

## Behaviour

| Location config | Current behaviour | New behaviour |
|---|---|---|
| Has `ip_camera_url` | Auto-starts CCTV stream; CCTV capture only | Toggle shown; no auto-start; agent picks source |
| No `ip_camera_url` | Webcam only | Webcam only (unchanged) |

### Source selection flow

1. Agent selects a location with a CCTV URL → toggle appears, nothing starts
2. Agent clicks **`📹 CCTV`** → CCTV stream starts on-demand → existing CCTV capture UI renders
3. Agent clicks **`📷 Webcam`** → browser webcam activates → existing webcam capture UI renders
4. Agent changes location → toggle resets to unselected; running stream stops; active webcam stops

---

## UI

```
[ Visit Details ]
  Location: [ Main Entrance ▾ ]

  Photo Source:  [📷 Webcam]  [📹 CCTV]
                 ↑ only shown when location has ip_camera_url

  [ capture area — renders based on selected source ]
```

Active button is highlighted (e.g. blue border/background). Unselected button is neutral.

---

## State changes

New state variable in the check-in form component:

```typescript
type PhotoSource = 'webcam' | 'cctv' | null
const [photoSource, setPhotoSource] = useState<PhotoSource>(null)
```

- `null` — toggle shown but nothing selected yet (no capture area visible)
- `'cctv'` — CCTV stream started, CCTV capture UI shown
- `'webcam'` — browser webcam started, webcam capture UI shown

Resets to `null` when location changes.

---

## Files Changed

| File | Change |
|---|---|
| `frontend/app/admin/visitors/new/page.tsx` | Add `photoSource` state; add toggle buttons; gate CCTV auto-start on `photoSource === 'cctv'`; show webcam UI when `photoSource === 'webcam'` or location has no CCTV |
