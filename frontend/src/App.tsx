import { useState } from 'react'
import './App.css'
import { listEvents, startSession, stopSession } from './api'

const statusLabels = {
  idle: 'Idle',
  active: 'Active',
  stopped: 'Stopped',
} as const

type SessionStatus = keyof typeof statusLabels

function App() {
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [eventCount, setEventCount] = useState(0)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleStart = async () => {
    setIsBusy(true)
    setError(null)

    try {
      const session = await startSession('device-1')
      setSessionId(session.session_id)
      setSessionStatus('active')

      const events = await listEvents(session.session_id)
      setEventCount(events.length)
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
            <span className="status-value">No events yet</span>
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
        </div>

        {error ? <p className="error-banner">{error}</p> : null}

        <section className="events">
          <div className="events-header">
            <h2>Recent events</h2>
            <span className="events-meta">{eventCount} captured</span>
          </div>
          <p className="events-empty">No clips captured yet.</p>
        </section>
      </main>
    </div>
  )
}

export default App
