import { useEffect, useMemo, useState } from 'react'
import './App.css'
import {
  createEvent,
  type EventResponse,
  listEvents,
  startSession,
  stopSession,
} from './api'
import { captureClipMetadata } from './recorder'

const statusLabels = {
  idle: 'Idle',
  active: 'Active',
  stopped: 'Stopped',
} as const

type SessionStatus = keyof typeof statusLabels

const getPollIntervalMs = () => {
  const override = (globalThis as { __PING_WATCH_POLL_INTERVAL__?: number })
    .__PING_WATCH_POLL_INTERVAL__
  if (typeof override === 'number') {
    return override
  }

  const envValue = import.meta.env.VITE_POLL_INTERVAL_MS
  return envValue ? Number(envValue) : 5000
}

function formatConfidence(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return null
  }
  return `${Math.round(value * 100)}%`
}

function App() {
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [events, setEvents] = useState<EventResponse[]>([])
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedEventId, setCopiedEventId] = useState<string | null>(null)

  const lastEvent = useMemo(() => events[events.length - 1], [events])

  const handleStart = async () => {
    setIsBusy(true)
    setError(null)

    try {
      const session = await startSession('device-1')
      setSessionId(session.session_id)
      setSessionStatus('active')

      const nextEvents = await listEvents(session.session_id)
      setEvents(nextEvents)
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
    } catch (err) {
      console.error(err)
      setError('Unable to stop session')
    } finally {
      setIsBusy(false)
    }
  }

  const handleCreateEvent = async () => {
    if (!sessionId) {
      return
    }

    setIsBusy(true)
    setError(null)

    try {
      const clipMetadata = await captureClipMetadata({ recordMs: 2000 })
      await createEvent({
        sessionId,
        deviceId: 'device-1',
        triggerType: 'motion',
        durationSeconds: clipMetadata.durationSeconds,
        clipUri: `local://event-${Date.now()}`,
        clipMime: clipMetadata.mimeType,
        clipSizeBytes: clipMetadata.sizeBytes,
      })
      const nextEvents = await listEvents(sessionId)
      setEvents(nextEvents)
    } catch (err) {
      console.error(err)
      setError('Unable to create event')
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
            onClick={handleCreateEvent}
            disabled={sessionStatus !== 'active' || isBusy}
          >
            Create event
          </button>
        </div>

        {error ? <p className="error-banner">{error}</p> : null}

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
      </main>
    </div>
  )
}

export default App
