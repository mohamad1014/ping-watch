import { describe, expect, it, vi } from 'vitest'
import { uploadPendingClips } from './clipUpload'

describe('uploadPendingClips', () => {
  it('uploads pending clips and marks them uploaded', async () => {
    const createEvent = vi.fn().mockResolvedValue({})
    const markClipUploaded = vi.fn().mockResolvedValue(undefined)
    const listClips = vi.fn().mockResolvedValue([
      {
        id: 'clip-1',
        blob: new Blob(['a']),
        mimeType: 'video/webm',
        sizeBytes: 1,
        durationSeconds: 2,
        createdAt: 0,
        uploaded: false,
      },
    ])

    const uploaded = await uploadPendingClips({
      sessionId: 'sess-1',
      deviceId: 'device-1',
      triggerType: 'motion',
      deps: { createEvent, listClips, markClipUploaded },
    })

    expect(uploaded).toBe(1)
    expect(createEvent).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      deviceId: 'device-1',
      triggerType: 'motion',
      durationSeconds: 2,
      clipUri: 'idb://clips/clip-1',
      clipMime: 'video/webm',
      clipSizeBytes: 1,
    })
    expect(markClipUploaded).toHaveBeenCalledWith('clip-1')
  })
})
