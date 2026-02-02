import { expect, test } from '@playwright/test'
import { postSummaryForEvent } from './helpers/worker'

const pollFor = async <T>(
  fn: () => Promise<T | undefined>,
  timeoutMs = 5000
): Promise<T> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await fn()
    if (value) {
      return value
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Timed out waiting for value')
}

test('shows the app shell and backend health', async ({ page, request }) => {
  const response = await request.get('http://localhost:8000/health')
  expect(response.ok()).toBeTruthy()
  await expect(response.json()).resolves.toMatchObject({ status: 'ok' })

  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Ping Watch' })
  ).toBeVisible()
})

test('creates an event and shows summary after worker update', async ({
  page,
  request,
}) => {
  await page.goto('/')

  await page.getByRole('button', { name: 'Start monitoring' }).click()
  await expect(page.getByText('Active')).toBeVisible()

  const sessionId = await pollFor(async () => {
    const response = await request.get(
      'http://localhost:8000/sessions'
    )
    const sessions = await response.json()
    return sessions[0]?.session_id as string | undefined
  })

  await page.getByRole('button', { name: 'Create event' }).click()

  const eventId = await pollFor(async () => {
    const response = await request.get(
      `http://localhost:8000/events?session_id=${sessionId}`
    )
    const events = await response.json()
    return events[0]?.event_id as string | undefined
  })

  await postSummaryForEvent('http://localhost:8000', eventId)

  await expect(page.getByText('Motion detected')).toBeVisible()
  await expect(page.getByText('done')).toBeVisible()
})

test('uploads a clip and marks the event as uploaded', async ({
  page,
  request,
}) => {
  await page.goto('/')

  await page.getByRole('button', { name: 'Start monitoring' }).click()
  await expect(page.getByText('Active')).toBeVisible()

  const sessionId = await pollFor(async () => {
    const response = await request.get('http://localhost:8000/sessions')
    const sessions = await response.json()
    const latest = sessions.at(-1)
    return latest?.session_id as string | undefined
  })

  await page.getByRole('button', { name: 'Create event' }).click()
  await page.getByRole('button', { name: 'Upload stored clips' }).click()

  const uploadedEvent = await pollFor(async () => {
    const response = await request.get(
      `http://localhost:8000/events?session_id=${sessionId}`
    )
    const events = await response.json()
    return events.find(
      (event: { clip_uploaded_at?: string | null }) => event.clip_uploaded_at
    )
  }, 10_000)

  expect(uploadedEvent?.clip_etag).toBeTruthy()
})
