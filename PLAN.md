## Updated plan (simple-first MVP, optimize later)

You’ll build a **phone-as-sensor PWA** that:

1. Records continuously (in a foreground session).
2. Uses **basic triggers** (motion as default, optional audio energy spike) to decide when to cut a clip.
3. Uploads **event clips only** to the cloud for inference + summaries + storage.
4. Notifies users (Telegram + second device monitoring).
5. Provides a timeline + later retrieval/search.

Two tiers:

* **Free:** limited cloud inference credits (e.g., seconds/minutes analyzed)
* **Paid:** more credits + better limits/retention

---

## Constraints (kept)

* **MVP = PWA foreground** (screen on; best with plugged-in old phone)
* **V1 reliability = native wrapper** (Capacitor) for better long-running behavior + native push later

---

## Core architecture (MVP-first, no early optimization)

### On-device pipeline (PWA)

**1) Capture**

* WebRTC `getUserMedia`
* `MediaRecorder` chunking (e.g., 2–4s chunks)
* **Ring buffer** in memory/IndexedDB to keep last *PRE* seconds (e.g., 10–20s) so clips include “what led up to it”

**2) Triggering (simple v0)**

* **Motion trigger (default)**

  * Downscale frames (e.g., 160×90 or 320×180)
  * Simple frame differencing to compute a “motion score”
  * Trigger when motion score > threshold for N consecutive checks (debounce)
  * Noise guards (MVP-friendly, pick minimal set):
    * Cooldown after trigger (e.g., 20–60s)
    * Minimum motion duration (N consecutive frames)
    * Adaptive background frame (slow update to ignore lighting drift)
    * Global brightness change gate (suppress auto-exposure shifts)
    * Min changed-pixel percentage (avoid tiny flicker)
    * Optional ROI mask to ignore known noisy zones (window/fan)
* **Optional audio energy spike trigger**

  * Compute short-window audio energy (RMS) from mic stream
  * Trigger when energy rises above a threshold (with debounce + cooldown)
* Combined behavior:

  * Trigger if **motion fires** OR **audio spike fires** (if enabled)

**3) Clip builder**

* On trigger:

  * build clip = PRE seconds (from ring buffer) + POST seconds (recorded after trigger)
  * generate basic metadata: timestamp, trigger type (motion/audio), clip length

**4) Upload**

* Upload clip to cloud (Azure Blob) using a secure upload URL
* Create an “event record” in DB with status = `processing`
* Simple upload flow improvements (MVP-friendly):
  * Idempotent event ID per clip (reuse on retries)
  * Retry with backoff; persist pending uploads in IndexedDB
  * Upload + finalize call (mark uploaded); backend can reconcile blobs
  * Include clip duration/size for basic integrity checks
  * Pause/resume on offline/online changes

**5) Local timeline**

* Immediately show “Event detected (processing…)”
* Update later when cloud results arrive

> Note: In this MVP phase, you do **not** do ROI calibration, fancy motion filtering, or preview-frame prechecks. Keep it working end-to-end first.

---

## Cloud pipeline (Azure, FastAPI)

**API (FastAPI)**

* Auth, device registration
* Start/stop session, list events, fetch event results
* Issue **SAS upload URL** for direct-to-Blob uploads
* Enforce credits (free vs paid)

**Storage**

* **Azure Blob Storage**: event clips, thumbnails (optional later), derived JSON
* **Azure Database for PostgreSQL**: users, devices, sessions, events, credits

**Queue**

* **Azure Service Bus** job: `clip_uploaded`

**GPU worker**

* Pull job → download clip → run VLM/multimodal inference:

  * label(s) + confidence
  * short natural-language summary
  * structured tags (optional)
* Write results to Postgres + derived artifacts to Blob
* Mark event as `done`

**Notifications**

* Telegram bot (primary)
* Second signed-in device: WebSocket subscription (near-real-time updates)

---

## Credits + pricing model (keep simple)

* Credits are measured in **seconds analyzed** (recommended).

  * Example: 1 credit = 10 seconds of inference
* Clip length determines credit burn.
* Free tier: monthly allowance
* Paid: higher allowance + longer retention + higher max clip length

---

## MVP milestones (re-ordered to match “get it working first”)

### MVP-1: PWA monitoring session + clip creation (local only)

* Media capture, chunking
* Ring buffer
* Motion trigger (simple)
* Optional audio energy spike trigger
* Clip builder + local event list

### MVP-2: Cloud upload + event timeline sync

* FastAPI: auth + sessions + event records
* SAS uploads to Azure Blob
* Event list API in the frontend (“processing” state)

### MVP-3: Cloud inference worker + results

* Service Bus queue
* GPU worker runs HF VLM
* Store label/summary/confidence
* Frontend updates event cards from “processing” → “classified”

### MVP-4: Notifications + second device monitoring

* Telegram bot on “classified” events
* WebSocket fan-out for monitors watching the same session

### MVP-5 (later): Optimize to reduce spam and cost (your requested shift)

**This is where you add:**

1. Motion “smarts” (ROI, better debounce/cooldown, background subtraction)
2. Low-bandwidth preview-frame pipeline (send 1–3 frames first, cloud decides whether to request full clip)

---

## What you *will* likely need even in MVP (minimal safeguards)

Even without “optimization”, you should still include:

* **Cooldown** after a trigger (e.g., 30s) so you don’t upload 20 clips in a minute
* **Max uploads per hour** per plan (hard limit)
* **Max clip length** per plan (e.g., 20–30s MVP)

These aren’t “fancy optimizations”—they’re basic guardrails to prevent runaway costs.

---

## Development phases (build order)

### Phase 0: Project skeleton

* PWA scaffold + minimal UI
  * App shell with start/stop session control
  * Basic event list placeholder
* FastAPI skeleton + Postgres schema draft
  * Users, devices, sessions, events tables (minimal fields)
  * Auth stub (JWT or session token placeholder)
* Cloud placeholders
  * Azure Blob container(s) defined
  * Service Bus queue name(s) reserved
* Local dev scaffolding
  * Env config files and secrets strategy
  * Basic logging setup (frontend + backend)

### Phase 1: Local capture + trigger

* Media capture, chunking
  * `getUserMedia` setup, constraints, and permission flow
  * `MediaRecorder` chunking cadence (2–4s)
* Ring buffer (30s in memory)
  * Store last N chunks and a few decoded frames for motion checks
* Motion trigger with debounce + cooldown
  * Downscale frames + frame differencing
  * Motion score threshold + consecutive-frame requirement
  * Cooldown timer after a trigger
  * Optional brightness gate and min changed-pixel percentage
* Optional audio spike trigger
  * Web Audio RMS energy window
  * Threshold + debounce
* Clip builder
  * Assemble PRE + POST seconds into a clip
  * Create local metadata (timestamp, trigger type, length)
* Local event list + playback
  * Save clips locally (temporary URL)
  * Basic event cards with playback

### Phase 2: Upload + event sync

* Auth + device registration
  * Device ID provisioning
  * Session start/stop endpoint
* SAS upload URLs
  * Generate SAS for event upload
  * Include container + path conventions
* Upload retries + finalize call
  * Idempotent event ID
  * Retry with exponential backoff
  * Finalize endpoint to mark uploaded
* Event list API and “processing” state
  * Create event record on upload start
  * Frontend polling or lightweight refresh
* Offline/online handling
  * Queue pending uploads in IndexedDB
  * Resume on reconnect

### Phase 3: Inference pipeline

* Service Bus queue `clip_uploaded`
  * Enqueue on finalize
* GPU worker inference + results
  * Download clip
  * Run VLM, produce labels + summary + confidence
  * Persist results to Postgres
* Update event state to `done`
  * Store derived artifacts in Blob (optional thumbnails)
  * Frontend shows classification results

### Phase 4: Notifications + monitoring

* Telegram bot alerts
  * On `done`, send summary + link
* Second-device WebSocket updates
  * Subscribe to session events
  * Live updates for new events and status changes

### Phase 5: Refinement + cost control

* Motion trigger tuning (ROI, better background model)
  * ROI editor + saved masks
  * Background model improvements
* Preview-frame pipeline for selective full-clip upload
  * Send 1–3 frames first
  * Cloud decides to request full clip
* Credit enforcement + tier limits
  * Per-user/month caps
  * Max clip length and max uploads/hour
