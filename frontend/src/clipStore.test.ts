import { afterEach, describe, expect, it } from 'vitest'
import {
  deleteClip,
  getClip,
  listClips,
  markClipUploaded,
  scheduleClipRetry,
  saveClip,
} from './clipStore'

const makeClip = (label: string) => ({
  blob: new Blob([label]),
  mimeType: 'video/webm',
  sizeBytes: label.length,
  durationSeconds: 2.5,
})

describe('clipStore', () => {
  afterEach(async () => {
    const clips = await listClips()
    await Promise.all(clips.map((clip) => deleteClip(clip.id)))
  })

  it('saves and retrieves clips', async () => {
    const stored = await saveClip(makeClip('aaa'))
    const fetched = await getClip(stored.id)

    expect(fetched?.id).toBe(stored.id)
    expect(fetched?.sizeBytes).toBe(3)
    expect(fetched?.mimeType).toBe('video/webm')
    expect(fetched?.uploaded).toBe(false)
  })

  it('marks clips as uploaded', async () => {
    const stored = await saveClip(makeClip('bbb'))

    await markClipUploaded(stored.id)
    const fetched = await getClip(stored.id)

    expect(fetched?.uploaded).toBe(true)
  })

  it('lists only pending clips when filtered', async () => {
    const clipA = await saveClip(makeClip('a'))
    const clipB = await saveClip(makeClip('bb'))
    await markClipUploaded(clipB.id)

    const pending = await listClips({ uploaded: false })

    expect(pending.map((clip) => clip.id)).toEqual([clipA.id])
  })

  it('schedules retries with backoff metadata', async () => {
    const stored = await saveClip(makeClip('ccc'))

    await scheduleClipRetry(stored.id, {
      error: 'offline',
      nextUploadAttemptAt: 1234,
    })

    const fetched = await getClip(stored.id)
    expect(fetched?.uploadAttempts).toBe(1)
    expect(fetched?.lastUploadError).toBe('offline')
    expect(fetched?.nextUploadAttemptAt).toBe(1234)
  })

  it('filters clips that are ready to upload', async () => {
    const clipA = await saveClip(makeClip('a'))
    const clipB = await saveClip(makeClip('bb'))
    await scheduleClipRetry(clipB.id, {
      error: 'offline',
      nextUploadAttemptAt: 5000,
    })

    const readyAtNow = await listClips({
      uploaded: false,
      readyToUpload: true,
      now: 1000,
    })
    expect(readyAtNow.map((clip) => clip.id)).toEqual([clipA.id])

    const readyLater = await listClips({
      uploaded: false,
      readyToUpload: true,
      now: 6000,
    })
    expect(readyLater.map((clip) => clip.id).sort()).toEqual(
      [clipA.id, clipB.id].sort()
    )
  })
})
