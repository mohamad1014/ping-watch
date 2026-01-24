import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from './App'

const buildResponse = (payload: unknown) =>
  Promise.resolve({
    ok: true,
    json: async () => payload,
  } as Response)

const createFetchMock = (routes: {
  start: unknown
  stop: unknown
  events: unknown[]
}) => {
  const eventQueue = [...routes.events]
  return vi.fn((input: RequestInfo | URL) => {
    const url = input.toString()

    if (url.endsWith('/sessions/start')) {
      return buildResponse(routes.start)
    }

    if (url.includes('/events')) {
      const payload = eventQueue.length > 1 ? eventQueue.shift() : eventQueue[0]
      return buildResponse(payload)
    }

    if (url.endsWith('/sessions/stop')) {
      return buildResponse(routes.stop)
    }

    return buildResponse({})
  })
}

describe('App', () => {
  it('shows the Ping Watch title', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { name: /ping watch/i })
    ).toBeInTheDocument()
  })

  it('starts and stops a session via the API', async () => {
    const user = userEvent.setup()
    const fetchMock = createFetchMock({
      start: { session_id: 'sess_1', device_id: 'device-1', status: 'active' },
      stop: { session_id: 'sess_1', device_id: 'device-1', status: 'stopped' },
      events: [[]],
    })

    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    await user.click(
      screen.getByRole('button', { name: /start monitoring/i })
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/sessions/start',
      expect.objectContaining({
        method: 'POST',
      })
    )
    expect(await screen.findByText('Active')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /stop/i }))

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/sessions/stop',
      expect.objectContaining({
        method: 'POST',
      })
    )
    expect(await screen.findByText('Stopped')).toBeInTheDocument()

    vi.restoreAllMocks()
  })

  it('polls and renders events when active', async () => {
    const user = userEvent.setup()
    ;(globalThis as { __PING_WATCH_POLL_INTERVAL__?: number }).__PING_WATCH_POLL_INTERVAL__ = 20

    const fetchMock = createFetchMock({
      start: { session_id: 'sess_1', device_id: 'device-1', status: 'active' },
      stop: { session_id: 'sess_1', device_id: 'device-1', status: 'stopped' },
      events: [
        [
          {
            event_id: 'evt_1',
            status: 'processing',
            trigger_type: 'motion',
          },
        ],
        [
          {
            event_id: 'evt_1',
            status: 'processing',
            trigger_type: 'motion',
          },
          {
            event_id: 'evt_2',
            status: 'done',
            trigger_type: 'audio',
          },
        ],
      ],
    })

    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    await user.click(
      screen.getByRole('button', { name: /start monitoring/i })
    )

    expect(await screen.findByText('1 captured')).toBeInTheDocument()

    const list = screen.getByRole('list')
    expect(within(list).getByText('evt_1')).toBeInTheDocument()

    expect(await screen.findByText('2 captured')).toBeInTheDocument()
    expect(within(list).getByText('evt_2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /stop/i }))

    vi.restoreAllMocks()
    ;(globalThis as { __PING_WATCH_POLL_INTERVAL__?: number }).__PING_WATCH_POLL_INTERVAL__ = undefined
  })
})
