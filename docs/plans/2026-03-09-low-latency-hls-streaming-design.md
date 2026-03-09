# Low-Latency HLS Streaming — Design

**Date:** 2026-03-09
**Status:** Approved

## Problem

RTSP→HLS camera streaming has two issues:
1. **Slow startup** (~10s before video appears) — caused by a hardcoded 3s frontend sleep plus a 10s HLS buffer window
2. **High playback latency** (~10s behind live) — caused by large segments, large list size, and re-encoding overhead

## Approach: Tuned HLS + Smart Polling (Approach A)

### Backend changes — `backend/app/routes/visitors.py`

#### 1. Low-latency ffmpeg input flags
Add to the beginning of the ffmpeg command (before `-i`):
```
-fflags nobuffer
-flags low_delay
-analyzeduration 0
-probesize 32
```

#### 2. Codec: copy-first, transcode fallback
- First attempt: `-c:v copy` (zero-cost passthrough if camera outputs H.264)
- If ffmpeg exits within 2s → restart with `-c:v libx264 -preset ultrafast -tune zerolatency`
- Detected via `proc.poll()` after a 2s `time.sleep()`

#### 3. Smaller HLS window
```
-hls_time 1          # was 2
-hls_list_size 3     # was 5
-hls_flags delete_segments+omit_endlist+split_by_time
```

#### 4. New `/stream/ready` endpoint
`GET /visitors/locations/{loc_id}/stream/ready`
Returns `{"ready": true}` when `index.m3u8` exists on disk and contains at least one `.ts` segment reference.
Returns `{"ready": false}` otherwise (no error, just not ready yet).

### Frontend changes — `frontend/app/admin/visitors/cameras/page.tsx`

#### 1. Replace hardcoded sleep with polling
```
// Old
await new Promise(r => setTimeout(r, 3000))
attachPlayer(streamUrl)

// New
poll /stream/ready every 500ms, up to 15 attempts (7.5s timeout)
→ on ready: attachPlayer(streamUrl)
→ on timeout: setStatus('error') with message "Stream took too long to start"
```

#### 2. Tuned hls.js config
```js
new Hls({
  enableWorker: true,
  lowLatencyMode: true,
  liveBackBufferLength: 5,   // don't hold more than 5s behind live
  maxBufferLength: 8,        // reduce from default 30s
  liveSyncDurationCount: 2,  // sync to 2 segments from live edge
})
```

## Expected Outcome

| Metric | Before | After |
|---|---|---|
| Time to first frame | ~10s | ~2–3s |
| Live latency | ~10s | ~3–4s |
| CPU (H.264 cameras) | High (re-encoding) | Near zero (copy mode) |

## Files Changed

- `backend/app/routes/visitors.py` — ffmpeg args, copy/transcode fallback, `/stream/ready` endpoint
- `frontend/app/admin/visitors/cameras/page.tsx` — polling loop, hls.js config
