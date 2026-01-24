import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('shows the Ping Watch title', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { name: /ping watch/i })
    ).toBeInTheDocument()
  })

  it('toggles session state from idle to active to stopped', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByText('Idle')).toBeInTheDocument()

    const startButton = screen.getByRole('button', {
      name: /start monitoring/i,
    })
    const stopButton = screen.getByRole('button', { name: /stop/i })

    await user.click(startButton)
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(stopButton).toBeEnabled()

    await user.click(stopButton)
    expect(screen.getByText('Stopped')).toBeInTheDocument()
  })
})
