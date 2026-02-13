import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import * as clipUpload from './clipUpload'
import { deleteClipsBySession, getClip, listClips, saveClip } from './clipStore'

vi.mock('./clipStore', () => ({
  saveClip: vi.fn(),
  listClips: vi.fn(),
  getClip: vi.fn(),
  deleteClipsBySession: vi.fn(),
  markClipUploaded: vi.fn(),
  scheduleClipRetry: vi.fn(),
}))

const mockedSaveClip = vi.mocked(saveClip)
const mockedListClips = vi.mocked(listClips)
const mockedGetClip = vi.mocked(getClip)
const mockedDeleteClipsBySession = vi.mocked(deleteClipsBySession)

const buildResponse = (payload: unknown) =>
  Promise.resolve({
    ok: true,
    json: async () => payload,
  } as Response)

const buildUploadResponse = (etag: string) =>
  Promise.resolve({
    ok: true,
    headers: {
      get: (key: string) => (key.toLowerCase() === 'etag' ? etag : null),
    },
    json: async () => ({}),
  } as unknown as Response)

const createFetchMock = (routes: {
  registerDevice?: unknown
  start: unknown
  stop: unknown
  forceStop?: unknown
  createEvent?: unknown
  initiateUpload?: unknown
  finalizeUpload?: unknown
  uploadEtag?: string
  events: unknown[]
}) => {
  const eventQueue = [...routes.events]
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString()

    if (url.endsWith('/devices/register')) {
      return buildResponse(
        routes.registerDevice ?? {
          device_id: 'device-1',
          label: null,
          created_at: 'now',
        }
      )
    }

    if (url.endsWith('/sessions/start')) {
      return buildResponse(routes.start)
    }

    if (url.endsWith('/events/upload/initiate') && init?.method === 'POST') {
      return buildResponse(routes.initiateUpload ?? {})
    }

    if (url.includes('/upload/finalize') && init?.method === 'POST') {
      return buildResponse(routes.finalizeUpload ?? {})
    }

    if (init?.method === 'PUT') {
      return buildUploadResponse(routes.uploadEtag ?? '"etag-1"')
    }

    if (url.endsWith('/events') && init?.method === 'POST') {
      return buildResponse(routes.createEvent ?? {})
    }

    if (url.includes('/events')) {
      const payload = eventQueue.length > 1 ? eventQueue.shift() : eventQueue[0]
      return buildResponse(payload)
    }

    if (url.endsWith('/sessions/stop')) {
      return buildResponse(routes.stop)
    }

    if (url.endsWith('/sessions/force-stop')) {
      return buildResponse(
        routes.forceStop ?? {
          ...(routes.stop as Record<string, unknown>),
          dropped_processing_events: 0,
          dropped_queued_jobs: 0,
        }
      )
    }

    return buildResponse({})
  })
}

describe('App', () => {
  const runtimeFlags = globalThis as {
    __PING_WATCH_DISABLE_MEDIA__?: boolean
    __PING_WATCH_CLIP_DURATION_MS__?: number
  }

  beforeEach(() => {
    runtimeFlags.__PING_WATCH_DISABLE_MEDIA__ = true
    runtimeFlags.__PING_WATCH_CLIP_DURATION_MS__ = 10000
    mockedSaveClip.mockClear()
    mockedListClips.mockResolvedValue([])
    mockedDeleteClipsBySession.mockResolvedValue(undefined)
    localStorage.clear()
  })

  afterEach(() => {
    runtimeFlags.__PING_WATCH_DISABLE_MEDIA__ = undefined
    runtimeFlags.__PING_WATCH_CLIP_DURATION_MS__ = undefined
  })

  it('shows the Ping Watch title', async () => {
    render(<App />)
    expect(
      await screen.findByRole('heading', { name: /ping watch/i })
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

    await user.click(screen.getByRole('button', { name: /^stop$/i }))

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/sessions/stop',
      expect.objectContaining({
        method: 'POST',
      })
    )
    expect(await screen.findByText('Stopped')).toBeInTheDocument()

    vi.restoreAllMocks()
  })

  it('shows queued clips counter and force stop control', async () => {
    render(<App />)

    expect(await screen.findByText(/queued clips/i)).toBeInTheDocument()
    expect(screen.getByText('0 remaining')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /force stop/i })
    ).toBeInTheDocument()
  })

  it('force stop clears local clips and requests server-side force stop', async () => {
    const user = userEvent.setup()
    const fetchMock = createFetchMock({
      start: { session_id: 'sess_1', device_id: 'device-1', status: 'active' },
      stop: { session_id: 'sess_1', device_id: 'device-1', status: 'stopped' },
      forceStop: {
        session_id: 'sess_1',
        device_id: 'device-1',
        status: 'stopped',
        dropped_processing_events: 2,
        dropped_queued_jobs: 1,
      },
      createEvent: {},
      events: [[]],
    })

    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    await user.click(
      screen.getByRole('button', { name: /start monitoring/i })
    )
    expect(await screen.findByText('Active')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /force stop/i }))

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/sessions/force-stop',
      expect.objectContaining({
        method: 'POST',
      })
    )
    expect(mockedDeleteClipsBySession).toHaveBeenCalledWith('sess_1')
    expect(await screen.findByText('Stopped')).toBeInTheDocument()
  })

  it('allows force stop after normal stop while backend processing may still be running', async () => {
    const user = userEvent.setup()
    const fetchMock = createFetchMock({
      start: { session_id: 'sess_1', device_id: 'device-1', status: 'active' },
      stop: { session_id: 'sess_1', device_id: 'device-1', status: 'stopped' },
      forceStop: {
        session_id: 'sess_1',
        device_id: 'device-1',
        status: 'stopped',
        dropped_processing_events: 1,
        dropped_queued_jobs: 1,
      },
      createEvent: {},
      events: [[]],
    })

    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    await user.click(screen.getByRole('button', { name: /start monitoring/i }))
    await user.click(screen.getByRole('button', { name: /^stop$/i }))

    const forceStopButton = screen.getByRole('button', { name: /force stop/i })
    expect(forceStopButton).toBeEnabled()

    await user.click(forceStopButton)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/sessions/force-stop',
      expect.objectContaining({
        method: 'POST',
      })
    )
  })

  it('stops local capture immediately even when stop API is pending', async () => {
    runtimeFlags.__PING_WATCH_DISABLE_MEDIA__ = false
    const user = userEvent.setup()
    const trackStop = vi.fn()
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve())
    const originalMediaDevices = navigator.mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: trackStop }],
        }),
      },
      configurable: true,
    })

    const originalMediaRecorder = globalThis.MediaRecorder
    class PassiveMediaRecorder {
      static isTypeSupported() {
        return true
      }
      state: 'inactive' | 'recording' = 'inactive'
      constructor() {}
      addEventListener() {}
      start() {
        this.state = 'recording'
      }
      stop() {
        this.state = 'inactive'
      }
    }
    Object.defineProperty(globalThis, 'MediaRecorder', {
      value: PassiveMediaRecorder,
      configurable: true,
    })

    let resolveStopRequest: ((response: Response) => void) | null = null
    const pendingStopRequest = new Promise<Response>((resolve) => {
      resolveStopRequest = resolve
    })

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString()
      if (url.endsWith('/devices/register')) {
        return buildResponse({
          device_id: 'device-1',
          label: null,
          created_at: 'now',
        })
      }
      if (url.endsWith('/sessions/start')) {
        return buildResponse({
          session_id: 'sess_1',
          device_id: 'device-1',
          status: 'active',
        })
      }
      if (url.endsWith('/sessions/stop')) {
        return pendingStopRequest
      }
      if (url.includes('/events')) {
        return buildResponse([])
      }
      if (url.endsWith('/events/upload/initiate') && init?.method === 'POST') {
        return buildResponse({})
      }
      if (url.includes('/upload/finalize') && init?.method === 'POST') {
        return buildResponse({})
      }
      if (init?.method === 'PUT') {
        return buildUploadResponse('"etag-1"')
      }
      return buildResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    await user.click(
      screen.getByRole('button', { name: /start monitoring/i })
    )
    expect(await screen.findByText(/capture active/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^stop$/i }))

    expect(await screen.findByText('Stopped')).toBeInTheDocument()
    expect(screen.getByText(/capture idle/i)).toBeInTheDocument()
    expect(trackStop).toHaveBeenCalled()

    resolveStopRequest?.({
      ok: true,
      json: async () => ({
        session_id: 'sess_1',
        device_id: 'device-1',
        status: 'stopped',
      }),
    } as Response)

    Object.defineProperty(globalThis, 'MediaRecorder', {
      value: originalMediaRecorder,
      configurable: true,
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      value: originalMediaDevices,
      configurable: true,
    })
    playSpy.mockRestore()
  })

  it('keeps the final async clip when stop is pressed', async () => {
    runtimeFlags.__PING_WATCH_DISABLE_MEDIA__ = false
    const user = userEvent.setup()
    const trackStop = vi.fn()
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve())
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const originalMediaDevices = navigator.mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: trackStop }],
        }),
      },
      configurable: true,
    })

    const originalMediaRecorder = globalThis.MediaRecorder
    type RecorderListener = (event?: unknown) => void
    class AsyncFinalClipMediaRecorder {
      static isTypeSupported() {
        return true
      }
      state: 'inactive' | 'recording' = 'inactive'
      private listeners: Record<string, RecorderListener[]> = {}

      constructor() {}

      addEventListener(type: string, listener: RecorderListener) {
        if (!this.listeners[type]) {
          this.listeners[type] = []
        }
        this.listeners[type].push(listener)
      }

      private emit(type: string, event?: unknown) {
        for (const listener of this.listeners[type] ?? []) {
          listener(event)
        }
      }

      start() {
        this.state = 'recording'
      }

      stop() {
        this.state = 'inactive'
        setTimeout(() => {
          this.emit('dataavailable', { data: new Blob(['final']) })
          this.emit('stop')
        }, 0)
      }
    }
    Object.defineProperty(globalThis, 'MediaRecorder', {
      value: AsyncFinalClipMediaRecorder,
      configurable: true,
    })

    let resolveStopRequest: ((response: Response) => void) | null = null
    const pendingStopRequest = new Promise<Response>((resolve) => {
      resolveStopRequest = resolve
    })
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString()
      if (url.endsWith('/devices/register')) {
        return buildResponse({
          device_id: 'device-1',
          label: null,
          created_at: 'now',
        })
      }
      if (url.endsWith('/sessions/start')) {
        return buildResponse({
          session_id: 'sess_1',
          device_id: 'device-1',
          status: 'active',
        })
      }
      if (url.endsWith('/sessions/stop')) {
        return pendingStopRequest
      }
      if (url.includes('/events')) {
        return buildResponse([])
      }
      if (url.endsWith('/events/upload/initiate') && init?.method === 'POST') {
        return buildResponse({})
      }
      if (url.includes('/upload/finalize') && init?.method === 'POST') {
        return buildResponse({})
      }
      if (init?.method === 'PUT') {
        return buildUploadResponse('"etag-1"')
      }
      return buildResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    await user.click(
      screen.getByRole('button', { name: /start monitoring/i })
    )
    await user.click(screen.getByRole('button', { name: /^stop$/i }))
    await new Promise((resolve) => setTimeout(resolve, 5))

    expect(trackStop).toHaveBeenCalled()
    expect(mockedSaveClip).toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalledWith('[App] Clip completed but no active session')

    resolveStopRequest?.({
      ok: true,
      json: async () => ({
        session_id: 'sess_1',
        device_id: 'device-1',
        status: 'stopped',
      }),
    } as Response)

    Object.defineProperty(globalThis, 'MediaRecorder', {
      value: originalMediaRecorder,
      configurable: true,
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      value: originalMediaDevices,
      configurable: true,
    })
    warnSpy.mockRestore()
    playSpy.mockRestore()
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

  it('renders clip timeline and previews a clip', async () => {
    const user = userEvent.setup()
    const fetchMock = createFetchMock({
      start: { session_id: 'sess_1', device_id: 'device-1', status: 'active' },
      stop: { session_id: 'sess_1', device_id: 'device-1', status: 'stopped' },
      createEvent: {},
      events: [[]],
    })
    const clip = {
      id: 'clip-1',
      sessionId: 'sess_1',
      deviceId: 'device-1',
      triggerType: 'motion' as const,
      blob: new Blob(['clip']),
      sizeBytes: 4,
      mimeType: 'video/webm',
      durationSeconds: 2,
      createdAt: 0,
      uploaded: false,
    }
    mockedListClips.mockResolvedValue([clip])
    mockedGetClip.mockResolvedValue(clip)

    const createObjectURL = vi.fn().mockReturnValue('blob:clip-1')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    })

    render(<App />)

    const previewButton = await screen.findByRole('button', {
      name: /preview clip-1/i,
    })
    await user.click(previewButton)

    expect(screen.getByTestId('clip-preview')).toHaveAttribute(
      'src',
      'blob:clip-1'
    )

    vi.restoreAllMocks()
  })

  it('shows inference output alongside stored clips', async () => {
    const user = userEvent.setup()
    const fetchMock = createFetchMock({
      start: { session_id: 'sess_1', device_id: 'device-1', status: 'active' },
      stop: { session_id: 'sess_1', device_id: 'device-1', status: 'stopped' },
      createEvent: {},
      events: [[
        {
          event_id: 'clip-1',
          status: 'done',
          trigger_type: 'motion',
          summary: 'Person entered room',
          label: 'person',
          confidence: 0.9,
        },
      ]],
    })
    const clip = {
      id: 'clip-1',
      sessionId: 'sess_1',
      deviceId: 'device-1',
      triggerType: 'motion' as const,
      blob: new Blob(['clip']),
      sizeBytes: 4,
      mimeType: 'video/webm',
      durationSeconds: 2,
      createdAt: 0,
      uploaded: true,
      uploadedAt: 1,
    }
    mockedListClips.mockResolvedValue([clip])
    mockedGetClip.mockResolvedValue(clip)
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    await user.click(
      screen.getByRole('button', { name: /start monitoring/i })
    )

    const clipSection = screen.getByRole('heading', { name: /stored clips/i }).closest('section')
    expect(clipSection).not.toBeNull()
    const scoped = within(clipSection as HTMLElement)

    expect(await scoped.findByText(/inference: done/i)).toBeInTheDocument()
    expect(scoped.getByText(/person entered room/i)).toBeInTheDocument()
    expect(scoped.getByText(/^person$/i)).toBeInTheDocument()
    expect(scoped.getByText(/90%/i)).toBeInTheDocument()

    vi.restoreAllMocks()
  })

  it('shows recording settings controls', async () => {
    render(<App />)

    expect(
      await screen.findByRole('slider', { name: /clip duration/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('slider', { name: /motion delta threshold/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('slider', { name: /motion absolute threshold/i })
    ).toBeInTheDocument()
  })

  it('shows optional audio detection toggles', async () => {
    render(<App />)

    expect(
      await screen.findByRole('checkbox', { name: /enable audio delta/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: /enable loud sound detection/i })
    ).toBeInTheDocument()
  })

  it('shows audio delta slider when enabled', async () => {
    const user = userEvent.setup()
    render(<App />)

    const toggle = await screen.findByRole('checkbox', { name: /enable audio delta/i })
    await user.click(toggle)

    expect(
      screen.getByRole('slider', { name: /audio delta threshold/i })
    ).toBeInTheDocument()
  })

  it('shows loud threshold slider when enabled', async () => {
    const user = userEvent.setup()
    render(<App />)

    const toggle = await screen.findByRole('checkbox', { name: /enable loud sound detection/i })
    await user.click(toggle)

    expect(
      screen.getByRole('slider', { name: /audio absolute threshold/i })
    ).toBeInTheDocument()
  })

  it('loads settings from localStorage', async () => {
    // Clear runtime override so localStorage is used
    runtimeFlags.__PING_WATCH_CLIP_DURATION_MS__ = undefined

    localStorage.setItem('ping-watch:clip-duration', '15')
    localStorage.setItem('ping-watch:motion-delta', '0.08')
    localStorage.setItem('ping-watch:motion-absolute', '0.05')

    render(<App />)

    const clipDuration = await screen.findByRole('slider', {
      name: /clip duration/i,
    })
    const motionDelta = screen.getByRole('slider', { name: /motion delta threshold/i })
    const motionAbsolute = screen.getByRole('slider', { name: /motion absolute threshold/i })

    expect(clipDuration).toHaveValue('15')
    expect(motionDelta).toHaveValue('0.08')
    expect(motionAbsolute).toHaveValue('0.05')
  })

  it('persists settings to localStorage', async () => {
    render(<App />)

    const clipDuration = await screen.findByRole('slider', {
      name: /clip duration/i,
    })
    const motionDelta = screen.getByRole('slider', { name: /motion delta threshold/i })
    const motionAbsolute = screen.getByRole('slider', { name: /motion absolute threshold/i })

    fireEvent.change(clipDuration, { target: { value: '12' } })
    fireEvent.change(motionDelta, { target: { value: '0.1' } })
    fireEvent.change(motionAbsolute, { target: { value: '0.06' } })

    expect(localStorage.getItem('ping-watch:clip-duration')).toBe('12')
    expect(localStorage.getItem('ping-watch:motion-delta')).toBe('0.1')
    expect(localStorage.getItem('ping-watch:motion-absolute')).toBe('0.06')
  })

  it('shows capture status when media is disabled', async () => {
    render(<App />)

    expect(
      await screen.findByText(/capture disabled/i)
    ).toBeInTheDocument()
  })

  it('shows a permission error when camera access is denied', async () => {
    runtimeFlags.__PING_WATCH_DISABLE_MEDIA__ = false
    const user = userEvent.setup()
    const fetchMock = createFetchMock({
      start: { session_id: 'sess_1', device_id: 'device-1', status: 'active' },
      stop: { session_id: 'sess_1', device_id: 'device-1', status: 'stopped' },
      createEvent: {},
      events: [[]],
    })

    const getUserMedia = vi
      .fn()
      .mockRejectedValue(new DOMException('Denied', 'NotAllowedError'))
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    })

    const originalMediaRecorder = globalThis.MediaRecorder
    class MockMediaRecorder {
      static isTypeSupported() {
        return false
      }
      constructor() {}
      addEventListener() {}
      start() {}
      stop() {}
      get state() {
        return 'inactive'
      }
    }
    Object.defineProperty(globalThis, 'MediaRecorder', {
      value: MockMediaRecorder,
      configurable: true,
    })

    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    await user.click(
      screen.getByRole('button', { name: /start monitoring/i })
    )

    expect(
      await screen.findByText(/camera permission denied/i)
    ).toBeInTheDocument()

    Object.defineProperty(globalThis, 'MediaRecorder', {
      value: originalMediaRecorder,
      configurable: true,
    })
  })

  it('retries pending uploads on an interval while active', async () => {
    ;(globalThis as { __PING_WATCH_UPLOAD_INTERVAL__?: number }).__PING_WATCH_UPLOAD_INTERVAL__ = 20
    const user = userEvent.setup()
    const fetchMock = createFetchMock({
      start: { session_id: 'sess_1', device_id: 'device-1', status: 'active' },
      stop: { session_id: 'sess_1', device_id: 'device-1', status: 'stopped' },
      createEvent: {},
      events: [[]],
    })

    const uploadSpy = vi
      .spyOn(clipUpload, 'uploadPendingClips')
      .mockResolvedValue(0)

    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    await user.click(
      screen.getByRole('button', { name: /start monitoring/i })
    )

    await screen.findByText('Active')
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(uploadSpy.mock.calls.length).toBeGreaterThanOrEqual(2)

    uploadSpy.mockRestore()
    ;(globalThis as { __PING_WATCH_UPLOAD_INTERVAL__?: number }).__PING_WATCH_UPLOAD_INTERVAL__ = undefined
  })

  it('prefers VITE interval settings over runtime overrides', async () => {
    process.env.VITE_POLL_INTERVAL_MS = '15'
    process.env.VITE_UPLOAD_INTERVAL_MS = '25'
    ;(globalThis as { __PING_WATCH_POLL_INTERVAL__?: number }).__PING_WATCH_POLL_INTERVAL__ = 40
    ;(globalThis as { __PING_WATCH_UPLOAD_INTERVAL__?: number }).__PING_WATCH_UPLOAD_INTERVAL__ = 50

    const user = userEvent.setup()
    const setIntervalSpy = vi
      .spyOn(window, 'setInterval')
      .mockImplementation((handler, timeout) => {
        return window.setTimeout(handler as TimerHandler, Number(timeout))
      })

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

    await screen.findByText('Active')
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 15)
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 25)

    setIntervalSpy.mockRestore()
    delete process.env.VITE_POLL_INTERVAL_MS
    delete process.env.VITE_UPLOAD_INTERVAL_MS
    ;(globalThis as { __PING_WATCH_POLL_INTERVAL__?: number }).__PING_WATCH_POLL_INTERVAL__ = undefined
    ;(globalThis as { __PING_WATCH_UPLOAD_INTERVAL__?: number }).__PING_WATCH_UPLOAD_INTERVAL__ = undefined
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

    const list = screen.getByRole('list')
    expect(await screen.findByText('2 captured')).toBeInTheDocument()
    expect(within(list).getByText('evt_1')).toBeInTheDocument()
    expect(within(list).getByText('evt_2')).toBeInTheDocument()
    expect(within(list).getByText('Motion detected')).toBeInTheDocument()
    expect(within(list).getByText('Audio spike')).toBeInTheDocument()
    expect(within(list).getAllByText('done').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: /^stop$/i }))

    vi.restoreAllMocks()
    ;(globalThis as { __PING_WATCH_POLL_INTERVAL__?: number }).__PING_WATCH_POLL_INTERVAL__ = undefined
  })

  it('continues polling after stop until processing events become done', async () => {
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
        ],
        [
          {
            event_id: 'evt_1',
            status: 'done',
            trigger_type: 'motion',
            summary: 'Detected person near desk',
            label: 'person',
            confidence: 0.93,
          },
        ],
      ],
    })

    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    await user.click(
      screen.getByRole('button', { name: /start monitoring/i })
    )

    expect(await screen.findByText(/processing/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^stop$/i }))

    expect(await screen.findByText('Detected person near desk')).toBeInTheDocument()
    expect(screen.getByText('done')).toBeInTheDocument()

    vi.restoreAllMocks()
    ;(globalThis as { __PING_WATCH_POLL_INTERVAL__?: number }).__PING_WATCH_POLL_INTERVAL__ = undefined
  })

  it('shows current clip index and benchmark status', async () => {
    render(<App />)

    expect(await screen.findByText(/current clip/i)).toBeInTheDocument()
    expect(screen.getByText('#0')).toBeInTheDocument()
    expect(screen.getByText(/benchmark/i)).toBeInTheDocument()
    expect(screen.getByText(/not set/i)).toBeInTheDocument()
  })

  it('shows session stats', async () => {
    render(<App />)

    expect(await screen.findByText(/session stats/i)).toBeInTheDocument()
    expect(screen.getByText(/stored: 0/i)).toBeInTheDocument()
    expect(screen.getByText(/discarded: 0/i)).toBeInTheDocument()
  })

  it('shows real-time motion/audio scores', async () => {
    render(<App />)

    expect(await screen.findByText(/motion \/ audio/i)).toBeInTheDocument()
    // Initial values are 0
    expect(screen.getByText('0.000 / 0.000')).toBeInTheDocument()
  })
})
