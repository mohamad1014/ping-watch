import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from './App'

const buildResponse = (payload: unknown) =>
  Promise.resolve({
    ok: true,
    json: async () => payload,
  } as Response)

describe('App', () => {
  it('shows the Ping Watch title', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { name: /ping watch/i })
    ).toBeInTheDocument()
  })

  it('starts and stops a session via the API', async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        buildResponse({
          session_id: 'sess_1',
          device_id: 'device-1',
          status: 'active',
        })
      )
      .mockResolvedValueOnce(buildResponse([]))
      .mockResolvedValueOnce(
        buildResponse({
          session_id: 'sess_1',
          device_id: 'device-1',
          status: 'stopped',
        })
      )

    vi.stubGlobal('fetch', fetchMock)

    render(<App />)

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

    await user.click(screen.getByRole('button', { name: /stop/i }))

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/sessions/stop',
      expect.objectContaining({
        method: 'POST',
      })
    )
    expect(await screen.findByText('Stopped')).toBeInTheDocument()

    vi.restoreAllMocks()
  })
})
