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
  summary?: string | null
  label?: string | null
  confidence?: number | null
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
