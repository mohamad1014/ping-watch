import './App.css'

function App() {
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
            <span className="status-value">Idle</span>
          </div>
          <div className="status-row">
            <span className="status-label">Last event</span>
            <span className="status-value">No events yet</span>
          </div>
        </section>

        <div className="controls">
          <button className="primary" type="button">
            Start monitoring
          </button>
          <button className="secondary" type="button" disabled>
            Stop
          </button>
        </div>

        <section className="events">
          <div className="events-header">
            <h2>Recent events</h2>
            <span className="events-meta">0 captured</span>
          </div>
          <p className="events-empty">No clips captured yet.</p>
        </section>
      </main>
    </div>
  )
}

export default App
