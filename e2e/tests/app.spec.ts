import { expect, test } from '@playwright/test'

test('shows the app shell and backend health', async ({ page, request }) => {
  const response = await request.get('http://localhost:8000/health')
  expect(response.ok()).toBeTruthy()
  await expect(response.json()).resolves.toMatchObject({ status: 'ok' })

  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Ping Watch' })
  ).toBeVisible()
})

test('starts a session from the UI and reports to the backend', async ({ page, request }) => {
  await page.goto('/')

  await page.getByRole('button', { name: 'Start monitoring' }).click()
  await expect(page.getByText('Active')).toBeVisible()

  await expect
    .poll(async () => {
      const response = await request.get(
        'http://localhost:8000/sessions?device_id=device-1'
      )
      const sessions = await response.json()
      return sessions.some(
        (session: { device_id: string; status: string }) =>
          session.device_id === 'device-1' && session.status === 'active'
      )
    })
    .toBeTruthy()

  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByText('Stopped')).toBeVisible()
})
