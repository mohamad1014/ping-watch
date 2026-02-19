import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'

const AUTH_REQUIRED_FLAG = '__PING_WATCH_AUTH_REQUIRED__'
const AUTH_AUTO_LOGIN_FLAG = '__PING_WATCH_AUTH_AUTO_LOGIN__'

const setAuthRequired = (value: boolean) => {
  ;(globalThis as Record<string, unknown>)[AUTH_REQUIRED_FLAG] = value
}

const setAuthAutoLogin = (value: boolean) => {
  ;(globalThis as Record<string, unknown>)[AUTH_AUTO_LOGIN_FLAG] = value
}

const jsonResponse = (payload: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  )

describe('App account flows', () => {
  beforeEach(() => {
    localStorage.clear()
    setAuthRequired(true)
    setAuthAutoLogin(false)
    ;(globalThis as { __PING_WATCH_DISABLE_MEDIA__?: boolean }).__PING_WATCH_DISABLE_MEDIA__ = true

    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.endsWith('/auth/dev/login')) {
        return jsonResponse({
          access_token: 'token-owner',
          token_type: 'bearer',
          user_id: 'user-owner',
          expires_at: '2099-01-01T00:00:00+00:00',
        })
      }

      if (url.endsWith('/devices/register')) {
        return jsonResponse({
          device_id: 'device-owner',
          user_id: 'user-owner',
          label: null,
          created_at: 'now',
        })
      }

      if (url.includes('/notifications/telegram/readiness')) {
        return jsonResponse({
          enabled: false,
          ready: false,
          status: 'not_configured',
          reason: null,
        })
      }

      if (url.endsWith('/sessions/start')) {
        return jsonResponse({
          session_id: 'sess-owner',
          device_id: 'device-owner',
          status: 'active',
        })
      }

      if (url.includes('/events')) {
        return jsonResponse([])
      }

      if (url.endsWith('/sessions/stop')) {
        return jsonResponse({
          session_id: 'sess-owner',
          device_id: 'device-owner',
          status: 'stopped',
        })
      }

      return jsonResponse({})
    }))
  })

  it('requires explicit sign-in before monitoring when auth auto-login is disabled', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(
      await screen.findByRole('heading', { name: /account/i })
    ).toBeInTheDocument()

    const startButton = screen.getByRole('button', { name: /start monitoring/i })
    expect(startButton).toBeDisabled()

    await user.type(screen.getByLabelText(/account email/i), 'owner@example.com')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(screen.getByText(/signed in as owner@example\.com/i)).toBeInTheDocument()
    })

    expect(startButton).toBeEnabled()
  })
})
