export type ClipMetadata = {
  durationSeconds: number
  sizeBytes: number
  mimeType: string
  blob?: Blob
}

type CaptureOptions = {
  stream?: MediaStream | null
  recordMs?: number
}

const fallbackMetadata = (recordMs: number): ClipMetadata => ({
  durationSeconds: recordMs / 1000,
  sizeBytes: 0,
  mimeType: 'video/mp4',
})

export const captureClipMetadata = async (
  options: CaptureOptions = {}
): Promise<ClipMetadata> => {
  const recordMs = options.recordMs ?? 2000
  const disableMedia =
    (globalThis as { __PING_WATCH_DISABLE_MEDIA__?: boolean })
      .__PING_WATCH_DISABLE_MEDIA__ === true ||
    (import.meta as ImportMeta & {
      env?: Record<string, string | undefined>
    }).env?.VITE_DISABLE_MEDIA === 'true'

  if (disableMedia) {
    return fallbackMetadata(recordMs)
  }

  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    return fallbackMetadata(recordMs)
  }

  let stream = options.stream ?? null
  let ownsStream = false

  if (!stream) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      })
      ownsStream = true
    } catch {
      return fallbackMetadata(recordMs)
    }
  }

  if (!stream) {
    return fallbackMetadata(recordMs)
  }

  return new Promise((resolve) => {
    const chunks: BlobPart[] = []
    const recorder = new MediaRecorder(stream)
    const startTime = performance.now()

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data)
      }
    })

    recorder.addEventListener('stop', () => {
      const blob = new Blob(chunks, {
        type: recorder.mimeType || 'video/webm',
      })
      const durationSeconds = (performance.now() - startTime) / 1000
      const metadata: ClipMetadata = {
        durationSeconds,
        sizeBytes: blob.size,
        mimeType: blob.type || 'video/webm',
        blob,
      }

      if (ownsStream) {
        stream?.getTracks().forEach((track) => track.stop())
      }

      resolve(metadata)
    })

    recorder.start()
    window.setTimeout(() => recorder.stop(), recordMs)
  })
}
