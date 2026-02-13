const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

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
    throw new Error(`Request failed: ${response.status}`)
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

export const listEvents = (sessionId: string) =>
  request<EventResponse[]>(`/events?session_id=${encodeURIComponent(sessionId)}`)

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
