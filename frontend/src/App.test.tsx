import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { captureClipMetadata } from './recorder'
import { assembleClip } from './clipAssembler'
import { saveClip } from './clipStore'

vi.mock('./recorder', () => ({
  captureClipMetadata: vi.fn(),
}))

const mockedCaptureClipMetadata = vi.mocked(captureClipMetadata)

vi.mock('./clipAssembler', () => ({
  assembleClip: vi.fn(),
}))

vi.mock('./clipStore', () => ({
  saveClip: vi.fn(),
}))

const mockedAssembleClip = vi.mocked(assembleClip)
const mockedSaveClip = vi.mocked(saveClip)

const buildResponse = (payload: unknown) =>
  Promise.resolve({
    ok: true,
    json: async () => payload,
  } as Response)

const createFetchMock = (routes: {
  start: unknown
  stop: unknown
  createEvent: unknown
  events: unknown[]
}) => {
  const eventQueue = [...routes.events]
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString()

    if (url.endsWith('/sessions/start')) {
      return buildResponse(routes.start)
    }

    if (url.endsWith('/events') && init?.method === 'POST') {
      return buildResponse(routes.createEvent)
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
  const runtimeFlags = globalThis as {
    __PING_WATCH_DISABLE_MEDIA__?: boolean
    __PING_WATCH_PRE_MS__?: number
    __PING_WATCH_POST_MS__?: number
  }

  beforeEach(() => {
    runtimeFlags.__PING_WATCH_DISABLE_MEDIA__ = true
    runtimeFlags.__PING_WATCH_POST_MS__ = 0
  })

  afterEach(() => {
    runtimeFlags.__PING_WATCH_DISABLE_MEDIA__ = undefined
    runtimeFlags.__PING_WATCH_POST_MS__ = undefined
  })

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
      createEvent: {},
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

  it('creates an event from the UI', async () => {
    const user = userEvent.setup()
    const fetchMock = createFetchMock({
      start: { session_id: 'sess_1', device_id: 'device-1', status: 'active' },
      stop: { session_id: 'sess_1', device_id: 'device-1', status: 'stopped' },
      createEvent: {
        event_id: 'evt_1',
        status: 'processing',
        trigger_type: 'motion',
      },
      events: [[{ event_id: 'evt_1', status: 'processing', trigger_type: 'motion' }]],
    })

    mockedCaptureClipMetadata.mockResolvedValue({
      durationSeconds: 3.4,
      sizeBytes: 2048,
      mimeType: 'video/webm',
    })
    mockedAssembleClip.mockReturnValue({
      blob: new Blob(['clip']),
      sizeBytes: 4,
      mimeType: 'video/webm',
      durationSeconds: 2,
      startMs: 0,
      endMs: 2000,
    })
    mockedSaveClip.mockResolvedValue({
      id: 'clip-1',
      blob: new Blob(['clip']),
      sizeBytes: 4,
      mimeType: 'video/webm',
      durationSeconds: 2,
      createdAt: 0,
    })

    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    await user.click(
      screen.getByRole('button', { name: /start monitoring/i })
    )

    await user.click(screen.getByRole('button', { name: /create event/i }))

    const createCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        input.toString().endsWith('/events') && init?.method === 'POST'
    )

    expect(createCall).toBeDefined()
    const [, createInit] = createCall ?? []
    const createBody = JSON.parse((createInit?.body ?? '{}') as string)

    expect(createBody).toMatchObject({
      duration_seconds: 2,
      clip_size_bytes: 4,
      clip_mime: 'video/webm',
      clip_uri: 'idb://clips/clip-1',
    })

    expect(await screen.findByText('1 captured')).toBeInTheDocument()
    const list = screen.getByRole('list')
    expect(within(list).getByText('evt_1')).toBeInTheDocument()

    vi.restoreAllMocks()
  })

  it('copies event ids for manual testing', async () => {
    const user = userEvent.setup()
    const fetchMock = createFetchMock({
      start: { session_id: 'sess_1', device_id: 'device-1', status: 'active' },
      stop: { session_id: 'sess_1', device_id: 'device-1', status: 'stopped' },
      createEvent: {},
      events: [[{ event_id: 'evt_1', status: 'done', trigger_type: 'motion' }]],
    })

    vi.stubGlobal('fetch', fetchMock)

    const originalClipboard = navigator.clipboard
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    render(<App />)

    await user.click(
      screen.getByRole('button', { name: /start monitoring/i })
    )

    const copyButton = await screen.findByRole('button', {
      name: /copy id/i,
    })
    await user.click(copyButton)

    expect(writeText).toHaveBeenCalledWith('evt_1')

    vi.restoreAllMocks()
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
    })
  })

  it('polls and renders events when active', async () => {
    const user = userEvent.setup()
    ;(globalThis as { __PING_WATCH_POLL_INTERVAL__?: number }).__PING_WATCH_POLL_INTERVAL__ = 20

    const fetchMock = createFetchMock({
      start: { session_id: 'sess_1', device_id: 'device-1', status: 'active' },
      stop: { session_id: 'sess_1', device_id: 'device-1', status: 'stopped' },
      createEvent: {},
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
            status: 'done',
            trigger_type: 'motion',
            summary: 'Motion detected',
            label: 'person',
            confidence: 0.82,
          },
          {
            event_id: 'evt_2',
            status: 'done',
            trigger_type: 'audio',
            summary: 'Audio spike',
            label: 'bang',
            confidence: 0.91,
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
    expect(within(list).getByText('Motion detected')).toBeInTheDocument()
    expect(within(list).getByText('Audio spike')).toBeInTheDocument()
    expect(within(list).getAllByText('done').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: /stop/i }))

    vi.restoreAllMocks()
    ;(globalThis as { __PING_WATCH_POLL_INTERVAL__?: number }).__PING_WATCH_POLL_INTERVAL__ = undefined
  })
})
