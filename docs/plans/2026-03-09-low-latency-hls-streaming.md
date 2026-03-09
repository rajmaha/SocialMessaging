# Low-Latency HLS Streaming Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce RTSP→HLS stream startup from ~10s to ~2–3s and live latency from ~10s to ~3–4s by tuning ffmpeg parameters, adding a copy-first codec strategy, and replacing the frontend's hardcoded sleep with manifest polling.

**Architecture:** Backend (`visitors.py`) gains low-latency ffmpeg flags, a copy→transcode fallback launcher, and a new `/stream/ready` polling endpoint. The frontend `CameraPlayer` component replaces its blind 3-second wait with a 500ms-interval poll against that endpoint, and hls.js is tuned to stay closer to the live edge.

**Tech Stack:** FastAPI (Python), subprocess/ffmpeg, hls.js (frontend), Next.js App Router (TypeScript)

---

### Task 1: Add low-latency ffmpeg flags and reduce segment size

**Files:**
- Modify: `backend/app/routes/visitors.py` — `start_camera_stream` function (~line 189)

**Step 1: Open the file and locate the `cmd` list in `start_camera_stream`**

Find this block (around line 204):
```python
cmd = [
    "ffmpeg", "-y",
    "-rtsp_transport", "tcp",
    "-i", loc.ip_camera_url,
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "zerolatency",
    "-g", "30",
    "-sc_threshold", "0",
    "-f", "hls",
    "-hls_time", "2",
    "-hls_list_size", "5",
    "-hls_flags", "delete_segments+omit_endlist",
    os.path.join(out_dir, "index.m3u8"),
]
```

**Step 2: Replace the entire `start_camera_stream` function**

Replace from `@router.post("/locations/{loc_id}/stream/start")` to the end of that function with:

```python
import time  # add at top of file if not already imported

def _build_ffmpeg_cmd(rtsp_url: str, out_dir: str, codec: str = "copy") -> list:
    """Build the ffmpeg command for low-latency HLS output.
    codec: 'copy' for passthrough, 'transcode' for libx264 re-encoding fallback.
    """
    base = [
        "ffmpeg", "-y",
        # Low-latency input flags
        "-fflags", "nobuffer",
        "-flags", "low_delay",
        "-analyzeduration", "0",
        "-probesize", "32",
        "-rtsp_transport", "tcp",
        "-i", rtsp_url,
    ]

    if codec == "copy":
        video_flags = ["-c:v", "copy"]
    else:
        video_flags = [
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-tune", "zerolatency",
            "-g", "30",
            "-sc_threshold", "0",
        ]

    hls_flags = [
        "-an",                  # no audio (avoids sync issues in copy mode)
        "-f", "hls",
        "-hls_time", "1",       # 1s segments (was 2)
        "-hls_list_size", "3",  # 3s total buffer (was 5 = 10s)
        "-hls_flags", "delete_segments+omit_endlist+split_by_time",
        os.path.join(out_dir, "index.m3u8"),
    ]

    return base + video_flags + hls_flags


@router.post("/locations/{loc_id}/stream/start")
def start_camera_stream(loc_id: int, db: Session = Depends(get_db)):
    """Start a live HLS stream from the location's RTSP camera via ffmpeg.

    Tries codec copy first (zero CPU if camera outputs H.264). If ffmpeg
    exits within 2 seconds (incompatible codec), restarts with libx264.
    """
    loc = db.query(VisitorLocation).filter(VisitorLocation.id == loc_id).first()
    if not loc or not loc.ip_camera_url:
        raise HTTPException(status_code=404, detail="No camera configured for this location")

    # If already running, return its URL
    existing = _stream_processes.get(loc_id)
    if existing and existing.poll() is None:
        return {"ok": True, "stream_url": f"/hls/{loc_id}/index.m3u8", "already_running": True}

    out_dir = os.path.join(HLS_OUTPUT_DIR, str(loc_id))
    os.makedirs(out_dir, exist_ok=True)

    try:
        # Attempt 1: copy (passthrough — fastest, zero CPU)
        cmd = _build_ffmpeg_cmd(loc.ip_camera_url, out_dir, codec="copy")
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(2)

        if proc.poll() is not None:
            # Copy failed (camera likely uses non-H.264 codec) — fall back to transcode
            logger.info("Stream copy mode failed for loc %s, retrying with libx264", loc_id)
            cmd = _build_ffmpeg_cmd(loc.ip_camera_url, out_dir, codec="transcode")
            proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        _stream_processes[loc_id] = proc
        return {"ok": True, "stream_url": f"/hls/{loc_id}/index.m3u8", "already_running": False}

    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="ffmpeg not installed on server")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to start stream: {exc}")
```

**Step 3: Add `import time` at the top of the file if missing**

Check the existing imports at the top of `visitors.py`. If `import time` is not there, add it after the stdlib imports block.

**Step 4: Manual test via Swagger**

- Open http://localhost:8000/docs
- Call `POST /visitors/locations/{loc_id}/stream/start`
- Check that it returns `{"ok": true, "stream_url": "/hls/{id}/index.m3u8"}`
- Wait 3s, then check `/tmp/hls/{loc_id}/` exists and contains `.ts` files

**Step 5: Commit**

```bash
git add backend/app/routes/visitors.py
git commit -m "perf: low-latency ffmpeg flags + copy-first codec strategy"
```

---

### Task 2: Add `/stream/ready` polling endpoint

**Files:**
- Modify: `backend/app/routes/visitors.py` — add new endpoint after `camera_stream_status`

**Step 1: Add the endpoint**

After the `camera_stream_status` function (around line 249), add:

```python
@router.get("/locations/{loc_id}/stream/ready")
def camera_stream_ready(loc_id: int):
    """Return ready=true once the HLS manifest has at least one .ts segment.

    The frontend polls this every 500ms instead of using a hardcoded sleep.
    Returns 200 always (never 404) so the frontend can poll without error handling.
    """
    manifest_path = os.path.join(HLS_OUTPUT_DIR, str(loc_id), "index.m3u8")
    if not os.path.exists(manifest_path):
        return {"ready": False}
    try:
        with open(manifest_path) as f:
            content = f.read()
        # Ready when at least one transport stream segment is listed
        ready = ".ts" in content
    except OSError:
        ready = False
    return {"ready": ready}
```

**Step 2: Manual test**

- Start a stream via Swagger (`POST /visitors/locations/{id}/stream/start`)
- Immediately call `GET /visitors/locations/{id}/stream/ready` — should return `{"ready": false}`
- After 2–3s call again — should return `{"ready": true}`

**Step 3: Commit**

```bash
git add backend/app/routes/visitors.py
git commit -m "feat: add /stream/ready endpoint for frontend polling"
```

---

### Task 3: Replace hardcoded sleep with manifest polling in frontend

**Files:**
- Modify: `frontend/app/admin/visitors/cameras/page.tsx` — `CameraPlayer` component, `startStream` function (~line 21)

**Step 1: Locate `startStream` in `CameraPlayer`**

Find this block:
```typescript
const startStream = async () => {
  setStatus('starting')
  setErrorMsg('')
  try {
    const res = await api.post(`/visitors/locations/${locationId}/stream/start`)
    const streamUrl = `${API_URL}${res.data.stream_url}`
    // Wait a moment for ffmpeg to generate the first segments
    await new Promise(r => setTimeout(r, 3000))
    attachPlayer(streamUrl)
  } catch (e: unknown) {
    ...
  }
}
```

**Step 2: Replace `startStream` with polling version**

```typescript
const startStream = async () => {
  setStatus('starting')
  setErrorMsg('')
  try {
    const res = await api.post(`/visitors/locations/${locationId}/stream/start`)
    const streamUrl = `${API_URL}${res.data.stream_url}`

    // Poll /stream/ready every 500ms instead of a hardcoded sleep.
    // Max 15 attempts = 7.5s timeout.
    const MAX_POLLS = 15
    const POLL_INTERVAL_MS = 500
    let ready = false

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
      try {
        const readyRes = await api.get(`/visitors/locations/${locationId}/stream/ready`)
        if (readyRes.data.ready) {
          ready = true
          break
        }
      } catch {
        // ignore transient poll errors, keep trying
      }
    }

    if (!ready) {
      setStatus('error')
      setErrorMsg('Stream took too long to start. Check camera connection.')
      return
    }

    attachPlayer(streamUrl)
  } catch (e: unknown) {
    const err = e as { response?: { data?: { detail?: string } } }
    setStatus('error')
    setErrorMsg(err?.response?.data?.detail || 'Failed to start stream')
  }
}
```

**Step 3: Verify the change visually**

Run `npm run dev` in the frontend directory and open the cameras page. Start a stream — status should say "Connecting…" and video should appear as soon as segments are ready (typically 2–3s), not after a fixed 3s wait.

**Step 4: Commit**

```bash
git add frontend/app/admin/visitors/cameras/page.tsx
git commit -m "perf: replace hardcoded 3s sleep with /stream/ready polling"
```

---

### Task 4: Tune hls.js config to stay close to live edge

**Files:**
- Modify: `frontend/app/admin/visitors/cameras/page.tsx` — `attachPlayer` function, hls.js instantiation (~line 48)

**Step 1: Find the hls.js instantiation in `attachPlayer`**

```typescript
const hls = new Hls({ enableWorker: true, lowLatencyMode: true })
```

**Step 2: Replace with tuned config**

```typescript
const hls = new Hls({
  enableWorker: true,
  lowLatencyMode: true,
  liveBackBufferLength: 5,    // discard segments more than 5s behind live
  maxBufferLength: 8,         // don't buffer more than 8s ahead (default 30)
  liveSyncDurationCount: 2,   // sync to 2 segments from live edge (default 3)
})
```

**Step 3: Verify**

Open the cameras page, start a stream, and watch it play. The video should be within 3–4 seconds of live (vs. the previous 10+s). You can verify by pointing a phone at a clock and comparing the time displayed on screen vs. wall clock.

**Step 4: Commit**

```bash
git add frontend/app/admin/visitors/cameras/page.tsx
git commit -m "perf: tune hls.js config for lower live latency"
```

---

### Task 5: Build verification

**Step 1: Run frontend build to ensure no TypeScript errors**

```bash
cd frontend && npm run build
```

Expected: build completes with no errors (warnings about console.log are fine).

**Step 2: Commit if any lint fixes were needed**

```bash
git add -A
git commit -m "fix: resolve any build issues from streaming changes"
```
