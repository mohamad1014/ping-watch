import { describe, expect, it } from 'vitest'
import {
  ClipRingBuffer,
  buildClipBlob,
  selectClipChunks,
} from './clipBuffer'

const makeChunk = (timestampMs: number, label: string) => ({
  timestampMs,
  blob: new Blob([label]),
})

describe('ClipRingBuffer', () => {
  it('keeps chunks within the configured window', () => {
    const buffer = new ClipRingBuffer({ windowMs: 4000 })
    buffer.addChunk(new Blob(['a']), 1000)
    buffer.addChunk(new Blob(['b']), 3000)
    buffer.addChunk(new Blob(['c']), 7000)

    expect(buffer.getChunks().map((chunk) => chunk.timestampMs)).toEqual([
      3000,
      7000,
    ])
  })
})

describe('selectClipChunks', () => {
  it('returns chunks within the requested time range', () => {
    const chunks = [
      makeChunk(0, 'a'),
      makeChunk(1000, 'b'),
      makeChunk(2000, 'c'),
      makeChunk(3000, 'd'),
      makeChunk(4000, 'e'),
    ]

    const selected = selectClipChunks(chunks, 1500, 4000)

    expect(selected.map((chunk) => chunk.timestampMs)).toEqual([2000, 3000, 4000])
  })
})

describe('buildClipBlob', () => {
  it('concatenates blobs and preserves mime type', () => {
    const chunks = [makeChunk(0, 'aaa'), makeChunk(1000, 'bbbb')]

    const result = buildClipBlob(chunks, 'video/webm')

    expect(result.sizeBytes).toBe(7)
    expect(result.mimeType).toBe('video/webm')
  })
})
