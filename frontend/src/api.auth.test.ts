import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getAuthSession,
  loginWithEmail,
  logout,
  listEvents,
  startSession,
} from './api'

const AUTH_REQUIRED_FLAG = '__PING_WATCH_AUTH_REQUIRED__'
const AUTH_AUTO_LOGIN_FLAG = '__PING_WATCH_AUTH_AUTO_LOGIN__'

const setAuthRequired = (value: boolean) => {
  ;(globalThis as Record<string, unknown>)[AUTH_REQUIRED_FLAG] = value
}

const setAuthAutoLogin = (value: boolean) => {
  ;(globalThis as Record<string, unknown>)[AUTH_AUTO_LOGIN_FLAG] = value
}

describe('api auth integration', () => {
  beforeEach(() => {
    localStorage.clear()
    setAuthRequired(false)
    setAuthAutoLogin(true)
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

  it('does not auto-login when auth is enabled and auto-login is disabled', async () => {
    setAuthRequired(true)
    setAuthAutoLogin(false)

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'missing bearer token' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    )

    await expect(startSession('device-1')).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/sessions/start')
  })

  it('supports explicit email login and logout session state', async () => {
    setAuthRequired(true)
    setAuthAutoLogin(false)

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/auth/dev/login')) {
          const parsed = JSON.parse(String(init?.body ?? '{}'))
          expect(parsed.email).toBe('owner@example.com')
          return new Response(
            JSON.stringify({
              access_token: 'token-login',
              token_type: 'bearer',
              user_id: 'user-owner',
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

    const authSession = await loginWithEmail('owner@example.com')
    expect(authSession.authenticated).toBe(true)
    expect(authSession.userId).toBe('user-owner')
    expect(authSession.email).toBe('owner@example.com')

    await startSession('device-1')

    const requestInit = (fetchMock.mock.calls[1][1] ?? {}) as RequestInit
    const headers = requestInit.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer token-login')

    logout()
    expect(getAuthSession().authenticated).toBe(false)
    expect(localStorage.getItem('ping-watch:auth-token')).toBeNull()
  })
})
