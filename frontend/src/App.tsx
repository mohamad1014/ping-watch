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
import { computeMotionScore } from './motion'
import { computeAudioRms } from './audio'

const statusLabels = {
  idle: 'Idle',
  active: 'Active',
  stopped: 'Stopped',
} as const

type SessionStatus = keyof typeof statusLabels
type CaptureStatus = 'idle' | 'active' | 'error'

const getPollIntervalMs = () => {
  const override = (globalThis as { __PING_WATCH_POLL_INTERVAL__?: number })
    .__PING_WATCH_POLL_INTERVAL__
  if (typeof override === 'number') {
    return override
  }

  const envValue = import.meta.env.VITE_POLL_INTERVAL_MS
  return envValue ? Number(envValue) : 5000
}

const getUploadIntervalMs = () => {
  const override = (globalThis as { __PING_WATCH_UPLOAD_INTERVAL__?: number })
    .__PING_WATCH_UPLOAD_INTERVAL__
  if (typeof override === 'number') {
    return override
  }

  const envValue = import.meta.env.VITE_UPLOAD_INTERVAL_MS
  return envValue ? Number(envValue) : 10_000
}

// LocalStorage keys for sequential recording settings
const CLIP_DURATION_KEY = 'ping-watch:clip-duration'
const MOTION_DELTA_KEY = 'ping-watch:motion-delta'
const MOTION_ABSOLUTE_KEY = 'ping-watch:motion-absolute'
const AUDIO_DELTA_ENABLED_KEY = 'ping-watch:audio-delta-enabled'
const AUDIO_DELTA_KEY = 'ping-watch:audio-delta'
const AUDIO_ABSOLUTE_ENABLED_KEY = 'ping-watch:audio-absolute-enabled'
const AUDIO_ABSOLUTE_KEY = 'ping-watch:audio-absolute'

const readStoredNumber = (key: string, fallback: number) => {
  try {
    const value = localStorage.getItem(key)
    if (value === null) {
      return fallback
    }
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

const readStoredBoolean = (key: string, fallback: boolean) => {
  try {
    const value = localStorage.getItem(key)
    if (value === null) {
      return fallback
    }
    return value === 'true'
  } catch {
    return fallback
  }
}

const isMediaDisabled = () =>
  (globalThis as { __PING_WATCH_DISABLE_MEDIA__?: boolean })
    .__PING_WATCH_DISABLE_MEDIA__ === true ||
  import.meta.env.VITE_DISABLE_MEDIA === 'true'

const formatBytes = (value: number) => {
  if (value < 1024) {
    return `${value} B`
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

const formatDuration = (seconds: number) => `${seconds.toFixed(1)}s`

function formatConfidence(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return null
  }
  return `${Math.round(value * 100)}%`
}

const generateClipId = () => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }
  return `clip_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

const formatTriggers = (triggers: TriggerReason[]) => {
  return triggers.map((t) => {
    switch (t) {
      case 'motionDelta':
        return 'motion\u0394'
      case 'motionAbsolute':
        return 'motion'
      case 'audioDelta':
        return 'audio\u0394'
      case 'audioAbsolute':
        return 'loud'
      default:
        return t
    }
  }).join(', ')
}

// Frame dimensions for motion detection
const FRAME_WIDTH = 160
const FRAME_HEIGHT = 90
const MOTION_DIFF_THRESHOLD = 30

function App() {
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [, setDeviceId] = useState<string | null>(null)
  const [events, setEvents] = useState<EventResponse[]>([])
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedEventId, setCopiedEventId] = useState<string | null>(null)
  const [clips, setClips] = useState<StoredClip[]>([])
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [selectedClipUrl, setSelectedClipUrl] = useState<string | null>(null)

  // Sequential recording settings
  const [clipDuration, setClipDuration] = useState(() => {
    const override = (globalThis as { __PING_WATCH_CLIP_DURATION_MS__?: number })
      .__PING_WATCH_CLIP_DURATION_MS__
    if (typeof override === 'number') {
      return override / 1000
    }
    return readStoredNumber(CLIP_DURATION_KEY, 10)
  })

  // Motion thresholds
  const [motionDeltaThreshold, setMotionDeltaThreshold] = useState(() =>
    readStoredNumber(MOTION_DELTA_KEY, 0.05)
  )
  const [motionAbsoluteThreshold, setMotionAbsoluteThreshold] = useState(() =>
    readStoredNumber(MOTION_ABSOLUTE_KEY, 0.03)
  )

  // Audio thresholds (optional)
  const [audioDeltaEnabled, setAudioDeltaEnabled] = useState(() =>
    readStoredBoolean(AUDIO_DELTA_ENABLED_KEY, false)
  )
  const [audioDeltaThreshold, setAudioDeltaThreshold] = useState(() =>
    readStoredNumber(AUDIO_DELTA_KEY, 0.1)
  )
  const [audioAbsoluteEnabled, setAudioAbsoluteEnabled] = useState(() =>
    readStoredBoolean(AUDIO_ABSOLUTE_ENABLED_KEY, false)
  )
  const [audioAbsoluteThreshold, setAudioAbsoluteThreshold] = useState(() =>
    readStoredNumber(AUDIO_ABSOLUTE_KEY, 0.15)
  )

  // Sequential recording state
  const [currentClipIndex, setCurrentClipIndex] = useState(0)
  const [benchmarkClipId, setBenchmarkClipId] = useState<string | null>(null)
  const [sessionCounts, setSessionCounts] = useState({ stored: 0, discarded: 0 })

  // Real-time metrics display
  const [currentMotionScore, setCurrentMotionScore] = useState(0)
  const [currentAudioScore, setCurrentAudioScore] = useState(0)

  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>('idle')
  const streamRef = useRef<MediaStream | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const deviceIdRef = useRef<string | null>(null)
  const sequentialRecorderRef = useRef<SequentialRecorder | null>(null)
  const clipUrlRef = useRef<string | null>(null)
  const uploadInFlightRef = useRef(false)
  const isProcessingClipRef = useRef(false)

  // Real-time motion detection refs
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const canvasCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const prevFrameRef = useRef<Uint8ClampedArray | null>(null)
  const motionScoreRef = useRef(0)

  // Real-time audio detection refs
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioDataRef = useRef<Float32Array | null>(null)
  const audioScoreRef = useRef(0)

  const lastEvent = useMemo(() => events[events.length - 1], [events])
  const clipStats = useMemo(() => {
    const pending = clips.filter((clip) => !clip.uploaded).length
    const failed = clips.filter((clip) => !clip.uploaded && clip.lastUploadError)
      .length
    return { pending, failed }
  }, [clips])

  const refreshClips = async () => {
    const nextClips = await listClips()
    nextClips.sort((a, b) => b.createdAt - a.createdAt)
    setClips(nextClips)
  }

  // Get current motion score (called by SequentialRecorder)
  const getMotionScore = useCallback(() => {
    const video = videoRef.current
    const ctx = canvasCtxRef.current

    if (!video || !ctx || video.readyState < 2) {
      return motionScoreRef.current
    }

    try {
      ctx.drawImage(video, 0, 0, FRAME_WIDTH, FRAME_HEIGHT)
      const imageData = ctx.getImageData(0, 0, FRAME_WIDTH, FRAME_HEIGHT)
      const currFrame = imageData.data

      if (prevFrameRef.current) {
        const score = computeMotionScore(prevFrameRef.current, currFrame, MOTION_DIFF_THRESHOLD)
        motionScoreRef.current = score
        setCurrentMotionScore(score)
      }

      prevFrameRef.current = new Uint8ClampedArray(currFrame)
    } catch (err) {
      console.warn('[App] Motion detection error:', err)
    }

    return motionScoreRef.current
  }, [])

  // Get current audio score (called by SequentialRecorder)
  const getAudioScore = useCallback(() => {
    const analyser = analyserRef.current
    const audioData = audioDataRef.current

    if (!analyser || !audioData) {
      return audioScoreRef.current
    }

    try {
      analyser.getFloatTimeDomainData(audioData)
      const rms = computeAudioRms(audioData)
      audioScoreRef.current = rms
      setCurrentAudioScore(rms)
    } catch (err) {
      console.warn('[App] Audio detection error:', err)
    }

    return audioScoreRef.current
  }, [])

  const handleClipComplete = useCallback(async (data: ClipCompleteData) => {
    const { blob, clipIndex, startTime, metrics } = data
    const resolvedSessionId = sessionIdRef.current
    const resolvedDeviceId = deviceIdRef.current

    if (!resolvedSessionId || !resolvedDeviceId) {
      console.warn('[App] Clip completed but no active session')
      return
    }

    // Prevent concurrent clip processing
    if (isProcessingClipRef.current) {
      console.warn('[App] Already processing a clip, skipping')
      return
    }
    isProcessingClipRef.current = true

    try {
      console.log(`[App] Processing clip #${clipIndex}`, {
        sizeBytes: blob.size,
        startTime,
        metrics,
      })

      const clipId = generateClipId()
      const durationSeconds = (Date.now() - startTime) / 1000

      // Update current clip index
      setCurrentClipIndex(clipIndex)

      if (clipIndex === 0) {
        // First clip = benchmark
        const benchmarkData = createBenchmarkData(clipId, metrics)
        setBenchmark(benchmarkData)
        setBenchmarkClipId(clipId)

        // Save and upload benchmark clip
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

        // Update session counts
        setSessionCounts(getCurrentSessionCounts())

        const nextEvents = await listEvents(resolvedSessionId)
        setEvents(nextEvents)
        return
      }

      // Compare with benchmark using multi-criteria
      const comparison = compareWithBenchmark(metrics, {
        motionDeltaThreshold,
        motionAbsoluteThreshold,
        audioDeltaEnabled,
        audioDeltaThreshold,
        audioAbsoluteEnabled,
        audioAbsoluteThreshold,
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
        // Determine trigger type based on what triggered
        const triggerType = comparison.triggeredBy.includes('motionDelta') ||
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

        // Update benchmark to this clip
        const benchmarkData = createBenchmarkData(clipId, metrics)
        setBenchmark(benchmarkData)
        setBenchmarkClipId(clipId)

        const nextEvents = await listEvents(resolvedSessionId)
        setEvents(nextEvents)
      }
      // else: clip discarded (already logged)

      // Update session counts
      setSessionCounts(getCurrentSessionCounts())
    } catch (err) {
      console.error('[App] Error processing clip:', err)
    } finally {
      isProcessingClipRef.current = false
    }
  }, [motionDeltaThreshold, motionAbsoluteThreshold, audioDeltaEnabled, audioDeltaThreshold, audioAbsoluteEnabled, audioAbsoluteThreshold])

  const handleStart = async () => {
    setIsBusy(true)
    setError(null)

    try {
      const resolvedDeviceId = await ensureDeviceId()
      setDeviceId(resolvedDeviceId)
      const session = await startSession(resolvedDeviceId)
      setDeviceId(session.device_id)
      setSessionId(session.session_id)
      sessionIdRef.current = session.session_id
      deviceIdRef.current = session.device_id
      setSessionStatus('active')

      // Initialize logging session
      startLogSession(session.session_id)

      // Reset sequential recording state
      setCurrentClipIndex(0)
      setBenchmarkClipId(null)
      clearBenchmark()
      setSessionCounts({ stored: 0, discarded: 0 })

      const nextEvents = await listEvents(session.session_id)
      setEvents(nextEvents)
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
    if (!sessionId) {
      return
    }

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
    if (!clip) {
      return
    }
    if (clipUrlRef.current) {
      URL.revokeObjectURL(clipUrlRef.current)
    }
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
      const nextEvents = await listEvents(sessionId)
      setEvents(nextEvents)
    } catch (err) {
      console.error(err)
      setError('Unable to upload clips')
    } finally {
      setIsBusy(false)
    }
  }

  const setupMotionDetection = (stream: MediaStream) => {
    // Create hidden video element for frame capture
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    video.autoplay = true
    videoRef.current = video

    // Create canvas for frame extraction
    const canvas = document.createElement('canvas')
    canvas.width = FRAME_WIDTH
    canvas.height = FRAME_HEIGHT
    canvasRef.current = canvas

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    canvasCtxRef.current = ctx

    // Start video playback
    video.play().catch((err) => {
      console.warn('[App] Video play failed:', err)
    })

    console.log('[App] Motion detection setup complete')
  }

  const setupAudioDetection = (stream: MediaStream) => {
    try {
      const AudioContextClass = window.AudioContext ||
        (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextClass) {
        console.warn('[App] AudioContext not available')
        return
      }

      const audioContext = new AudioContextClass()
      audioContextRef.current = audioContext

      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)

      analyserRef.current = analyser
      audioDataRef.current = new Float32Array(analyser.fftSize)

      console.log('[App] Audio detection setup complete')
    } catch (err) {
      console.warn('[App] Audio detection setup failed:', err)
    }
  }

  const cleanupMotionDetection = () => {
    if (videoRef.current) {
      videoRef.current.srcObject = null
      videoRef.current = null
    }
    canvasRef.current = null
    canvasCtxRef.current = null
    prevFrameRef.current = null
    motionScoreRef.current = 0
    setCurrentMotionScore(0)
  }

  const cleanupAudioDetection = () => {
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
    analyserRef.current = null
    audioDataRef.current = null
    audioScoreRef.current = 0
    setCurrentAudioScore(0)
  }

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

      // Setup real-time motion and audio detection
      setupMotionDetection(stream)
      setupAudioDetection(stream)

      // Create sequential recorder with score getters
      const recorder = new SequentialRecorder({
        stream,
        clipDurationMs: clipDuration * 1000,
        getMotionScore,
        getAudioScore,
        motionEventThreshold: motionAbsoluteThreshold,
        onClipComplete: handleClipComplete,
        onError: (err) => {
          console.error('[App] Sequential recorder error:', err)
          setError('Recording error: ' + err.message)
        },
      })

      sequentialRecorderRef.current = recorder
      recorder.start()

      console.log('[App] Sequential recording started', {
        clipDurationMs: clipDuration * 1000,
      })
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
    // Stop sequential recorder
    if (sequentialRecorderRef.current) {
      void sequentialRecorderRef.current.stop()
      sequentialRecorderRef.current = null
    }

    // Cleanup motion/audio detection
    cleanupMotionDetection()
    cleanupAudioDetection()

    // Stop media stream
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCaptureStatus('idle')
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
    if (sessionStatus !== 'active' || !sessionId) {
      return
    }

    let cancelled = false

    const refresh = async () => {
      try {
        const nextEvents = await listEvents(sessionId)
        if (!cancelled) {
          setEvents(nextEvents)
        }
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
    if (sessionStatus !== 'active' || !sessionId) {
      return
    }

    let cancelled = false

    const tick = async () => {
      if (cancelled || uploadInFlightRef.current) {
        return
      }

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
    if (sessionStatus !== 'active' || !sessionId) {
      return
    }

    const onOnline = () => {
      void uploadPendingClips({
        sessionId,
      }).then(refreshClips).catch(console.error)
    }

    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('online', onOnline)
    }
  }, [sessionId, sessionStatus])

  // Clear copied event ID after timeout
  useEffect(() => {
    if (!copiedEventId) {
      return
    }

    const timeout = window.setTimeout(() => {
      setCopiedEventId(null)
    }, 1500)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [copiedEventId])

  // Initial clip load and cleanup
  useEffect(() => {
    void refreshClips()
    return () => {
      if (clipUrlRef.current) {
        URL.revokeObjectURL(clipUrlRef.current)
      }
    }
  }, [])

  // Update sequential recorder when clip duration changes
  useEffect(() => {
    if (sequentialRecorderRef.current) {
      sequentialRecorderRef.current.setClipDuration(clipDuration * 1000)
    }
  }, [clipDuration])

  // Update motion event threshold in recorder
  useEffect(() => {
    if (sequentialRecorderRef.current) {
      sequentialRecorderRef.current.setMotionEventThreshold(motionAbsoluteThreshold)
    }
  }, [motionAbsoluteThreshold])

  // Persist settings to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(CLIP_DURATION_KEY, String(clipDuration))
      localStorage.setItem(MOTION_DELTA_KEY, String(motionDeltaThreshold))
      localStorage.setItem(MOTION_ABSOLUTE_KEY, String(motionAbsoluteThreshold))
      localStorage.setItem(AUDIO_DELTA_ENABLED_KEY, String(audioDeltaEnabled))
      localStorage.setItem(AUDIO_DELTA_KEY, String(audioDeltaThreshold))
      localStorage.setItem(AUDIO_ABSOLUTE_ENABLED_KEY, String(audioAbsoluteEnabled))
      localStorage.setItem(AUDIO_ABSOLUTE_KEY, String(audioAbsoluteThreshold))
    } catch {
      // Ignore persistence failures (private mode or storage disabled).
    }
  }, [clipDuration, motionDeltaThreshold, motionAbsoluteThreshold, audioDeltaEnabled, audioDeltaThreshold, audioAbsoluteEnabled, audioAbsoluteThreshold])

  const captureLabel = (() => {
    if (isMediaDisabled()) {
      return 'Capture disabled'
    }
    if (captureStatus === 'active') {
      return 'Capture active'
    }
    if (captureStatus === 'error') {
      return 'Capture error'
    }
    if (sessionStatus === 'active') {
      return 'Capture starting'
    }
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
            <span className="status-value">
              {benchmarkClipId ? `Clip #0` : 'Not set'}
            </span>
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
              {currentMotionScore.toFixed(3)} / {currentAudioScore.toFixed(3)}
            </span>
          </div>
          <div className="status-row">
            <span className="status-label">Last event</span>
            <span className="status-value">
              {lastEvent ? lastEvent.event_id : 'No events yet'}
            </span>
          </div>
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

        {error ? <p className="error-banner">{error}</p> : null}

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
                value={clipDuration}
                aria-label="Clip duration seconds"
                onChange={(event) =>
                  setClipDuration(Number(event.target.value))
                }
              />
              <span className="motion-value">{clipDuration}s</span>
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
                value={motionDeltaThreshold}
                aria-label="Motion delta threshold"
                onChange={(event) =>
                  setMotionDeltaThreshold(Number(event.target.value))
                }
              />
              <span className="motion-value">{motionDeltaThreshold.toFixed(2)}</span>
            </label>
            <label className="motion-field">
              <span>Motion absolute threshold</span>
              <input
                type="range"
                min={0.01}
                max={0.3}
                step={0.01}
                value={motionAbsoluteThreshold}
                aria-label="Motion absolute threshold"
                onChange={(event) =>
                  setMotionAbsoluteThreshold(Number(event.target.value))
                }
              />
              <span className="motion-value">{motionAbsoluteThreshold.toFixed(2)}</span>
            </label>
          </div>

          <h3>Audio Detection (Optional)</h3>
          <div className="motion-grid">
            <label className="motion-field motion-toggle">
              <span>Audio delta comparison</span>
              <input
                type="checkbox"
                checked={audioDeltaEnabled}
                aria-label="Enable audio delta"
                onChange={(event) =>
                  setAudioDeltaEnabled(event.target.checked)
                }
              />
            </label>
            {audioDeltaEnabled && (
              <label className="motion-field">
                <span>Audio delta threshold</span>
                <input
                  type="range"
                  min={0.01}
                  max={0.5}
                  step={0.01}
                  value={audioDeltaThreshold}
                  aria-label="Audio delta threshold"
                  onChange={(event) =>
                    setAudioDeltaThreshold(Number(event.target.value))
                  }
                />
                <span className="motion-value">{audioDeltaThreshold.toFixed(2)}</span>
              </label>
            )}
            <label className="motion-field motion-toggle">
              <span>Loud sound detection</span>
              <input
                type="checkbox"
                checked={audioAbsoluteEnabled}
                aria-label="Enable loud sound detection"
                onChange={(event) =>
                  setAudioAbsoluteEnabled(event.target.checked)
                }
              />
            </label>
            {audioAbsoluteEnabled && (
              <label className="motion-field">
                <span>Loud threshold</span>
                <input
                  type="range"
                  min={0.05}
                  max={0.5}
                  step={0.01}
                  value={audioAbsoluteThreshold}
                  aria-label="Audio absolute threshold"
                  onChange={(event) =>
                    setAudioAbsoluteThreshold(Number(event.target.value))
                  }
                />
                <span className="motion-value">{audioAbsoluteThreshold.toFixed(2)}</span>
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
                      {event.summary ? (
                        <p className="event-summary">{event.summary}</p>
                      ) : null}
                      {event.label || confidence ? (
                        <div className="event-meta">
                          {event.label ? (
                            <span className="event-label">{event.label}</span>
                          ) : null}
                          {confidence ? (
                            <span className="event-confidence">{confidence}</span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <span className={`event-status status-${event.status}`}>
                      {event.status}
                    </span>
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
                      {clip.isBenchmark ? (
                        <span className="clip-badge benchmark">Benchmark</span>
                      ) : null}
                    </div>
                    <div className="clip-meta">
                      <span>{formatDuration(clip.durationSeconds)}</span>
                      <span>{formatBytes(clip.sizeBytes)}</span>
                      <span>{clip.triggerType}</span>
                      <span>{clip.uploaded ? 'uploaded' : 'pending'}</span>
                      {clip.peakMotionScore !== undefined ? (
                        <span>peak motion: {clip.peakMotionScore.toFixed(3)}</span>
                      ) : null}
                      {clip.peakAudioScore !== undefined ? (
                        <span>peak audio: {clip.peakAudioScore.toFixed(3)}</span>
                      ) : null}
                      {clip.triggeredBy && clip.triggeredBy.length > 0 ? (
                        <span className="clip-triggers">
                          triggered: {formatTriggers(clip.triggeredBy)}
                        </span>
                      ) : null}
                      {!clip.uploaded && clip.lastUploadError ? (
                        <span className="clip-error">
                          {clip.lastUploadError}
                        </span>
                      ) : null}
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
          {selectedClipUrl ? (
            <div className="clip-preview">
              <div className="clip-preview-header">
                <span>Preview: {selectedClipId}</span>
              </div>
              <video
                data-testid="clip-preview"
                src={selectedClipUrl}
                controls
              />
            </div>
          ) : null}
        </section>
      </main>
    </div>
  )
}

export default App
