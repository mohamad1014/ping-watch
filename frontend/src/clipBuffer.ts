export type ClipChunk = {
  timestampMs: number
  blob: Blob
  isFirstChunk?: boolean
}

type ClipRingBufferOptions = {
  windowMs: number
}

export class ClipRingBuffer {
  private windowMs: number
  private chunks: ClipChunk[] = []
  private firstChunkBlob: Blob | null = null
  private hasRecordedFirstChunk: boolean = false

  constructor(options: ClipRingBufferOptions) {
    this.windowMs = options.windowMs
  }

  setWindowMs(windowMs: number) {
    this.windowMs = windowMs
    // Re-prune with new window size using the most recent chunk timestamp
    if (this.chunks.length > 0) {
      const latestTimestamp = this.chunks[this.chunks.length - 1].timestampMs
      this.prune(latestTimestamp)
    }
  }

  addChunk(blob: Blob, timestampMs: number = Date.now()): ClipChunk {
    // Only the very first chunk of the recording has the WebM header
    const isFirstChunk = !this.hasRecordedFirstChunk
    const chunk = { timestampMs, blob, isFirstChunk }

    // Store the first chunk (contains WebM header) separately
    if (isFirstChunk) {
      this.firstChunkBlob = blob
      this.hasRecordedFirstChunk = true
    }

    this.chunks.push(chunk)
    this.prune(timestampMs)
    return chunk
  }

  getFirstChunkBlob(): Blob | null {
    return this.firstChunkBlob
  }

  getChunks(): ClipChunk[] {
    return [...this.chunks]
  }

  clear() {
    this.chunks = []
    this.firstChunkBlob = null
    this.hasRecordedFirstChunk = false
  }

  private prune(latestTimestampMs: number) {
    const cutoff = latestTimestampMs - this.windowMs
    // Never prune the first chunk - it contains the WebM header needed for playback.
    // VP9 uses inter-frame compression, so all clips need the first chunk to be decodable.
    while (
      this.chunks.length > 1 &&
      !this.chunks[0].isFirstChunk &&
      this.chunks[0].timestampMs < cutoff
    ) {
      this.chunks.shift()
    }
  }
}

export const selectClipChunks = (
  chunks: ClipChunk[],
  _startMs: number,
  endMs: number
): ClipChunk[] => {
  // IMPORTANT: VP9 uses inter-frame compression. Each frame depends on previous frames.
  // We must include ALL chunks from the beginning up to endMs to create a decodable video.
  // The startMs parameter is ignored - clips always start from the first chunk.
  //
  // This means clips will be longer than the requested pre/post window, but they will
  // be playable. For shorter clips, a different recording strategy or server-side
  // re-encoding would be needed.
  return chunks.filter((chunk) => chunk.timestampMs <= endMs)
}

export const buildClipBlob = (
  chunks: ClipChunk[],
  mimeType: string,
  _firstChunkBlob: Blob | null = null
) => {
  // NOTE: We no longer prepend the first chunk to clips that don't include it.
  // Reason: WebM with VP9 uses inter-frame compression, so chunks from the middle
  // of a recording depend on previous frames. Prepending just the header from
  // the first chunk creates a structurally valid file, but the video data
  // is undecodable because it's missing the frames it depends on.
  //
  // Clips that don't include the first chunk will need server-side re-encoding
  // or a different recording strategy (e.g., independent recordings per clip).

  const hasFirstChunk = chunks.some((chunk) => chunk.isFirstChunk)
  if (!hasFirstChunk) {
    console.warn('[WARN] Clip does not include first chunk - may not be playable without re-encoding')
  }

  const blobParts = chunks.map((chunk) => chunk.blob)
  const blob = new Blob(blobParts, { type: mimeType })

  return {
    blob,
    sizeBytes: blob.size,
    mimeType: blob.type || mimeType,
  }
}
