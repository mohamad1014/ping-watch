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
