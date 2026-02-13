import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  type EventResponse,
  listEvents,
  startSession,
  stopSession,
} from './api'
import { getClip, listClips, saveClip, type StoredClip } from './clipStore'
import { uploadPendingClips } from './clipUpload'
import { ensureDeviceId } from './device'
import { SequentialRecorder, type ClipCompleteData } from './sequentialRecorder'
import {
  setBenchmark,
  compareWithBenchmark,
  clearBenchmark,
  createBenchmarkData,
  type TriggerReason,
} from './benchmarkManager'
import {
  logClipAnalysis,
  startLogSession,
  endLogSession,
  getCurrentSessionCounts,
} from './clipLogger'
import {
  useRecordingSettings,
  useMotionDetection,
  useAudioDetection,
} from './hooks'

const statusLabels = {
  idle: 'Idle',
  active: 'Active',
  stopped: 'Stopped',
} as const

type SessionStatus = keyof typeof statusLabels
type CaptureStatus = 'idle' | 'active' | 'error'

const getEnvNumber = (key: string) => {
  const env = (import.meta as ImportMeta & {
    env?: Record<string, string | undefined>
  }).env
  const raw = env?.[key] ?? (typeof process !== 'undefined'
    ? process.env?.[key]
    : undefined)
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

const getPollIntervalMs = () => {
  const envValue = getEnvNumber('VITE_POLL_INTERVAL_MS')
  if (typeof envValue === 'number') return envValue
  const override = (globalThis as { __PING_WATCH_POLL_INTERVAL__?: number })
    .__PING_WATCH_POLL_INTERVAL__
  return typeof override === 'number' ? override : 5000
}

const getUploadIntervalMs = () => {
  const envValue = getEnvNumber('VITE_UPLOAD_INTERVAL_MS')
  if (typeof envValue === 'number') return envValue
  const override = (globalThis as { __PING_WATCH_UPLOAD_INTERVAL__?: number })
    .__PING_WATCH_UPLOAD_INTERVAL__
  return typeof override === 'number' ? override : 10_000
}

const isMediaDisabled = () =>
  (globalThis as { __PING_WATCH_DISABLE_MEDIA__?: boolean })
    .__PING_WATCH_DISABLE_MEDIA__ === true

const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

const formatDuration = (seconds: number) => `${seconds.toFixed(1)}s`

const formatConfidence = (value: number | null | undefined) => {
  if (value === null || value === undefined) return null
  return `${Math.round(value * 100)}%`
}

const generateClipId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `clip_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

const formatTriggers = (triggers: TriggerReason[]) =>
  triggers
    .map((t) => {
      switch (t) {
        case 'motionDelta': return 'motion\u0394'
        case 'motionAbsolute': return 'motion'
        case 'audioDelta': return 'audio\u0394'
        case 'audioAbsolute': return 'loud'
        default: return t
      }
    })
    .join(', ')

function App() {
  // Session state
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [events, setEvents] = useState<EventResponse[]>([])
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedEventId, setCopiedEventId] = useState<string | null>(null)
  const [analysisPrompt, setAnalysisPrompt] = useState('')

  // Clips state
  const [clips, setClips] = useState<StoredClip[]>([])
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [selectedClipUrl, setSelectedClipUrl] = useState<string | null>(null)

  // Sequential recording state
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>('idle')
  const [currentClipIndex, setCurrentClipIndex] = useState(0)
  const [benchmarkClipId, setBenchmarkClipId] = useState<string | null>(null)
  const [sessionCounts, setSessionCounts] = useState({ stored: 0, discarded: 0 })

  // Custom hooks
  const settings = useRecordingSettings()
  const motionDetection = useMotionDetection()
  const audioDetection = useAudioDetection()

  // Refs
  const streamRef = useRef<MediaStream | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const deviceIdRef = useRef<string | null>(null)
  const sequentialRecorderRef = useRef<SequentialRecorder | null>(null)
  const clipUrlRef = useRef<string | null>(null)
  const uploadInFlightRef = useRef(false)
  const isProcessingClipRef = useRef(false)

  // Memoized values
  const lastEvent = useMemo(() => events[events.length - 1], [events])
  const clipStats = useMemo(() => {
    const pending = clips.filter((clip) => !clip.uploaded).length
    const failed = clips.filter((clip) => !clip.uploaded && clip.lastUploadError).length
    return { pending, failed }
  }, [clips])

  const refreshClips = async () => {
    const nextClips = await listClips()
    nextClips.sort((a, b) => b.createdAt - a.createdAt)
    setClips(nextClips)
  }

  const handleClipComplete = useCallback(
    async (data: ClipCompleteData) => {
      const { blob, clipIndex, startTime, metrics } = data
      const resolvedSessionId = sessionIdRef.current
      const resolvedDeviceId = deviceIdRef.current

      if (!resolvedSessionId || !resolvedDeviceId) {
        console.warn('[App] Clip completed but no active session')
        return
      }

      if (isProcessingClipRef.current) {
        console.warn('[App] Already processing a clip, skipping')
        return
      }
      isProcessingClipRef.current = true

      try {
        const clipId = generateClipId()
        const durationSeconds = (Date.now() - startTime) / 1000
        setCurrentClipIndex(clipIndex)

        if (clipIndex === 0) {
          // First clip = benchmark
          const benchmarkData = createBenchmarkData(clipId, metrics)
          setBenchmark(benchmarkData)
          setBenchmarkClipId(clipId)

          await saveClip({
            sessionId: resolvedSessionId,
            deviceId: resolvedDeviceId,
            triggerType: 'benchmark',
            blob,
            mimeType: blob.type || 'video/webm',
            sizeBytes: blob.size,
            durationSeconds,
            isBenchmark: true,
            clipIndex,
            peakMotionScore: metrics.peakMotionScore,
            avgMotionScore: metrics.avgMotionScore,
            motionEventCount: metrics.motionEventCount,
            peakAudioScore: metrics.peakAudioScore,
            avgAudioScore: metrics.avgAudioScore,
          })

          logClipAnalysis({
            clipIndex,
            clipId,
            isBenchmark: true,
            motionScore: metrics.peakMotionScore,
            audioScore: metrics.peakAudioScore,
            decision: 'stored',
            timestamp: Date.now(),
            durationMs: durationSeconds * 1000,
            sizeBytes: blob.size,
          })

          await refreshClips()
          await uploadPendingClips({ sessionId: resolvedSessionId })
          setSessionCounts(getCurrentSessionCounts())
          setEvents(await listEvents(resolvedSessionId))
          return
        }

        // Compare with benchmark
        const comparison = compareWithBenchmark(metrics, {
          motionDeltaThreshold: settings.motionDeltaThreshold,
          motionAbsoluteThreshold: settings.motionAbsoluteThreshold,
          audioDeltaEnabled: settings.audioDeltaEnabled,
          audioDeltaThreshold: settings.audioDeltaThreshold,
          audioAbsoluteEnabled: settings.audioAbsoluteEnabled,
          audioAbsoluteThreshold: settings.audioAbsoluteThreshold,
        })

        logClipAnalysis({
          clipIndex,
          clipId,
          isBenchmark: false,
          motionScore: metrics.peakMotionScore,
          audioScore: metrics.peakAudioScore,
          motionDelta: comparison.motionDelta,
          audioDelta: comparison.audioDelta,
          decision: comparison.shouldStore ? 'stored' : 'discarded',
          timestamp: Date.now(),
          durationMs: durationSeconds * 1000,
          sizeBytes: blob.size,
        })

        if (comparison.shouldStore) {
          const triggerType =
            comparison.triggeredBy.includes('motionDelta') ||
            comparison.triggeredBy.includes('motionAbsolute')
              ? 'motion'
              : 'audio'

          await saveClip({
            sessionId: resolvedSessionId,
            deviceId: resolvedDeviceId,
            triggerType,
            blob,
            mimeType: blob.type || 'video/webm',
            sizeBytes: blob.size,
            durationSeconds,
            isBenchmark: false,
            clipIndex,
            peakMotionScore: metrics.peakMotionScore,
            avgMotionScore: metrics.avgMotionScore,
            motionEventCount: metrics.motionEventCount,
            peakAudioScore: metrics.peakAudioScore,
            avgAudioScore: metrics.avgAudioScore,
            motionDelta: comparison.motionDelta,
            audioDelta: comparison.audioDelta,
            triggeredBy: comparison.triggeredBy,
          })

          await refreshClips()
          await uploadPendingClips({ sessionId: resolvedSessionId })

          const benchmarkData = createBenchmarkData(clipId, metrics)
          setBenchmark(benchmarkData)
          setBenchmarkClipId(clipId)
          setEvents(await listEvents(resolvedSessionId))
        }

        setSessionCounts(getCurrentSessionCounts())
      } catch (err) {
        console.error('[App] Error processing clip:', err)
      } finally {
        isProcessingClipRef.current = false
      }
    },
    [settings]
  )

  const startCapture = async () => {
    if (isMediaDisabled()) {
      setCaptureStatus('error')
      return
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Media capture unavailable')
      setCaptureStatus('error')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      })
      streamRef.current = stream
      setCaptureStatus('active')

      motionDetection.setup(stream)
      audioDetection.setup(stream)

      const recorder = new SequentialRecorder({
        stream,
        clipDurationMs: settings.clipDuration * 1000,
        getMotionScore: motionDetection.getScore,
        getAudioScore: audioDetection.getScore,
        motionEventThreshold: settings.motionAbsoluteThreshold,
        onClipComplete: handleClipComplete,
        onError: (err) => {
          console.error('[App] Recorder error:', err)
          setError('Recording error: ' + err.message)
        },
      })

      sequentialRecorderRef.current = recorder
      recorder.start()
    } catch (err) {
      console.error(err)
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setError('Camera permission denied')
      } else {
        setError('Unable to access camera')
      }
      setCaptureStatus('error')
    }
  }

  const stopCapture = () => {
    sequentialRecorderRef.current?.stop()
    sequentialRecorderRef.current = null
    motionDetection.cleanup()
    audioDetection.cleanup()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCaptureStatus('idle')
  }

  const handleStart = async () => {
    setIsBusy(true)
    setError(null)

    try {
      const resolvedDeviceId = await ensureDeviceId()
      const session = await startSession(resolvedDeviceId, analysisPrompt || undefined)
      setSessionId(session.session_id)
      sessionIdRef.current = session.session_id
      deviceIdRef.current = session.device_id
      setSessionStatus('active')

      startLogSession(session.session_id)
      setCurrentClipIndex(0)
      setBenchmarkClipId(null)
      clearBenchmark()
      setSessionCounts({ stored: 0, discarded: 0 })

      setEvents(await listEvents(session.session_id))
      await startCapture()
      await refreshClips()
    } catch (err) {
      console.error(err)
      setError('Unable to start session')
    } finally {
      setIsBusy(false)
    }
  }

  const handleStop = async () => {
    if (!sessionId) return

    setIsBusy(true)
    setError(null)

    try {
      await stopSession(sessionId)
      setSessionStatus('stopped')
      sessionIdRef.current = null
      endLogSession()
      stopCapture()
    } catch (err) {
      console.error(err)
      setError('Unable to stop session')
    } finally {
      setIsBusy(false)
    }
  }

  const handlePreviewClip = async (clipId: string) => {
    const clip = await getClip(clipId)
    if (!clip) return
    if (clipUrlRef.current) URL.revokeObjectURL(clipUrlRef.current)
    const url = URL.createObjectURL(clip.blob)
    clipUrlRef.current = url
    setSelectedClipUrl(url)
    setSelectedClipId(clipId)
  }

  const handleUploadClips = async () => {
    if (!sessionId) {
      setError('Start a session before uploading')
      return
    }
    setIsBusy(true)
    setError(null)
    try {
      await uploadPendingClips({ sessionId })
      await refreshClips()
      setEvents(await listEvents(sessionId))
    } catch (err) {
      console.error(err)
      setError('Unable to upload clips')
    } finally {
      setIsBusy(false)
    }
  }

  const handleCopyEventId = async (eventId: string) => {
    try {
      if (!navigator.clipboard?.writeText) {
        setError('Clipboard unavailable')
        return
      }
      await navigator.clipboard.writeText(eventId)
      setCopiedEventId(eventId)
    } catch (err) {
      console.error(err)
      setError('Unable to copy event id')
    }
  }

  // Poll for events
  useEffect(() => {
    if (sessionStatus !== 'active' || !sessionId) return

    let cancelled = false
    const refresh = async () => {
      try {
        const nextEvents = await listEvents(sessionId)
        if (!cancelled) setEvents(nextEvents)
      } catch (err) {
        console.error(err)
      }
    }

    const interval = setInterval(refresh, getPollIntervalMs())
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [sessionId, sessionStatus])

  // Upload clips periodically
  useEffect(() => {
    if (sessionStatus !== 'active' || !sessionId) return

    let cancelled = false
    const tick = async () => {
      if (cancelled || uploadInFlightRef.current) return
      uploadInFlightRef.current = true
      try {
        await uploadPendingClips({ sessionId })
        await refreshClips()
      } catch (err) {
        console.error(err)
      } finally {
        uploadInFlightRef.current = false
      }
    }

    void tick()
    const interval = window.setInterval(tick, getUploadIntervalMs())
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [sessionId, sessionStatus])

  // Handle online event
  useEffect(() => {
    if (sessionStatus !== 'active' || !sessionId) return

    const onOnline = () => {
      void uploadPendingClips({ sessionId }).then(refreshClips).catch(console.error)
    }

    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [sessionId, sessionStatus])

  // Clear copied event ID after timeout
  useEffect(() => {
    if (!copiedEventId) return
    const timeout = window.setTimeout(() => setCopiedEventId(null), 1500)
    return () => window.clearTimeout(timeout)
  }, [copiedEventId])

  // Initial clip load and cleanup
  useEffect(() => {
    void refreshClips()
    return () => {
      if (clipUrlRef.current) URL.revokeObjectURL(clipUrlRef.current)
    }
  }, [])

  // Update recorder when settings change
  useEffect(() => {
    sequentialRecorderRef.current?.setClipDuration(settings.clipDuration * 1000)
  }, [settings.clipDuration])

  useEffect(() => {
    sequentialRecorderRef.current?.setMotionEventThreshold(settings.motionAbsoluteThreshold)
  }, [settings.motionAbsoluteThreshold])

  const captureLabel = (() => {
    if (isMediaDisabled()) return 'Capture disabled'
    if (captureStatus === 'active') return 'Capture active'
    if (captureStatus === 'error') return 'Capture error'
    if (sessionStatus === 'active') return 'Capture starting'
    return 'Capture idle'
  })()

  return (
    <div className="app">
      <header className="app-header">
        <h1>Ping Watch</h1>
        <p className="app-tagline">Phone-as-sensor monitoring</p>
      </header>

      <main className="app-main">
        <section className="status-card" aria-label="Session status">
          <div className="status-row">
            <span className="status-label">Session</span>
            <span className="status-value">{statusLabels[sessionStatus]}</span>
          </div>
          <div className="status-row">
            <span className="status-label">Capture</span>
            <span className="status-value">{captureLabel}</span>
          </div>
          <div className="status-row">
            <span className="status-label">Current clip</span>
            <span className="status-value">#{currentClipIndex}</span>
          </div>
          <div className="status-row">
            <span className="status-label">Benchmark</span>
            <span className="status-value">{benchmarkClipId ? 'Clip #0' : 'Not set'}</span>
          </div>
          <div className="status-row">
            <span className="status-label">Session stats</span>
            <span className="status-value">
              Stored: {sessionCounts.stored} / Discarded: {sessionCounts.discarded}
            </span>
          </div>
          <div className="status-row">
            <span className="status-label">Motion / Audio</span>
            <span className="status-value">
              {motionDetection.currentScore.toFixed(3)} / {audioDetection.currentScore.toFixed(3)}
            </span>
          </div>
          <div className="status-row">
            <span className="status-label">Last event</span>
            <span className="status-value">{lastEvent ? lastEvent.event_id : 'No events yet'}</span>
          </div>
        </section>

        <section className="analysis-prompt-section" aria-label="Analysis prompt">
          <label className="analysis-prompt-label">
            <span>Analysis prompt (optional)</span>
            <textarea
              className="analysis-prompt-input"
              placeholder="Add custom instructions for the VLM analysis, e.g., 'Focus on detecting people near the door' or 'Alert for any animal activity'"
              value={analysisPrompt}
              onChange={(e) => setAnalysisPrompt(e.target.value)}
              disabled={sessionStatus === 'active'}
              rows={3}
            />
          </label>
        </section>

        <div className="controls">
          <button
            className="primary"
            type="button"
            onClick={handleStart}
            disabled={sessionStatus === 'active' || isBusy}
          >
            Start monitoring
          </button>
          <button
            className="secondary"
            type="button"
            onClick={handleStop}
            disabled={sessionStatus !== 'active' || isBusy}
          >
            Stop
          </button>
          <button
            className="secondary"
            type="button"
            onClick={handleUploadClips}
            disabled={!sessionId || isBusy}
          >
            Upload stored clips
          </button>
        </div>

        {error && <p className="error-banner">{error}</p>}

        <section className="clip-controls" aria-label="Sequential recording controls">
          <h2>Recording Settings</h2>
          <div className="motion-grid">
            <label className="motion-field">
              <span>Clip duration (s)</span>
              <input
                type="range"
                min={5}
                max={20}
                step={1}
                value={settings.clipDuration}
                aria-label="Clip duration seconds"
                onChange={(e) => settings.setClipDuration(Number(e.target.value))}
              />
              <span className="motion-value">{settings.clipDuration}s</span>
            </label>
          </div>

          <h3>Motion Detection</h3>
          <div className="motion-grid">
            <label className="motion-field">
              <span>Motion delta threshold</span>
              <input
                type="range"
                min={0.01}
                max={0.3}
                step={0.01}
                value={settings.motionDeltaThreshold}
                aria-label="Motion delta threshold"
                onChange={(e) => settings.setMotionDeltaThreshold(Number(e.target.value))}
              />
              <span className="motion-value">{settings.motionDeltaThreshold.toFixed(2)}</span>
            </label>
            <label className="motion-field">
              <span>Motion absolute threshold</span>
              <input
                type="range"
                min={0.01}
                max={0.3}
                step={0.01}
                value={settings.motionAbsoluteThreshold}
                aria-label="Motion absolute threshold"
                onChange={(e) => settings.setMotionAbsoluteThreshold(Number(e.target.value))}
              />
              <span className="motion-value">{settings.motionAbsoluteThreshold.toFixed(2)}</span>
            </label>
          </div>

          <h3>Audio Detection (Optional)</h3>
          <div className="motion-grid">
            <label className="motion-field motion-toggle">
              <span>Audio delta comparison</span>
              <input
                type="checkbox"
                checked={settings.audioDeltaEnabled}
                aria-label="Enable audio delta"
                onChange={(e) => settings.setAudioDeltaEnabled(e.target.checked)}
              />
            </label>
            {settings.audioDeltaEnabled && (
              <label className="motion-field">
                <span>Audio delta threshold</span>
                <input
                  type="range"
                  min={0.01}
                  max={0.5}
                  step={0.01}
                  value={settings.audioDeltaThreshold}
                  aria-label="Audio delta threshold"
                  onChange={(e) => settings.setAudioDeltaThreshold(Number(e.target.value))}
                />
                <span className="motion-value">{settings.audioDeltaThreshold.toFixed(2)}</span>
              </label>
            )}
            <label className="motion-field motion-toggle">
              <span>Loud sound detection</span>
              <input
                type="checkbox"
                checked={settings.audioAbsoluteEnabled}
                aria-label="Enable loud sound detection"
                onChange={(e) => settings.setAudioAbsoluteEnabled(e.target.checked)}
              />
            </label>
            {settings.audioAbsoluteEnabled && (
              <label className="motion-field">
                <span>Loud threshold</span>
                <input
                  type="range"
                  min={0.05}
                  max={0.5}
                  step={0.01}
                  value={settings.audioAbsoluteThreshold}
                  aria-label="Audio absolute threshold"
                  onChange={(e) => settings.setAudioAbsoluteThreshold(Number(e.target.value))}
                />
                <span className="motion-value">{settings.audioAbsoluteThreshold.toFixed(2)}</span>
              </label>
            )}
          </div>
        </section>

        <section className="events">
          <div className="events-header">
            <h2>Recent events</h2>
            <span className="events-meta">{events.length} captured</span>
          </div>
          {events.length === 0 ? (
            <p className="events-empty">No clips captured yet.</p>
          ) : (
            <ul className="events-list">
              {events.map((event) => {
                const confidence = formatConfidence(event.confidence)
                const isCopied = copiedEventId === event.event_id
                return (
                  <li key={event.event_id} className="event-item">
                    <div>
                      <div className="event-header">
                        <div className="event-id-row">
                          <span className="event-id">{event.event_id}</span>
                          <button
                            type="button"
                            className={`event-copy${isCopied ? ' copied' : ''}`}
                            onClick={() => handleCopyEventId(event.event_id)}
                          >
                            {isCopied ? 'Copied' : 'Copy ID'}
                          </button>
                        </div>
                        <span className="event-trigger">{event.trigger_type}</span>
                      </div>
                      {event.summary && <p className="event-summary">{event.summary}</p>}
                      {(event.label || confidence) && (
                        <div className="event-meta">
                          {event.label && <span className="event-label">{event.label}</span>}
                          {confidence && <span className="event-confidence">{confidence}</span>}
                        </div>
                      )}
                    </div>
                    <span className={`event-status status-${event.status}`}>{event.status}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="clip-timeline">
          <div className="clip-header">
            <h2>Stored clips</h2>
            <span className="events-meta">
              {clips.length} stored · {clipStats.pending} pending
              {clipStats.failed ? ` · ${clipStats.failed} failed` : ''}
            </span>
          </div>
          {clips.length === 0 ? (
            <p className="events-empty">No stored clips yet.</p>
          ) : (
            <ul className="clip-list">
              {clips.map((clip) => (
                <li key={clip.id} className="clip-item">
                  <div>
                    <div className="clip-id">
                      {clip.id}
                      {clip.isBenchmark && <span className="clip-badge benchmark">Benchmark</span>}
                    </div>
                    <div className="clip-meta">
                      <span>{formatDuration(clip.durationSeconds)}</span>
                      <span>{formatBytes(clip.sizeBytes)}</span>
                      <span>{clip.triggerType}</span>
                      <span>{clip.uploaded ? 'uploaded' : 'pending'}</span>
                      {clip.peakMotionScore !== undefined && (
                        <span>peak motion: {clip.peakMotionScore.toFixed(3)}</span>
                      )}
                      {clip.peakAudioScore !== undefined && (
                        <span>peak audio: {clip.peakAudioScore.toFixed(3)}</span>
                      )}
                      {clip.triggeredBy && clip.triggeredBy.length > 0 && (
                        <span className="clip-triggers">
                          triggered: {formatTriggers(clip.triggeredBy)}
                        </span>
                      )}
                      {!clip.uploaded && clip.lastUploadError && (
                        <span className="clip-error">{clip.lastUploadError}</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => handlePreviewClip(clip.id)}
                    aria-label={`Preview ${clip.id}`}
                  >
                    Preview
                  </button>
                </li>
              ))}
            </ul>
          )}
          {selectedClipUrl && (
            <div className="clip-preview">
              <div className="clip-preview-header">
                <span>Preview: {selectedClipId}</span>
              </div>
              <video data-testid="clip-preview" src={selectedClipUrl} controls />
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

export default App
