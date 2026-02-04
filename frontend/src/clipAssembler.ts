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
  const estimateChunkMs = (source: ClipChunk[]) => {
    if (source.length < 2) {
      return null
    }
    const deltas = source
      .map((chunk, index) =>
        index === 0 ? null : chunk.timestampMs - source[index - 1].timestampMs
      )
      .filter((delta): delta is number => delta !== null && delta > 0)
    if (deltas.length === 0) {
      return null
    }
    const sum = deltas.reduce((total, delta) => total + delta, 0)
    return sum / deltas.length
  }
  const estimatedChunkMs =
    estimateChunkMs(selected) ?? estimateChunkMs(chunks) ?? 0
  const selectedDurationMs =
    selected.length === 1
      ? estimatedChunkMs
      : selected[selected.length - 1].timestampMs -
        selected[0].timestampMs +
        estimatedChunkMs
  const durationSeconds = Math.max(0, selectedDurationMs / 1000)

  return {
    blob,
    sizeBytes,
    mimeType,
    durationSeconds,
    startMs,
    endMs,
  }
}
