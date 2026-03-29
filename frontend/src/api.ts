const normalizeApiBaseUrl = (value: string): string => value.replace(/\/+$/, '')

const getDefaultApiBaseUrl = (): string => {
  if (typeof window !== 'undefined' && window.location?.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:8000`
  }
  return 'http://localhost:8000'
}

const API_BASE_URL = normalizeApiBaseUrl(
  import.meta.env.VITE_API_URL?.trim() || getDefaultApiBaseUrl()
)

const AUTH_TOKEN_KEY = 'ping-watch:auth-token'
const AUTH_USER_ID_KEY = 'ping-watch:auth-user-id'
const AUTH_EXPIRES_AT_KEY = 'ping-watch:auth-expires-at'
const AUTH_EMAIL_KEY = 'ping-watch:auth-email'
const AUTH_LOCAL_USER_ID_KEY = 'ping-watch:auth-local-user-id'
const AUTH_REQUIRED_OVERRIDE_KEY = '__PING_WATCH_AUTH_REQUIRED__'
const AUTH_AUTO_LOGIN_OVERRIDE_KEY = '__PING_WATCH_AUTH_AUTO_LOGIN__'

let authLoginPromise: Promise<string> | null = null

const parseBoolean = (value: string | undefined): boolean =>
  (value ?? '').trim().toLowerCase() === 'true'

const isAuthRequired = (): boolean => {
  const override = (globalThis as Record<string, unknown>)[AUTH_REQUIRED_OVERRIDE_KEY]
  if (typeof override === 'boolean') {
    return override
  }
  return parseBoolean(import.meta.env.VITE_AUTH_REQUIRED)
}

const isAuthAutoLoginEnabled = (): boolean => {
  const override = (globalThis as Record<string, unknown>)[AUTH_AUTO_LOGIN_OVERRIDE_KEY]
  if (typeof override === 'boolean') {
    return override
  }
  return parseBoolean(import.meta.env.VITE_AUTH_AUTO_LOGIN)
}

const getStorageValue = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const setStorageValue = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
      return
    }
    localStorage.setItem(key, value)
  } catch {
    // Ignore localStorage failures and continue without persistence.
  }
}

const nowMs = () => Date.now()

const getStoredToken = (): string | null => getStorageValue(AUTH_TOKEN_KEY)

const tokenExpired = (expiresAt: string | null): boolean => {
  if (!expiresAt) return false
  const expiresAtMs = Date.parse(expiresAt)
  if (Number.isNaN(expiresAtMs)) return true
  return expiresAtMs <= nowMs() + 10_000
}

const generateClientId = (): string => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }
  return `user_${nowMs()}_${Math.random().toString(16).slice(2)}`
}

const getOrCreateLocalUserId = (): string => {
  const existing = getStorageValue(AUTH_LOCAL_USER_ID_KEY)
  if (existing) return existing
  const generated = generateClientId()
  setStorageValue(AUTH_LOCAL_USER_ID_KEY, generated)
  return generated
}

const setStoredAuthSession = (payload: {
  token: string
  userId: string | null
  expiresAt: string | null
  email?: string | null
}) => {
  setStorageValue(AUTH_TOKEN_KEY, payload.token)
  setStorageValue(AUTH_USER_ID_KEY, payload.userId)
  setStorageValue(AUTH_EXPIRES_AT_KEY, payload.expiresAt)
  if (payload.email !== undefined) {
    setStorageValue(AUTH_EMAIL_KEY, payload.email)
  }
}

const clearStoredAuthSession = () => {
  setStorageValue(AUTH_TOKEN_KEY, null)
  setStorageValue(AUTH_USER_ID_KEY, null)
  setStorageValue(AUTH_EXPIRES_AT_KEY, null)
  setStorageValue(AUTH_EMAIL_KEY, null)
}

type DevLoginResponse = {
  access_token: string
  token_type: string
  user_id?: string | null
  expires_at?: string | null
}

const runDevLogin = async (payload: {
  userId?: string
  email?: string | null
}): Promise<string> => {
  const response = await fetch(`${API_BASE_URL}/auth/dev/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: payload.userId,
      email: payload.email,
    }),
  })

  if (!response.ok) {
    throw new ApiError(response.status)
  }

  const data = (await response.json()) as DevLoginResponse
  const token = (data.access_token ?? '').trim()
  if (!token) {
    throw new ApiError(500, 'missing access token from auth response')
  }

  setStoredAuthSession({
    token,
    userId: data.user_id ?? null,
    expiresAt: data.expires_at ?? null,
    email: payload.email ?? null,
  })
  return token
}

const loginForToken = async (): Promise<string> => {
  if (authLoginPromise) return authLoginPromise

  authLoginPromise = (async () => {
    const localUserId = getOrCreateLocalUserId()
    return runDevLogin({ userId: localUserId })
  })()

  try {
    return await authLoginPromise
  } finally {
    authLoginPromise = null
  }
}

const resolveAuthToken = async (forceRefresh: boolean): Promise<string | null> => {
  if (!isAuthRequired()) return null
  if (!forceRefresh) {
    const token = getStoredToken()
    const expiresAt = getStorageValue(AUTH_EXPIRES_AT_KEY)
    if (token && !tokenExpired(expiresAt)) {
      return token
    }
  }
  if (!isAuthAutoLoginEnabled()) {
    return null
  }
  return loginForToken()
}

export type AuthSession = {
  authRequired: boolean
  autoLogin: boolean
  authenticated: boolean
  userId: string | null
  email: string | null
  expiresAt: string | null
}

export const getAuthSession = (): AuthSession => {
  const token = getStoredToken()
  const expiresAt = getStorageValue(AUTH_EXPIRES_AT_KEY)
  const expired = tokenExpired(expiresAt)
  const authenticated = Boolean(token) && !expired
  return {
    authRequired: isAuthRequired(),
    autoLogin: isAuthAutoLoginEnabled(),
    authenticated,
    userId: authenticated ? getStorageValue(AUTH_USER_ID_KEY) : null,
    email: authenticated ? getStorageValue(AUTH_EMAIL_KEY) : null,
    expiresAt: authenticated ? expiresAt : null,
  }
}

export const loginWithEmail = async (email: string): Promise<AuthSession> => {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) {
    throw new ApiError(400, 'email is required')
  }
  await runDevLogin({ email: normalizedEmail })
  return getAuthSession()
}

export const logout = () => {
  clearStoredAuthSession()
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message?: string) {
    super(message ?? `Request failed: ${status}`)
    this.name = 'ApiError'
    this.status = status
  }
}

type RequestOptions = {
  method?: string
  body?: unknown
}

const request = async <T>(path: string, options: RequestOptions = {}) => {
  const method = (options.method ?? 'GET').toUpperCase()

  const execute = async (forceRefreshToken: boolean) => {
    const token = await resolveAuthToken(forceRefreshToken)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }

    return fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    })
  }

  let response = await execute(false)
  if (response.status === 401 && isAuthRequired()) {
    clearStoredAuthSession()
    if (isAuthAutoLoginEnabled()) {
      response = await execute(true)
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status)
  }

  return (await response.json()) as T
}

export type SessionResponse = {
  session_id: string
  device_id: string
  user_id?: string | null
  status: string
  started_at?: string
  stopped_at?: string | null
  analysis_prompt?: string | null
}

export type DeviceResponse = {
  device_id: string
  user_id?: string | null
  label?: string | null
  created_at?: string
}

export type EventResponse = {
  event_id: string
  session_id?: string
  user_id?: string | null
  device_id?: string
  status: string
  trigger_type: string
  created_at?: string
  duration_seconds?: number
  clip_uri?: string
  clip_mime?: string
  clip_size_bytes?: number
  clip_container?: string | null
  clip_blob_name?: string | null
  clip_uploaded_at?: string | null
  clip_etag?: string | null
  summary?: string | null
  label?: string | null
  confidence?: number | null
  inference_provider?: string | null
  inference_model?: string | null
  should_notify?: boolean | null
  alert_reason?: string | null
  matched_rules?: string[] | null
  detected_entities?: string[] | null
  detected_actions?: string[] | null
}

export type TelegramReadinessResponse = {
  enabled: boolean
  ready: boolean
  status: string
  reason: string | null
}

export type TelegramLinkStartResponse = {
  enabled: boolean
  ready: boolean
  status: string
  reason: string | null
  attemptId: string | null
  connectUrl: string | null
  expiresAt: string | null
  linkCode: string | null
  fallbackCommand: string | null
}

export type TelegramLinkStatusResponse = {
  enabled: boolean
  ready: boolean
  linked: boolean
  status: string
  reason: string | null
  attemptId: string
}

export type TelegramTestAlertResponse = {
  ok: boolean
  deliveredCount: number
}

type TelegramReadinessApiResponse = {
  enabled: boolean
  ready: boolean
  status: string
  reason?: string | null
}

type TelegramLinkStartApiResponse = {
  enabled: boolean
  ready: boolean
  status: string
  reason?: string | null
  attempt_id?: string | null
  connect_url?: string | null
  expires_at?: string | null
  link_code?: string | null
  fallback_command?: string | null
}

type TelegramLinkStatusApiResponse = {
  enabled: boolean
  ready: boolean
  linked: boolean
  status: string
  reason?: string | null
  attempt_id: string
}

type TelegramTestAlertApiResponse = {
  ok: boolean
  delivered_count?: number | null
}

export type NotificationRecipient = {
  endpointId: string
  provider: string
  chatId: string
  telegramUsername: string | null
  linkedAt: string
  subscribed: boolean
}

export type NotificationRecipientListResponse = {
  deviceId: string
  recipients: NotificationRecipient[]
}

export type NotificationInvite = {
  inviteId: string
  deviceId: string
  status: string
  inviteCode: string | null
  createdAt: string
  expiresAt: string
  acceptedAt: string | null
  revokedAt: string | null
  recipientChatId: string | null
  recipientTelegramUsername: string | null
}

export type NotificationInviteListResponse = {
  deviceId: string
  invites: NotificationInvite[]
}

type NotificationRecipientApiResponse = {
  endpoint_id: string
  provider: string
  chat_id: string
  telegram_username?: string | null
  linked_at: string
  subscribed: boolean
}

type NotificationRecipientListApiResponse = {
  device_id: string
  recipients: NotificationRecipientApiResponse[]
}

type NotificationInviteApiResponse = {
  invite_id: string
  device_id: string
  status: string
  invite_code?: string | null
  created_at: string
  expires_at: string
  accepted_at?: string | null
  revoked_at?: string | null
  recipient_chat_id?: string | null
  recipient_telegram_username?: string | null
}

type NotificationInviteListApiResponse = {
  device_id: string
  invites: NotificationInviteApiResponse[]
}

type NotificationRecipientRemoveApiResponse = {
  device_id: string
  endpoint_id: string
  removed: boolean
}

export type CreateEventPayload = {
  sessionId: string
  deviceId: string
  triggerType: string
  durationSeconds: number
  clipUri: string
  clipMime: string
  clipSizeBytes: number
}

export type InitiateUploadPayload = {
  eventId?: string
  sessionId: string
  deviceId: string
  triggerType: string
  durationSeconds: number
  clipMime: string
  clipSizeBytes: number
}

export type InitiateUploadResponse = {
  event: EventResponse
  uploadUrl: string
  blobUrl: string
  expiresAt: string
}

export const startSession = (deviceId: string, analysisPrompts?: string[]) => {
  const normalizedPrompts = (analysisPrompts ?? [])
    .map((prompt) => prompt.trim())
    .filter(Boolean)

  return request<SessionResponse>('/sessions/start', {
    method: 'POST',
    body: {
      device_id: deviceId,
      analysis_prompt: null,
      analysis_prompts: normalizedPrompts.length > 0 ? normalizedPrompts : null,
    },
  })
}

export const stopSession = (sessionId: string) =>
  request<SessionResponse>('/sessions/stop', {
    method: 'POST',
    body: { session_id: sessionId },
  })

export type ForceStopSessionResponse = SessionResponse & {
  dropped_processing_events: number
  dropped_queued_jobs: number
}

export const forceStopSession = (sessionId: string) =>
  request<ForceStopSessionResponse>('/sessions/force-stop', {
    method: 'POST',
    body: { session_id: sessionId },
  })

export const listEvents = (sessionId: string) =>
  request<EventResponse[]>(`/events?session_id=${encodeURIComponent(sessionId)}`)

const toTelegramReadiness = (
  response: TelegramReadinessApiResponse
): TelegramReadinessResponse => ({
  enabled: response.enabled,
  ready: response.ready,
  status: response.status,
  reason: response.reason ?? null,
})

const toTelegramLinkStart = (
  response: TelegramLinkStartApiResponse
): TelegramLinkStartResponse => ({
  enabled: response.enabled,
  ready: response.ready,
  status: response.status,
  reason: response.reason ?? null,
  attemptId: response.attempt_id ?? null,
  connectUrl: response.connect_url ?? null,
  expiresAt: response.expires_at ?? null,
  linkCode: response.link_code ?? null,
  fallbackCommand: response.fallback_command ?? null,
})

const toTelegramLinkStatus = (
  response: TelegramLinkStatusApiResponse
): TelegramLinkStatusResponse => ({
  enabled: response.enabled,
  ready: response.ready,
  linked: response.linked,
  status: response.status,
  reason: response.reason ?? null,
  attemptId: response.attempt_id,
})

const toNotificationRecipient = (
  response: NotificationRecipientApiResponse
): NotificationRecipient => ({
  endpointId: response.endpoint_id,
  provider: response.provider,
  chatId: response.chat_id,
  telegramUsername: response.telegram_username ?? null,
  linkedAt: response.linked_at,
  subscribed: response.subscribed,
})

const toNotificationInvite = (
  response: NotificationInviteApiResponse
): NotificationInvite => ({
  inviteId: response.invite_id,
  deviceId: response.device_id,
  status: response.status,
  inviteCode: response.invite_code ?? null,
  createdAt: response.created_at,
  expiresAt: response.expires_at,
  acceptedAt: response.accepted_at ?? null,
  revokedAt: response.revoked_at ?? null,
  recipientChatId: response.recipient_chat_id ?? null,
  recipientTelegramUsername: response.recipient_telegram_username ?? null,
})

export const getTelegramReadiness = async (
  deviceId: string
): Promise<TelegramReadinessResponse> => {
  const response = await request<TelegramReadinessApiResponse>(
    `/notifications/telegram/readiness?device_id=${encodeURIComponent(deviceId)}`
  )
  return toTelegramReadiness(response)
}

export const startTelegramLink = async (
  deviceId: string
): Promise<TelegramLinkStartResponse> => {
  const response = await request<TelegramLinkStartApiResponse>(
    '/notifications/telegram/link/start',
    {
      method: 'POST',
      body: {
        device_id: deviceId,
      },
    }
  )
  return toTelegramLinkStart(response)
}

export const getTelegramLinkStatus = async (
  deviceId: string,
  attemptId: string
): Promise<TelegramLinkStatusResponse> => {
  const response = await request<TelegramLinkStatusApiResponse>(
    `/notifications/telegram/link/status?device_id=${encodeURIComponent(deviceId)}&attempt_id=${encodeURIComponent(attemptId)}`
  )
  return toTelegramLinkStatus(response)
}

export const sendTelegramTestAlert = async (
  deviceId: string
): Promise<TelegramTestAlertResponse> => {
  const response = await request<TelegramTestAlertApiResponse>(
    '/notifications/telegram/test',
    {
      method: 'POST',
      body: {
        device_id: deviceId,
      },
    }
  )
  return {
    ok: response.ok,
    deliveredCount: response.delivered_count ?? 0,
  }
}

export const listNotificationRecipients = async (
  deviceId: string
): Promise<NotificationRecipientListResponse> => {
  const response = await request<NotificationRecipientListApiResponse>(
    `/notifications/recipients?device_id=${encodeURIComponent(deviceId)}`
  )
  return {
    deviceId: response.device_id ?? deviceId,
    recipients: (response.recipients ?? []).map(toNotificationRecipient),
  }
}

export const addNotificationRecipient = async (
  deviceId: string,
  endpointId: string
): Promise<NotificationRecipient> => {
  const response = await request<NotificationRecipientApiResponse>(
    '/notifications/recipients',
    {
      method: 'POST',
      body: {
        device_id: deviceId,
        endpoint_id: endpointId,
      },
    }
  )
  return toNotificationRecipient(response)
}

export const removeNotificationRecipient = async (
  deviceId: string,
  endpointId: string
): Promise<boolean> => {
  const response = await request<NotificationRecipientRemoveApiResponse>(
    `/notifications/recipients?device_id=${encodeURIComponent(deviceId)}&endpoint_id=${encodeURIComponent(endpointId)}`,
    {
      method: 'DELETE',
    }
  )
  return response.removed
}

export const listNotificationInvites = async (
  deviceId: string
): Promise<NotificationInviteListResponse> => {
  const response = await request<NotificationInviteListApiResponse>(
    `/notifications/invites?device_id=${encodeURIComponent(deviceId)}`
  )
  return {
    deviceId: response.device_id ?? deviceId,
    invites: (response.invites ?? []).map(toNotificationInvite),
  }
}

export const createNotificationInvite = async (
  deviceId: string
): Promise<NotificationInvite> => {
  const response = await request<NotificationInviteApiResponse>(
    '/notifications/invites',
    {
      method: 'POST',
      body: {
        device_id: deviceId,
      },
    }
  )
  return toNotificationInvite(response)
}

export const acceptNotificationInvite = async (
  inviteCode: string
): Promise<TelegramLinkStartResponse & { deviceId: string }> => {
  const response = await request<TelegramLinkStartApiResponse & { device_id: string }>(
    '/notifications/invites/accept',
    {
      method: 'POST',
      body: {
        invite_code: inviteCode,
      },
    }
  )
  return {
    ...toTelegramLinkStart(response),
    deviceId: response.device_id,
  }
}

export const revokeNotificationInvite = async (
  deviceId: string,
  inviteId: string
): Promise<NotificationInvite> => {
  const response = await request<NotificationInviteApiResponse>(
    `/notifications/invites?device_id=${encodeURIComponent(deviceId)}&invite_id=${encodeURIComponent(inviteId)}`,
    {
      method: 'DELETE',
    }
  )
  return toNotificationInvite(response)
}

export const registerDevice = (payload: {
  deviceId?: string
  label?: string
}) =>
  request<DeviceResponse>('/devices/register', {
    method: 'POST',
    body: {
      device_id: payload.deviceId,
      label: payload.label,
    },
  })

export const createEvent = (payload: CreateEventPayload) =>
  request<EventResponse>('/events', {
    method: 'POST',
    body: {
      session_id: payload.sessionId,
      device_id: payload.deviceId,
      trigger_type: payload.triggerType,
      duration_seconds: payload.durationSeconds,
      clip_uri: payload.clipUri,
      clip_mime: payload.clipMime,
      clip_size_bytes: payload.clipSizeBytes,
    },
  })

export const initiateUpload = async (
  payload: InitiateUploadPayload
): Promise<InitiateUploadResponse> => {
  const response = await request<{
    event: EventResponse
    upload_url: string
    blob_url: string
    expires_at: string
  }>('/events/upload/initiate', {
    method: 'POST',
    body: {
      event_id: payload.eventId,
      session_id: payload.sessionId,
      device_id: payload.deviceId,
      trigger_type: payload.triggerType,
      duration_seconds: payload.durationSeconds,
      clip_mime: payload.clipMime,
      clip_size_bytes: payload.clipSizeBytes,
    },
  })

  return {
    event: response.event,
    uploadUrl: response.upload_url,
    blobUrl: response.blob_url,
    expiresAt: response.expires_at,
  }
}

export const finalizeUpload = (eventId: string, etag: string | null) =>
  request<EventResponse>(`/events/${encodeURIComponent(eventId)}/upload/finalize`, {
    method: 'POST',
    body: { etag },
  })

export const uploadClipViaApi = async (
  eventId: string,
  blob: Blob,
  options: { contentType: string }
): Promise<{ etag: string | null }> => {
  const execute = async (forceRefreshToken: boolean) => {
    const token = await resolveAuthToken(forceRefreshToken)
    const headers: Record<string, string> = {
      'Content-Type': options.contentType,
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }

    return fetch(`${API_BASE_URL}/events/${encodeURIComponent(eventId)}/upload`, {
      method: 'PUT',
      body: blob,
      headers,
    })
  }

  let response = await execute(false)
  if (response.status === 401 && isAuthRequired()) {
    clearStoredAuthSession()
    response = await execute(true)
  }

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }

  return { etag: response.headers.get('etag') }
}
