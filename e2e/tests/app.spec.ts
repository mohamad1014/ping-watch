import { expect, test } from '@playwright/test'

test('shows the app shell', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Ping Watch' })
  ).toBeVisible()
})
