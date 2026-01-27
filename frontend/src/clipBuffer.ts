export type ClipChunk = {
  timestampMs: number
  blob: Blob
}

type ClipRingBufferOptions = {
  windowMs: number
}

export class ClipRingBuffer {
  private readonly windowMs: number
  private chunks: ClipChunk[] = []

  constructor(options: ClipRingBufferOptions) {
    this.windowMs = options.windowMs
  }

  addChunk(blob: Blob, timestampMs: number = Date.now()): ClipChunk {
    const chunk = { timestampMs, blob }
    this.chunks.push(chunk)
    this.prune(timestampMs)
    return chunk
  }

  getChunks(): ClipChunk[] {
    return [...this.chunks]
  }

  clear() {
    this.chunks = []
  }

  private prune(latestTimestampMs: number) {
    const cutoff = latestTimestampMs - this.windowMs
    while (this.chunks.length > 0 && this.chunks[0].timestampMs < cutoff) {
      this.chunks.shift()
    }
  }
}

export const selectClipChunks = (
  chunks: ClipChunk[],
  startMs: number,
  endMs: number
): ClipChunk[] =>
  chunks.filter(
    (chunk) => chunk.timestampMs >= startMs && chunk.timestampMs <= endMs
  )

export const buildClipBlob = (chunks: ClipChunk[], mimeType: string) => {
  const blob = new Blob(
    chunks.map((chunk) => chunk.blob),
    { type: mimeType }
  )

  return {
    blob,
    sizeBytes: blob.size,
    mimeType: blob.type || mimeType,
  }
}
