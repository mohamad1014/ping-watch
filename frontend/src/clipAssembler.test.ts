import { describe, expect, it } from 'vitest'
import { assembleClip } from './clipAssembler'

// NOTE: clipAssembler is deprecated in favor of SequentialRecorder.
// These tests are kept for reference but test the legacy behavior.
// Due to VP9 inter-frame compression requirements, clips now always start
// from the first chunk, making pre/post window selection less relevant.

const makeChunk = (timestampMs: number, label: string) => ({
  timestampMs,
  blob: new Blob([label]),
})

describe('assembleClip', () => {
  it('includes all chunks from start up to endMs (VP9 requirement)', () => {
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
    // startMs/endMs are based on the requested window
    expect(clip?.startMs).toBe(1000)
    expect(clip?.endMs).toBe(4000)
    // But due to VP9, all 5 chunks from start are included (a,b,c,d,e)
    expect(clip?.sizeBytes).toBe(5)
    // Duration spans from first chunk (0) to last selected + estimated chunk duration
    expect(clip?.durationSeconds).toBeCloseTo(5)
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
    // All 4 chunks included due to VP9 requirement
    // Duration: 0 to 3000 + 1000ms estimated = 4s
    expect(clip?.durationSeconds).toBeCloseTo(4)
  })
})
