import { afterEach, describe, expect, it } from 'vitest'
import { deleteClip, getClip, listClips, saveClip } from './clipStore'

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
  })
})
