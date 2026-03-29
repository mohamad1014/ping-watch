import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
const TELEGRAM_LINK_ATTEMPT_KEY = 'ping-watch:telegram-link-attempt-id'
const TELEGRAM_LINK_FALLBACK_URL_KEY = 'ping-watch:telegram-link-fallback-url'
const TELEGRAM_LINK_FALLBACK_COMMAND_KEY = 'ping-watch:telegram-link-fallback-command'
const TELEGRAM_LINK_WAITING_KEY = 'ping-watch:telegram-link-waiting'
const FRONTEND_MODE_KEY = 'ping-watch:frontend-mode'

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

const addRequiredAlertInstruction = async (user: ReturnType<typeof userEvent.setup>) => {
  const firstInstruction = await screen.findByLabelText(/alert instruction 1/i)
  await user.clear(firstInstruction)
  await user.type(firstInstruction, 'Alert if a person enters the office.')
}

type RecipientApiResponse = {
  endpoint_id: string
  provider: string
  chat_id: string
  telegram_username: string | null
  linked_at: string
  subscribed: boolean
}

type InviteApiResponse = {
  invite_id: string
  device_id: string
  status: string
  invite_code: string | null
  created_at: string
  expires_at: string
  accepted_at: string | null
  revoked_at: string | null
  recipient_chat_id: string | null
  recipient_telegram_username: string | null
}

const createFetchMock = (routes: {
  registerDevice?: unknown
  telegramReadiness?: unknown[]
  telegramLinkStart?: unknown[]
  telegramLinkStatus?: unknown[]
  invites?: {
    lists?: { device_id: string, invites: InviteApiResponse[] }[]
    create?: InviteApiResponse[]
    accept?: unknown[]
    revoke?: InviteApiResponse[]
  }
  recipients?: {
    lists?: { device_id: string, recipients: RecipientApiResponse[] }[]
    add?: RecipientApiResponse[]
    remove?: { device_id: string, endpoint_id: string, removed: boolean }[]
  }
  telegramTestAlert?: unknown[]
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
  const readinessQueue = routes.telegramReadiness?.length
    ? [...routes.telegramReadiness]
    : [{
      enabled: false,
      ready: false,
      status: 'not_configured',
      reason: null,
      connect_url: null,
    }]
  const telegramLinkStartQueue = routes.telegramLinkStart?.length
    ? [...routes.telegramLinkStart]
    : [{
      enabled: true,
      ready: false,
      status: 'pending',
      reason: null,
      attempt_id: 'attempt-1',
      connect_url: 'https://t.me/pingwatch_bot?start=token-1',
      expires_at: '2099-01-01T00:00:00Z',
      link_code: 'token-1',
      fallback_command: '/start token-1',
    }]
  const telegramLinkStatusQueue = routes.telegramLinkStatus?.length
    ? [...routes.telegramLinkStatus]
    : [{
      enabled: true,
      ready: false,
      linked: false,
      status: 'pending',
      reason: null,
      attempt_id: 'attempt-1',
    }]
  const inviteListQueue = routes.invites?.lists?.length
    ? [...routes.invites.lists]
    : [{
      device_id: 'device-1',
      invites: [],
    }]
  const inviteCreateQueue = routes.invites?.create?.length
    ? [...routes.invites.create]
    : []
  const inviteAcceptQueue = routes.invites?.accept?.length
    ? [...routes.invites.accept]
    : []
  const inviteRevokeQueue = routes.invites?.revoke?.length
    ? [...routes.invites.revoke]
    : []
  const recipientListQueue = routes.recipients?.lists?.length
    ? [...routes.recipients.lists]
    : [{
      device_id: 'device-1',
      recipients: [],
    }]
  const recipientAddQueue = routes.recipients?.add?.length
    ? [...routes.recipients.add]
    : []
  const recipientRemoveQueue = routes.recipients?.remove?.length
    ? [...routes.recipients.remove]
    : []
  const telegramTestAlertQueue = routes.telegramTestAlert?.length
    ? [...routes.telegramTestAlert]
    : [{
      ok: true,
      delivered_count: 1,
    }]
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString()

    if (url.includes('/notifications/telegram/readiness')) {
      const payload =
        readinessQueue.length > 1 ? readinessQueue.shift() : readinessQueue[0]
      return buildResponse(payload)
    }

    if (url.endsWith('/notifications/telegram/link/start') && init?.method === 'POST') {
      const payload =
        telegramLinkStartQueue.length > 1
          ? telegramLinkStartQueue.shift()
          : telegramLinkStartQueue[0]
      return buildResponse(payload)
    }

    if (url.includes('/notifications/telegram/link/status')) {
      const payload =
        telegramLinkStatusQueue.length > 1
          ? telegramLinkStatusQueue.shift()
          : telegramLinkStatusQueue[0]
      return buildResponse(payload)
    }

    if (url.includes('/notifications/invites') && (!init?.method || init.method === 'GET')) {
      const payload =
        inviteListQueue.length > 1 ? inviteListQueue.shift() : inviteListQueue[0]
      return buildResponse(payload)
    }

    if (url.endsWith('/notifications/invites') && init?.method === 'POST') {
      const payload =
        inviteCreateQueue.length > 1 ? inviteCreateQueue.shift() : inviteCreateQueue[0]
      return buildResponse(payload)
    }

    if (url.endsWith('/notifications/invites/accept') && init?.method === 'POST') {
      const payload =
        inviteAcceptQueue.length > 1 ? inviteAcceptQueue.shift() : inviteAcceptQueue[0]
      return buildResponse(payload)
    }

    if (url.includes('/notifications/invites') && init?.method === 'DELETE') {
      const payload =
        inviteRevokeQueue.length > 1 ? inviteRevokeQueue.shift() : inviteRevokeQueue[0]
      return buildResponse(payload)
    }

    if (url.includes('/notifications/recipients') && (!init?.method || init.method === 'GET')) {
      const payload =
        recipientListQueue.length > 1 ? recipientListQueue.shift() : recipientListQueue[0]
      return buildResponse(payload)
    }

    if (url.endsWith('/notifications/recipients') && init?.method === 'POST') {
      const payload =
        recipientAddQueue.length > 1 ? recipientAddQueue.shift() : recipientAddQueue[0]
      return buildResponse(payload)
    }

    if (url.includes('/notifications/recipients') && init?.method === 'DELETE') {
      const payload =
        recipientRemoveQueue.length > 1 ? recipientRemoveQueue.shift() : recipientRemoveQueue[0]
      return buildResponse(payload)
    }

    if (url.endsWith('/notifications/telegram/test') && init?.method === 'POST') {
      const payload =
        telegramTestAlertQueue.length > 1
          ? telegramTestAlertQueue.shift()
          : telegramTestAlertQueue[0]
      return buildResponse(payload)
    }

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
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = input.toString()
      if (url.endsWith('/devices/register')) {
        return buildResponse({
          device_id: 'device-1',
          label: null,
          created_at: 'now',
        })
      }
      if (url.includes('/notifications/telegram/readiness')) {
        return buildResponse({
          enabled: false,
          ready: false,
          status: 'not_configured',
          reason: null,
          connect_url: null,
        })
      }
      return buildResponse({})
    }))
    localStorage.clear()
  })

  afterEach(() => {
    runtimeFlags.__PING_WATCH_DISABLE_MEDIA__ = undefined
    runtimeFlags.__PING_WATCH_CLIP_DURATION_MS__ = undefined
  })

  it('shows a straightforward monitoring headline', async () => {
    render(<App />)
    expect(
      await screen.findByRole('heading', { name: /watch a space and send alerts to telegram/i })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/use this phone as a simple camera monitor for a room, door, desk, or entryway/i)
    ).toBeInTheDocument()
  })

  it('shows alert instruction guidance with multiple examples', async () => {
    render(<App />)

    expect(await screen.findByRole('heading', { name: /alert instructions/i })).toBeInTheDocument()
    expect(
      screen.getByText(/write one short sentence per instruction so alerts stay clear and specific/i)
    ).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText(/example: alert me if a person enters through the front door/i)
    ).toBeInTheDocument()
    expect(screen.getByText(/alert if someone opens the office door/i)).toBeInTheDocument()
    expect(screen.getByText(/alert if motion happens near the stock shelf after 10 pm/i)).toBeInTheDocument()
    expect(screen.getByText(/alert if a person stands near the front desk for more than a minute/i)).toBeInTheDocument()
  })

  it('lets the user choose between connecting this phone or another phone', async () => {
    const user = userEvent.setup()
    render(<App />)

    const telegramSection = await screen.findByRole('region', { name: /^telegram$/i })
    const thisPhoneButton = within(telegramSection).getByRole('button', { name: /this phone/i })
    const anotherPhoneButton = within(telegramSection).getByRole('button', { name: /another phone/i })

    expect(thisPhoneButton).toHaveAttribute('aria-pressed', 'true')
    expect(anotherPhoneButton).toHaveAttribute('aria-pressed', 'false')
    expect(within(telegramSection).getByText(/choose this if the monitoring phone should also receive telegram alerts/i)).toBeInTheDocument()
    expect(within(telegramSection).queryByText(/paste an invite code from a device owner/i)).not.toBeInTheDocument()

    await user.click(anotherPhoneButton)

    expect(thisPhoneButton).toHaveAttribute('aria-pressed', 'false')
    expect(anotherPhoneButton).toHaveAttribute('aria-pressed', 'true')
    expect(within(telegramSection).getByText(/choose this if alerts should go to a different phone or another person's telegram account/i)).toBeInTheDocument()
    expect(within(telegramSection).getByText(/paste an invite code from a device owner/i)).toBeInTheDocument()
    expect(within(telegramSection).queryByText(/connect telegram and send \/start to your bot before monitoring/i)).not.toBeInTheDocument()
  })

  it('shows onboarding guidance for device owners', async () => {
    render(<App />)

    const onboardingSection = await screen.findByRole('region', { name: /how this works/i })
    expect(within(onboardingSection).getByText(/choose where alerts should go/i)).toBeInTheDocument()
    expect(within(onboardingSection).getByText(/write the alerts you want/i)).toBeInTheDocument()
    expect(within(onboardingSection).getByText(/place this phone and start monitoring/i)).toBeInTheDocument()
    expect(within(onboardingSection).queryByText(/switch to dev mode only when you need to tune recording/i)).not.toBeInTheDocument()
    expect(within(onboardingSection).queryByRole('button', { name: /user mode/i })).not.toBeInTheDocument()
  })

  it('requires at least one alert instruction and sends multiple instructions together', async () => {
    const user = userEvent.setup()
    const fetchMock = createFetchMock({
      start: {
        session_id: 'sess_1',
        device_id: 'device-1',
        status: 'active',
        analysis_prompt: 'Alert if a person enters the office.\nAlert if motion happens after 10 PM.',
      },
      stop: { session_id: 'sess_1', device_id: 'device-1', status: 'stopped' },
      createEvent: {},
      events: [[]],
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    const startButton = screen.getByRole('button', { name: /start monitoring/i })
    expect(startButton).toBeDisabled()

    const firstInstruction = await screen.findByRole('textbox', { name: /alert instruction 1/i })
    await user.type(firstInstruction, 'Alert if a person enters the office.')
    expect(startButton).toBeEnabled()

    await user.click(screen.getByRole('button', { name: /add instruction/i }))
    const secondInstruction = screen.getByRole('textbox', { name: /alert instruction 2/i })
    await user.type(secondInstruction, 'Alert if motion happens after 10 PM.')

    await user.click(startButton)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/sessions/start',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          device_id: 'device-1',
          analysis_prompt: null,
          analysis_prompts: [
            'Alert if a person enters the office.',
            'Alert if motion happens after 10 PM.',
          ],
        }),
      })
    )
  })

  it('lets panels be minimized from their section header', async () => {
    const user = userEvent.setup()
    render(<App />)

    const onboardingToggle = await screen.findByRole('button', { name: /how this works/i })
    expect(onboardingToggle).toHaveAttribute('aria-expanded', 'true')

    await user.click(onboardingToggle)

    expect(onboardingToggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/mount or place this phone/i)).not.toBeInTheDocument()
  })

  it('shows the primary owner flow in the intended order and keeps monitoring controls fixed', async () => {
    render(<App />)

    await screen.findByRole('region', { name: /how this works/i })

    const sectionTitles = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(sectionTitles).toEqual([
      'How this works',
      'Telegram',
      'Alert instructions',
      'Monitoring controls',
      'Recent events',
      'Stored clips',
    ])
    expect(screen.queryByRole('button', { name: /toggle monitoring controls/i })).not.toBeInTheDocument()
  })

  it('requires Telegram readiness before start when backend reports not ready', async () => {
    const fetchMock = createFetchMock({
      telegramReadiness: [{
        enabled: true,
        ready: false,
        status: 'needs_user_action',
        reason: 'Open Telegram and send /start to your bot, then return.',
        connect_url: 'https://t.me/pingwatch_bot',
      }],
      start: { session_id: 'sess_1', device_id: 'device-1', status: 'active' },
      stop: { session_id: 'sess_1', device_id: 'device-1', status: 'stopped' },
      createEvent: {},
      events: [[]],
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    expect(
      await screen.findByRole('button', { name: /connect telegram alerts/i })
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/telegram status: action needed/i)).toBeInTheDocument()
    expect(
      screen.getByText(/open telegram and send \/start to your bot/i)
    ).toBeInTheDocument()
    expect(screen.getByText(/bot linked/i)).toBeInTheDocument()
    expect(screen.getByText(/recipient added/i)).toBeInTheDocument()
    expect(screen.getByText(/ready to monitor/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /start monitoring/i })).toBeDisabled()
  })

  it('opens Telegram onboarding and enables start when backend confirms readiness', async () => {
    const user = userEvent.setup()
    const fetchMock = createFetchMock({
      telegramReadiness: [
        {
          enabled: true,
          ready: false,
          status: 'needs_user_action',
          reason: 'Open Telegram and send /start to your bot, then return.',
          connect_url: null,
        },
        {
          enabled: true,
          ready: true,
          status: 'ready',
          reason: null,
          connect_url: null,
        },
      ],
      telegramLinkStart: [{
        enabled: true,
        ready: false,
        status: 'pending',
        reason: null,
        attempt_id: 'attempt-1',
        connect_url: 'https://t.me/pingwatch_bot?start=token-1',
        expires_at: '2099-01-01T00:00:00Z',
        link_code: 'token-1',
        fallback_command: '/start token-1',
      }],
      telegramLinkStatus: [{
        enabled: true,
        ready: true,
        linked: true,
        status: 'ready',
        reason: null,
        attempt_id: 'attempt-1',
      }],
      start: { session_id: 'sess_1', device_id: 'device-1', status: 'active' },
      stop: { session_id: 'sess_1', device_id: 'device-1', status: 'stopped' },
      createEvent: {},
      events: [[]],
    })
    vi.stubGlobal('fetch', fetchMock)
    const popup = { location: { href: '' }, close: vi.fn() } as unknown as Window
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(popup)

    render(<App />)
    await addRequiredAlertInstruction(user)

    await user.click(
      await screen.findByRole('button', { name: /connect telegram alerts/i })
    )

    expect(openSpy).toHaveBeenCalledWith(
      'https://t.me/pingwatch_bot?start=token-1',
      '_blank',
      'noopener,noreferrer'
    )
    expect(popup.location.href).toBe('')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start monitoring/i })).toBeEnabled()
    })
    expect(screen.getByLabelText(/telegram status: connected/i)).toBeInTheDocument()
    expect(screen.getByText(/bot linked/i)).toBeInTheDocument()
    expect(screen.getByText(/recipient added/i)).toBeInTheDocument()
    expect(screen.getByText(/ready to monitor/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /test telegram alert/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /start monitoring/i }))
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/sessions/start',
      expect.objectContaining({ method: 'POST' })
    )

    openSpy.mockRestore()
  })

  it('sends a Telegram test alert once Telegram is linked', async () => {
    const user = userEvent.setup()
    const fetchMock = createFetchMock({
      telegramReadiness: [{
        enabled: true,
        ready: true,
        status: 'ready',
        reason: null,
      }],
      telegramTestAlert: [{
        ok: true,
        delivered_count: 2,
      }],
      recipients: {
        lists: [{
          device_id: 'device-1',
          recipients: [{
            endpoint_id: 'endpoint-1',
            provider: 'telegram',
            chat_id: '111',
            telegram_username: 'alice',
            linked_at: '2026-03-01T10:00:00Z',
            subscribed: true,
          }],
        }],
      },
      start: { session_id: 'sess_1', device_id: 'device-1', status: 'active' },
      stop: { session_id: 'sess_1', device_id: 'device-1', status: 'stopped' },
      createEvent: {},
      events: [[]],
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    await user.click(await screen.findByRole('button', { name: /test telegram alert/i }))

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/notifications/telegram/test',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          device_id: 'device-1',
        }),
      })
    )
    expect(await screen.findByText(/test alert sent to 2 telegram recipients/i)).toBeInTheDocument()
  })

  it('shows a backup Telegram link when popup is blocked', async () => {
    const user = userEvent.setup()
    const fetchMock = createFetchMock({
      telegramReadiness: [{
        enabled: true,
        ready: false,
        status: 'needs_user_action',
        reason: 'Open Telegram and send /start to your bot, then return.',
        connect_url: null,
      }],
      telegramLinkStart: [{
        enabled: true,
        ready: false,
        status: 'pending',
        reason: null,
        attempt_id: 'attempt-1',
        connect_url: 'https://t.me/pingwatch_bot?start=token-1',
        expires_at: '2099-01-01T00:00:00Z',
      }],
      start: { session_id: 'sess_1', device_id: 'device-1', status: 'active' },
      stop: { session_id: 'sess_1', device_id: 'device-1', status: 'stopped' },
      createEvent: {},
      events: [[]],
    })
    vi.stubGlobal('fetch', fetchMock)
    const openSpy = vi.spyOn(window, 'open')
      .mockReturnValueOnce(null)

    render(<App />)

    await user.click(
      await screen.findByRole('button', { name: /connect telegram alerts/i })
    )

    expect(openSpy).toHaveBeenNthCalledWith(
      1,
      'https://t.me/pingwatch_bot?start=token-1',
      '_blank',
      'noopener,noreferrer'
    )
    const fallbackLink = screen.getByRole('link', {
      name: /open telegram link again/i,
    })
    expect(fallbackLink).toHaveAttribute(
      'href',
      'https://t.me/pingwatch_bot?start=token-1'
    )
    expect(screen.getByText(/popup blocked/i)).toBeInTheDocument()

    openSpy.mockRestore()
  })

  it('opens a placeholder popup immediately while creating Telegram link on mobile', async () => {
    const user = userEvent.setup()

    let resolveLinkStart: ((value: Response) => void) | null = null
    const linkStartPromise = new Promise<Response>((resolve) => {
      resolveLinkStart = resolve
    })

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString()
      if (url.endsWith('/devices/register')) {
        return Promise.resolve(buildResponse({
          device_id: 'device-1',
          label: null,
          created_at: 'now',
        }))
      }
      if (url.includes('/notifications/telegram/readiness')) {
        return Promise.resolve(buildResponse({
          enabled: true,
          ready: false,
          status: 'needs_user_action',
          reason: 'Open Telegram and send /start to your bot, then return.',
          connect_url: null,
        }))
      }
      if (url.endsWith('/notifications/telegram/link/start') && init?.method === 'POST') {
        return linkStartPromise
      }
      return Promise.resolve(buildResponse({}))
    })
    vi.stubGlobal('fetch', fetchMock)

    const previousUserAgent = navigator.userAgent
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      configurable: true,
    })

    const popup = { location: { href: '' }, close: vi.fn() } as unknown as Window
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(popup)

    render(<App />)

    await user.click(
      await screen.findByRole('button', { name: /connect telegram alerts/i })
    )

    expect(openSpy).toHaveBeenCalledWith('', '_blank', 'noopener,noreferrer')

    await act(async () => {
      resolveLinkStart?.(buildResponse({
        enabled: true,
        ready: false,
        status: 'pending',
        reason: null,
        attempt_id: 'attempt-1',
        connect_url: 'https://t.me/pingwatch_bot?start=token-1',
        expires_at: '2099-01-01T00:00:00Z',
      }))
    })
    await waitFor(() => {
      expect(popup.location.href).toBe('https://t.me/pingwatch_bot?start=token-1')
    })

    Object.defineProperty(window.navigator, 'userAgent', {
      value: previousUserAgent,
      configurable: true,
    })
    openSpy.mockRestore()
  })

  it('persists telegram link attempt state for backup-check flow', async () => {
    const user = userEvent.setup()
    const fetchMock = createFetchMock({
      telegramReadiness: [{
        enabled: true,
        ready: false,
        status: 'needs_user_action',
        reason: 'Open Telegram and send /start to your bot, then return.',
        connect_url: null,
      }],
      telegramLinkStart: [{
        enabled: true,
        ready: false,
        status: 'pending',
        reason: null,
        attempt_id: 'attempt-1',
        connect_url: 'https://t.me/pingwatch_bot?start=token-1',
        expires_at: '2099-01-01T00:00:00Z',
      }],
      start: { session_id: 'sess_1', device_id: 'device-1', status: 'active' },
      stop: { session_id: 'sess_1', device_id: 'device-1', status: 'stopped' },
      createEvent: {},
      events: [[]],
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'open').mockReturnValueOnce(null)

    render(<App />)
    await user.click(
      await screen.findByRole('button', { name: /connect telegram alerts/i })
    )

    expect(localStorage.getItem(TELEGRAM_LINK_ATTEMPT_KEY)).toBe('attempt-1')
    expect(localStorage.getItem(TELEGRAM_LINK_FALLBACK_URL_KEY)).toBe(
      'https://t.me/pingwatch_bot?start=token-1'
    )
    expect(localStorage.getItem(TELEGRAM_LINK_FALLBACK_COMMAND_KEY)).toBe(
      '/start token-1'
    )
  })

  it('persists Telegram reopen link and fallback command even when popup opens', async () => {
    const user = userEvent.setup()
    const fetchMock = createFetchMock({
      telegramReadiness: [{
        enabled: true,
        ready: false,
        status: 'needs_user_action',
        reason: 'Open Telegram and send /start to your bot, then return.',
        connect_url: null,
      }],
      telegramLinkStart: [{
        enabled: true,
        ready: false,
        status: 'pending',
        reason: null,
        attempt_id: 'attempt-1',
        connect_url: 'https://t.me/pingwatch_bot?start=token-1',
        expires_at: '2099-01-01T00:00:00Z',
        link_code: 'token-1',
        fallback_command: '/start token-1',
      }],
      start: { session_id: 'sess_1', device_id: 'device-1', status: 'active' },
      stop: { session_id: 'sess_1', device_id: 'device-1', status: 'stopped' },
      createEvent: {},
      events: [[]],
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'open').mockReturnValue({
      location: { href: '' },
      close: vi.fn(),
    } as unknown as Window)

    render(<App />)
    await user.click(
      await screen.findByRole('button', { name: /connect telegram alerts/i })
    )

    expect(localStorage.getItem(TELEGRAM_LINK_FALLBACK_URL_KEY)).toBe(
      'https://t.me/pingwatch_bot?start=token-1'
    )
    expect(localStorage.getItem(TELEGRAM_LINK_FALLBACK_COMMAND_KEY)).toBe(
      '/start token-1'
    )
  })

  it('shows fallback Telegram start command while waiting for confirmation', async () => {
    const user = userEvent.setup()
    const fetchMock = createFetchMock({
      telegramReadiness: [{
        enabled: true,
        ready: false,
        status: 'needs_user_action',
        reason: 'Open Telegram and send /start to your bot, then return.',
        connect_url: null,
      }],
      telegramLinkStart: [{
        enabled: true,
        ready: false,
        status: 'pending',
        reason: null,
        attempt_id: 'attempt-1',
        connect_url: 'https://t.me/pingwatch_bot?start=token-1',
        expires_at: '2099-01-01T00:00:00Z',
        link_code: 'token-1',
        fallback_command: '/start token-1',
      }],
      start: { session_id: 'sess_1', device_id: 'device-1', status: 'active' },
      stop: { session_id: 'sess_1', device_id: 'device-1', status: 'stopped' },
      createEvent: {},
      events: [[]],
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'open').mockReturnValueOnce(null)

    render(<App />)
    await user.click(
      await screen.findByRole('button', { name: /connect telegram alerts/i })
    )

    expect(screen.getByText('/start token-1')).toBeInTheDocument()
  })

  it('lists recipients and lets the owner add or remove device subscriptions', async () => {
    const user = userEvent.setup()
    const fetchMock = createFetchMock({
      telegramReadiness: [{
        enabled: true,
        ready: true,
        status: 'ready',
        reason: null,
      }],
      recipients: {
        lists: [
          {
            device_id: 'device-1',
            recipients: [
              {
                endpoint_id: 'endpoint-1',
                provider: 'telegram',
                chat_id: '111',
                telegram_username: 'alice',
                linked_at: '2026-03-10T12:00:00Z',
                subscribed: true,
              },
              {
                endpoint_id: 'endpoint-2',
                provider: 'telegram',
                chat_id: '222',
                telegram_username: 'bob',
                linked_at: '2026-03-10T12:05:00Z',
                subscribed: false,
              },
            ],
          },
          {
            device_id: 'device-1',
            recipients: [
              {
                endpoint_id: 'endpoint-1',
                provider: 'telegram',
                chat_id: '111',
                telegram_username: 'alice',
                linked_at: '2026-03-10T12:00:00Z',
                subscribed: true,
              },
              {
                endpoint_id: 'endpoint-2',
                provider: 'telegram',
                chat_id: '222',
                telegram_username: 'bob',
                linked_at: '2026-03-10T12:05:00Z',
                subscribed: true,
              },
            ],
          },
          {
            device_id: 'device-1',
            recipients: [
              {
                endpoint_id: 'endpoint-1',
                provider: 'telegram',
                chat_id: '111',
                telegram_username: 'alice',
                linked_at: '2026-03-10T12:00:00Z',
                subscribed: false,
              },
              {
                endpoint_id: 'endpoint-2',
                provider: 'telegram',
                chat_id: '222',
                telegram_username: 'bob',
                linked_at: '2026-03-10T12:05:00Z',
                subscribed: true,
              },
            ],
          },
        ],
        add: [{
          endpoint_id: 'endpoint-2',
          provider: 'telegram',
          chat_id: '222',
          telegram_username: 'bob',
          linked_at: '2026-03-10T12:05:00Z',
          subscribed: true,
        }],
        remove: [{
          device_id: 'device-1',
          endpoint_id: 'endpoint-1',
          removed: true,
        }],
      },
      start: { session_id: 'sess_1', device_id: 'device-1', status: 'active' },
      stop: { session_id: 'sess_1', device_id: 'device-1', status: 'stopped' },
      createEvent: {},
      events: [[]],
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    const telegramSection = await screen.findByRole('region', {
      name: /^telegram$/i,
    })
    expect(screen.queryByRole('region', { name: /telegram recipients/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /share access/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /accept shared invite/i })).not.toBeInTheDocument()
    expect(within(telegramSection).getByText('@alice')).toBeInTheDocument()
    expect(within(telegramSection).getByText('@bob')).toBeInTheDocument()
    expect(within(telegramSection).getByText('Subscribed')).toBeInTheDocument()
    expect(within(telegramSection).getByText('Not subscribed')).toBeInTheDocument()

    await user.click(
      within(telegramSection).getByRole('button', { name: /add bob to alerts/i })
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/notifications/recipients',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          device_id: 'device-1',
          endpoint_id: 'endpoint-2',
        }),
      })
    )
    await waitFor(() => {
      expect(within(telegramSection).getAllByText('Subscribed')).toHaveLength(2)
    })

    await user.click(
      within(telegramSection).getByRole('button', { name: /remove alice from alerts/i })
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/notifications/recipients?device_id=device-1&endpoint_id=endpoint-1',
      expect.objectContaining({
        method: 'DELETE',
      })
    )
    await waitFor(() => {
      expect(within(telegramSection).getByText('Not subscribed')).toBeInTheDocument()
    })
  })

  it('re-runs recipient onboarding from the recipient controls area', async () => {
    const user = userEvent.setup()
    const fetchMock = createFetchMock({
      telegramReadiness: [{
        enabled: true,
        ready: true,
        status: 'ready',
        reason: null,
      }],
      recipients: {
        lists: [{
          device_id: 'device-1',
          recipients: [],
        }],
      },
      telegramLinkStart: [{
        enabled: true,
        ready: false,
        status: 'pending',
        reason: null,
        attempt_id: 'attempt-2',
        connect_url: 'https://t.me/pingwatch_bot?start=token-2',
        expires_at: '2099-01-01T00:00:00Z',
        link_code: 'token-2',
        fallback_command: '/start token-2',
      }],
      start: { session_id: 'sess_1', device_id: 'device-1', status: 'active' },
      stop: { session_id: 'sess_1', device_id: 'device-1', status: 'stopped' },
      createEvent: {},
      events: [[]],
    })
    vi.stubGlobal('fetch', fetchMock)
    const popup = { location: { href: '' }, close: vi.fn() } as unknown as Window
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(popup)

    render(<App />)

    const telegramSection = await screen.findByRole('region', {
      name: /^telegram$/i,
    })
    await user.click(
      within(telegramSection).getByRole('button', { name: /re-run telegram onboarding/i })
    )

    expect(openSpy).toHaveBeenCalledWith(
      'https://t.me/pingwatch_bot?start=token-2',
      '_blank',
      'noopener,noreferrer'
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/notifications/telegram/link/start',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          device_id: 'device-1',
        }),
      })
    )

    openSpy.mockRestore()
  })

  it('lets the owner create and revoke a share invite', async () => {
    const user = userEvent.setup()
    const fetchMock = createFetchMock({
      telegramReadiness: [{
        enabled: true,
        ready: true,
        status: 'ready',
        reason: null,
      }],
      invites: {
        lists: [
          {
            device_id: 'device-1',
            invites: [],
          },
          {
            device_id: 'device-1',
            invites: [{
              invite_id: 'invite-1',
              device_id: 'device-1',
              status: 'pending',
              invite_code: null,
              created_at: '2026-03-11T10:00:00Z',
              expires_at: '2026-03-11T10:30:00Z',
              accepted_at: null,
              revoked_at: null,
              recipient_chat_id: null,
              recipient_telegram_username: null,
            }],
          },
          {
            device_id: 'device-1',
            invites: [{
              invite_id: 'invite-1',
              device_id: 'device-1',
              status: 'revoked',
              invite_code: null,
              created_at: '2026-03-11T10:00:00Z',
              expires_at: '2026-03-11T10:30:00Z',
              accepted_at: null,
              revoked_at: '2026-03-11T10:05:00Z',
              recipient_chat_id: null,
              recipient_telegram_username: null,
            }],
          },
        ],
        create: [{
          invite_id: 'invite-1',
          device_id: 'device-1',
          status: 'pending',
          invite_code: 'share-code-1',
          created_at: '2026-03-11T10:00:00Z',
          expires_at: '2026-03-11T10:30:00Z',
          accepted_at: null,
          revoked_at: null,
          recipient_chat_id: null,
          recipient_telegram_username: null,
        }],
        revoke: [{
          invite_id: 'invite-1',
          device_id: 'device-1',
          status: 'revoked',
          invite_code: 'share-code-1',
          created_at: '2026-03-11T10:00:00Z',
          expires_at: '2026-03-11T10:30:00Z',
          accepted_at: null,
          revoked_at: '2026-03-11T10:05:00Z',
          recipient_chat_id: null,
          recipient_telegram_username: null,
        }],
      },
      recipients: {
        lists: [{
          device_id: 'device-1',
          recipients: [],
        }],
      },
      start: { session_id: 'sess_1', device_id: 'device-1', status: 'active' },
      stop: { session_id: 'sess_1', device_id: 'device-1', status: 'stopped' },
      createEvent: {},
      events: [[]],
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

    const telegramSection = await screen.findByRole('region', {
      name: /^telegram$/i,
    })
    await user.click(
      within(telegramSection).getByRole('button', { name: /another phone/i })
    )
    await user.click(
      within(telegramSection).getByRole('button', { name: /create share invite/i })
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/notifications/invites',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          device_id: 'device-1',
        }),
      })
    )
    await waitFor(() => {
      expect(within(telegramSection).getByText('share-code-1')).toBeInTheDocument()
      expect(within(telegramSection).getByText('Pending')).toBeInTheDocument()
    })

    await user.click(
      within(telegramSection).getByRole('button', { name: /revoke invite invite-1/i })
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/notifications/invites?device_id=device-1&invite_id=invite-1',
      expect.objectContaining({
        method: 'DELETE',
      })
    )
    await waitFor(() => {
      expect(within(telegramSection).getByText('Revoked')).toBeInTheDocument()
    })
  })

  it('accepts a share invite through Telegram linking', async () => {
    const user = userEvent.setup()
    const fetchMock = createFetchMock({
      telegramReadiness: [{
        enabled: true,
        ready: true,
        status: 'ready',
        reason: null,
      }],
      telegramLinkStatus: [{
        enabled: true,
        ready: true,
        linked: true,
        status: 'ready',
        reason: null,
        attempt_id: 'share-attempt-1',
      }],
      invites: {
        lists: [{
          device_id: 'device-1',
          invites: [],
        }],
        accept: [{
          enabled: true,
          ready: false,
          status: 'pending',
          reason: null,
          attempt_id: 'share-attempt-1',
          connect_url: 'https://t.me/pingwatch_bot?start=share-token-1',
          expires_at: '2099-01-01T00:00:00Z',
          link_code: 'share-token-1',
          fallback_command: '/start share-token-1',
          device_id: 'shared-device-1',
        }],
      },
      recipients: {
        lists: [{
          device_id: 'device-1',
          recipients: [],
        }],
      },
      start: { session_id: 'sess_1', device_id: 'device-1', status: 'active' },
      stop: { session_id: 'sess_1', device_id: 'device-1', status: 'stopped' },
      createEvent: {},
      events: [[]],
    })
    vi.stubGlobal('fetch', fetchMock)
    const popup = { location: { href: '' }, close: vi.fn() } as unknown as Window
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(popup)

    render(<App />)

    const telegramSection = await screen.findByRole('region', {
      name: /^telegram$/i,
    })
    await user.click(
      within(telegramSection).getByRole('button', { name: /another phone/i })
    )
    await user.type(
      within(telegramSection).getByLabelText(/invite code/i),
      'share-code-1'
    )
    await user.click(
      within(telegramSection).getByRole('button', { name: /accept invite/i })
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/notifications/invites/accept',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          invite_code: 'share-code-1',
        }),
      })
    )
    expect(openSpy).toHaveBeenCalledWith(
      'https://t.me/pingwatch_bot?start=share-token-1',
      '_blank',
      'noopener,noreferrer'
    )
    await waitFor(() => {
      expect(screen.getByText(/shared invite accepted/i)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /start monitoring/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /telegram recipients/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /share access/i })).not.toBeInTheDocument()

    openSpy.mockRestore()
  })

  it('clears stale telegram attempt state when status returns not_found', async () => {
    const fetchMock = createFetchMock({
      telegramReadiness: [{
        enabled: true,
        ready: false,
        status: 'needs_user_action',
        reason: 'Tap Connect Telegram alerts to start linking.',
      }],
      telegramLinkStatus: [{
        enabled: true,
        ready: false,
        linked: false,
        status: 'not_found',
        reason: 'This link attempt no longer exists. Start a new Telegram connection.',
        attempt_id: 'attempt-stale',
      }],
      start: { session_id: 'sess_1', device_id: 'device-1', status: 'active' },
      stop: { session_id: 'sess_1', device_id: 'device-1', status: 'stopped' },
      createEvent: {},
      events: [[]],
    })
    vi.stubGlobal('fetch', fetchMock)
    localStorage.setItem(TELEGRAM_LINK_ATTEMPT_KEY, 'attempt-stale')
    localStorage.setItem(TELEGRAM_LINK_WAITING_KEY, '1')
    localStorage.setItem(
      TELEGRAM_LINK_FALLBACK_URL_KEY,
      'https://t.me/pingwatch_bot?start=token-stale'
    )
    localStorage.setItem(TELEGRAM_LINK_FALLBACK_COMMAND_KEY, '/start token-stale')

    render(<App />)

    await waitFor(() => {
      expect(localStorage.getItem(TELEGRAM_LINK_ATTEMPT_KEY)).toBeNull()
      expect(localStorage.getItem(TELEGRAM_LINK_WAITING_KEY)).toBeNull()
      expect(localStorage.getItem(TELEGRAM_LINK_FALLBACK_URL_KEY)).toBeNull()
      expect(localStorage.getItem(TELEGRAM_LINK_FALLBACK_COMMAND_KEY)).toBeNull()
    })
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
    await addRequiredAlertInstruction(user)

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
    localStorage.setItem(FRONTEND_MODE_KEY, 'dev')
    render(<App />)

    expect(await screen.findByText(/queued clips/i)).toBeInTheDocument()
    expect(screen.getByText('0 remaining')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /force stop/i })
    ).toBeInTheDocument()
  })

  it('force stop clears local clips and requests server-side force stop', async () => {
    const user = userEvent.setup()
    localStorage.setItem(FRONTEND_MODE_KEY, 'dev')
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
    await addRequiredAlertInstruction(user)

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
    localStorage.setItem(FRONTEND_MODE_KEY, 'dev')
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
    await addRequiredAlertInstruction(user)
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
    await addRequiredAlertInstruction(user)

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
    await addRequiredAlertInstruction(user)

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
    await addRequiredAlertInstruction(user)

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
          inference_provider: 'nvidia',
          inference_model: 'nvidia/nemotron-nano-12b-v2-vl',
          should_notify: true,
          alert_reason: 'Matched person entering front door',
          matched_rules: ['person entering front door'],
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
    await addRequiredAlertInstruction(user)

    await user.click(
      screen.getByRole('button', { name: /start monitoring/i })
    )

    const clipSection = screen.getByRole('heading', { name: /stored clips/i }).closest('section')
    expect(clipSection).not.toBeNull()
    const scoped = within(clipSection as HTMLElement)

    expect(await scoped.findByText(/inference: done/i)).toBeInTheDocument()
    expect(scoped.getByText(/alert/i)).toBeInTheDocument()
    expect(scoped.getByText(/person entered room/i)).toBeInTheDocument()
    expect(scoped.getByText(/matched person entering front door/i)).toBeInTheDocument()
    expect(scoped.getByText(/^person$/i)).toBeInTheDocument()
    expect(scoped.getByText(/90%/i)).toBeInTheDocument()
    expect(scoped.getByText(/nvidia · nvidia\/nemotron-nano-12b-v2-vl/i)).toBeInTheDocument()

    vi.restoreAllMocks()
  })

  it('starts in user mode and hides developer-only recording controls', async () => {
    render(<App />)

    expect(await screen.findByRole('button', { name: /user mode/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.queryByRole('heading', { name: /recording settings/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/^benchmark$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^current clip$/i)).not.toBeInTheDocument()
  })

  it('shows recording settings controls in dev mode', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /dev mode/i }))

    expect(screen.getByRole('heading', { name: /recording settings/i })).toBeInTheDocument()
    expect(
      screen.getByRole('slider', { name: /clip duration/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('slider', { name: /motion delta threshold/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('slider', { name: /motion absolute threshold/i })
    ).toBeInTheDocument()
  })

  it('persists the selected frontend mode', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /dev mode/i }))

    expect(localStorage.getItem(FRONTEND_MODE_KEY)).toBe('dev')
  })

  it('shows optional audio detection toggles', async () => {
    localStorage.setItem(FRONTEND_MODE_KEY, 'dev')
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
    localStorage.setItem(FRONTEND_MODE_KEY, 'dev')
    render(<App />)

    const toggle = await screen.findByRole('checkbox', { name: /enable audio delta/i })
    await user.click(toggle)

    expect(
      screen.getByRole('slider', { name: /audio delta threshold/i })
    ).toBeInTheDocument()
  })

  it('shows loud threshold slider when enabled', async () => {
    const user = userEvent.setup()
    localStorage.setItem(FRONTEND_MODE_KEY, 'dev')
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

    localStorage.setItem(FRONTEND_MODE_KEY, 'dev')
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
    localStorage.setItem(FRONTEND_MODE_KEY, 'dev')
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
    await addRequiredAlertInstruction(user)

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
    await addRequiredAlertInstruction(user)

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
    await addRequiredAlertInstruction(user)

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
    await addRequiredAlertInstruction(user)

    await user.click(
      screen.getByRole('button', { name: /start monitoring/i })
    )

    const eventsSection = screen.getByRole('heading', { name: /recent events/i }).closest('section')
    expect(eventsSection).not.toBeNull()
    const list = within(eventsSection as HTMLElement).getByRole('list')
    const monitoringSection = screen.getByRole('heading', { name: /monitoring controls/i }).closest('section')
    expect(monitoringSection).not.toBeNull()
    expect(await screen.findByText('2 captured')).toBeInTheDocument()
    expect(within(monitoringSection as HTMLElement).getByText(/latest event summary/i)).toBeInTheDocument()
    expect(within(monitoringSection as HTMLElement).getByText(/audio spike/i)).toBeInTheDocument()
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
    await addRequiredAlertInstruction(user)

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
    localStorage.setItem(FRONTEND_MODE_KEY, 'dev')
    render(<App />)

    expect(await screen.findByText(/current clip/i)).toBeInTheDocument()
    expect(screen.getByText('#0')).toBeInTheDocument()
    expect(screen.getByText(/^benchmark$/i)).toBeInTheDocument()
    expect(screen.getByText(/not set/i)).toBeInTheDocument()
  })

  it('shows session stats', async () => {
    localStorage.setItem(FRONTEND_MODE_KEY, 'dev')
    render(<App />)

    expect(await screen.findByText(/session stats/i)).toBeInTheDocument()
    expect(screen.getByText(/stored: 0/i)).toBeInTheDocument()
    expect(screen.getByText(/discarded: 0/i)).toBeInTheDocument()
  })

  it('shows real-time motion/audio scores', async () => {
    localStorage.setItem(FRONTEND_MODE_KEY, 'dev')
    render(<App />)

    expect(await screen.findByText(/motion \/ audio/i)).toBeInTheDocument()
    // Initial values are 0
    expect(screen.getByText('0.000 / 0.000')).toBeInTheDocument()
  })
})
