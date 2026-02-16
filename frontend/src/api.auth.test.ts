import { beforeEach, describe, expect, it, vi } from 'vitest'

import { listEvents, startSession } from './api'

const AUTH_REQUIRED_FLAG = '__PING_WATCH_AUTH_REQUIRED__'

const setAuthRequired = (value: boolean) => {
  ;(globalThis as Record<string, unknown>)[AUTH_REQUIRED_FLAG] = value
}

describe('api auth integration', () => {
  beforeEach(() => {
    localStorage.clear()
    setAuthRequired(false)
    vi.restoreAllMocks()
  })

  it('logs in and attaches bearer token on protected writes when auth is enabled', async () => {
    setAuthRequired(true)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/auth/dev/login')) {
          return new Response(
            JSON.stringify({
              access_token: 'token-1',
              token_type: 'bearer',
              user_id: 'user-1',
              expires_at: '2099-01-01T00:00:00+00:00',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        }

        return new Response(
          JSON.stringify({
            session_id: 'sess-1',
            device_id: 'device-1',
            status: 'active',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
    )

    const response = await startSession('device-1')

    expect(response.status).toBe('active')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const secondCall = fetchMock.mock.calls[1]
    const requestInit = (secondCall[1] ?? {}) as RequestInit
    const headers = requestInit.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer token-1')
  })

  it('reuses stored token and attaches authorization on reads when auth is enabled', async () => {
    setAuthRequired(true)
    localStorage.setItem('ping-watch:auth-token', 'token-2')

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            event_id: 'evt-1',
            status: 'done',
            trigger_type: 'motion',
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )

    const events = await listEvents('sess-1')

    expect(events).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const requestInit = (fetchMock.mock.calls[0][1] ?? {}) as RequestInit
    const headers = requestInit.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer token-2')
  })
})
