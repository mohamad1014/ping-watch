import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import './App.css'
import {
  acceptNotificationInvite,
  addNotificationRecipient,
  ApiError,
  type AuthSession,
  createNotificationInvite,
  type EventResponse,
  forceStopSession,
  getAuthSession,
  listNotificationRecipients,
  listNotificationInvites,
  type NotificationRecipient,
  type NotificationInvite,
  revokeNotificationInvite,
  removeNotificationRecipient,
  sendTelegramTestAlert,
  getTelegramLinkStatus,
  getTelegramReadiness,
  loginWithEmail,
  listEvents,
  startTelegramLink,
  startSession,
  stopSession,
  type TelegramReadinessResponse,
} from './api'
import {
  deleteAllClips,
  deleteClipsBySession,
  getClip,
  listClips,
  saveClip,
  type StoredClip,
} from './clipStore'
import { uploadPendingClips } from './clipUpload'
import { ensureDeviceId } from './device'
import { SequentialRecorder, type ClipCompleteData } from './sequentialRecorder'
import { createSerialQueue, type SerialQueue } from './clipProcessingQueue'
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
import {
  useRecordingSettings,
  useMotionDetection,
  useAudioDetection,
} from './hooks'

const statusLabels = {
  idle: 'Idle',
  active: 'Active',
  stopped: 'Stopped',
} as const

type SessionStatus = keyof typeof statusLabels
type CaptureStatus = 'idle' | 'active' | 'error'
type FrontendMode = 'user' | 'dev'
type TelegramSetupPath = 'device' | 'invite'
type QueuedClip = {
  data: ClipCompleteData
  sessionId: string
  deviceId: string
}

const FRONTEND_MODE_KEY = 'ping-watch:frontend-mode'
const TELEGRAM_LINK_ATTEMPT_KEY = 'ping-watch:telegram-link-attempt-id'
const TELEGRAM_LINK_ATTEMPT_DEVICE_ID_KEY = 'ping-watch:telegram-link-attempt-device-id'
const TELEGRAM_LINK_FLOW_KEY = 'ping-watch:telegram-link-flow'
const TELEGRAM_LINK_FALLBACK_URL_KEY = 'ping-watch:telegram-link-fallback-url'
const TELEGRAM_LINK_FALLBACK_COMMAND_KEY = 'ping-watch:telegram-link-fallback-command'
const TELEGRAM_LINK_WAITING_KEY = 'ping-watch:telegram-link-waiting'
const RECIPIENT_SHARED_DEVICE_ID_KEY = 'ping-watch:recipient-shared-device-id'

type TelegramLinkFlow = 'device' | 'invite'

const getEnvNumber = (key: string) => {
  const env = (import.meta as ImportMeta & {
    env?: Record<string, string | undefined>
  }).env
  const processEnv = (globalThis as {
    process?: {
      env?: Record<string, string | undefined>
    }
  }).process?.env
  const raw = env?.[key] ?? processEnv?.[key]
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

const getPollIntervalMs = () => {
  const envValue = getEnvNumber('VITE_POLL_INTERVAL_MS')
  if (typeof envValue === 'number') return envValue
  const override = (globalThis as { __PING_WATCH_POLL_INTERVAL__?: number })
    .__PING_WATCH_POLL_INTERVAL__
  return typeof override === 'number' ? override : 5000
}

const getUploadIntervalMs = () => {
  const envValue = getEnvNumber('VITE_UPLOAD_INTERVAL_MS')
  if (typeof envValue === 'number') return envValue
  const override = (globalThis as { __PING_WATCH_UPLOAD_INTERVAL__?: number })
    .__PING_WATCH_UPLOAD_INTERVAL__
  return typeof override === 'number' ? override : 10_000
}

const isMediaDisabled = () =>
  (globalThis as { __PING_WATCH_DISABLE_MEDIA__?: boolean })
    .__PING_WATCH_DISABLE_MEDIA__ === true

const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

const formatDuration = (seconds: number) => `${seconds.toFixed(1)}s`

const formatConfidence = (value: number | null | undefined) => {
  if (value === null || value === undefined) return null
  return `${Math.round(value * 100)}%`
}

const formatInferenceSource = (
  provider: string | null | undefined,
  model: string | null | undefined
) => {
  if (!provider && !model) return null
  if (provider && model) return `${provider} · ${model}`
  return provider ?? model
}

const generateClipId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `clip_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

const formatTriggers = (triggers: TriggerReason[]) =>
  triggers
    .map((t) => {
      switch (t) {
        case 'motionDelta': return 'motion\u0394'
        case 'motionAbsolute': return 'motion'
        case 'audioDelta': return 'audio\u0394'
        case 'audioAbsolute': return 'loud'
        default: return t
      }
    })
    .join(', ')

const readStoredTelegramValue = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const writeStoredTelegramValue = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
      return
    }
    localStorage.setItem(key, value)
  } catch {
    // Ignore storage errors and continue with in-memory state.
  }
}

const shouldPreOpenTelegramPopup = () => {
  if (typeof navigator === 'undefined') return false
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent)
}

const deriveTelegramFallbackCommand = (
  explicitCommand: string | null,
  connectUrl: string | null
) => {
  if (explicitCommand) return explicitCommand
  if (!connectUrl) return null
  try {
    const token = new URL(connectUrl).searchParams.get('start')
    if (!token) return null
    return `/start ${token}`
  } catch {
    return null
  }
}

const isTerminalTelegramLinkStatus = (status: string) =>
  status === 'not_found'
  || status === 'expired'
  || status === 'unknown_device'
  || status === 'not_configured'

const formatRecipientHandle = (recipient: NotificationRecipient) =>
  recipient.telegramUsername ? `@${recipient.telegramUsername}` : recipient.chatId

const formatRecipientActionName = (
  action: 'add' | 'remove',
  recipient: NotificationRecipient
) => {
  const label = recipient.telegramUsername ?? recipient.chatId
  return `${action === 'add' ? 'Add' : 'Remove'} ${label} ${action === 'add' ? 'to' : 'from'} alerts`
}

const formatInviteStatus = (status: string) =>
  status.charAt(0).toUpperCase() + status.slice(1)

const formatInviteRecipient = (invite: NotificationInvite) =>
  invite.recipientTelegramUsername
    ? `@${invite.recipientTelegramUsername}`
    : invite.recipientChatId

const formatInviteActionName = (invite: NotificationInvite) =>
  `Revoke invite ${invite.inviteId}`

const formatInviteDismissActionName = (invite: NotificationInvite) =>
  `Remove invite ${invite.inviteId} from list`

const createEmptyAlertInstructions = () => ['']
const TELEGRAM_READY_CONFIRMATION_GRACE_MS = 15000

const readStoredFrontendMode = (): FrontendMode => {
  try {
    return localStorage.getItem(FRONTEND_MODE_KEY) === 'dev' ? 'dev' : 'user'
  } catch {
    return 'user'
  }
}

const writeStoredFrontendMode = (mode: FrontendMode) => {
  try {
    localStorage.setItem(FRONTEND_MODE_KEY, mode)
  } catch {
    // Ignore storage errors and continue with in-memory state.
  }
}

const buildShareInviteLink = (inviteCode: string) => {
  if (typeof window === 'undefined') return inviteCode
  try {
    const url = new URL(window.location.href)
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1)
    }
    url.search = ''
    url.hash = ''
    url.searchParams.set('invite', inviteCode)
    return url.toString()
  } catch {
    return inviteCode
  }
}

const copyTextToClipboard = async (value: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
    throw new Error('Clipboard unavailable')
  }

  const textArea = document.createElement('textarea')
  textArea.value = value
  textArea.setAttribute('readonly', '')
  textArea.style.position = 'fixed'
  textArea.style.top = '-9999px'
  textArea.style.left = '-9999px'
  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()
  textArea.setSelectionRange(0, textArea.value.length)

  const didCopy = document.execCommand('copy')
  document.body.removeChild(textArea)
  if (!didCopy) {
    throw new Error('Clipboard unavailable')
  }
}

const readInviteCodeFromUrl = () => {
  if (typeof window === 'undefined') return null
  try {
    const inviteCode = new URLSearchParams(window.location.search).get('invite')?.trim() ?? null
    return inviteCode ? inviteCode : null
  } catch {
    return null
  }
}

type TelegramLinkStateFromUrl = {
  attemptId: string
  deviceId: string
  flow: TelegramLinkFlow
}

const readTelegramLinkStateFromUrl = (): TelegramLinkStateFromUrl | null => {
  if (typeof window === 'undefined') return null
  try {
    const params = new URLSearchParams(window.location.search)
    const attemptId = params.get('telegram_link_attempt_id')?.trim() ?? ''
    const deviceId = params.get('telegram_link_device_id')?.trim() ?? ''
    if (!attemptId || !deviceId) {
      return null
    }
    return {
      attemptId,
      deviceId,
      flow: params.get('telegram_link_flow') === 'invite' ? 'invite' : 'device',
    }
  } catch {
    return null
  }
}

const clearInviteCodeFromUrl = () => {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('invite')) return
    url.searchParams.delete('invite')
    const nextSearch = url.searchParams.toString()
    const nextUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ''}${url.hash}`
    window.history.replaceState(window.history.state, '', nextUrl)
  } catch {
    // Ignore URL cleanup errors and continue.
  }
}

const clearTelegramLinkStateFromUrl = () => {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    const keys = [
      'telegram_link_attempt_id',
      'telegram_link_device_id',
      'telegram_link_flow',
    ]
    if (!keys.some((key) => url.searchParams.has(key))) return
    keys.forEach((key) => {
      url.searchParams.delete(key)
    })
    const nextSearch = url.searchParams.toString()
    const nextUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ''}${url.hash}`
    window.history.replaceState(window.history.state, '', nextUrl)
  } catch {
    // Ignore URL cleanup errors and continue.
  }
}

type CollapsiblePanelProps = {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  className?: string
  contentClassName?: string
  headerContent?: ReactNode
  collapsible?: boolean
}

function CollapsiblePanel({
  title,
  children,
  defaultOpen = true,
  className,
  contentClassName,
  headerContent,
  collapsible = true,
}: CollapsiblePanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const titleId = useId()
  const contentId = useId()
  const isVisible = collapsible ? isOpen : true

  return (
    <section className={`panel${className ? ` ${className}` : ''}`} aria-labelledby={titleId}>
      <div className="panel-header">
        <div className="panel-heading-group">
          <h2 id={titleId} className="panel-title">{title}</h2>
          {headerContent}
        </div>
        {collapsible && (
          <button
            type="button"
            className="panel-toggle"
            aria-expanded={isOpen}
            aria-controls={contentId}
            aria-label={`Toggle ${title}`}
            onClick={() => setIsOpen((value) => !value)}
          >
            {isOpen ? 'Minimize' : 'Expand'}
          </button>
        )}
      </div>
      {isVisible && (
        <div id={contentId} className={contentClassName}>
          {children}
        </div>
      )}
    </section>
  )
}

function App() {
  const [authSession, setAuthSession] = useState<AuthSession>(() => getAuthSession())
  const [accountEmail, setAccountEmail] = useState(() => getAuthSession().email ?? '')
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [frontendMode, setFrontendMode] = useState<FrontendMode>(() => readStoredFrontendMode())

  // Session state
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [events, setEvents] = useState<EventResponse[]>([])
  const [isBusy, setIsBusy] = useState(false)
  const [isForceStopping, setIsForceStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedEventId, setCopiedEventId] = useState<string | null>(null)
  const [alertInstructions, setAlertInstructions] = useState<string[]>(createEmptyAlertInstructions)
  const [telegramReadiness, setTelegramReadiness] = useState<TelegramReadinessResponse | null>(null)
  const [checkingTelegramReadiness, setCheckingTelegramReadiness] = useState(false)
  const telegramLinkStateFromUrl = readTelegramLinkStateFromUrl()
  const [isWaitingForTelegramConnect, setIsWaitingForTelegramConnect] = useState(
    () => telegramLinkStateFromUrl !== null || readStoredTelegramValue(TELEGRAM_LINK_WAITING_KEY) === '1'
  )
  const [telegramPopupFallbackUrl, setTelegramPopupFallbackUrl] = useState<string | null>(
    () => readStoredTelegramValue(TELEGRAM_LINK_FALLBACK_URL_KEY)
  )
  const [telegramFallbackCommand, setTelegramFallbackCommand] = useState<string | null>(
    () => readStoredTelegramValue(TELEGRAM_LINK_FALLBACK_COMMAND_KEY)
  )
  const [telegramLinkAttemptId, setTelegramLinkAttemptId] = useState<string | null>(
    () => telegramLinkStateFromUrl?.attemptId ?? readStoredTelegramValue(TELEGRAM_LINK_ATTEMPT_KEY)
  )
  const [telegramLinkAttemptDeviceId, setTelegramLinkAttemptDeviceId] = useState<string | null>(
    () => telegramLinkStateFromUrl?.deviceId ?? readStoredTelegramValue(TELEGRAM_LINK_ATTEMPT_DEVICE_ID_KEY)
  )
  const [telegramLinkFlow, setTelegramLinkFlow] = useState<TelegramLinkFlow>(
    () => telegramLinkStateFromUrl?.flow ?? (readStoredTelegramValue(TELEGRAM_LINK_FLOW_KEY) === 'invite' ? 'invite' : 'device')
  )
  const [telegramRecipients, setTelegramRecipients] = useState<NotificationRecipient[]>([])
  const [loadingTelegramRecipients, setLoadingTelegramRecipients] = useState(false)
  const [updatingRecipientEndpointId, setUpdatingRecipientEndpointId] = useState<string | null>(null)
  const [notificationInvites, setNotificationInvites] = useState<NotificationInvite[]>([])
  const [dismissedInviteIds, setDismissedInviteIds] = useState<string[]>([])
  const [loadingNotificationInvites, setLoadingNotificationInvites] = useState(false)
  const [updatingInviteId, setUpdatingInviteId] = useState<string | null>(null)
  const [latestInviteCode, setLatestInviteCode] = useState<string | null>(null)
  const [latestInviteCopyStatus, setLatestInviteCopyStatus] = useState<'idle' | 'copied'>('idle')
  const [inviteCodeInput, setInviteCodeInput] = useState('')
  const [inviteCodeFromUrl, setInviteCodeFromUrl] = useState<string | null>(() => readInviteCodeFromUrl())
  const [inviteAcceptedMessage, setInviteAcceptedMessage] = useState<string | null>(null)
  const [showInviteCodeFallback, setShowInviteCodeFallback] = useState(false)
  const [telegramStepExpanded, setTelegramStepExpanded] = useState(false)
  const [telegramTestAlertMessage, setTelegramTestAlertMessage] = useState<string | null>(null)
  const [sendingTelegramTestAlert, setSendingTelegramTestAlert] = useState(false)
  const [showAlertPreview, setShowAlertPreview] = useState(false)
  const [isCameraPreviewVisible, setIsCameraPreviewVisible] = useState(false)
  const [recipientSharedDeviceId, setRecipientSharedDeviceId] = useState<string | null>(
    () => readStoredTelegramValue(RECIPIENT_SHARED_DEVICE_ID_KEY)
  )
  const [telegramSetupPath, setTelegramSetupPath] = useState<TelegramSetupPath>('invite')

  // Clips state
  const [clips, setClips] = useState<StoredClip[]>([])
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [selectedClipUrl, setSelectedClipUrl] = useState<string | null>(null)

  // Sequential recording state
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>('idle')
  const [currentClipIndex, setCurrentClipIndex] = useState(0)
  const [benchmarkClipId, setBenchmarkClipId] = useState<string | null>(null)
  const [sessionCounts, setSessionCounts] = useState({ stored: 0, discarded: 0 })
  const [queuedClipsRemaining, setQueuedClipsRemaining] = useState(0)

  // Custom hooks
  const settings = useRecordingSettings()
  const motionDetection = useMotionDetection()
  const audioDetection = useAudioDetection()

  // Refs
  const streamRef = useRef<MediaStream | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const deviceIdRef = useRef<string | null>(null)
  const sequentialRecorderRef = useRef<SequentialRecorder | null>(null)
  const clipUrlRef = useRef<string | null>(null)
  const uploadInFlightRef = useRef(false)
  const dropQueuedProcessingRef = useRef(false)
  const processQueuedClipRef = useRef<(clip: QueuedClip) => Promise<void>>(async () => {})
  const clipQueueRef = useRef<SerialQueue<QueuedClip> | null>(null)
  const cameraPreviewVideoRef = useRef<HTMLVideoElement | null>(null)
  const cameraPreviewTimeoutRef = useRef<number | null>(null)
  const cameraPreviewStreamRef = useRef<MediaStream | null>(null)
  const cameraPreviewOwnsStreamRef = useRef(false)
  const telegramReadinessRequestIdRef = useRef(0)
  const telegramConfirmedReadyUntilRef = useRef(0)
  const telegramReadinessRef = useRef<TelegramReadinessResponse | null>(null)

  if (!clipQueueRef.current) {
    clipQueueRef.current = createSerialQueue(
      (queuedClip) => processQueuedClipRef.current(queuedClip),
      {
        onError: (error) => {
          console.error('[App] Error processing clip:', error)
        },
        onSizeChange: (size) => {
          setQueuedClipsRemaining(size)
        },
      }
    )
  }

  // Memoized values
  const lastEvent = useMemo(() => events[events.length - 1], [events])
  const eventsById = useMemo(
    () => new Map(events.map((event) => [event.event_id, event])),
    [events]
  )
  const hasProcessingEvents = useMemo(
    () => events.some((event) => event.status === 'processing'),
    [events]
  )
  const clipStats = useMemo(() => {
    const pending = clips.filter((clip) => !clip.uploaded).length
    const failed = clips.filter((clip) => !clip.uploaded && clip.lastUploadError).length
    return { pending, failed }
  }, [clips])
  const requiresAccountSignIn =
    authSession.authRequired && !authSession.authenticated && !authSession.autoLogin
  const normalizedAlertInstructions = useMemo(
    () => alertInstructions.map((instruction) => instruction.trim()).filter(Boolean),
    [alertInstructions]
  )
  const hasAlertInstructions = normalizedAlertInstructions.length > 0
  const requiresTelegramOnboarding = checkingTelegramReadiness
    || requiresAccountSignIn
    || (telegramReadiness?.enabled === true && telegramReadiness.ready === false)

  const refreshClips = useCallback(async () => {
    if (requiresAccountSignIn) {
      setClips([])
      return
    }
    const nextClips = await listClips()
    nextClips.sort((a, b) => b.createdAt - a.createdAt)
    setClips(nextClips)
  }, [requiresAccountSignIn])

  const ensureResolvedDeviceId = useCallback(async () => {
    if (requiresAccountSignIn) {
      throw new ApiError(401, 'Sign in required')
    }
    if (deviceIdRef.current) return deviceIdRef.current
    const resolved = await ensureDeviceId({
      userScopeKey: authSession.userId,
    })
    deviceIdRef.current = resolved
    return resolved
  }, [authSession.userId, requiresAccountSignIn])

  const clearTelegramLinkState = useCallback(() => {
    setIsWaitingForTelegramConnect(false)
    setTelegramPopupFallbackUrl(null)
    setTelegramFallbackCommand(null)
    setTelegramLinkAttemptId(null)
    setTelegramLinkAttemptDeviceId(null)
    setTelegramLinkFlow('device')
    writeStoredTelegramValue(TELEGRAM_LINK_WAITING_KEY, null)
    writeStoredTelegramValue(TELEGRAM_LINK_FALLBACK_URL_KEY, null)
    writeStoredTelegramValue(TELEGRAM_LINK_FALLBACK_COMMAND_KEY, null)
    writeStoredTelegramValue(TELEGRAM_LINK_ATTEMPT_KEY, null)
    writeStoredTelegramValue(TELEGRAM_LINK_ATTEMPT_DEVICE_ID_KEY, null)
    writeStoredTelegramValue(TELEGRAM_LINK_FLOW_KEY, null)
  }, [])

  const clearRecipientMode = useCallback(() => {
    setRecipientSharedDeviceId(null)
    writeStoredTelegramValue(RECIPIENT_SHARED_DEVICE_ID_KEY, null)
  }, [])

  const activateRecipientMode = useCallback((deviceId: string) => {
    setRecipientSharedDeviceId(deviceId)
    writeStoredTelegramValue(RECIPIENT_SHARED_DEVICE_ID_KEY, deviceId)
  }, [])

  const refreshTelegramRecipients = useCallback(async (resolvedDeviceId?: string) => {
    if (requiresAccountSignIn) {
      setLoadingTelegramRecipients(false)
      setTelegramRecipients([])
      return
    }

    setLoadingTelegramRecipients(true)
    try {
      const deviceId = resolvedDeviceId ?? await ensureResolvedDeviceId()
      const response = await listNotificationRecipients(deviceId)
      setTelegramRecipients(response.recipients)
    } catch (err) {
      console.error(err)
      if (err instanceof ApiError && err.status === 401) {
        setAuthSession(getAuthSession())
        setTelegramRecipients([])
        return
      }
      setError('Unable to load Telegram recipients.')
    } finally {
      setLoadingTelegramRecipients(false)
    }
  }, [ensureResolvedDeviceId, requiresAccountSignIn])

  const refreshNotificationInvites = useCallback(async (resolvedDeviceId?: string) => {
    if (requiresAccountSignIn) {
      setLoadingNotificationInvites(false)
      setNotificationInvites([])
      setDismissedInviteIds([])
      return
    }

    setLoadingNotificationInvites(true)
    try {
      const deviceId = resolvedDeviceId ?? await ensureResolvedDeviceId()
      const response = await listNotificationInvites(deviceId)
      setNotificationInvites(response.invites)
      setDismissedInviteIds((current) =>
        current.filter((inviteId) => response.invites.some((invite) => invite.inviteId === inviteId))
      )
    } catch (err) {
      console.error(err)
      if (err instanceof ApiError && err.status === 401) {
        setAuthSession(getAuthSession())
        setNotificationInvites([])
        setDismissedInviteIds([])
        return
      }
      setError('Unable to load share invites.')
    } finally {
      setLoadingNotificationInvites(false)
    }
  }, [ensureResolvedDeviceId, requiresAccountSignIn])

  const persistTelegramLinkState = useCallback((
    state: {
      waiting?: boolean
      fallbackUrl?: string | null
      fallbackCommand?: string | null
      attemptId?: string | null
      deviceId?: string | null
      flow?: TelegramLinkFlow
    }
  ) => {
    if (state.waiting !== undefined) {
      setIsWaitingForTelegramConnect(state.waiting)
      writeStoredTelegramValue(
        TELEGRAM_LINK_WAITING_KEY,
        state.waiting ? '1' : null
      )
    }
    if (state.fallbackUrl !== undefined) {
      setTelegramPopupFallbackUrl(state.fallbackUrl)
      writeStoredTelegramValue(TELEGRAM_LINK_FALLBACK_URL_KEY, state.fallbackUrl)
    }
    if (state.fallbackCommand !== undefined) {
      setTelegramFallbackCommand(state.fallbackCommand)
      writeStoredTelegramValue(TELEGRAM_LINK_FALLBACK_COMMAND_KEY, state.fallbackCommand)
    }
    if (state.attemptId !== undefined) {
      setTelegramLinkAttemptId(state.attemptId)
      writeStoredTelegramValue(TELEGRAM_LINK_ATTEMPT_KEY, state.attemptId)
    }
    if (state.deviceId !== undefined) {
      setTelegramLinkAttemptDeviceId(state.deviceId)
      writeStoredTelegramValue(TELEGRAM_LINK_ATTEMPT_DEVICE_ID_KEY, state.deviceId)
    }
    if (state.flow !== undefined) {
      setTelegramLinkFlow(state.flow)
      writeStoredTelegramValue(TELEGRAM_LINK_FLOW_KEY, state.flow)
    }
  }, [])

  useEffect(() => {
    if (!telegramLinkStateFromUrl) return

    persistTelegramLinkState({
      waiting: true,
      attemptId: telegramLinkStateFromUrl.attemptId,
      deviceId: telegramLinkStateFromUrl.deviceId,
      flow: telegramLinkStateFromUrl.flow,
    })
    if (telegramLinkStateFromUrl.flow === 'invite') {
      setTelegramSetupPath('invite')
    }
    clearTelegramLinkStateFromUrl()
  }, [persistTelegramLinkState, telegramLinkStateFromUrl])

  const processQueuedClip = useCallback(
    async (queuedClip: QueuedClip) => {
      const { data, sessionId: resolvedSessionId, deviceId: resolvedDeviceId } = queuedClip
      const { blob, clipIndex, startTime, metrics } = data

      if (!resolvedSessionId || !resolvedDeviceId) {
        console.warn('[App] Clip completed but no active session')
        return
      }
      if (dropQueuedProcessingRef.current) {
        return
      }

      const clipId = generateClipId()
      const durationSeconds = (Date.now() - startTime) / 1000
      setCurrentClipIndex(clipIndex)

      if (clipIndex === 0) {
        // First clip = benchmark
        const benchmarkData = createBenchmarkData(clipId, metrics)
        setBenchmark(benchmarkData)
        setBenchmarkClipId(clipId)
        if (dropQueuedProcessingRef.current) return

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

        if (dropQueuedProcessingRef.current) return
        await refreshClips()
        setSessionCounts(getCurrentSessionCounts())
        return
      }

      // Compare with benchmark
      const comparison = compareWithBenchmark(metrics, {
        motionDeltaThreshold: settings.motionDeltaThreshold,
        motionAbsoluteThreshold: settings.motionAbsoluteThreshold,
        audioDeltaEnabled: settings.audioDeltaEnabled,
        audioDeltaThreshold: settings.audioDeltaThreshold,
        audioAbsoluteEnabled: settings.audioAbsoluteEnabled,
        audioAbsoluteThreshold: settings.audioAbsoluteThreshold,
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
      if (dropQueuedProcessingRef.current) return

      if (comparison.shouldStore) {
        const triggerType =
          comparison.triggeredBy.includes('motionDelta') ||
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

        if (dropQueuedProcessingRef.current) return
        await refreshClips()

        const benchmarkData = createBenchmarkData(clipId, metrics)
        setBenchmark(benchmarkData)
        setBenchmarkClipId(clipId)
      }

      setSessionCounts(getCurrentSessionCounts())
    },
    [settings]
  )

  processQueuedClipRef.current = processQueuedClip

  const handleClipComplete = useCallback(
    (data: ClipCompleteData) => {
      const resolvedSessionId = sessionIdRef.current
      const resolvedDeviceId = deviceIdRef.current

      if (!resolvedSessionId || !resolvedDeviceId) {
        console.warn('[App] Clip completed but no active session')
        return
      }

      clipQueueRef.current?.enqueue({
        data,
        sessionId: resolvedSessionId,
        deviceId: resolvedDeviceId,
      })
    },
    []
  )

  const stopCameraPreview = useCallback(() => {
    if (cameraPreviewTimeoutRef.current !== null) {
      window.clearTimeout(cameraPreviewTimeoutRef.current)
      cameraPreviewTimeoutRef.current = null
    }
    if (cameraPreviewOwnsStreamRef.current) {
      cameraPreviewStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
    cameraPreviewOwnsStreamRef.current = false
    cameraPreviewStreamRef.current = null
    if (cameraPreviewVideoRef.current) {
      ;(cameraPreviewVideoRef.current as HTMLVideoElement & { srcObject?: MediaStream | null }).srcObject = null
    }
    setIsCameraPreviewVisible(false)
  }, [])

  const handleStartCameraPreview = useCallback(async () => {
    if (isMediaDisabled()) {
      setError('Camera preview unavailable while media is disabled')
      return
    }

    setError(null)
    stopCameraPreview()

    try {
      let previewStream = streamRef.current
      let ownsPreviewStream = false

      if (!previewStream) {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError('Camera preview unavailable')
          return
        }
        previewStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        })
        ownsPreviewStream = true
      }

      cameraPreviewStreamRef.current = previewStream
      cameraPreviewOwnsStreamRef.current = ownsPreviewStream
      setIsCameraPreviewVisible(true)

      if (cameraPreviewVideoRef.current) {
        ;(cameraPreviewVideoRef.current as HTMLVideoElement & { srcObject?: MediaStream | null }).srcObject = previewStream
      }

      cameraPreviewTimeoutRef.current = window.setTimeout(() => {
        stopCameraPreview()
      }, 5000)
    } catch (err) {
      console.error(err)
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setError('Camera permission denied')
      } else {
        setError('Unable to start camera preview')
      }
    }
  }, [stopCameraPreview])

  const startCapture = async () => {
    stopCameraPreview()
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

      motionDetection.setup(stream)
      audioDetection.setup(stream)

      const recorder = new SequentialRecorder({
        stream,
        clipDurationMs: settings.clipDuration * 1000,
        getMotionScore: motionDetection.getScore,
        getAudioScore: audioDetection.getScore,
        motionEventThreshold: settings.motionAbsoluteThreshold,
        onClipComplete: handleClipComplete,
        onError: (err) => {
          console.error('[App] Recorder error:', err)
          setError('Recording error: ' + err.message)
        },
      })

      sequentialRecorderRef.current = recorder
      recorder.start()
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
    stopCameraPreview()
    sequentialRecorderRef.current?.stop()
    sequentialRecorderRef.current = null
    motionDetection.cleanup()
    audioDetection.cleanup()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCaptureStatus('idle')
  }

  const resetForAccountChange = useCallback(async () => {
    stopCapture()
    dropQueuedProcessingRef.current = true
    clipQueueRef.current?.clear()
    setSessionStatus('idle')
    setSessionId(null)
    sessionIdRef.current = null
    deviceIdRef.current = null
    endLogSession()
    clearBenchmark()
    setBenchmarkClipId(null)
    setCurrentClipIndex(0)
    setSessionCounts({ stored: 0, discarded: 0 })
    setEvents([])
    clearTelegramLinkState()
    setTelegramReadiness(null)
    setTelegramRecipients([])
    setNotificationInvites([])
    setDismissedInviteIds([])
    setLatestInviteCode(null)
    setInviteCodeInput('')
    setInviteAcceptedMessage(null)
    setShowInviteCodeFallback(false)
    setTelegramStepExpanded(false)
    clearRecipientMode()
    await deleteAllClips()
    setClips([])
    if (clipUrlRef.current) {
      URL.revokeObjectURL(clipUrlRef.current)
      clipUrlRef.current = null
    }
    setSelectedClipId(null)
    setSelectedClipUrl(null)
    dropQueuedProcessingRef.current = false
  }, [clearRecipientMode, clearTelegramLinkState, motionDetection, audioDetection])

  const handleAccountSignIn = useCallback(async () => {
    const normalizedEmail = accountEmail.trim().toLowerCase()
    if (!normalizedEmail) {
      setError('Enter an account email before signing in.')
      return
    }

    setIsAuthenticating(true)
    setError(null)

    try {
      await resetForAccountChange()
      const nextSession = await loginWithEmail(normalizedEmail)
      setAuthSession(nextSession)
      setAccountEmail(nextSession.email ?? normalizedEmail)
    } catch (err) {
      console.error(err)
      setError('Unable to sign in with that account.')
    } finally {
      setIsAuthenticating(false)
    }
  }, [accountEmail, resetForAccountChange])

  const handleStart = async () => {
    if (requiresAccountSignIn) {
      setError('Sign in before starting monitoring.')
      return
    }
    if (!hasAlertInstructions) {
      setError('Add at least one alert instruction before starting monitoring.')
      return
    }
    setIsBusy(true)
    setError(null)

    try {
      const resolvedDeviceId = await ensureResolvedDeviceId()
      const session = await startSession(resolvedDeviceId, normalizedAlertInstructions)
      setSessionId(session.session_id)
      sessionIdRef.current = session.session_id
      deviceIdRef.current = session.device_id
      setSessionStatus('active')

      startLogSession(session.session_id)
      dropQueuedProcessingRef.current = false
      clipQueueRef.current?.clear()
      setCurrentClipIndex(0)
      setBenchmarkClipId(null)
      clearBenchmark()
      setSessionCounts({ stored: 0, discarded: 0 })

      setEvents(await listEvents(session.session_id))
      await startCapture()
      await refreshClips()
    } catch (err) {
      console.error(err)
      if (err instanceof ApiError && err.status === 401) {
        setAuthSession(getAuthSession())
        setError('Sign in before starting monitoring.')
        return
      }
      setError('Unable to start session')
    } finally {
      setIsBusy(false)
    }
  }

  const handleAlertInstructionChange = (index: number, value: string) => {
    setAlertInstructions((current) => current.map((instruction, itemIndex) => (
      itemIndex === index ? value : instruction
    )))
  }

  const handleAddAlertInstruction = () => {
    setAlertInstructions((current) => [...current, ''])
  }

  const handleRemoveAlertInstruction = (index: number) => {
    setAlertInstructions((current) => {
      if (current.length === 1) return createEmptyAlertInstructions()
      const nextInstructions = current.filter((_, itemIndex) => itemIndex !== index)
      return nextInstructions.length > 0 ? nextInstructions : createEmptyAlertInstructions()
    })
  }

  const refreshTelegramReadiness = useCallback(async () => {
    const requestId = telegramReadinessRequestIdRef.current + 1
    telegramReadinessRequestIdRef.current = requestId
    if (requiresAccountSignIn) {
      setCheckingTelegramReadiness(false)
      setTelegramReadiness(null)
      return
    }
    setCheckingTelegramReadiness(true)
    try {
      const resolvedDeviceId = await ensureResolvedDeviceId()
      console.info('[TelegramOnboarding] Checking readiness', {
        deviceId: resolvedDeviceId,
      })
      const status = await getTelegramReadiness(resolvedDeviceId)
      if (telegramReadinessRequestIdRef.current !== requestId) {
        return
      }
      const shouldPreserveConfirmedReadyState = !status.ready
        && telegramReadinessRef.current?.ready === true
        && Date.now() < telegramConfirmedReadyUntilRef.current
      if (shouldPreserveConfirmedReadyState) {
        clearTelegramLinkState()
        return
      }
      setTelegramReadiness(status)
      if (status.enabled) {
        await refreshTelegramRecipients(resolvedDeviceId)
        await refreshNotificationInvites(resolvedDeviceId)
      } else {
        setTelegramRecipients([])
        setNotificationInvites([])
      }
      if (telegramReadinessRequestIdRef.current !== requestId) {
        return
      }
      console.info('[TelegramOnboarding] Readiness response', {
        deviceId: resolvedDeviceId,
        enabled: status.enabled,
        ready: status.ready,
        status: status.status,
        reason: status.reason,
      })
      if (status.ready) {
        clearTelegramLinkState()
      }
    } catch (err) {
      if (telegramReadinessRequestIdRef.current !== requestId) {
        return
      }
      console.error(err)
      if (err instanceof ApiError && err.status === 401) {
        setAuthSession(getAuthSession())
        setTelegramReadiness(null)
        return
      }
      setTelegramReadiness({
        enabled: true,
        ready: false,
        status: 'error',
        reason: 'Unable to verify Telegram readiness. Retry in a few seconds.',
      })
      setTelegramRecipients([])
    } finally {
      if (telegramReadinessRequestIdRef.current === requestId) {
        setCheckingTelegramReadiness(false)
      }
    }
  }, [
    clearTelegramLinkState,
    ensureResolvedDeviceId,
    refreshNotificationInvites,
    refreshTelegramRecipients,
    requiresAccountSignIn,
    isWaitingForTelegramConnect,
    telegramLinkAttemptId,
  ])

  const handleAddRecipient = useCallback(async (recipient: NotificationRecipient) => {
    setError(null)
    setUpdatingRecipientEndpointId(recipient.endpointId)
    try {
      const resolvedDeviceId = await ensureResolvedDeviceId()
      await addNotificationRecipient(resolvedDeviceId, recipient.endpointId)
      await refreshTelegramRecipients(resolvedDeviceId)
      await refreshTelegramReadiness()
    } catch (err) {
      console.error(err)
      setError('Unable to add Telegram recipient.')
    } finally {
      setUpdatingRecipientEndpointId(null)
    }
  }, [ensureResolvedDeviceId, refreshTelegramReadiness, refreshTelegramRecipients])

  const handleTelegramLinkStatusResult = useCallback(async (
    linkDeviceId: string,
    flow: TelegramLinkFlow,
    status: {
      ready: boolean
      linked?: boolean
      status: string
      reason: string | null
    }
  ) => {
    if (status.ready) {
      // Invalidate any older readiness request that was started before link polling
      // completed so its response cannot overwrite the confirmed ready state.
      telegramReadinessRequestIdRef.current += 1
      telegramConfirmedReadyUntilRef.current = Date.now() + TELEGRAM_READY_CONFIRMATION_GRACE_MS
      setCheckingTelegramReadiness(false)
      if (flow === 'invite') {
        activateRecipientMode(linkDeviceId)
        clearTelegramLinkState()
        setInviteAcceptedMessage('Shared invite accepted. Alerts will go to your Telegram account.')
        setInviteCodeInput('')
        return true
      }
      clearTelegramLinkState()
      setTelegramReadiness({
        enabled: true,
        ready: true,
        status: 'ready',
        reason: null,
      })
      await refreshTelegramRecipients(linkDeviceId)
      await refreshNotificationInvites(linkDeviceId)
      return true
    }

    if (isTerminalTelegramLinkStatus(status.status)) {
      clearTelegramLinkState()
      setError(status.reason)
      await refreshTelegramReadiness()
      return true
    }

    return false
  }, [
    activateRecipientMode,
    clearTelegramLinkState,
    refreshNotificationInvites,
    refreshTelegramReadiness,
    refreshTelegramRecipients,
  ])

  const beginTelegramLinkFlow = useCallback((
    start: {
      enabled: boolean
      ready: boolean
      status: string
      reason: string | null
      attemptId: string | null
      connectUrl: string | null
      fallbackCommand: string | null
    },
    options: {
      deviceId: string
      flow: TelegramLinkFlow
      preOpenedPopup: Window | null
      preferSameTabRedirect?: boolean
      suppressAutomaticRedirect?: boolean
    }
  ) => {
    const fallbackCommand = deriveTelegramFallbackCommand(
      start.fallbackCommand,
      start.connectUrl
    )
    setTelegramReadiness({
      enabled: start.enabled,
      ready: start.ready,
      status: start.status,
      reason: start.reason,
    })

    if (!start.connectUrl || !start.attemptId) {
      options.preOpenedPopup?.close()
      clearTelegramLinkState()
      setError(start.reason || 'Unable to generate Telegram connect link.')
      return
    }

    persistTelegramLinkState({
      attemptId: start.attemptId,
      deviceId: options.deviceId,
      flow: options.flow,
      fallbackCommand,
    })

    let popup = options.preOpenedPopup
    const shouldReuseCurrentTab = !options.preOpenedPopup
      && !options.suppressAutomaticRedirect
      && (options.preferSameTabRedirect || options.flow === 'invite')
    if (!popup && !shouldReuseCurrentTab) {
      popup = window.open(start.connectUrl, '_blank', 'noopener,noreferrer')
    }
    if (!popup && !shouldReuseCurrentTab) {
      persistTelegramLinkState({
        waiting: true,
        fallbackUrl: start.connectUrl,
        fallbackCommand,
        deviceId: options.deviceId,
        flow: options.flow,
      })
      setError('Popup blocked. Use the backup Telegram link below.')
      return
    }

    if (shouldReuseCurrentTab) {
      persistTelegramLinkState({
        waiting: true,
        fallbackUrl: start.connectUrl,
        fallbackCommand,
        deviceId: options.deviceId,
        flow: options.flow,
      })
      setError(null)
      try {
        window.location.assign(start.connectUrl)
      } catch {
        setError('Unable to open Telegram automatically. Use the backup Telegram link below.')
      }
      return
    }

    if (options.preOpenedPopup) {
      const openedPopup = options.preOpenedPopup
      try {
        openedPopup.location.href = start.connectUrl
      } catch {
        openedPopup.close()
        persistTelegramLinkState({
          waiting: true,
          fallbackUrl: start.connectUrl,
          fallbackCommand,
          deviceId: options.deviceId,
          flow: options.flow,
        })
        setError('Unable to redirect popup. Use the backup Telegram link below.')
        return
      }
    }

    persistTelegramLinkState({
      waiting: true,
      fallbackUrl: start.connectUrl,
      fallbackCommand,
      deviceId: options.deviceId,
      flow: options.flow,
    })
    setError(null)
  }, [clearTelegramLinkState, persistTelegramLinkState])

  const handleRemoveRecipient = useCallback(async (recipient: NotificationRecipient) => {
    setError(null)
    setUpdatingRecipientEndpointId(recipient.endpointId)
    try {
      const resolvedDeviceId = await ensureResolvedDeviceId()
      await removeNotificationRecipient(resolvedDeviceId, recipient.endpointId)
      await refreshTelegramRecipients(resolvedDeviceId)
      await refreshTelegramReadiness()
    } catch (err) {
      console.error(err)
      setError('Unable to remove Telegram recipient.')
    } finally {
      setUpdatingRecipientEndpointId(null)
    }
  }, [ensureResolvedDeviceId, refreshTelegramReadiness, refreshTelegramRecipients])

  const handleCreateInvite = useCallback(async () => {
    setError(null)
    setInviteAcceptedMessage(null)
    setShowInviteCodeFallback(false)
    setUpdatingInviteId('creating')
    try {
      const resolvedDeviceId = await ensureResolvedDeviceId()
      const invite = await createNotificationInvite(resolvedDeviceId)
      setLatestInviteCode(invite.inviteCode)
      setLatestInviteCopyStatus('idle')
      const shareInviteLink = invite.inviteCode ? buildShareInviteLink(invite.inviteCode) : null
      if (shareInviteLink) {
        try {
          await copyTextToClipboard(shareInviteLink)
          setLatestInviteCopyStatus('copied')
        } catch (clipboardError) {
          console.warn('[ShareInvite] Unable to copy share invite link to clipboard', clipboardError)
        }
      }
      await refreshNotificationInvites(resolvedDeviceId)
    } catch (err) {
      console.error(err)
      if (err instanceof ApiError && err.status === 401) {
        setError('Sign in is required before creating share invites.')
      } else {
        setError('Unable to create a share invite.')
      }
    } finally {
      setUpdatingInviteId(null)
    }
  }, [ensureResolvedDeviceId, refreshNotificationInvites])

  const handleCopyLatestInviteLink = useCallback(async () => {
    if (!latestInviteCode) {
      setError('No share link is available to copy yet.')
      return
    }
    const shareInviteLink = buildShareInviteLink(latestInviteCode)
    try {
      await copyTextToClipboard(shareInviteLink)
      setLatestInviteCopyStatus('copied')
      setError(null)
    } catch (err) {
      console.error(err)
      setError(
        err instanceof Error && err.message === 'Clipboard unavailable'
          ? 'Clipboard unavailable'
          : 'Unable to copy the latest share link.'
      )
    }
  }, [latestInviteCode])

  const handleRevokeInvite = useCallback(async (invite: NotificationInvite) => {
    setError(null)
    setUpdatingInviteId(invite.inviteId)
    try {
      const resolvedDeviceId = await ensureResolvedDeviceId()
      await revokeNotificationInvite(resolvedDeviceId, invite.inviteId)
      await refreshNotificationInvites(resolvedDeviceId)
      await refreshTelegramRecipients(resolvedDeviceId)
      await refreshTelegramReadiness()
    } catch (err) {
      console.error(err)
      setError('Unable to revoke that share invite.')
    } finally {
      setUpdatingInviteId(null)
    }
  }, [ensureResolvedDeviceId, refreshNotificationInvites, refreshTelegramReadiness, refreshTelegramRecipients])

  const handleDismissInvite = useCallback((inviteId: string) => {
    setDismissedInviteIds((current) => (
      current.includes(inviteId) ? current : [...current, inviteId]
    ))
  }, [])

  const handleAcceptInviteCode = useCallback(async (
    inviteCode: string,
    options?: {
      openedFromShareLink?: boolean
    }
  ) => {
    const normalizedCode = inviteCode.trim()
    if (!normalizedCode) {
      setError('Enter an invite code before accepting a shared invite.')
      return
    }

    setError(null)
    setInviteAcceptedMessage(null)
    if (options?.openedFromShareLink) {
      setShowInviteCodeFallback(true)
    }
    const preOpenedPopup = options?.openedFromShareLink
      ? null
      : shouldPreOpenTelegramPopup()
      ? window.open('', '_blank', 'noopener,noreferrer')
      : null

    try {
      const start = await acceptNotificationInvite(normalizedCode)
      beginTelegramLinkFlow(start, {
        deviceId: start.deviceId,
        flow: 'invite',
        preOpenedPopup: options?.openedFromShareLink ? null : preOpenedPopup,
        preferSameTabRedirect: options?.openedFromShareLink === true,
      })
      if (start.attemptId) {
        const status = await getTelegramLinkStatus(start.deviceId, start.attemptId)
        await handleTelegramLinkStatusResult(start.deviceId, 'invite', status)
      }
    } catch (err) {
      console.error(err)
      preOpenedPopup?.close()
      setError('Unable to accept that shared invite.')
    }
  }, [beginTelegramLinkFlow, handleTelegramLinkStatusResult])

  const handleAcceptInvite = useCallback(async () => {
    await handleAcceptInviteCode(inviteCodeInput)
  }, [handleAcceptInviteCode, inviteCodeInput])

  useEffect(() => {
    if (!inviteCodeFromUrl) return
    setTelegramSetupPath('invite')
    setInviteCodeInput(inviteCodeFromUrl)
    clearInviteCodeFromUrl()
    setInviteCodeFromUrl(null)
    if (recipientSharedDeviceId) return
    if (telegramLinkFlow === 'invite' && telegramLinkAttemptId) {
      if (telegramPopupFallbackUrl) {
        try {
          window.location.assign(telegramPopupFallbackUrl)
        } catch {
          setError('Unable to open Telegram automatically. Use the backup Telegram link below.')
        }
      }
      return
    }
    void handleAcceptInviteCode(inviteCodeFromUrl, { openedFromShareLink: true })
  }, [
    handleAcceptInviteCode,
    inviteCodeFromUrl,
    recipientSharedDeviceId,
    telegramLinkAttemptId,
    telegramLinkFlow,
    telegramPopupFallbackUrl,
  ])

  const handleSendTelegramTestAlert = useCallback(async () => {
    const resolvedDeviceId = await ensureDeviceId()
    setTelegramTestAlertMessage(null)
    setSendingTelegramTestAlert(true)
    setError(null)
    try {
      const response = await sendTelegramTestAlert(resolvedDeviceId)
      setTelegramTestAlertMessage(
        response.deliveredCount === 1
          ? 'Test alert sent to 1 Telegram recipient.'
          : `Test alert sent to ${response.deliveredCount} Telegram recipients.`
      )
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('Add at least one Telegram recipient before sending a test alert.')
      } else {
        setError('Unable to send a Telegram test alert.')
      }
    } finally {
      setSendingTelegramTestAlert(false)
    }
  }, [])

  const handleConnectTelegram = async () => {
    setError(null)
    setInviteAcceptedMessage(null)
    const preferSameTabRedirect = shouldPreOpenTelegramPopup()
    const preOpenedPopup: Window | null = null
    console.info('[TelegramOnboarding] Connect clicked', {
      preOpenedPopup: Boolean(preOpenedPopup),
      preferSameTabRedirect,
    })
    try {
      const resolvedDeviceId = await ensureResolvedDeviceId()
      console.info('[TelegramOnboarding] Requesting link start', {
        deviceId: resolvedDeviceId,
      })
      const start = await startTelegramLink(resolvedDeviceId)
      console.info('[TelegramOnboarding] Link start response', {
        deviceId: resolvedDeviceId,
        enabled: start.enabled,
        ready: start.ready,
        status: start.status,
        attemptId: start.attemptId,
        hasConnectUrl: Boolean(start.connectUrl),
      })
      beginTelegramLinkFlow(start, {
        deviceId: resolvedDeviceId,
        flow: 'device',
        preOpenedPopup,
        preferSameTabRedirect,
      })
    } catch (err) {
      console.error(err)
      setError('Unable to open Telegram link')
    }
  }

  const handleCheckTelegramReadiness = useCallback(async () => {
    setError(null)
    try {
      const resolvedDeviceId = await ensureResolvedDeviceId()
      const linkDeviceId = telegramLinkAttemptDeviceId ?? resolvedDeviceId
        if (telegramLinkAttemptId) {
          console.info('[TelegramOnboarding] Checking link attempt status', {
            deviceId: linkDeviceId,
            attemptId: telegramLinkAttemptId,
          })
          const status = await getTelegramLinkStatus(linkDeviceId, telegramLinkAttemptId)
        console.info('[TelegramOnboarding] Link status response', {
          deviceId: linkDeviceId,
          attemptId: telegramLinkAttemptId,
          ready: status.ready,
          linked: status.linked,
          status: status.status,
          reason: status.reason,
        })
          if (await handleTelegramLinkStatusResult(linkDeviceId, telegramLinkFlow, status)) {
            return
          }
        }
        await refreshTelegramReadiness()
    } catch (err) {
      console.error(err)
      if (err instanceof ApiError && err.status === 404) {
        console.warn('[TelegramOnboarding] Stale link attempt during manual check, clearing local attempt', {
          attemptId: telegramLinkAttemptId,
        })
        clearTelegramLinkState()
      }
      await refreshTelegramReadiness()
    }
  }, [
    ensureResolvedDeviceId,
    handleTelegramLinkStatusResult,
    refreshTelegramReadiness,
    telegramLinkAttemptDeviceId,
    telegramLinkFlow,
    telegramLinkAttemptId,
  ])

  const handleStop = async () => {
    const resolvedSessionId = sessionIdRef.current ?? sessionId
    if (!resolvedSessionId) return

    setError(null)
    stopCapture()
    setSessionStatus('stopped')
    endLogSession()

    try {
      await stopSession(resolvedSessionId)
      setEvents(await listEvents(resolvedSessionId))
    } catch (err) {
      console.error(err)
      setError('Stopped locally, but unable to stop session on server')
    }
  }

  const handlePreviewClip = async (clipId: string) => {
    const clip = await getClip(clipId)
    if (!clip) return
    if (clipUrlRef.current) URL.revokeObjectURL(clipUrlRef.current)
    const url = URL.createObjectURL(clip.blob)
    clipUrlRef.current = url
    setSelectedClipUrl(url)
    setSelectedClipId(clipId)
  }

  const handleForceStop = async () => {
    const resolvedSessionId = sessionIdRef.current ?? sessionId
    if (!resolvedSessionId) return

    setIsForceStopping(true)
    setError(null)
    dropQueuedProcessingRef.current = true
    clipQueueRef.current?.clear()
    stopCapture()
    setSessionStatus('stopped')
    setSessionId(null)
    sessionIdRef.current = null
    endLogSession()
    setEvents([])

    try {
      await deleteClipsBySession(resolvedSessionId)
      await refreshClips()
      await forceStopSession(resolvedSessionId)
    } catch (err) {
      console.error(err)
      setError('Force stop failed to cancel server processing')
    } finally {
      setIsForceStopping(false)
    }
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
      setEvents(await listEvents(sessionId))
    } catch (err) {
      console.error(err)
      if (err instanceof ApiError && err.status === 401) {
        setAuthSession(getAuthSession())
        setError('Sign in before uploading clips.')
        return
      }
      setError('Unable to upload clips')
    } finally {
      setIsBusy(false)
    }
  }

  const handleCopyEventId = async (eventId: string) => {
    try {
      await copyTextToClipboard(eventId)
      setCopiedEventId(eventId)
    } catch (err) {
      console.error(err)
      setError(
        err instanceof Error && err.message === 'Clipboard unavailable'
          ? 'Clipboard unavailable'
          : 'Unable to copy event id'
      )
    }
  }

  // Poll for events
  useEffect(() => {
    if (!sessionId || (sessionStatus !== 'active' && !hasProcessingEvents)) return

    let cancelled = false
    const refresh = async () => {
      try {
        const nextEvents = await listEvents(sessionId)
        if (!cancelled) setEvents(nextEvents)
      } catch (err) {
        console.error(err)
      }
    }

    void refresh()
    const interval = setInterval(refresh, getPollIntervalMs())
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [hasProcessingEvents, sessionId, sessionStatus])

  // Upload clips periodically
  useEffect(() => {
    if (sessionStatus !== 'active' || !sessionId) return

    let cancelled = false
    const tick = async () => {
      if (cancelled || uploadInFlightRef.current) return
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
    if (sessionStatus !== 'active' || !sessionId) return

    const onOnline = () => {
      void uploadPendingClips({ sessionId }).then(refreshClips).catch(console.error)
    }

    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [sessionId, sessionStatus])

  // Clear copied event ID after timeout
  useEffect(() => {
    if (!copiedEventId) return
    const timeout = window.setTimeout(() => setCopiedEventId(null), 1500)
    return () => window.clearTimeout(timeout)
  }, [copiedEventId])

  useEffect(() => {
    if (latestInviteCopyStatus !== 'copied') return
    const timeout = window.setTimeout(() => setLatestInviteCopyStatus('idle'), 2000)
    return () => window.clearTimeout(timeout)
  }, [latestInviteCopyStatus])

  useEffect(() => {
    if (!authSession.email) return
    setAccountEmail(authSession.email)
  }, [authSession.email])

  useEffect(() => {
    telegramReadinessRef.current = telegramReadiness
  }, [telegramReadiness])

  // Initial clip load and cleanup
  useEffect(() => {
    void refreshTelegramReadiness()
  }, [refreshTelegramReadiness])

  useEffect(() => {
    if (requiresAccountSignIn || !isWaitingForTelegramConnect) return

    let cancelled = false
    const poll = async () => {
      if (cancelled) return
      try {
        const resolvedDeviceId = await ensureResolvedDeviceId()
        const linkDeviceId = telegramLinkAttemptDeviceId ?? resolvedDeviceId
        if (telegramLinkAttemptId) {
          console.info('[TelegramOnboarding] Polling link status', {
            deviceId: linkDeviceId,
            attemptId: telegramLinkAttemptId,
          })
          const status = await getTelegramLinkStatus(linkDeviceId, telegramLinkAttemptId)
          console.info('[TelegramOnboarding] Poll result', {
            deviceId: linkDeviceId,
            attemptId: telegramLinkAttemptId,
            ready: status.ready,
            status: status.status,
          })
          if (await handleTelegramLinkStatusResult(linkDeviceId, telegramLinkFlow, status)) {
            return
          }
        }
        await refreshTelegramReadiness()
      } catch (err) {
        if (!cancelled) {
          console.error(err)
          if (err instanceof ApiError && err.status === 404) {
            console.warn('[TelegramOnboarding] Stale link attempt during poll, clearing local attempt', {
              attemptId: telegramLinkAttemptId,
            })
            clearTelegramLinkState()
            await refreshTelegramReadiness()
            return
          }
        }
      }
    }

    void poll()
    const interval = window.setInterval(poll, 2000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [
    handleTelegramLinkStatusResult,
    ensureResolvedDeviceId,
    isWaitingForTelegramConnect,
    requiresAccountSignIn,
    refreshTelegramReadiness,
    telegramLinkAttemptDeviceId,
    telegramLinkFlow,
    telegramLinkAttemptId,
  ])

  useEffect(() => {
    if (requiresAccountSignIn || !isWaitingForTelegramConnect) return

    const refreshOnReturn = () => {
      void handleCheckTelegramReadiness()
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void handleCheckTelegramReadiness()
      }
    }

    window.addEventListener('focus', refreshOnReturn)
    window.addEventListener('pageshow', refreshOnReturn)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('focus', refreshOnReturn)
      window.removeEventListener('pageshow', refreshOnReturn)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [
    handleCheckTelegramReadiness,
    isWaitingForTelegramConnect,
    requiresAccountSignIn,
  ])

  useEffect(() => {
    void refreshClips()
    return () => {
      if (clipUrlRef.current) URL.revokeObjectURL(clipUrlRef.current)
    }
  }, [refreshClips])

  // Update recorder when settings change
  useEffect(() => {
    sequentialRecorderRef.current?.setClipDuration(settings.clipDuration * 1000)
  }, [settings.clipDuration])

  useEffect(() => {
    sequentialRecorderRef.current?.setMotionEventThreshold(settings.motionAbsoluteThreshold)
  }, [settings.motionAbsoluteThreshold])

  const captureLabel = (() => {
    if (isMediaDisabled()) return 'Capture disabled'
    if (captureStatus === 'active') return 'Capture active'
    if (captureStatus === 'error') return 'Capture error'
    if (sessionStatus === 'active') return 'Capture starting'
    return 'Capture idle'
  })()
  const isRecipientOnlyMode = Boolean(recipientSharedDeviceId)
  const selectedTelegramSetupPath = isRecipientOnlyMode ? 'invite' : telegramSetupPath
  const isDevMode = frontendMode === 'dev'
  const monitoringStatusLabel = statusLabels[sessionStatus]
  const showAccountPanel = authSession.authRequired && !authSession.authenticated
  const isSessionActive = sessionStatus === 'active'
  const showTelegramCheckingState = checkingTelegramReadiness && isWaitingForTelegramConnect
  const telegramStatusLabel = showTelegramCheckingState
    ? 'Checking Telegram'
    : telegramReadiness?.ready
    ? 'Telegram connected'
    : telegramReadiness?.enabled
    ? 'Telegram setup needed'
    : 'Telegram optional'
  const telegramStatusTone = showTelegramCheckingState
    ? 'checking'
    : telegramReadiness?.ready
    ? 'connected'
    : isWaitingForTelegramConnect
    ? 'checking'
    : 'attention'
  const lastEventLabel = lastEvent ? lastEvent.event_id : 'No events yet'
  const latestEventSummary = lastEvent?.summary?.trim()
    || lastEvent?.alert_reason?.trim()
    || null
  const hasSubscribedTelegramRecipient = telegramRecipients.some((recipient) => recipient.subscribed)
  const telegramLinkedForMonitoring = requiresAccountSignIn
    ? false
    : telegramReadiness?.enabled === true
    ? telegramReadiness.ready
    : true
  const telegramChecklist = [
    {
      label: 'Bot linked',
      done: Boolean(telegramReadiness?.ready),
    },
    {
      label: 'Recipient added',
      done: Boolean(telegramReadiness?.ready || hasSubscribedTelegramRecipient),
    },
    {
      label: 'Ready to monitor',
      done: Boolean(telegramReadiness?.ready),
    },
  ]
  const deviceTelegramSummary = showTelegramCheckingState
    ? {
      tone: 'checking',
      label: 'Checking setup',
      summary: 'Checking whether this phone is linked to Telegram alerts.',
      nextAction: 'Next: wait a moment, or tap Check Telegram status if the bot just replied.',
    }
    : telegramReadiness?.ready
    ? {
      tone: 'ready',
      label: 'Ready',
      summary: 'This phone is ready to receive Telegram alerts.',
      nextAction: 'Next: send a test alert or start monitoring.',
    }
    : isWaitingForTelegramConnect
    ? {
      tone: 'checking',
      label: 'Waiting for Telegram',
      summary: 'This phone still needs the Telegram confirmation step.',
      nextAction: 'Next: finish the /start step in Telegram, then return here.',
    }
    : {
      tone: 'attention',
      label: 'Needs setup',
      summary: 'This phone is not ready to receive Telegram alerts yet.',
      nextAction: 'Next: tap Connect Telegram alerts, then send /start in the bot chat.',
    }
  const anotherPhoneLinked = isRecipientOnlyMode
    || Boolean(inviteAcceptedMessage)
    || notificationInvites.some((invite) => invite.status === 'pending' || invite.status === 'accepted')
    || Boolean(latestInviteCode)
  const latestInviteLink = latestInviteCode ? buildShareInviteLink(latestInviteCode) : null
  const visibleNotificationInvites = notificationInvites.filter(
    (invite) => !dismissedInviteIds.includes(invite.inviteId)
  )
  const anotherPhoneSummary = anotherPhoneLinked
    ? {
      tone: 'ready',
      label: 'Invite ready',
      summary: isRecipientOnlyMode
        ? 'This phone is connected to shared Telegram alerts.'
        : 'Another phone can now be linked to Telegram alerts.',
      nextAction: isRecipientOnlyMode
        ? 'Next: wait for the device owner to start monitoring.'
        : 'Next: send the link to the other phone and open it there to finish automatically.',
    }
    : {
      tone: 'attention',
      label: 'Needs setup',
      summary: 'Another phone is not linked yet.',
      nextAction: 'Next: send a link to the other phone, then open it there to finish automatically.',
    }
  const monitoringChecklist = [
    {
      label: 'Telegram linked',
      done: telegramLinkedForMonitoring,
      note: telegramLinkedForMonitoring ? 'Alerts have somewhere to go.' : 'Finish Telegram setup first.',
    },
    {
      label: 'At least one instruction added',
      done: hasAlertInstructions,
      note: hasAlertInstructions ? 'Alert wording is ready.' : 'Add at least one short alert instruction.',
    },
  ]
  const setMode = (mode: FrontendMode) => {
    setFrontendMode(mode)
    writeStoredFrontendMode(mode)
  }
  const showTelegramCompactSuccess = telegramReadiness?.ready === true && !telegramStepExpanded
  const showSetupMonitor = !isRecipientOnlyMode && sessionStatus !== 'active'
  const showLiveMonitoring = !isRecipientOnlyMode && sessionStatus === 'active'

  useEffect(() => {
    if (isRecipientOnlyMode) {
      setTelegramSetupPath('invite')
    }
  }, [isRecipientOnlyMode])

  useEffect(() => {
    if (!cameraPreviewVideoRef.current) return
    ;(cameraPreviewVideoRef.current as HTMLVideoElement & { srcObject?: MediaStream | null }).srcObject =
      isCameraPreviewVisible ? cameraPreviewStreamRef.current : null
  }, [isCameraPreviewVisible])

  useEffect(() => () => {
    stopCameraPreview()
  }, [stopCameraPreview])

  return (
    <div className="app">
      <header className="app-header">
        <h1>Turn this phone into a Telegram monitor</h1>
        <p className="app-tagline">
          Choose where alerts go, describe what matters, preview the camera, then start video monitoring.
        </p>
      </header>

      <main className="app-main">
        {showAccountPanel && (
          <CollapsiblePanel title="Account" contentClassName="account-card">
            <div className="account-header">
              <p>Sign in to load your devices and events.</p>
            </div>
            <div className="account-controls">
              <label className="account-field">
                <span>Account email</span>
                <input
                  type="email"
                  value={accountEmail}
                  onChange={(event) => setAccountEmail(event.target.value)}
                  placeholder="owner@example.com"
                  aria-label="Account email"
                  disabled={isAuthenticating}
                />
              </label>
              <button
                type="button"
                className="primary"
                onClick={handleAccountSignIn}
                disabled={isAuthenticating}
              >
                Sign in
              </button>
            </div>
          </CollapsiblePanel>
        )}

        {isRecipientOnlyMode ? (
          <CollapsiblePanel title="Shared alerts" contentClassName="setup-panel" collapsible={false}>
            <section className="setup-step" aria-label="Telegram">
              <div className="setup-step-header">
                <span className="setup-step-number">1</span>
                <div>
                  <h3>Shared alert access</h3>
                  <p>This browser is connected as a Telegram recipient for a shared device.</p>
                </div>
              </div>
              <div className="telegram-subsection share-access">
                <p className="telegram-recipient-meta">
                  Device owners start monitoring. You will receive alerts in Telegram for the shared device.
                </p>
                {inviteAcceptedMessage && (
                  <p className="telegram-recipient-meta">{inviteAcceptedMessage}</p>
                )}
              </div>
            </section>
          </CollapsiblePanel>
        ) : (
          <>
            {showSetupMonitor && (
              <CollapsiblePanel title="Setup monitor" contentClassName="setup-panel" collapsible={false}>
                <div className="setup-intro">
                  <p className="setup-intro-copy">
                    Finish these three steps once, then just come back here whenever you want to use this phone again.
                  </p>
                  <div className="setup-progress" aria-label="Setup steps">
                    <span className="setup-progress-chip">1. Which phone should receive alerts?</span>
                    <span className="setup-progress-chip">2. What should trigger an alert?</span>
                    <span className="setup-progress-chip">3. Check camera and start</span>
                  </div>
                </div>

                <section className="setup-step" aria-label="Telegram">
                  <div className="setup-step-header">
                    <span className="setup-step-number">1</span>
                    <div>
                      <h3>Which phone should receive alerts?</h3>
                      <p>Pick the phone that should get Telegram alerts for this monitor. We will send you clips alerts to the other phone that must Telegram installed.</p>
                    </div>
                    <span
                      className={`telegram-health telegram-health-${telegramStatusTone}`}
                      aria-label={`Telegram status: ${
                        telegramStatusTone === 'connected'
                          ? 'connected'
                          : telegramStatusTone === 'checking'
                          ? 'checking'
                          : 'action needed'
                      }`}
                    >
                      <span className="telegram-health-dot" aria-hidden="true" />
                      {telegramStatusLabel}
                    </span>
                  </div>

                  <div className="telegram-panel">
                    {showTelegramCompactSuccess ? (
                      <div className="telegram-success-row">
                        <div className="telegram-success-copy">
                          <span className="telegram-success-label">Alerts will go to Telegram</span>
                          <p className="telegram-recipient-meta">
                            Telegram is connected. You can keep going or edit this step if you want to change where alerts go.
                          </p>
                        </div>
                        <button
                          type="button"
                          className="secondary telegram-edit-button"
                          onClick={() => setTelegramStepExpanded(true)}
                        >
                          Edit
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="telegram-path-picker" role="group" aria-label="Telegram setup path">
                          <button
                            type="button"
                            className={`telegram-path-button${selectedTelegramSetupPath === 'device' ? ' active' : ''}`}
                            aria-pressed={selectedTelegramSetupPath === 'device'}
                            onClick={() => setTelegramSetupPath('device')}
                          >
                            This phone
                          </button>
                          <button
                            type="button"
                            className={`telegram-path-button${selectedTelegramSetupPath === 'invite' ? ' active' : ''}`}
                            aria-pressed={selectedTelegramSetupPath === 'invite'}
                            onClick={() => setTelegramSetupPath('invite')}
                          >
                            A different phone
                          </button>
                        </div>

                        {/* Keep the "This phone" and "A different phone" Telegram paths aligned.
                            If one path's setup/status actions or copy changes, review the other path too. */}
                        {selectedTelegramSetupPath === 'device' && (
                          <>
                            <div className="telegram-subsection telegram-onboarding">
                              <div className="telegram-subsection-header">
                                <h4>Link this phone</h4>
                                <p className="telegram-onboarding-copy">
                                  Choose this if the monitoring phone should also receive Telegram alerts.
                                </p>
                                <p className="telegram-onboarding-copy">
                                  {showTelegramCheckingState
                                    ? 'Checking Telegram readiness...'
                                    : telegramReadiness?.ready
                                    ? 'Telegram alerts are connected.'
                                    : isWaitingForTelegramConnect
                                    ? 'Waiting for Telegram confirmation. Keep this page open and we will detect the link automatically.'
                                    : 'Connect Telegram and send /start to your bot before monitoring.'}
                                </p>
                              </div>
                              <div className={`telegram-empty-state telegram-empty-state-${deviceTelegramSummary.tone}`}>
                                <div className="telegram-empty-state-header">
                                  <span className="telegram-empty-state-badge">{deviceTelegramSummary.label}</span>
                                  <p className="telegram-empty-state-summary">{deviceTelegramSummary.summary}</p>
                                </div>
                                <p className="telegram-empty-state-next">{deviceTelegramSummary.nextAction}</p>
                              </div>
                              <ul className="telegram-checklist" aria-label="Telegram setup checklist">
                                {telegramChecklist.map((item) => (
                                  <li
                                    key={item.label}
                                    className={`telegram-checklist-item${item.done ? ' is-complete' : ''}`}
                                  >
                                    <span className="telegram-checklist-indicator" aria-hidden="true" />
                                    <span>{item.label}</span>
                                  </li>
                                ))}
                              </ul>
                              {telegramReadiness?.reason && !telegramReadiness.ready && (
                                <p className="telegram-onboarding-copy">{telegramReadiness.reason}</p>
                              )}
                              <div className="telegram-actions telegram-actions-primary">
                                <button
                                  className="primary"
                                  type="button"
                                  onClick={handleConnectTelegram}
                                  disabled={checkingTelegramReadiness}
                                >
                                  Connect Telegram alerts
                                </button>
                                <button
                                  className="telegram-link-button"
                                  type="button"
                                  onClick={handleCheckTelegramReadiness}
                                  disabled={checkingTelegramReadiness}
                                >
                                  {checkingTelegramReadiness ? 'Checking...' : 'Check Telegram status'}
                                </button>
                              </div>
                              {telegramPopupFallbackUrl && (
                                <a
                                  className="telegram-inline-link"
                                  href={telegramPopupFallbackUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  Open Telegram link again
                                </a>
                              )}
                              {isWaitingForTelegramConnect && telegramFallbackCommand && (
                                <p className="telegram-onboarding-copy telegram-onboarding-command">
                                  If Telegram opens without payload, send <code>{telegramFallbackCommand}</code> in the bot chat.
                                </p>
                              )}
                            </div>

                            {telegramReadiness?.enabled && (
                              <div className="telegram-subsection telegram-recipients">
                                <div className="telegram-recipients-header">
                                  <div>
                                    <h4>People getting alerts</h4>
                                    <p className="telegram-recipient-meta">
                                      Manage which linked Telegram recipients receive alerts for this device.
                                    </p>
                                  </div>
                                  <button
                                    className="secondary"
                                    type="button"
                                    onClick={handleConnectTelegram}
                                    disabled={checkingTelegramReadiness}
                                  >
                                    Re-run Telegram onboarding
                                  </button>
                                </div>

                                {loadingTelegramRecipients ? (
                                  <p className="telegram-recipient-meta">Loading recipients...</p>
                                ) : telegramRecipients.length === 0 ? (
                                  <p className="telegram-recipient-meta">
                                    No Telegram recipients are linked yet. Re-run onboarding to link another recipient.
                                  </p>
                                ) : (
                                  <ul className="telegram-recipient-list">
                                    {telegramRecipients.map((recipient) => {
                                      const isUpdating = updatingRecipientEndpointId === recipient.endpointId
                                      return (
                                        <li key={recipient.endpointId} className="telegram-recipient-item">
                                          <div className="telegram-recipient-details">
                                            <span className="telegram-recipient-name">
                                              {formatRecipientHandle(recipient)}
                                            </span>
                                            <span className="telegram-recipient-meta">
                                              {recipient.subscribed ? 'Subscribed' : 'Not subscribed'}
                                            </span>
                                          </div>
                                          <button
                                            className="secondary"
                                            type="button"
                                            onClick={() => {
                                              void (
                                                recipient.subscribed
                                                  ? handleRemoveRecipient(recipient)
                                                  : handleAddRecipient(recipient)
                                              )
                                            }}
                                            disabled={isUpdating}
                                            aria-label={formatRecipientActionName(
                                              recipient.subscribed ? 'remove' : 'add',
                                              recipient
                                            )}
                                          >
                                            {recipient.subscribed ? 'Remove' : 'Add'}
                                          </button>
                                        </li>
                                      )
                                    })}
                                  </ul>
                                )}
                              </div>
                            )}
                          </>
                        )}

                        {selectedTelegramSetupPath === 'invite' && (
                          <>
                            <div className="telegram-subsection share-access">
                              <div className="share-access-header">
                                <div>
                                  <h4>Send connection link</h4>
                                  <p className="telegram-recipient-meta">
                                    Tap the button below to make a link for the other phone. Opening it there will connect alerts automatically.
                                  </p>
                                </div>
                                <button
                                  className="primary"
                                  type="button"
                                  onClick={() => {
                                    void handleCreateInvite()
                                  }}
                                  disabled={updatingInviteId === 'creating'}
                                >
                                  Send link to another phone
                                </button>
                              </div>
                              {latestInviteCode && latestInviteLink && (
                                <div className="share-access-invite-callout">
                                  <p className="share-access-code">
                                    <span>Latest share link</span>
                                    <code>{latestInviteLink}</code>
                                  </p>
                                  <div className="telegram-actions telegram-actions-compact">
                                    <button
                                      type="button"
                                      className="telegram-link-button"
                                      onClick={() => {
                                        void handleCopyLatestInviteLink()
                                      }}
                                    >
                                      Copy latest share link
                                    </button>
                                    <button
                                      type="button"
                                      className="telegram-link-button"
                                      onClick={handleCheckTelegramReadiness}
                                      disabled={checkingTelegramReadiness}
                                    >
                                      {checkingTelegramReadiness ? 'Checking...' : 'Check Telegram status'}
                                    </button>
                                  </div>
                                  {latestInviteCopyStatus === 'copied' && (
                                    <p className="telegram-recipient-meta">Share link copied to clipboard.</p>
                                  )}
                                  <p className="telegram-recipient-meta">
                                    Open this link on the other phone to connect alerts automatically.
                                  </p>
                                  <p className="telegram-recipient-meta share-access-waiting">
                                    Waiting for the other phone to open the link.
                                  </p>
                                  <button
                                    type="button"
                                    className="telegram-link-button"
                                    onClick={() => setShowInviteCodeFallback((current) => !current)}
                                  >
                                    {showInviteCodeFallback ? 'Hide fallback code' : 'Having trouble? use code instead'}
                                  </button>
                                  {showInviteCodeFallback && (
                                    <p className="telegram-recipient-meta">
                                      Fallback code: <code>{latestInviteCode}</code>
                                    </p>
                                  )}
                                </div>
                              )}
                              {!latestInviteCode && !showInviteCodeFallback && (
                                <button
                                  type="button"
                                  className="telegram-link-button"
                                  onClick={() => setShowInviteCodeFallback(true)}
                                >
                                  Already have a code? use it instead
                                </button>
                              )}
                              {loadingNotificationInvites ? (
                                <p className="telegram-recipient-meta">Loading share invites...</p>
                              ) : visibleNotificationInvites.length === 0 ? (
                                <p className="telegram-recipient-meta">
                                  No share invites yet. Create one when you want to grant Telegram access.
                                </p>
                              ) : (
                                <ul className="telegram-recipient-list">
                                  {visibleNotificationInvites.map((invite) => {
                                    const isUpdating = updatingInviteId === invite.inviteId
                                    const isTerminalInvite = invite.status === 'revoked' || invite.status === 'expired'
                                    return (
                                      <li key={invite.inviteId} className="telegram-recipient-item">
                                        <div className="telegram-recipient-details">
                                          <span className="telegram-recipient-name">
                                            {formatInviteStatus(invite.status)}
                                          </span>
                                          <span className="telegram-recipient-meta">
                                            {formatInviteRecipient(invite) ?? invite.inviteId}
                                          </span>
                                        </div>
                                        {!isTerminalInvite && (
                                          <button
                                            className="secondary"
                                            type="button"
                                            onClick={() => {
                                              void handleRevokeInvite(invite)
                                            }}
                                            disabled={isUpdating}
                                            aria-label={formatInviteActionName(invite)}
                                          >
                                            Revoke
                                          </button>
                                        )}
                                        {isTerminalInvite && (
                                          <button
                                            className="secondary"
                                            type="button"
                                            onClick={() => handleDismissInvite(invite.inviteId)}
                                            aria-label={formatInviteDismissActionName(invite)}
                                          >
                                            Remove from list
                                          </button>
                                        )}
                                      </li>
                                    )
                                  })}
                                </ul>
                              )}
                            </div>

                            {showInviteCodeFallback && (
                              <div className="telegram-subsection share-access share-access-fallback">
                                <div className="share-access-header">
                                  <div>
                                    <h4>Use a code instead</h4>
                                    <p className="telegram-recipient-meta">
                                      If opening the link does not work on the other phone, paste the backup code here.
                                    </p>
                                  </div>
                                </div>
                                <div className={`telegram-empty-state telegram-empty-state-${anotherPhoneSummary.tone}`}>
                                  <div className="telegram-empty-state-header">
                                    <span className="telegram-empty-state-badge">{anotherPhoneSummary.label}</span>
                                    <p className="telegram-empty-state-summary">{anotherPhoneSummary.summary}</p>
                                  </div>
                                  <p className="telegram-empty-state-next">{anotherPhoneSummary.nextAction}</p>
                                </div>
                                <div className="share-access-controls">
                                  <label className="account-field">
                                    <span>Invite code</span>
                                    <input
                                      type="text"
                                      value={inviteCodeInput}
                                      onChange={(event) => setInviteCodeInput(event.target.value)}
                                      aria-label="Invite code"
                                      placeholder="Insert code shared from other phone here to connect!"
                                    />
                                  </label>
                                  <div className="telegram-actions telegram-actions-compact">
                                    <button
                                      className="secondary"
                                      type="button"
                                      onClick={() => {
                                        void handleAcceptInvite()
                                      }}
                                    >
                                      Accept invite
                                    </button>
                                    <button
                                      className="telegram-link-button"
                                      type="button"
                                      onClick={handleCheckTelegramReadiness}
                                      disabled={checkingTelegramReadiness}
                                    >
                                      {checkingTelegramReadiness ? 'Checking...' : 'Check Telegram status'}
                                    </button>
                                  </div>
                                </div>
                                {telegramPopupFallbackUrl && (
                                  <a
                                    className="telegram-inline-link"
                                    href={telegramPopupFallbackUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    Open Telegram link again
                                  </a>
                                )}
                                {inviteAcceptedMessage && (
                                  <p className="telegram-recipient-meta">{inviteAcceptedMessage}</p>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </section>

                <section className="setup-step" aria-label="Alert instructions">
                  <div className="setup-step-header">
                    <span className="setup-step-number">2</span>
                    <div>
                      <h3>What should trigger an alert?</h3>
                      <p>Add one or more short rules so Ping Watch knows what should count as an alert.</p>
                    </div>
                  </div>
                  <div className="analysis-prompt-section">
                    <div className="analysis-prompt-header">
                      <div className="analysis-prompt-copy-group">
                        <p className="analysis-prompt-copy">
                          Add one short sentence per rule so alerts stay clear and specific.
                        </p>
                        <ul className="analysis-prompt-examples" aria-label="Alert instruction examples">
                          <li>Alert if my dog comes into the room.</li>
                          <li>Alert if someone seems to break into my red honda car.</li>
                          <li>Alert if garbage are placed outside of the garbage deposit.</li>
                        </ul>
                      </div>
                    </div>
                    <div className="analysis-prompt-list">
                      {alertInstructions.map((instruction, index) => (
                        <div key={`alert-instruction-${index}`} className="analysis-prompt-item">
                          <label className="analysis-prompt-label">
                            <span>{`Alert instruction ${index + 1}`}</span>
                            <textarea
                              className="analysis-prompt-input"
                              placeholder="Example: Alert me if a person enters through the front door."
                              value={instruction}
                              onChange={(event) => handleAlertInstructionChange(index, event.target.value)}
                              disabled={isSessionActive}
                              rows={2}
                            />
                          </label>
                          <div className="analysis-prompt-actions">
                            <button
                              className="secondary"
                              type="button"
                              onClick={handleAddAlertInstruction}
                              disabled={isSessionActive}
                              aria-label={`Add alert instruction after ${index + 1}`}
                            >
                              Add
                            </button>
                            <button
                              className="secondary analysis-prompt-remove"
                              type="button"
                              onClick={() => handleRemoveAlertInstruction(index)}
                              disabled={isSessionActive || alertInstructions.length === 1}
                              aria-label={`Remove alert instruction ${index + 1}`}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>

                <section className="setup-step" aria-label="Monitoring controls">
                  <div className="setup-step-header">
                    <span className="setup-step-number">3</span>
                    <div>
                      <h3>Check camera and start</h3>
                      <p>Make sure alerts are ready, preview the camera once, then tap start.</p>
                    </div>
                  </div>

                  <div className="status-card setup-status-card">
                    <div className="status-row">
                      <span className="status-label">Monitoring</span>
                      <span className="status-value">{monitoringStatusLabel}</span>
                    </div>
                    <div className="status-row">
                      <span className="status-label">Capture</span>
                      <span className="status-value">{captureLabel}</span>
                    </div>
                    <div className="status-row">
                      <span className="status-label">Alerts</span>
                      <span className="status-value">{telegramStatusLabel}</span>
                    </div>
                    <div className="status-row">
                      <span className="status-label">Last event</span>
                      <span className="status-value">{lastEventLabel}</span>
                    </div>
                  </div>

                  <div className="monitoring-readiness-card">
                    <div className="monitoring-readiness-header">
                      <div>
                        <h3>Required before start</h3>
                        <p>Finish these two steps so alerts are ready before you start monitoring.</p>
                      </div>
                    </div>
                    <ul className="monitoring-readiness-list" aria-label="Monitoring readiness checklist">
                      {monitoringChecklist.map((item) => (
                        <li
                          key={item.label}
                          className={`monitoring-readiness-item${item.done ? ' is-complete' : ''}`}
                        >
                          <span className="monitoring-readiness-indicator" aria-hidden="true" />
                          <div className="monitoring-readiness-copy">
                            <span className="monitoring-readiness-label">{item.label}</span>
                            <span className="monitoring-readiness-note">{item.note}</span>
                            {item.label === 'Telegram linked' && !telegramReadiness?.ready && (
                              <button
                                className="secondary monitoring-readiness-action"
                                type="button"
                                onClick={handleCheckTelegramReadiness}
                                disabled={checkingTelegramReadiness}
                              >
                                {checkingTelegramReadiness ? 'Checking...' : 'Check Telegram status'}
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="monitoring-readiness-header">
                      <div>
                        <h3>Helpful tips</h3>
                        <p>These are optional, but they usually make monitoring work better.</p>
                      </div>
                    </div>
                    <div className="monitoring-hints" aria-label="Helpful setup tips">
                      <p className="monitoring-hint">Keep the phone plugged in for longer sessions.</p>
                      <p className="monitoring-hint">Use camera preview to check what the lens sees before you start.</p>
                    </div>
                    <div className="monitoring-preview-actions">
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => {
                          void handleStartCameraPreview()
                        }}
                        disabled={isCameraPreviewVisible}
                      >
                        {isCameraPreviewVisible ? 'Camera preview live...' : 'Preview camera for 5 seconds'}
                      </button>
                      {telegramReadiness?.ready && (
                        <button
                          className="secondary"
                          type="button"
                          onClick={() => {
                            void handleSendTelegramTestAlert()
                          }}
                          disabled={sendingTelegramTestAlert}
                        >
                          {sendingTelegramTestAlert ? 'Sending test alert...' : 'Send test alert'}
                        </button>
                      )}
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => setShowAlertPreview((current) => !current)}
                        disabled={!hasAlertInstructions}
                      >
                        {showAlertPreview ? 'Hide alert preview' : 'Preview how alerts will be described'}
                      </button>
                    </div>
                    {isCameraPreviewVisible && (
                      <div className="monitoring-preview-card monitoring-camera-preview" role="region" aria-label="Camera preview">
                        <span className="monitoring-preview-eyebrow">Camera preview</span>
                        <p className="monitoring-preview-copy">
                          Live for 5 seconds so you can confirm the camera angle before monitoring starts.
                        </p>
                        <video
                          ref={cameraPreviewVideoRef}
                          className="monitoring-camera-preview-video"
                          aria-label="Camera preview video"
                          autoPlay
                          muted
                          playsInline
                          disablePictureInPicture
                        />
                      </div>
                    )}
                    {telegramTestAlertMessage && (
                      <p className="monitoring-inline-message">{telegramTestAlertMessage}</p>
                    )}
                    {showAlertPreview && hasAlertInstructions && (
                      <div className="monitoring-preview-card" aria-label="Preview alert wording">
                        <span className="monitoring-preview-eyebrow">Preview alert wording</span>
                        <p className="monitoring-preview-copy">
                          Ping Watch can send alerts like these when it notices activity:
                        </p>
                        <ul className="monitoring-preview-list">
                          {normalizedAlertInstructions.map((instruction) => (
                            <li key={instruction}>{instruction}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <div className="controls setup-controls">
                    <button
                      className="primary"
                      type="button"
                      onClick={handleStart}
                      disabled={
                        isSessionActive
                        || isBusy
                        || isAuthenticating
                        || requiresTelegramOnboarding
                        || !hasAlertInstructions
                      }
                    >
                      Start monitoring
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      onClick={handleStop}
                      disabled={!isSessionActive || isBusy || isAuthenticating}
                    >
                      Stop
                    </button>
                  </div>
                </section>
              </CollapsiblePanel>
            )}

            {showLiveMonitoring && (
              <CollapsiblePanel title="Monitoring" contentClassName="live-monitor-panel" collapsible={false}>
                <div className="live-monitor-hero">
                  <span className="live-monitor-pill">Monitoring is on</span>
                  <h3>Monitoring is on</h3>
                  <p>
                    Leave this phone pointed at the area you want to watch. Alerts will go to Telegram when something matches your rules.
                  </p>
                </div>
                <div className="status-card live-status-card">
                  <div className="status-row">
                    <span className="status-label">Monitoring</span>
                    <span className="status-value">{monitoringStatusLabel}</span>
                  </div>
                  <div className="status-row">
                    <span className="status-label">Capture</span>
                    <span className="status-value">{captureLabel}</span>
                  </div>
                  <div className="status-row">
                    <span className="status-label">Alerts</span>
                    <span className="status-value">{telegramStatusLabel}</span>
                  </div>
                  <div className="status-row">
                    <span className="status-label">Last event</span>
                    <span className="status-value">{lastEventLabel}</span>
                  </div>
                  {latestEventSummary && (
                    <div className="monitoring-callout" aria-label="Latest event summary">
                      <span className="status-label">Latest event summary</span>
                      <p className="monitoring-callout-copy">{latestEventSummary}</p>
                    </div>
                  )}
                </div>
                <div className="monitoring-preview-actions">
                  <button
                    className="primary"
                    type="button"
                    onClick={handleStop}
                    disabled={sessionStatus !== 'active' || isBusy || isAuthenticating}
                  >
                    Stop
                  </button>
                  {telegramReadiness?.ready && (
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => {
                        void handleSendTelegramTestAlert()
                      }}
                      disabled={sendingTelegramTestAlert}
                    >
                      {sendingTelegramTestAlert ? 'Sending test alert...' : 'Send test alert'}
                    </button>
                  )}
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setShowAlertPreview((current) => !current)}
                    disabled={!hasAlertInstructions}
                  >
                    {showAlertPreview ? 'Hide alert preview' : 'Preview how alerts will be described'}
                  </button>
                </div>
                {telegramTestAlertMessage && (
                  <p className="monitoring-inline-message">{telegramTestAlertMessage}</p>
                )}
                {showAlertPreview && hasAlertInstructions && (
                  <div className="monitoring-preview-card" aria-label="Preview alert wording">
                    <span className="monitoring-preview-eyebrow">Preview alert wording</span>
                    <p className="monitoring-preview-copy">
                      Ping Watch can send alerts like these when it notices activity:
                    </p>
                    <ul className="monitoring-preview-list">
                      {normalizedAlertInstructions.map((instruction) => (
                        <li key={instruction}>{instruction}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CollapsiblePanel>
            )}

            <CollapsiblePanel title="History" contentClassName="history-panel">
              <section className="history-section events">
                <div className="history-section-header">
                  <h3>Recent events</h3>
                  <span className="events-meta">{events.length} captured</span>
                </div>
                {events.length === 0 ? (
                  <p className="events-empty">No clips captured yet.</p>
                ) : (
                  <ul className="events-list">
                    {events.map((event) => {
                      const confidence = formatConfidence(event.confidence)
                      const inferenceSource = formatInferenceSource(
                        event.inference_provider,
                        event.inference_model
                      )
                      const notifyStatus = event.should_notify === true ? 'alert' : 'no alert'
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
                            {event.summary && <p className="event-summary">{event.summary}</p>}
                            {(event.label || confidence || inferenceSource || event.alert_reason) && (
                              <div className="event-meta">
                                <span className={`event-notify-status status-${notifyStatus.replace(' ', '-')}`}>
                                  {notifyStatus}
                                </span>
                                {event.label && <span className="event-label">{event.label}</span>}
                                {confidence && <span className="event-confidence">{confidence}</span>}
                                {event.alert_reason && (
                                  <span className="event-alert-reason">{event.alert_reason}</span>
                                )}
                                {inferenceSource && (
                                  <span className="event-inference-source">{inferenceSource}</span>
                                )}
                              </div>
                            )}
                          </div>
                          <span className={`event-status status-${event.status}`}>{event.status}</span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>

              <section className="history-section clip-timeline">
                <div className="history-section-header">
                  <h3>Stored clips</h3>
                  <span className="events-meta">
                    {clips.length} stored · {clipStats.pending} pending
                    {clipStats.failed ? ` · ${clipStats.failed} failed` : ''}
                  </span>
                </div>
                {clips.length === 0 ? (
                  <p className="events-empty">No stored clips yet.</p>
                ) : (
                  <ul className="clip-list">
                    {clips.map((clip) => {
                      const relatedEvent = eventsById.get(clip.id)
                      const relatedConfidence = formatConfidence(relatedEvent?.confidence)
                      const relatedInferenceSource = formatInferenceSource(
                        relatedEvent?.inference_provider,
                        relatedEvent?.inference_model
                      )
                      const relatedNotifyStatus = relatedEvent?.should_notify === true ? 'alert' : 'no alert'
                      return (
                        <li key={clip.id} className="clip-item">
                          <div>
                            <div className="clip-id">
                              {clip.id}
                              {clip.isBenchmark && <span className="clip-badge benchmark">Benchmark</span>}
                            </div>
                            <div className="clip-meta">
                              <span>{formatDuration(clip.durationSeconds)}</span>
                              <span>{formatBytes(clip.sizeBytes)}</span>
                              <span>{clip.triggerType}</span>
                              <span>{clip.uploaded ? 'uploaded' : 'pending'}</span>
                              {relatedEvent && (
                                <span className={`clip-inference-status status-${relatedEvent.status}`}>
                                  inference: {relatedEvent.status}
                                </span>
                              )}
                              {clip.peakMotionScore !== undefined && (
                                <span>peak motion: {clip.peakMotionScore.toFixed(3)}</span>
                              )}
                              {clip.peakAudioScore !== undefined && (
                                <span>peak audio: {clip.peakAudioScore.toFixed(3)}</span>
                              )}
                              {clip.triggeredBy && clip.triggeredBy.length > 0 && (
                                <span className="clip-triggers">
                                  triggered: {formatTriggers(clip.triggeredBy)}
                                </span>
                              )}
                              {!clip.uploaded && clip.lastUploadError && (
                                <span className="clip-error">{clip.lastUploadError}</span>
                              )}
                            </div>
                            {relatedEvent?.summary && (
                              <p className="clip-inference-summary">{relatedEvent.summary}</p>
                            )}
                            {(relatedEvent?.label || relatedConfidence || relatedInferenceSource || relatedEvent?.alert_reason) && (
                              <div className="clip-inference-meta">
                                <span>{relatedNotifyStatus}</span>
                                {relatedEvent?.label && <span>{relatedEvent.label}</span>}
                                {relatedConfidence && <span>{relatedConfidence}</span>}
                                {relatedEvent?.alert_reason && <span>{relatedEvent.alert_reason}</span>}
                                {relatedInferenceSource && <span>{relatedInferenceSource}</span>}
                              </div>
                            )}
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
                      )
                    })}
                  </ul>
                )}
              </section>
            </CollapsiblePanel>

            <CollapsiblePanel title="Advanced settings" contentClassName="advanced-panel">
              <p className="advanced-intro">
                Most people can leave this alone. Open it only when you want to tune recording or inspect low-level details.
              </p>
              <div className="mode-toggle mode-toggle-inline" role="group" aria-label="Frontend mode">
                <button
                  type="button"
                  className={`mode-toggle-button${!isDevMode ? ' active' : ''}`}
                  aria-pressed={!isDevMode}
                  onClick={() => setMode('user')}
                >
                  User mode
                </button>
                <button
                  type="button"
                  className={`mode-toggle-button${isDevMode ? ' active' : ''}`}
                  aria-pressed={isDevMode}
                  onClick={() => setMode('dev')}
                >
                  Dev mode
                </button>
              </div>
              {!isDevMode ? (
                <p className="advanced-intro">
                  User mode keeps the main screen focused on setup, live monitoring, and history.
                </p>
              ) : (
                <>
                  <div className="status-card advanced-status-card">
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
                      <span className="status-value">{benchmarkClipId ? 'Clip #0' : 'Not set'}</span>
                    </div>
                    <div className="status-row">
                      <span className="status-label">Session stats</span>
                      <span className="status-value">
                        Stored: {sessionCounts.stored} / Discarded: {sessionCounts.discarded}
                      </span>
                    </div>
                    <div className="status-row">
                      <span className="status-label">Queued clips</span>
                      <span className="status-value status-queue">
                        {queuedClipsRemaining} remaining
                        <button
                          className="secondary status-inline-action"
                          type="button"
                          onClick={handleForceStop}
                          disabled={!sessionId || isForceStopping}
                        >
                          Force stop
                        </button>
                      </span>
                    </div>
                    <div className="status-row">
                      <span className="status-label">Motion / Audio</span>
                      <span className="status-value">
                        {motionDetection.currentScore.toFixed(3)} / {audioDetection.currentScore.toFixed(3)}
                      </span>
                    </div>
                    <div className="status-row">
                      <span className="status-label">Last event</span>
                      <span className="status-value">{lastEventLabel}</span>
                    </div>
                  </div>

                  <div className="clip-controls">
                    <h3>Recording settings</h3>
                    <div className="motion-grid">
                      <label className="motion-field">
                        <span>Clip duration (s)</span>
                        <input
                          type="range"
                          min={5}
                          max={20}
                          step={1}
                          value={settings.clipDuration}
                          aria-label="Clip duration seconds"
                          onChange={(e) => settings.setClipDuration(Number(e.target.value))}
                        />
                        <span className="motion-value">{settings.clipDuration}s</span>
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
                          value={settings.motionDeltaThreshold}
                          aria-label="Motion delta threshold"
                          onChange={(e) => settings.setMotionDeltaThreshold(Number(e.target.value))}
                        />
                        <span className="motion-value">{settings.motionDeltaThreshold.toFixed(2)}</span>
                      </label>
                      <label className="motion-field">
                        <span>Motion absolute threshold</span>
                        <input
                          type="range"
                          min={0.01}
                          max={0.3}
                          step={0.01}
                          value={settings.motionAbsoluteThreshold}
                          aria-label="Motion absolute threshold"
                          onChange={(e) => settings.setMotionAbsoluteThreshold(Number(e.target.value))}
                        />
                        <span className="motion-value">{settings.motionAbsoluteThreshold.toFixed(2)}</span>
                      </label>
                    </div>

                    <h3>Audio Detection (Optional)</h3>
                    <div className="motion-grid">
                      <label className="motion-field motion-toggle">
                        <span>Audio delta comparison</span>
                        <input
                          type="checkbox"
                          checked={settings.audioDeltaEnabled}
                          aria-label="Enable audio delta"
                          onChange={(e) => settings.setAudioDeltaEnabled(e.target.checked)}
                        />
                      </label>
                      {settings.audioDeltaEnabled && (
                        <label className="motion-field">
                          <span>Audio delta threshold</span>
                          <input
                            type="range"
                            min={0.01}
                            max={0.5}
                            step={0.01}
                            value={settings.audioDeltaThreshold}
                            aria-label="Audio delta threshold"
                            onChange={(e) => settings.setAudioDeltaThreshold(Number(e.target.value))}
                          />
                          <span className="motion-value">{settings.audioDeltaThreshold.toFixed(2)}</span>
                        </label>
                      )}
                      <label className="motion-field motion-toggle">
                        <span>Loud sound detection</span>
                        <input
                          type="checkbox"
                          checked={settings.audioAbsoluteEnabled}
                          aria-label="Enable loud sound detection"
                          onChange={(e) => settings.setAudioAbsoluteEnabled(e.target.checked)}
                        />
                      </label>
                      {settings.audioAbsoluteEnabled && (
                        <label className="motion-field">
                          <span>Loud threshold</span>
                          <input
                            type="range"
                            min={0.05}
                            max={0.5}
                            step={0.01}
                            value={settings.audioAbsoluteThreshold}
                            aria-label="Audio absolute threshold"
                            onChange={(e) => settings.setAudioAbsoluteThreshold(Number(e.target.value))}
                          />
                          <span className="motion-value">{settings.audioAbsoluteThreshold.toFixed(2)}</span>
                        </label>
                      )}
                    </div>

                    <div className="controls advanced-controls">
                      <button
                        className="secondary"
                        type="button"
                        onClick={handleUploadClips}
                        disabled={!sessionId || isBusy || isAuthenticating}
                      >
                        Upload stored clips
                      </button>
                    </div>
                  </div>
                </>
              )}
            </CollapsiblePanel>
          </>
        )}

        {error && <p className="error-banner">{error}</p>}

        {selectedClipUrl && (
          <div className="clip-preview">
            <div className="clip-preview-header">
              <span>Preview: {selectedClipId}</span>
            </div>
            <video data-testid="clip-preview" src={selectedClipUrl} controls />
          </div>
        )}
      </main>
    </div>
  )
}

export default App
