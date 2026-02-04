export type ClipChunk = {
  timestampMs: number
  blob: Blob
  hasInitSegment?: boolean // Indicates if chunk contains WebM initialization segment
}

type ClipRingBufferOptions = {
  windowMs: number
}

export class ClipRingBuffer {
  private readonly windowMs: number
  private chunks: ClipChunk[] = []
  private initSegment: Blob | null = null // Store the first chunk's init segment

  constructor(options: ClipRingBufferOptions) {
    this.windowMs = options.windowMs
  }

  addChunk(
    blob: Blob,
    timestampMs: number = Date.now(),
    hasInitSegment = false
  ): ClipChunk {
    const chunk = { timestampMs, blob, hasInitSegment }

    // Store the first chunk with init segment for later use
    if (hasInitSegment && !this.initSegment) {
      this.initSegment = blob
    }

    this.chunks.push(chunk)
    this.prune(timestampMs)
    return chunk
  }

  getChunks(): ClipChunk[] {
    return [...this.chunks]
  }

  getInitSegment(): Blob | null {
    return this.initSegment
  }

  clear() {
    this.chunks = []
    this.initSegment = null
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

export const buildClipBlob = (
  chunks: ClipChunk[],
  mimeType: string,
  initSegment: Blob | null = null
) => {
  // Check if we need to prepend an init segment
  const hasInitSegment = chunks.some((chunk) => chunk.hasInitSegment)
  const blobParts: Blob[] = []

  // If no chunk has init segment but we have a stored one, prepend it
  if (!hasInitSegment && initSegment) {
    blobParts.push(initSegment)
  }

  // Add all chunk data
  blobParts.push(...chunks.map((chunk) => chunk.blob))

  const blob = new Blob(blobParts, { type: mimeType })

  return {
    blob,
    sizeBytes: blob.size,
    mimeType: blob.type || mimeType,
  }
}
