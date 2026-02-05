# Ping Watch Frontend

React + TypeScript + Vite application for motion and audio detection monitoring.

## Quick Start

```bash
npm install
npm run dev      # Start dev server
npm test -- --run  # Run tests
```

## Architecture

### Sequential Clip Recording

The app records continuous video in fixed-length clips (default 10 seconds). The first clip establishes a baseline (benchmark), and subsequent clips are analyzed against it using multiple criteria:

```
Session Start
    │
    ├─► getUserMedia (video + audio)
    ├─► Setup motion detection (hidden video + canvas)
    ├─► Setup audio detection (AudioContext + AnalyserNode)
    │
    ▼
Sequential Recorder starts
    │
    ├─► Clip #0 completes ──► Set as BENCHMARK ──► Store & Upload
    │
    └─► Clip #N completes ──► Compare with benchmark
                                  │
                          ┌───────┴───────┐
                          │               │
                    Triggers met    No triggers
                          │               │
                          ▼               ▼
                    Store & Upload    Discard
                    Update benchmark  (logged only)
```

### Detection Criteria

A clip is stored if **any** enabled criterion is triggered:

| Criterion | Description | Default |
|-----------|-------------|---------|
| Motion Delta | Change from benchmark peak motion | 0.05 |
| Motion Absolute | Peak motion exceeds threshold | 0.02 |
| Audio Delta | Change from benchmark peak audio | 0.1 (optional) |
| Audio Absolute | Peak audio exceeds threshold | 0.3 (optional) |

### Core Modules

| Module | Purpose |
|--------|---------|
| `sequentialRecorder.ts` | Records independent clips with real-time metrics sampling |
| `benchmarkManager.ts` | Multi-criteria comparison against baseline |
| `clipLogger.ts` | Session-based logging for debugging |
| `clipStore.ts` | IndexedDB storage for clips |
| `clipUpload.ts` | Upload with retry logic |
| `motion.ts` | Frame-diff motion scoring |
| `audio.ts` | RMS audio level scoring |
| `device.ts` | Device registration |
| `api.ts` | REST API client |

### Data Flow

1. **Recording**: `SequentialRecorder` creates fresh MediaRecorder per clip
2. **Sampling**: Motion/audio scores sampled every 500ms during recording
3. **Completion**: Clip completes → metrics finalized → comparison runs
4. **Decision**: If triggers met → save to IndexedDB → upload to backend
5. **Logging**: All decisions logged for debugging

## Configuration

Settings are persisted to localStorage:

| Setting | Key | Default | Range |
|---------|-----|---------|-------|
| Clip Duration | `ping-watch:clip-duration` | 10s | 5-20s |
| Motion Delta | `ping-watch:motion-delta` | 0.05 | 0.01-0.5 |
| Motion Absolute | `ping-watch:motion-absolute` | 0.02 | 0.01-0.2 |
| Audio Delta | `ping-watch:audio-delta` | 0.1 | 0.01-0.5 |
| Audio Absolute | `ping-watch:audio-absolute` | 0.3 | 0.05-1.0 |

## Project Structure

```
src/
├── App.tsx              # Main component (session, UI, orchestration)
├── App.css              # Styles
├── main.tsx             # Entry point
├── api.ts               # Backend API client
├── device.ts            # Device registration
├── sequentialRecorder.ts # Core recording logic
├── benchmarkManager.ts  # Clip comparison logic
├── clipStore.ts         # IndexedDB storage
├── clipUpload.ts        # Upload management
├── clipLogger.ts        # Session logging
├── clipAnalyzer.ts      # Video analysis utilities
├── motion.ts            # Motion detection
├── audio.ts             # Audio detection
└── *.test.ts            # Test files
```

## Testing

```bash
npm test -- --run        # Run all tests
npm test -- --watch      # Watch mode
npm test -- motion.test  # Run specific test file
```

Tests use Vitest with jsdom and fake-indexeddb for browser API mocking.

## Environment Variables

Primary configuration (Vite environment variables):

- `VITE_POLL_INTERVAL_MS` — event polling interval (ms).
- `VITE_UPLOAD_INTERVAL_MS` — upload retry interval (ms).
- `VITE_DISABLE_MEDIA` — skip getUserMedia/MediaRecorder capture (useful for tests/E2E).

Runtime flags for testing/debug (set on `globalThis`):

- `__PING_WATCH_DISABLE_MEDIA__` - Skip getUserMedia for headless testing
- `__PING_WATCH_CLIP_DURATION_MS__` - Override clip duration
- `__PING_WATCH_POLL_INTERVAL__` - Event polling interval
- `__PING_WATCH_UPLOAD_INTERVAL__` - Upload retry interval

Env values take precedence over runtime globals, and both fall back to defaults.

## PWA Support

Production builds register a service worker and expose a web manifest for installability.
The manifest lives at `frontend/public/manifest.webmanifest`, and icons are in `frontend/public/`.
