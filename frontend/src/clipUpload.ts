import { finalizeUpload, initiateUpload } from './api'
import {
  listClips,
  markClipUploaded,
  scheduleClipRetry,
  type StoredClip,
} from './clipStore'

type UploadDeps = {
  initiateUpload: typeof initiateUpload
  finalizeUpload: typeof finalizeUpload
  uploadBlob: (
    uploadUrl: string,
    blob: Blob,
    options: { contentType: string }
  ) => Promise<{ etag: string | null }>
  listClips: typeof listClips
  markClipUploaded: typeof markClipUploaded
  scheduleClipRetry: typeof scheduleClipRetry
  getNow: () => number
  sleep: (ms: number) => Promise<void>
  isOnline: () => boolean
}

type UploadOptions = {
  sessionId: string
  deviceId: string
  triggerType: string
  deps?: UploadDeps
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

const computeBackoffMs = (attempt: number) => {
  const base = 1000
  const max = 30_000
  const exp = Math.min(max, base * 2 ** Math.max(0, attempt - 1))
  const jitter = exp * 0.2 * Math.random()
  return Math.round(exp + jitter)
}

const defaultUploadBlob: UploadDeps['uploadBlob'] = async (
  uploadUrl,
  blob,
  options
) => {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    body: blob,
    headers: {
      'x-ms-blob-type': 'BlockBlob',
      'Content-Type': options.contentType,
    },
  })

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status}`)
  }

  return { etag: response.headers.get('etag') }
}

const defaultIsOnline = () =>
  typeof navigator !== 'undefined' ? navigator.onLine : true

export const uploadPendingClips = async ({
  sessionId,
  deviceId,
  triggerType,
  deps,
}: UploadOptions): Promise<number> => {
  const {
    initiateUpload: initiateUploadFn,
    finalizeUpload: finalizeUploadFn,
    uploadBlob: uploadBlobFn,
    listClips: listClipsFn,
    markClipUploaded: markClipUploadedFn,
    scheduleClipRetry: scheduleClipRetryFn,
    getNow,
    sleep,
    isOnline,
  } = deps ?? {
    initiateUpload,
    finalizeUpload,
    uploadBlob: defaultUploadBlob,
    listClips,
    markClipUploaded,
    scheduleClipRetry,
    getNow: () => Date.now(),
    sleep: defaultSleep,
    isOnline: defaultIsOnline,
  }

  const pending = await listClipsFn({
    uploaded: false,
    readyToUpload: true,
    now: getNow(),
  })
  if (pending.length === 0) {
    return 0
  }

  let uploadedCount = 0
  for (const clip of pending) {
    const uploaded = await uploadClip(clip, {
      sessionId,
      deviceId,
      triggerType,
      initiateUpload: initiateUploadFn,
      finalizeUpload: finalizeUploadFn,
      uploadBlob: uploadBlobFn,
      markClipUploaded: markClipUploadedFn,
      scheduleClipRetry: scheduleClipRetryFn,
      getNow,
      sleep,
      isOnline,
    })
    if (uploaded) {
      uploadedCount += 1
    }
  }

  return uploadedCount
}

type UploadClipDeps = Pick<
  UploadDeps,
  | 'initiateUpload'
  | 'finalizeUpload'
  | 'uploadBlob'
  | 'markClipUploaded'
  | 'scheduleClipRetry'
  | 'getNow'
  | 'sleep'
  | 'isOnline'
>

const uploadClip = async (
  clip: StoredClip,
  deps: UploadClipDeps & {
    sessionId: string
    deviceId: string
    triggerType: string
  }
): Promise<boolean> => {
  if (!deps.isOnline()) {
    await deps.scheduleClipRetry(clip.id, {
      error: 'offline',
      nextUploadAttemptAt: deps.getNow() + 10_000,
    })
    return false
  }

  const maxAttempts = 3
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const initiated = await deps.initiateUpload({
        eventId: clip.id,
        sessionId: deps.sessionId,
        deviceId: deps.deviceId,
        triggerType: deps.triggerType,
        durationSeconds: clip.durationSeconds,
        clipMime: clip.mimeType,
        clipSizeBytes: clip.sizeBytes,
      })

      const { etag } = await deps.uploadBlob(initiated.uploadUrl, clip.blob, {
        contentType: clip.mimeType,
      })

      await deps.finalizeUpload(clip.id, etag)
      await deps.markClipUploaded(clip.id)
      return true
    } catch (err) {
      if (attempt >= maxAttempts) {
        const message = err instanceof Error ? err.message : 'upload_failed'
        await deps.scheduleClipRetry(clip.id, {
          error: message,
          nextUploadAttemptAt: deps.getNow() + computeBackoffMs(attempt),
        })
        return false
      }
      await deps.sleep(computeBackoffMs(attempt))
    }
  }

  return false
}
