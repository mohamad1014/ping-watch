import { expect, test } from '@playwright/test'
import { startServers } from './helpers/servers'

test('live flow without webServer config', async ({ page, request }) => {
  const { frontendUrl, backendUrl, stop } = await startServers()

  try {
    const response = await request.get(`${backendUrl}/health`)
    expect(response.ok()).toBeTruthy()

    await page.goto(frontendUrl)
    await page.getByRole('button', { name: 'Start monitoring' }).click()
    await expect(page.getByText('Active')).toBeVisible()

    await expect
      .poll(async () => {
        const sessionsResponse = await request.get(
          `${backendUrl}/sessions?device_id=device-1`
        )
        const sessions = await sessionsResponse.json()
        return sessions.some(
          (session: { device_id: string; status: string }) =>
            session.device_id === 'device-1' && session.status === 'active'
        )
      })
      .toBeTruthy()
  } finally {
    await stop()
  }
})
