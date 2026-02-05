import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMotionDetection } from './useMotionDetection'

// Mock MediaStream for jsdom
class MockMediaStream {
  getTracks() { return [] }
}
vi.stubGlobal('MediaStream', MockMediaStream)

describe('useMotionDetection', () => {
  let mockVideo: {
    srcObject: MediaStream | null
    muted: boolean
    playsInline: boolean
    autoplay: boolean
    readyState: number
    play: ReturnType<typeof vi.fn>
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
  let frameCount: number
  let originalCreateElement: typeof document.createElement

  beforeEach(() => {
    frameCount = 0

    mockCtx = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => {
        frameCount++
        // Alternate between different frames to simulate motion
        if (frameCount % 2 === 1) {
          return {
            data: new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]),
          }
        } else {
          return {
            data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]),
          }
        }
      }),
    }

    mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => mockCtx),
    }

    mockVideo = {
      srcObject: null,
      muted: false,
      playsInline: false,
      autoplay: false,
      readyState: 4, // HAVE_ENOUGH_DATA
      play: vi.fn(() => Promise.resolve()),
    }

    // Store original createElement
    originalCreateElement = document.createElement.bind(document)

    // Mock createElement without causing infinite recursion
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'video') return mockVideo as unknown as HTMLVideoElement
      if (tag === 'canvas') return mockCanvas as unknown as HTMLCanvasElement
      // For other tags, use the real implementation
      return originalCreateElement(tag)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('initializes with zero score', () => {
    const { result } = renderHook(() => useMotionDetection())

    expect(result.current.currentScore).toBe(0)
  })

  it('provides setup and cleanup functions', () => {
    const { result } = renderHook(() => useMotionDetection())

    expect(typeof result.current.setup).toBe('function')
    expect(typeof result.current.cleanup).toBe('function')
    expect(typeof result.current.getScore).toBe('function')
  })

  it('sets up video and canvas from media stream', () => {
    const { result } = renderHook(() => useMotionDetection())
    const mockStream = new MockMediaStream()

    act(() => {
      result.current.setup(mockStream as unknown as MediaStream)
    })

    expect(mockVideo.srcObject).toBe(mockStream)
    expect(mockVideo.muted).toBe(true)
    expect(mockVideo.playsInline).toBe(true)
    expect(mockVideo.autoplay).toBe(true)
    expect(mockVideo.play).toHaveBeenCalled()
    expect(mockCanvas.width).toBe(160)
    expect(mockCanvas.height).toBe(90)
    expect(mockCanvas.getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true })
  })

  it('getScore returns 0 on first call (no previous frame)', () => {
    const { result } = renderHook(() => useMotionDetection())
    const mockStream = new MockMediaStream()

    act(() => {
      result.current.setup(mockStream as unknown as MediaStream)
    })

    let score: number = 0
    act(() => {
      score = result.current.getScore()
    })

    // First call captures frame but has no previous to compare
    expect(score).toBe(0)
  })

  it('getScore computes motion between consecutive frames', () => {
    const { result } = renderHook(() => useMotionDetection())
    const mockStream = new MockMediaStream()

    act(() => {
      result.current.setup(mockStream as unknown as MediaStream)
    })

    // First call - captures initial frame
    act(() => {
      result.current.getScore()
    })

    // Second call - computes motion against previous frame
    let score: number = 0
    act(() => {
      score = result.current.getScore()
    })

    expect(score).toBeGreaterThan(0)
    expect(mockCtx.drawImage).toHaveBeenCalledTimes(2)
    expect(mockCtx.getImageData).toHaveBeenCalledTimes(2)
  })

  it('getScore returns cached score before setup', () => {
    const { result } = renderHook(() => useMotionDetection())

    let score: number = 0
    act(() => {
      score = result.current.getScore()
    })

    expect(score).toBe(0)
    expect(mockCtx.drawImage).not.toHaveBeenCalled()
  })

  it('getScore returns cached score when video not ready', () => {
    mockVideo.readyState = 1 // HAVE_METADATA

    const { result } = renderHook(() => useMotionDetection())
    const mockStream = new MockMediaStream()

    act(() => {
      result.current.setup(mockStream as unknown as MediaStream)
    })

    let score: number = 0
    act(() => {
      score = result.current.getScore()
    })

    expect(score).toBe(0)
    expect(mockCtx.drawImage).not.toHaveBeenCalled()
  })

  it('cleanup resets video and state', () => {
    const { result } = renderHook(() => useMotionDetection())
    const mockStream = new MockMediaStream()

    act(() => {
      result.current.setup(mockStream as unknown as MediaStream)
    })

    act(() => {
      result.current.cleanup()
    })

    expect(mockVideo.srcObject).toBe(null)
    expect(result.current.currentScore).toBe(0)
  })

  it('handles video play rejection gracefully', () => {
    mockVideo.play = vi.fn(() => Promise.reject(new Error('Not allowed')))

    const { result } = renderHook(() => useMotionDetection())
    const mockStream = new MockMediaStream()

    // Should not throw
    expect(() => {
      act(() => {
        result.current.setup(mockStream as unknown as MediaStream)
      })
    }).not.toThrow()
  })

  it('handles getScore errors gracefully', () => {
    mockCtx.drawImage = vi.fn(() => {
      throw new Error('Failed to draw')
    })

    const { result } = renderHook(() => useMotionDetection())
    const mockStream = new MockMediaStream()

    act(() => {
      result.current.setup(mockStream as unknown as MediaStream)
    })

    // Should not throw
    let score: number = 0
    expect(() => {
      act(() => {
        score = result.current.getScore()
      })
    }).not.toThrow()

    expect(score).toBe(0)
  })

  it('updates currentScore state when getScore is called', () => {
    const { result } = renderHook(() => useMotionDetection())
    const mockStream = new MockMediaStream()

    act(() => {
      result.current.setup(mockStream as unknown as MediaStream)
    })

    expect(result.current.currentScore).toBe(0)

    // First call - no motion
    act(() => {
      result.current.getScore()
    })

    // Second call - should detect motion
    act(() => {
      result.current.getScore()
    })

    expect(result.current.currentScore).toBeGreaterThan(0)
  })

  it('handles missing canvas context', () => {
    mockCanvas.getContext = vi.fn(() => null)

    const { result } = renderHook(() => useMotionDetection())
    const mockStream = new MockMediaStream()

    act(() => {
      result.current.setup(mockStream as unknown as MediaStream)
    })

    let score: number = 0
    act(() => {
      score = result.current.getScore()
    })

    expect(score).toBe(0)
  })
})
