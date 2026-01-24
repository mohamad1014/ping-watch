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

export const startSession = (deviceId: string) =>
  request<SessionResponse>('/sessions/start', {
    method: 'POST',
    body: { device_id: deviceId },
  })

export const stopSession = (sessionId: string) =>
  request<SessionResponse>('/sessions/stop', {
    method: 'POST',
    body: { session_id: sessionId },
  })

export const listEvents = (sessionId: string) =>
  request<EventResponse[]>(`/events?session_id=${encodeURIComponent(sessionId)}`)

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
