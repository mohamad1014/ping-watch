import { buildClipBlob, selectClipChunks, type ClipChunk } from './clipBuffer'

type AssembleClipOptions = {
  chunks: ClipChunk[]
  triggerMs: number
  preMs: number
  postMs: number
  fallbackMime: string
}

export type AssembledClip = {
  blob: Blob
  sizeBytes: number
  mimeType: string
  durationSeconds: number
  startMs: number
  endMs: number
}

export const assembleClip = ({
  chunks,
  triggerMs,
  preMs,
  postMs,
  fallbackMime,
}: AssembleClipOptions): AssembledClip | null => {
  if (chunks.length === 0) {
    return null
  }

  const startMs = triggerMs - preMs
  const endMs = triggerMs + postMs
  const selected = selectClipChunks(chunks, startMs, endMs)

  if (selected.length === 0) {
    return null
  }

  const { blob, sizeBytes, mimeType } = buildClipBlob(selected, fallbackMime)
  const durationSeconds = Math.max(0, (endMs - startMs) / 1000)

  return {
    blob,
    sizeBytes,
    mimeType,
    durationSeconds,
    startMs,
    endMs,
  }
}
