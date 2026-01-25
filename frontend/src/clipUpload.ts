import { createEvent } from './api'
import {
  listClips,
  markClipUploaded,
  type StoredClip,
} from './clipStore'

type UploadDeps = {
  createEvent: typeof createEvent
  listClips: typeof listClips
  markClipUploaded: typeof markClipUploaded
}

type UploadOptions = {
  sessionId: string
  deviceId: string
  triggerType: string
  deps?: UploadDeps
}

export const uploadPendingClips = async ({
  sessionId,
  deviceId,
  triggerType,
  deps,
}: UploadOptions): Promise<number> => {
  const {
    createEvent: createEventFn,
    listClips: listClipsFn,
    markClipUploaded: markClipUploadedFn,
  } = deps ?? {
    createEvent,
    listClips,
    markClipUploaded,
  }

  const pending = await listClipsFn({ uploaded: false })
  if (pending.length === 0) {
    return 0
  }

  let uploadedCount = 0
  for (const clip of pending) {
    await uploadClip(clip, {
      sessionId,
      deviceId,
      triggerType,
      createEvent: createEventFn,
      markClipUploaded: markClipUploadedFn,
    })
    uploadedCount += 1
  }

  return uploadedCount
}

type UploadClipDeps = Pick<UploadDeps, 'createEvent' | 'markClipUploaded'>

const uploadClip = async (
  clip: StoredClip,
  deps: UploadClipDeps & {
    sessionId: string
    deviceId: string
    triggerType: string
  }
) => {
  await deps.createEvent({
    sessionId: deps.sessionId,
    deviceId: deps.deviceId,
    triggerType: deps.triggerType,
    durationSeconds: clip.durationSeconds,
    clipUri: `idb://clips/${clip.id}`,
    clipMime: clip.mimeType,
    clipSizeBytes: clip.sizeBytes,
  })

  await deps.markClipUploaded(clip.id)
}
