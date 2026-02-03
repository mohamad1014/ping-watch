import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { assembleClip } from './clipAssembler'
import * as clipUpload from './clipUpload'
import { getClip, listClips, saveClip } from './clipStore'
import { startMotionTrigger } from './motion'

vi.mock('./clipAssembler', () => ({
  assembleClip: vi.fn(),
}))

vi.mock('./clipStore', () => ({
  saveClip: vi.fn(),
  listClips: vi.fn(),
  getClip: vi.fn(),
  markClipUploaded: vi.fn(),
  scheduleClipRetry: vi.fn(),
}))

vi.mock('./motion', async () => {
  const actual = await vi.importActual<typeof import('./motion')>('./motion')
  return {
    ...actual,
    startMotionTrigger: vi.fn(),
  }
})

const mockedAssembleClip = vi.mocked(assembleClip)
const mockedSaveClip = vi.mocked(saveClip)
const mockedListClips = vi.mocked(listClips)
const mockedGetClip = vi.mocked(getClip)
const mockedStartMotionTrigger = vi.mocked(startMotionTrigger)

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
    mockedStartMotionTrigger.mockImplementation(() => ({
      stop: vi.fn(),
    }))
    mockedSaveClip.mockClear()
    mockedListClips.mockResolvedValue([])
    localStorage.clear()
  })

  afterEach(() => {
    runtimeFlags.__PING_WATCH_DISABLE_MEDIA__ = undefined
    runtimeFlags.__PING_WATCH_POST_MS__ = undefined
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
      initiateUpload: {
        event: {
          event_id: 'clip-1',
          status: 'processing',
          trigger_type: 'motion',
        },
        upload_url: 'http://upload/clip-1',
        blob_url: 'http://blob/clip-1',
        expires_at: new Date().toISOString(),
      },
      finalizeUpload: {
        event_id: 'clip-1',
        status: 'processing',
        trigger_type: 'motion',
      },
      uploadEtag: '"etag-1"',
      events: [
        [],
        [{ event_id: 'clip-1', status: 'processing', trigger_type: 'motion' }],
      ],
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
      sessionId: 'sess_1',
      deviceId: 'device-1',
      triggerType: 'motion',
      blob: new Blob(['clip']),
      sizeBytes: 4,
      mimeType: 'video/webm',
      durationSeconds: 2,
      createdAt: 0,
      uploaded: false,
      uploadAttempts: 0,
    })
    mockedListClips.mockImplementation(async (filter?: unknown) => {
      if (
        typeof filter === 'object' &&
        filter !== null &&
        'uploaded' in filter &&
        (filter as { uploaded?: boolean }).uploaded === false
      ) {
        return [
          {
            id: 'clip-1',
            sessionId: 'sess_1',
            deviceId: 'device-1',
            triggerType: 'motion',
            blob: new Blob(['clip']),
            sizeBytes: 4,
            mimeType: 'video/webm',
            durationSeconds: 2,
            createdAt: 0,
            uploaded: false,
            uploadAttempts: 0,
          },
        ]
      }
      return []
    })

    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    await user.click(
      screen.getByRole('button', { name: /start monitoring/i })
    )

    await user.click(screen.getByRole('button', { name: /create event/i }))

    const initiateCall = fetchMock.mock.calls.find(([input, init]) =>
      input.toString().endsWith('/events/upload/initiate') && init?.method === 'POST'
    )
    expect(initiateCall).toBeDefined()
    const [, initiateInit] = initiateCall ?? []
    const initiateBody = JSON.parse((initiateInit?.body ?? '{}') as string)
    expect(initiateBody).toMatchObject({
      event_id: 'clip-1',
      session_id: 'sess_1',
      device_id: 'device-1',
      trigger_type: 'motion',
      duration_seconds: 2,
      clip_mime: 'video/webm',
      clip_size_bytes: 4,
    })

    expect(await screen.findByText('1 captured')).toBeInTheDocument()
    const list = screen.getByRole('list')
    expect(within(list).getByText('clip-1')).toBeInTheDocument()

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

  it('skips saving when no clip data is assembled', async () => {
    const user = userEvent.setup()
    const fetchMock = createFetchMock({
      start: { session_id: 'sess_1', device_id: 'device-1', status: 'active' },
      stop: { session_id: 'sess_1', device_id: 'device-1', status: 'stopped' },
      createEvent: {},
      events: [[]],
    })
    const fakeTrack = { stop: vi.fn() }
    const fakeStream = {
      getTracks: () => [fakeTrack],
      getAudioTracks: () => [],
    } as unknown as MediaStream
    const mediaDevices = {
      getUserMedia: vi.fn().mockResolvedValue(fakeStream),
    }
    const mockContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray(160 * 90 * 4),
      })),
    }

    runtimeFlags.__PING_WATCH_DISABLE_MEDIA__ = false
    mockedAssembleClip.mockReturnValue(null)
    mockedStartMotionTrigger.mockImplementation(({ onTrigger }) => {
      onTrigger()
      return { stop: vi.fn() }
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices,
    })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      mockContext as unknown as CanvasRenderingContext2D
    )

    class MockMediaRecorder {
      static isTypeSupported() {
        return true
      }

      state = 'inactive'
      mimeType = 'video/webm'
      private listeners: Record<string, ((event: { data: Blob }) => void)[]> = {}

      addEventListener(type: string, listener: (event: { data: Blob }) => void) {
        this.listeners[type] ??= []
        this.listeners[type].push(listener)
      }

      start() {
        this.state = 'recording'
      }

      stop() {
        this.state = 'inactive'
      }
    }

    vi.stubGlobal('MediaRecorder', MockMediaRecorder as unknown as typeof MediaRecorder)

    render(<App />)

    await user.click(
      screen.getByRole('button', { name: /start monitoring/i })
    )

    expect(
      await screen.findByText('Unable to assemble clip')
    ).toBeInTheDocument()
    expect(mockedSaveClip).not.toHaveBeenCalled()

    vi.restoreAllMocks()
  })

  it('shows motion controls', async () => {
    render(<App />)

    expect(
      await screen.findByRole('slider', { name: /motion threshold/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('slider', { name: /motion cooldown/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('slider', { name: /roi inset/i })
    ).toBeInTheDocument()
  })

  it('loads motion settings from localStorage', async () => {
    localStorage.setItem('ping-watch:motion-threshold', '0.18')
    localStorage.setItem('ping-watch:motion-cooldown', '24')
    localStorage.setItem('ping-watch:motion-roi-inset', '12')

    render(<App />)

    const threshold = await screen.findByRole('slider', {
      name: /motion threshold/i,
    })
    const cooldown = screen.getByRole('slider', { name: /motion cooldown/i })
    const roi = screen.getByRole('slider', { name: /roi inset/i })

    expect(threshold).toHaveValue('0.18')
    expect(cooldown).toHaveValue('24')
    expect(roi).toHaveValue('12')
  })

  it('persists motion settings to localStorage', async () => {
    render(<App />)

    const threshold = await screen.findByRole('slider', {
      name: /motion threshold/i,
    })
    const cooldown = screen.getByRole('slider', { name: /motion cooldown/i })
    const roi = screen.getByRole('slider', { name: /roi inset/i })

    fireEvent.change(threshold, { target: { value: '0.22' } })
    fireEvent.change(cooldown, { target: { value: '28' } })
    fireEvent.change(roi, { target: { value: '16' } })

    expect(localStorage.getItem('ping-watch:motion-threshold')).toBe('0.22')
    expect(localStorage.getItem('ping-watch:motion-cooldown')).toBe('28')
    expect(localStorage.getItem('ping-watch:motion-roi-inset')).toBe('16')
  })

  it('shows audio controls', async () => {
    render(<App />)

    expect(
      await screen.findByRole('checkbox', { name: /audio trigger/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('slider', { name: /audio threshold/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('slider', { name: /audio cooldown/i })
    ).toBeInTheDocument()
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

  it('loads audio settings from localStorage', async () => {
    localStorage.setItem('ping-watch:audio-enabled', 'true')
    localStorage.setItem('ping-watch:audio-threshold', '0.42')
    localStorage.setItem('ping-watch:audio-cooldown', '22')

    render(<App />)

    const enabled = await screen.findByRole('checkbox', {
      name: /audio trigger/i,
    })
    const threshold = screen.getByRole('slider', { name: /audio threshold/i })
    const cooldown = screen.getByRole('slider', { name: /audio cooldown/i })

    expect(enabled).toBeChecked()
    expect(threshold).toHaveValue('0.42')
    expect(cooldown).toHaveValue('22')
  })

  it('persists audio settings to localStorage', async () => {
    const user = userEvent.setup()
    render(<App />)

    const enabled = await screen.findByRole('checkbox', {
      name: /audio trigger/i,
    })
    await user.click(enabled)

    const threshold = screen.getByRole('slider', { name: /audio threshold/i })
    const cooldown = screen.getByRole('slider', { name: /audio cooldown/i })
    fireEvent.change(threshold, { target: { value: '0.5' } })
    fireEvent.change(cooldown, { target: { value: '18' } })

    expect(localStorage.getItem('ping-watch:audio-enabled')).toBe('true')
    expect(localStorage.getItem('ping-watch:audio-threshold')).toBe('0.5')
    expect(localStorage.getItem('ping-watch:audio-cooldown')).toBe('18')
  })

  it('renders the audio level meter', async () => {
    render(<App />)

    expect(
      await screen.findByRole('meter', { name: /audio level/i })
    ).toBeInTheDocument()
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
