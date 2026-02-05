import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  computeFrameMotionScores,
  FrameData,
} from './clipAnalyzer'

// Mock MediaStream for jsdom
class MockMediaStream {
  getTracks() { return [] }
}
vi.stubGlobal('MediaStream', MockMediaStream)

describe('computeFrameMotionScores', () => {
  it('returns empty array for empty frames', () => {
    const scores = computeFrameMotionScores([])
    expect(scores).toEqual([])
  })

  it('returns empty array for single frame', () => {
    const frame: FrameData = {
      timestamp: 0,
      data: new Uint8ClampedArray([0, 0, 0, 255]),
      width: 1,
      height: 1,
    }
    const scores = computeFrameMotionScores([frame])
    expect(scores).toEqual([])
  })

  it('computes motion scores between consecutive frames', () => {
    const frame1: FrameData = {
      timestamp: 0,
      data: new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]),
      width: 2,
      height: 1,
    }
    const frame2: FrameData = {
      timestamp: 500,
      data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]),
      width: 2,
      height: 1,
    }
    const frame3: FrameData = {
      timestamp: 1000,
      data: new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]),
      width: 2,
      height: 1,
    }

    const scores = computeFrameMotionScores([frame1, frame2, frame3])

    expect(scores).toHaveLength(2)
    expect(scores[0]).toBeCloseTo(0.5) // 1 of 2 pixels changed
    expect(scores[1]).toBeCloseTo(0.5) // 1 of 2 pixels changed
  })

  it('returns 0 for mismatched frame dimensions', () => {
    const frame1: FrameData = {
      timestamp: 0,
      data: new Uint8ClampedArray([0, 0, 0, 255]),
      width: 1,
      height: 1,
    }
    const frame2: FrameData = {
      timestamp: 500,
      data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]),
      width: 2,
      height: 1,
    }

    const scores = computeFrameMotionScores([frame1, frame2])

    expect(scores).toHaveLength(1)
    expect(scores[0]).toBe(0)
  })

  it('uses custom diff threshold', () => {
    const frame1: FrameData = {
      timestamp: 0,
      data: new Uint8ClampedArray([0, 0, 0, 255]),
      width: 1,
      height: 1,
    }
    const frame2: FrameData = {
      timestamp: 500,
      data: new Uint8ClampedArray([60, 60, 60, 255]), // Change: sum of RGB diff = 180
      width: 1,
      height: 1,
    }

    // With low threshold (10), change of 180 (sum) is detected
    const scoresLow = computeFrameMotionScores([frame1, frame2], 10)
    expect(scoresLow[0]).toBeGreaterThan(0)

    // With threshold higher than sum (200), change is not detected
    const scoresHigh = computeFrameMotionScores([frame1, frame2], 200)
    expect(scoresHigh[0]).toBe(0)
  })

  it('handles identical frames', () => {
    const frame1: FrameData = {
      timestamp: 0,
      data: new Uint8ClampedArray([100, 100, 100, 255]),
      width: 1,
      height: 1,
    }
    const frame2: FrameData = {
      timestamp: 500,
      data: new Uint8ClampedArray([100, 100, 100, 255]),
      width: 1,
      height: 1,
    }

    const scores = computeFrameMotionScores([frame1, frame2])

    expect(scores).toHaveLength(1)
    expect(scores[0]).toBe(0)
  })
})

describe('extractFramesFromBlob', () => {
  let mockVideo: {
    addEventListener: ReturnType<typeof vi.fn>
    load: ReturnType<typeof vi.fn>
    src: string
    muted: boolean
    playsInline: boolean
    currentTime: number
    duration: number
    error: { code: number; message: string } | null
    readyState: number
  }
  let mockCanvas: {
    width: number
    height: number
    getContext: ReturnType<typeof vi.fn>
  }
  let mockCtx: {
    drawImage: ReturnType<typeof vi.fn>
    getImageData: ReturnType<typeof vi.fn>
  }
  let eventHandlers: Record<string, () => void>

  beforeEach(() => {
    eventHandlers = {}

    mockCtx = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray([0, 0, 0, 255]),
      })),
    }

    mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => mockCtx),
    }

    mockVideo = {
      addEventListener: vi.fn((event: string, handler: () => void) => {
        eventHandlers[event] = handler
      }),
      load: vi.fn(),
      src: '',
      muted: false,
      playsInline: false,
      currentTime: 0,
      duration: 2,
      error: null,
      readyState: 4,
    }

    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'video') return mockVideo as unknown as HTMLVideoElement
      if (tag === 'canvas') return mockCanvas as unknown as HTMLCanvasElement
      return document.createElement(tag)
    })

    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sets up video element correctly', async () => {
    const { extractFramesFromBlob } = await import('./clipAnalyzer')
    const blob = new Blob(['test'], { type: 'video/webm' })

    // Start extraction but don't await
    const promise = extractFramesFromBlob(blob, { width: 160, height: 90 })

    expect(mockVideo.muted).toBe(true)
    expect(mockVideo.playsInline).toBe(true)
    expect(mockCanvas.width).toBe(160)
    expect(mockCanvas.height).toBe(90)

    // Simulate video loaded with 0 duration to resolve quickly
    mockVideo.duration = 0
    eventHandlers['loadedmetadata']?.()

    const frames = await promise
    expect(frames).toEqual([])
  })

  it('handles video error gracefully', async () => {
    const { extractFramesFromBlob } = await import('./clipAnalyzer')
    const blob = new Blob(['test'], { type: 'video/webm' })

    const promise = extractFramesFromBlob(blob)

    mockVideo.error = { code: 4, message: 'Format not supported' }
    eventHandlers['error']?.()

    await expect(promise).rejects.toThrow('Video load error (4): Format not supported')
  })

  it('handles missing canvas context', async () => {
    mockCanvas.getContext = vi.fn(() => null)

    const { extractFramesFromBlob } = await import('./clipAnalyzer')
    const blob = new Blob(['test'], { type: 'video/webm' })

    await expect(extractFramesFromBlob(blob)).rejects.toThrow('Could not get canvas context')
  })
})

describe('extractAudioScore', () => {
  let mockDecodeAudioData: ReturnType<typeof vi.fn>
  let mockClose: ReturnType<typeof vi.fn>
  let mockGetChannelData: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockGetChannelData = vi.fn(() => new Float32Array([0.5, -0.5, 0.5, -0.5]))
    mockDecodeAudioData = vi.fn(() => Promise.resolve({
      getChannelData: mockGetChannelData,
    }))
    mockClose = vi.fn(() => Promise.resolve())

    // Create a proper class mock for AudioContext
    class MockAudioContext {
      decodeAudioData = mockDecodeAudioData
      close = mockClose
    }

    vi.stubGlobal('AudioContext', MockAudioContext)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('extracts audio and computes RMS score', async () => {
    const { extractAudioScore } = await import('./clipAnalyzer')

    // Create a blob with arrayBuffer method mocked
    const mockBlob = {
      arrayBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(8))),
    } as unknown as Blob

    const score = await extractAudioScore(mockBlob)

    expect(mockBlob.arrayBuffer).toHaveBeenCalled()
    expect(mockDecodeAudioData).toHaveBeenCalled()
    expect(mockGetChannelData).toHaveBeenCalledWith(0)
    expect(mockClose).toHaveBeenCalled()
    expect(score).toBeCloseTo(0.5)
  })

  it('returns 0 on decode error', async () => {
    mockDecodeAudioData.mockImplementation(() => Promise.reject(new Error('Decode failed')))

    const { extractAudioScore } = await import('./clipAnalyzer')

    const mockBlob = {
      arrayBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(8))),
    } as unknown as Blob

    const score = await extractAudioScore(mockBlob)

    expect(score).toBe(0)
  })
})
