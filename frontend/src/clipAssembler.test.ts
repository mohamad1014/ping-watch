import { describe, expect, it } from 'vitest'
import { assembleClip } from './clipAssembler'

const makeChunk = (timestampMs: number, label: string) => ({
  timestampMs,
  blob: new Blob([label]),
})

describe('assembleClip', () => {
  it('selects pre/post chunks and returns metadata', () => {
    const chunks = [
      makeChunk(0, 'a'),
      makeChunk(1000, 'b'),
      makeChunk(2000, 'c'),
      makeChunk(3000, 'd'),
      makeChunk(4000, 'e'),
    ]

    const clip = assembleClip({
      chunks,
      triggerMs: 3000,
      preMs: 2000,
      postMs: 1000,
      fallbackMime: 'video/webm',
    })

    expect(clip).not.toBeNull()
    expect(clip?.startMs).toBe(1000)
    expect(clip?.endMs).toBe(4000)
    expect(clip?.durationSeconds).toBeCloseTo(4)
    expect(clip?.sizeBytes).toBe(4)
    expect(clip?.mimeType).toBe('video/webm')
  })

  it('uses the available chunk cadence for duration', () => {
    const chunks = [
      makeChunk(0, 'a'),
      makeChunk(1000, 'b'),
      makeChunk(2000, 'c'),
      makeChunk(3000, 'd'),
    ]

    const clip = assembleClip({
      chunks,
      triggerMs: 3500,
      preMs: 2000,
      postMs: 2000,
      fallbackMime: 'video/webm',
    })

    expect(clip).not.toBeNull()
    expect(clip?.durationSeconds).toBeCloseTo(2)
  })
})
