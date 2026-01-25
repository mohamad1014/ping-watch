import { afterEach, describe, expect, it } from 'vitest'
import {
  deleteClip,
  getClip,
  listClips,
  markClipUploaded,
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
})
