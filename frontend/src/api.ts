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
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (!response.ok) {
    throw new ApiError(response.status)
  }

  return (await response.json()) as T
}

export type SessionResponse = {
  session_id: string
  device_id: string
  status: string
  started_at?: string
  stopped_at?: string | null
  analysis_prompt?: string | null
}

export type DeviceResponse = {
  device_id: string
  label?: string | null
  created_at?: string
}

export type EventResponse = {
  event_id: string
  session_id?: string
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

export const startSession = (deviceId: string, analysisPrompt?: string) =>
  request<SessionResponse>('/sessions/start', {
    method: 'POST',
    body: {
      device_id: deviceId,
      analysis_prompt: analysisPrompt || null,
    },
  })

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
  const response = await fetch(
    `${API_BASE_URL}/events/${encodeURIComponent(eventId)}/upload`,
    {
      method: 'PUT',
      body: blob,
      headers: {
        'Content-Type': options.contentType,
      },
    }
  )

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }

  return { etag: response.headers.get('etag') }
}
