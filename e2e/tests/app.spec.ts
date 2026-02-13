import { expect, test } from '@playwright/test'
import { processUploadedEventWithWorker } from './helpers/worker'

const backendBaseUrl = process.env.PING_WATCH_E2E_BACKEND_URL ?? 'http://localhost:8000'

type SessionResponse = {
  session_id: string
  device_id: string
  status: string
}

type EventResponse = {
  event_id: string
  session_id: string
  status: string
  clip_container: string | null
  clip_blob_name: string | null
  clip_uploaded_at: string | null
  clip_etag: string | null
  summary: string | null
  label: string | null
}

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
  await page.addInitScript(() => {
    ;(globalThis as { __PING_WATCH_DISABLE_MEDIA__?: boolean })
      .__PING_WATCH_DISABLE_MEDIA__ = true
  })

  const response = await request.get(`${backendBaseUrl}/health`)
  expect(response.ok()).toBeTruthy()
  await expect(response.json()).resolves.toMatchObject({ status: 'ok' })

  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Ping Watch' })
  ).toBeVisible()
})

const seedPendingClip = async (
  page,
  args: { sessionId: string; deviceId: string }
): Promise<string> =>
  page.evaluate(async ({ sessionId, deviceId }) => {
    const openDb = () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('ping-watch', 1)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains('clips')) {
            const store = db.createObjectStore('clips', { keyPath: 'id' })
            store.createIndex('createdAt', 'createdAt')
          }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })

    const waitForTransaction = (tx: IDBTransaction) =>
      new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })

    const db = await openDb()
    const clipId = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `clip_${Date.now()}`
    const blob = new Blob(
      [new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88])],
      { type: 'video/webm' }
    )
    const now = Date.now()

    const tx = db.transaction('clips', 'readwrite')
    tx.objectStore('clips').put({
      id: clipId,
      sessionId,
      deviceId,
      triggerType: 'motion',
      blob,
      mimeType: 'video/webm',
      sizeBytes: blob.size,
      durationSeconds: 5,
      createdAt: now,
      uploaded: false,
      uploadAttempts: 0,
      isBenchmark: false,
      clipIndex: 1,
      peakMotionScore: 0.42,
      avgMotionScore: 0.17,
      motionEventCount: 2,
      peakAudioScore: 0.0,
      avgAudioScore: 0.0,
    })
    await waitForTransaction(tx)
    return clipId
  }, args)

test('critical flow: start session, upload clip, worker summary, event done', async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    ;(globalThis as { __PING_WATCH_DISABLE_MEDIA__?: boolean })
      .__PING_WATCH_DISABLE_MEDIA__ = true
  })

  await page.goto('/')

  await page.getByRole('button', { name: 'Start monitoring' }).click()
  await expect(page.getByText('Active')).toBeVisible()
  await expect(page.getByText('Capture disabled')).toBeVisible()

  const session = await pollFor(async () => {
    const response = await request.get(`${backendBaseUrl}/sessions`)
    const sessions = await response.json() as SessionResponse[]
    const latest = sessions.at(-1)
    if (!latest || latest.status !== 'active') return undefined
    return latest
  })

  const clipId = await seedPendingClip(page, {
    sessionId: session.session_id,
    deviceId: session.device_id,
  })
  await page.getByRole('button', { name: 'Upload stored clips' }).click()

  const uploadedEvent = await pollFor(async () => {
    const response = await request.get(
      `${backendBaseUrl}/events?session_id=${session.session_id}`
    )
    const events = await response.json() as EventResponse[]
    return events.find(
      (event) => event.event_id === clipId && event.clip_uploaded_at
    )
  }, 15_000)

  expect(uploadedEvent?.clip_etag).toBeTruthy()

  await processUploadedEventWithWorker(backendBaseUrl, {
    event_id: uploadedEvent.event_id,
    session_id: uploadedEvent.session_id,
    clip_container: uploadedEvent.clip_container ?? '',
    clip_blob_name: uploadedEvent.clip_blob_name ?? '',
  })

  const completedEvent = await pollFor(async () => {
    const response = await request.get(
      `${backendBaseUrl}/events?session_id=${session.session_id}`
    )
    const events = await response.json() as EventResponse[]
    const event = events.find((entry) => entry.event_id === clipId)
    if (!event || event.status !== 'done' || !event.summary) return undefined
    return event
  }, 10_000)

  expect(completedEvent.label).toBe('test')
  await expect(page.locator('.event-status.status-done').first()).toBeVisible()
  await expect(page.locator('.event-summary').filter({ hasText: /Critical flow test summary/ }).first()).toBeVisible()
})
