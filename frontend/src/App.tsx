import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  type EventResponse,
  listEvents,
  startSession,
  stopSession,
} from './api'
import { ClipRingBuffer } from './clipBuffer'
import { assembleClip } from './clipAssembler'
import { getClip, listClips, saveClip, type StoredClip } from './clipStore'
import { uploadPendingClips } from './clipUpload'
import { ensureDeviceId } from './device'
import {
  applyMotionGates,
  computeMotionMetricsInRegion,
  startMotionTrigger,
} from './motion'
import { computeAudioRms, startAudioTrigger } from './audio'

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

const MOTION_DIFF_THRESHOLD = 30
const MOTION_MIN_SCORE = 0.02
const MOTION_BRIGHTNESS_GATE = 40

const AUDIO_ENABLED_KEY = 'ping-watch:audio-enabled'
const AUDIO_THRESHOLD_KEY = 'ping-watch:audio-threshold'
const AUDIO_COOLDOWN_KEY = 'ping-watch:audio-cooldown'
const MOTION_THRESHOLD_KEY = 'ping-watch:motion-threshold'
const MOTION_COOLDOWN_KEY = 'ping-watch:motion-cooldown'
const MOTION_ROI_INSET_KEY = 'ping-watch:motion-roi-inset'
const CLIP_PRE_SECONDS_KEY = 'ping-watch:clip-pre-seconds'
const CLIP_POST_SECONDS_KEY = 'ping-watch:clip-post-seconds'

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

function App() {
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [events, setEvents] = useState<EventResponse[]>([])
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedEventId, setCopiedEventId] = useState<string | null>(null)
  const [clips, setClips] = useState<StoredClip[]>([])
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [selectedClipUrl, setSelectedClipUrl] = useState<string | null>(null)
  const [motionThreshold, setMotionThreshold] = useState(() =>
    readStoredNumber(MOTION_THRESHOLD_KEY, 0.06)
  )
  const [motionCooldown, setMotionCooldown] = useState(() =>
    readStoredNumber(MOTION_COOLDOWN_KEY, 15)
  )
  const [roiInsetPercent, setRoiInsetPercent] = useState(() =>
    readStoredNumber(MOTION_ROI_INSET_KEY, 0)
  )
  const [audioEnabled, setAudioEnabled] = useState(() =>
    readStoredBoolean(AUDIO_ENABLED_KEY, false)
  )
  const [audioThreshold, setAudioThreshold] = useState(() =>
    readStoredNumber(AUDIO_THRESHOLD_KEY, 0.25)
  )
  const [audioCooldown, setAudioCooldown] = useState(() =>
    readStoredNumber(AUDIO_COOLDOWN_KEY, 10)
  )
  const [audioLevel, setAudioLevel] = useState(0)
  const [clipPreSeconds, setClipPreSeconds] = useState(() => {
    const override = (globalThis as { __PING_WATCH_PRE_MS__?: number })
      .__PING_WATCH_PRE_MS__
    if (typeof override === 'number') {
      return override / 1000
    }
    return readStoredNumber(CLIP_PRE_SECONDS_KEY, 2)
  })
  const [clipPostSeconds, setClipPostSeconds] = useState(() => {
    const override = (globalThis as { __PING_WATCH_POST_MS__?: number })
      .__PING_WATCH_POST_MS__
    if (typeof override === 'number') {
      return override / 1000
    }
    return readStoredNumber(CLIP_POST_SECONDS_KEY, 2)
  })
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>('idle')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const deviceIdRef = useRef<string | null>(null)
  const motionStopRef = useRef<(() => void) | null>(null)
  const audioStopRef = useRef<(() => void) | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const clipBuffer = useMemo(
    () =>
      new ClipRingBuffer({
        windowMs: clipPreSeconds * 1000 + clipPostSeconds * 1000 + 2000,
      }),
    [clipPreSeconds, clipPostSeconds]
  )
  const bufferRef = useRef(clipBuffer)
  const clipUrlRef = useRef<string | null>(null)
  const uploadInFlightRef = useRef(false)
  const chunkTimerRef = useRef<number | null>(null)

  // Update buffer ref when clip lengths change
  useEffect(() => {
    bufferRef.current = clipBuffer
  }, [clipBuffer])

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
      stopCapture()
    } catch (err) {
      console.error(err)
      setError('Unable to stop session')
    } finally {
      setIsBusy(false)
    }
  }

  const handleCreateEvent = async (triggerType: 'motion' | 'audio' = 'motion') => {
    const resolvedSessionId = sessionIdRef.current ?? sessionId
    const resolvedDeviceId = deviceIdRef.current ?? deviceId
    if (!resolvedSessionId || !resolvedDeviceId) {
      setError('Start a session before creating events')
      return
    }

    setIsBusy(true)
    setError(null)

    try {
      const triggerMs = Date.now()
      const postMs = clipPostSeconds * 1000
      if (postMs > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, postMs))
      }

      const bufferChunks = bufferRef.current.getChunks()
      const assembled = assembleClip({
        chunks: bufferChunks,
        triggerMs,
        preMs: clipPreSeconds * 1000,
        postMs,
        fallbackMime: recorderRef.current?.mimeType || 'video/webm',
      })

      if (!assembled) {
        setError('Unable to assemble clip')
        return
      }

      let durationSeconds = assembled?.durationSeconds ?? 0
      let clipMime = assembled?.mimeType ?? 'video/webm'
      let clipSizeBytes = assembled?.sizeBytes ?? 0

      const clipBlob =
        assembled?.blob ??
        new Blob([`ping-watch:${triggerType}:${Date.now()}`], { type: clipMime })

      if (!assembled?.blob) {
        clipMime = clipBlob.type || 'video/webm'
        clipSizeBytes = clipBlob.size
      }

      await saveClip({
        sessionId: resolvedSessionId,
        deviceId: resolvedDeviceId,
        triggerType,
        blob: clipBlob,
        mimeType: clipMime,
        sizeBytes: clipSizeBytes,
        durationSeconds,
      })

      await refreshClips()
      await uploadPendingClips({ sessionId: resolvedSessionId })
      const nextEvents = await listEvents(resolvedSessionId)
      setEvents(nextEvents)
    } catch (err) {
      console.error(err)
      setError('Unable to create event')
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

      const preferredTypes = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ]
      const mimeType = preferredTypes.find((type) =>
        MediaRecorder.isTypeSupported(type)
      )
      const startRecorder = () => {
        if (!streamRef.current) return

        const recorder = new MediaRecorder(
          streamRef.current,
          mimeType ? { mimeType } : undefined
        )
        recorderRef.current = recorder

        const chunkStartTime = Date.now()
        recorder.addEventListener('stop', () => {
          // Recorder stopped, will be handled by stop event
        })

        recorder.addEventListener('dataavailable', (event) => {
          if (event.data.size > 0) {
            bufferRef.current.addChunk(event.data, chunkStartTime)
          }
        })

        recorder.start()
      }

      const restartRecorder = () => {
        if (
          recorderRef.current &&
          recorderRef.current.state === 'recording'
        ) {
          recorderRef.current.stop()
        }
        // Start new recorder after a brief delay to ensure stop completes
        setTimeout(() => {
          if (streamRef.current) {
            startRecorder()
          }
        }, 50)
      }

      // Start the first recorder
      startRecorder()

      // Set up timer to restart recorder every second
      chunkTimerRef.current = window.setInterval(restartRecorder, 1000)

      startMotionMonitoring(stream)
      startAudioMonitoring(stream)
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
    motionStopRef.current?.()
    motionStopRef.current = null
    stopAudioMonitoring()

    if (chunkTimerRef.current !== null) {
      clearInterval(chunkTimerRef.current)
      chunkTimerRef.current = null
    }

    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
    recorderRef.current = null

    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    bufferRef.current.clear()
    setCaptureStatus('idle')
  }

  const startMotionMonitoring = (stream: MediaStream) => {
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    void video.play().catch(() => undefined)

    const canvas = document.createElement('canvas')
    const width = 160
    const height = 90
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    let previous: Uint8ClampedArray | null = null

    if (!ctx) {
      return
    }

    const getScore = () => {
      if (video.readyState < 2) {
        return 0
      }
      ctx.drawImage(video, 0, 0, width, height)
      const data = ctx.getImageData(0, 0, width, height).data
      if (!previous) {
        previous = data
        return 0
      }
      const insetX = Math.floor((roiInsetPercent / 100) * width)
      const insetY = Math.floor((roiInsetPercent / 100) * height)
      const metrics = computeMotionMetricsInRegion(
        previous,
        data,
        MOTION_DIFF_THRESHOLD,
        {
          x: insetX,
          y: insetY,
          width: width - insetX * 2,
          height: height - insetY * 2,
          frameWidth: width,
          frameHeight: height,
        }
      )
      previous = data
      return applyMotionGates(metrics, {
        minScore: Math.max(MOTION_MIN_SCORE, motionThreshold),
        brightnessThreshold: MOTION_BRIGHTNESS_GATE,
      })
    }

    const trigger = startMotionTrigger({
      getScore,
      intervalMs: 500,
      threshold: motionThreshold,
      consecutive: 2,
      cooldownMs: motionCooldown * 1000,
      onTrigger: () => {
        void handleCreateEvent('motion')
      },
    })
    motionStopRef.current = trigger.stop
  }

  const stopAudioMonitoring = () => {
    audioStopRef.current?.()
    audioStopRef.current = null
    if (audioContextRef.current) {
      void audioContextRef.current.close()
      audioContextRef.current = null
    }
    setAudioLevel(0)
  }

  const startAudioMonitoring = (stream: MediaStream) => {
    if (!audioEnabled) {
      return
    }

    if (stream.getAudioTracks().length === 0) {
      return
    }

    const AudioContextConstructor =
      window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

    if (!AudioContextConstructor) {
      return
    }

    stopAudioMonitoring()

    const audioContext = new AudioContextConstructor()
    audioContextRef.current = audioContext
    const source = audioContext.createMediaStreamSource(stream)
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)

    const buffer = new Float32Array(analyser.fftSize)

    void audioContext.resume()

    const trigger = startAudioTrigger({
      getScore: () => {
        analyser.getFloatTimeDomainData(buffer)
        const score = computeAudioRms(buffer)
        setAudioLevel(Math.min(1, score))
        return score
      },
      intervalMs: 250,
      threshold: audioThreshold,
      consecutive: 2,
      cooldownMs: audioCooldown * 1000,
      onTrigger: () => {
        void handleCreateEvent('audio')
      },
    })

    audioStopRef.current = () => {
      trigger.stop()
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

  useEffect(() => {
    void refreshClips()
    return () => {
      if (clipUrlRef.current) {
        URL.revokeObjectURL(clipUrlRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (sessionStatus !== 'active' || !streamRef.current) {
      return
    }

    motionStopRef.current?.()
    startMotionMonitoring(streamRef.current)
  }, [motionThreshold, motionCooldown, roiInsetPercent, sessionStatus])

  useEffect(() => {
    if (sessionStatus !== 'active' || !streamRef.current) {
      stopAudioMonitoring()
      return
    }

    stopAudioMonitoring()
    if (audioEnabled) {
      startAudioMonitoring(streamRef.current)
    }
  }, [audioEnabled, audioThreshold, audioCooldown, sessionStatus])

  useEffect(() => {
    try {
      localStorage.setItem(MOTION_THRESHOLD_KEY, String(motionThreshold))
      localStorage.setItem(MOTION_COOLDOWN_KEY, String(motionCooldown))
      localStorage.setItem(MOTION_ROI_INSET_KEY, String(roiInsetPercent))
      localStorage.setItem(AUDIO_ENABLED_KEY, String(audioEnabled))
      localStorage.setItem(AUDIO_THRESHOLD_KEY, String(audioThreshold))
      localStorage.setItem(AUDIO_COOLDOWN_KEY, String(audioCooldown))
      localStorage.setItem(CLIP_PRE_SECONDS_KEY, String(clipPreSeconds))
      localStorage.setItem(CLIP_POST_SECONDS_KEY, String(clipPostSeconds))
    } catch {
      // Ignore persistence failures (private mode or storage disabled).
    }
  }, [
    motionThreshold,
    motionCooldown,
    roiInsetPercent,
    audioEnabled,
    audioThreshold,
    audioCooldown,
    clipPreSeconds,
    clipPostSeconds,
  ])

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
            onClick={() => handleCreateEvent('motion')}
            disabled={sessionStatus !== 'active' || isBusy}
          >
            Create event
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

        <section className="motion-controls" aria-label="Motion controls">
          <h2>Motion controls</h2>
          <div className="motion-grid">
            <label className="motion-field">
              <span>Motion threshold</span>
              <input
                type="range"
                min={0.02}
                max={0.3}
                step={0.01}
                value={motionThreshold}
                aria-label="Motion threshold"
                onChange={(event) =>
                  setMotionThreshold(Number(event.target.value))
                }
              />
              <span className="motion-value">{motionThreshold.toFixed(2)}</span>
            </label>
            <label className="motion-field">
              <span>Cooldown (s)</span>
              <input
                type="range"
                min={5}
                max={60}
                step={1}
                value={motionCooldown}
                aria-label="Motion cooldown"
                onChange={(event) =>
                  setMotionCooldown(Number(event.target.value))
                }
              />
              <span className="motion-value">{motionCooldown}s</span>
            </label>
            <label className="motion-field">
              <span>ROI inset (%)</span>
              <input
                type="range"
                min={0}
                max={40}
                step={2}
                value={roiInsetPercent}
                aria-label="ROI inset"
                onChange={(event) =>
                  setRoiInsetPercent(Number(event.target.value))
                }
              />
              <span className="motion-value">{roiInsetPercent}%</span>
            </label>
          </div>
        </section>

        <section className="audio-controls" aria-label="Audio controls">
          <h2>Audio controls</h2>
          <div className="motion-grid">
            <label className="motion-field motion-toggle">
              <span>Audio trigger</span>
              <input
                type="checkbox"
                checked={audioEnabled}
                aria-label="Audio trigger"
                onChange={(event) => setAudioEnabled(event.target.checked)}
              />
            </label>
            <label className="motion-field">
              <span>Audio level</span>
              <meter
                aria-label="Audio level"
                min={0}
                max={1}
                low={0.15}
                high={0.35}
                optimum={0.1}
                value={audioLevel}
              />
              <span className="motion-value">
                {audioLevel.toFixed(2)}
              </span>
            </label>
            <label className="motion-field">
              <span>Audio threshold</span>
              <input
                type="range"
                min={0.05}
                max={0.8}
                step={0.01}
                value={audioThreshold}
                aria-label="Audio threshold"
                onChange={(event) =>
                  setAudioThreshold(Number(event.target.value))
                }
                disabled={!audioEnabled}
              />
              <span className="motion-value">{audioThreshold.toFixed(2)}</span>
            </label>
            <label className="motion-field">
              <span>Audio cooldown (s)</span>
              <input
                type="range"
                min={5}
                max={60}
                step={1}
                value={audioCooldown}
                aria-label="Audio cooldown"
                onChange={(event) =>
                  setAudioCooldown(Number(event.target.value))
                }
                disabled={!audioEnabled}
              />
              <span className="motion-value">{audioCooldown}s</span>
            </label>
          </div>
        </section>

        <section className="clip-controls" aria-label="Clip length controls">
          <h2>Clip length</h2>
          <div className="motion-grid">
            <label className="motion-field">
              <span>Before trigger (s)</span>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={clipPreSeconds}
                aria-label="Clip pre-roll seconds"
                onChange={(event) =>
                  setClipPreSeconds(Number(event.target.value))
                }
              />
              <span className="motion-value">{clipPreSeconds}s</span>
            </label>
            <label className="motion-field">
              <span>After trigger (s)</span>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={clipPostSeconds}
                aria-label="Clip post-roll seconds"
                onChange={(event) =>
                  setClipPostSeconds(Number(event.target.value))
                }
              />
              <span className="motion-value">{clipPostSeconds}s</span>
            </label>
            <label className="motion-field">
              <span>Total clip length</span>
              <span className="motion-value">
                {clipPreSeconds + clipPostSeconds}s
              </span>
            </label>
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
                    <div className="clip-id">{clip.id}</div>
                    <div className="clip-meta">
                      <span>{formatDuration(clip.durationSeconds)}</span>
                      <span>{formatBytes(clip.sizeBytes)}</span>
                      <span>{clip.triggerType}</span>
                      <span>{clip.uploaded ? 'uploaded' : 'pending'}</span>
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
