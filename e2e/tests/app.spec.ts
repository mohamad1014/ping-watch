import { expect, test } from '@playwright/test'
import { processUploadedEventWithWorker } from './helpers/worker'

const backendBaseUrl = process.env.PING_WATCH_E2E_BACKEND_URL ?? 'http://127.0.0.1:8002'

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

type AuthResponse = {
  access_token: string
  user_id: string
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

const signInWithEmail = async (page, email: string) => {
  await page.getByLabel('Account email').fill(email)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page.getByText(new RegExp(`Signed in as ${email}`, 'i'))).toBeVisible()
}

const addRequiredAlertInstruction = async (page) => {
  await page.getByRole('textbox', { name: /alert instruction 1/i }).fill(
    'Alert if a person enters the office.'
  )
  await page.getByRole('checkbox', { name: /phone plugged in/i }).check()
  await page.getByRole('checkbox', { name: /camera aimed/i }).check()
}

const loginViaApi = async (request, email: string): Promise<AuthResponse> => {
  const response = await request.post(`${backendBaseUrl}/auth/dev/login`, {
    data: { email },
  })
  expect(response.ok()).toBeTruthy()
  return response.json() as Promise<AuthResponse>
}

const getLatestActiveSession = async (
  request,
  token: string
): Promise<SessionResponse | undefined> => {
  const response = await request.get(`${backendBaseUrl}/sessions`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  })
  expect(response.ok()).toBeTruthy()
  const sessions = (await response.json()) as SessionResponse[]
  return sessions.find((session) => session.status === 'active')
}

const createEventForSession = async (
  request,
  token: string,
  payload: { sessionId: string; deviceId: string }
): Promise<string> => {
  const response = await request.post(`${backendBaseUrl}/events`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
    data: {
      session_id: payload.sessionId,
      device_id: payload.deviceId,
      trigger_type: 'motion',
      duration_seconds: 3,
      clip_uri: 'https://example.test/clip.webm',
      clip_mime: 'video/webm',
      clip_size_bytes: 512,
    },
  })
  expect(response.ok()).toBeTruthy()
  const created = await response.json() as EventResponse
  return created.event_id
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
    page.getByRole('heading', { name: 'Watch a space and send alerts to Telegram' })
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
    window.localStorage.setItem('ping-watch:frontend-mode', 'dev')
  })

  await page.goto('/')
  await signInWithEmail(page, 'owner@example.com')
  await addRequiredAlertInstruction(page)

  await page.getByRole('button', { name: 'Start monitoring' }).click()
  await expect(page.getByText('Active')).toBeVisible()
  await expect(page.getByText('Capture disabled')).toBeVisible()

  const auth = await loginViaApi(request, 'owner@example.com')
  const session = await pollFor(async () => {
    const latest = await getLatestActiveSession(request, auth.access_token)
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
      `${backendBaseUrl}/events?session_id=${session.session_id}`,
      {
        headers: {
          authorization: `Bearer ${auth.access_token}`,
        },
      }
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
  }, {
    apiToken: auth.access_token,
  })

  const completedEvent = await pollFor(async () => {
    const response = await request.get(
      `${backendBaseUrl}/events?session_id=${session.session_id}`,
      {
        headers: {
          authorization: `Bearer ${auth.access_token}`,
        },
      }
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

test('account switching keeps event fetching scoped to the signed-in owner', async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    ;(globalThis as { __PING_WATCH_DISABLE_MEDIA__?: boolean })
      .__PING_WATCH_DISABLE_MEDIA__ = true
  })

  await page.goto('/')

  await signInWithEmail(page, 'owner-a@example.com')
  await addRequiredAlertInstruction(page)
  await page.getByRole('button', { name: 'Start monitoring' }).click()
  await expect(page.getByText('Active')).toBeVisible()

  const userA = await loginViaApi(request, 'owner-a@example.com')
  const sessionA = await pollFor(async () => {
    const latest = await getLatestActiveSession(request, userA.access_token)
    if (!latest) return undefined
    return latest
  })

  const eventA = await createEventForSession(request, userA.access_token, {
    sessionId: sessionA.session_id,
    deviceId: sessionA.device_id,
  })

  await expect.poll(async () => await page.getByText(eventA).count()).toBeGreaterThan(0)

  await page.getByRole('button', { name: /sign out/i }).click()
  await signInWithEmail(page, 'owner-b@example.com')

  await expect(page.getByText(eventA)).toHaveCount(0)

  await addRequiredAlertInstruction(page)
  await page.getByRole('button', { name: 'Start monitoring' }).click()
  await expect(page.getByText('Active')).toBeVisible()

  const userB = await loginViaApi(request, 'owner-b@example.com')
  const sessionB = await pollFor(async () => {
    const latest = await getLatestActiveSession(request, userB.access_token)
    if (!latest) return undefined
    return latest
  })

  const eventB = await createEventForSession(request, userB.access_token, {
    sessionId: sessionB.session_id,
    deviceId: sessionB.device_id,
  })

  await expect.poll(async () => await page.getByText(eventB).count()).toBeGreaterThan(0)
  await expect(page.getByText(eventA)).toHaveCount(0)
})
