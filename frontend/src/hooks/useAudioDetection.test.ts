import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAudioDetection } from './useAudioDetection'

// Mock MediaStream for jsdom
class MockMediaStream {
  getTracks() { return [] }
}
vi.stubGlobal('MediaStream', MockMediaStream)

describe('useAudioDetection', () => {
  let mockCreateMediaStreamSource: ReturnType<typeof vi.fn>
  let mockCreateAnalyser: ReturnType<typeof vi.fn>
  let mockClose: ReturnType<typeof vi.fn>
  let mockConnect: ReturnType<typeof vi.fn>
  let mockGetFloatTimeDomainData: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockConnect = vi.fn()
    mockGetFloatTimeDomainData = vi.fn((arr: Float32Array) => {
      // Simulate audio data with some volume
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.sin(i * 0.1) * 0.5
      }
    })

    const mockAnalyser = {
      fftSize: 2048,
      getFloatTimeDomainData: mockGetFloatTimeDomainData,
    }

    const mockSource = {
      connect: mockConnect,
    }

    mockCreateMediaStreamSource = vi.fn(() => mockSource)
    mockCreateAnalyser = vi.fn(() => mockAnalyser)
    mockClose = vi.fn(() => Promise.resolve())

    class MockAudioContext {
      createMediaStreamSource = mockCreateMediaStreamSource
      createAnalyser = mockCreateAnalyser
      close = mockClose
    }

    vi.stubGlobal('AudioContext', MockAudioContext)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    // Re-stub MediaStream after unstubbing all
    vi.stubGlobal('MediaStream', MockMediaStream)
  })

  it('initializes with zero score', () => {
    const { result } = renderHook(() => useAudioDetection())

    expect(result.current.currentScore).toBe(0)
  })

  it('provides setup and cleanup functions', () => {
    const { result } = renderHook(() => useAudioDetection())

    expect(typeof result.current.setup).toBe('function')
    expect(typeof result.current.cleanup).toBe('function')
    expect(typeof result.current.getScore).toBe('function')
  })

  it('sets up audio context from media stream', () => {
    const { result } = renderHook(() => useAudioDetection())
    const mockStream = new MockMediaStream()

    act(() => {
      result.current.setup(mockStream as unknown as MediaStream)
    })

    expect(mockCreateMediaStreamSource).toHaveBeenCalledWith(mockStream)
    expect(mockCreateAnalyser).toHaveBeenCalled()
    expect(mockConnect).toHaveBeenCalled()
  })

  it('getScore returns audio RMS from analyser', () => {
    const { result } = renderHook(() => useAudioDetection())
    const mockStream = new MockMediaStream()

    act(() => {
      result.current.setup(mockStream as unknown as MediaStream)
    })

    let score: number = 0
    act(() => {
      score = result.current.getScore()
    })

    expect(mockGetFloatTimeDomainData).toHaveBeenCalled()
    expect(score).toBeGreaterThan(0)
  })

  it('getScore returns cached score before setup', () => {
    const { result } = renderHook(() => useAudioDetection())

    let score: number = 0
    act(() => {
      score = result.current.getScore()
    })

    expect(score).toBe(0)
    expect(mockGetFloatTimeDomainData).not.toHaveBeenCalled()
  })

  it('cleanup closes audio context and resets state', () => {
    const { result } = renderHook(() => useAudioDetection())
    const mockStream = new MockMediaStream()

    act(() => {
      result.current.setup(mockStream as unknown as MediaStream)
    })

    act(() => {
      result.current.cleanup()
    })

    expect(mockClose).toHaveBeenCalled()
    expect(result.current.currentScore).toBe(0)
  })

  it('handles missing AudioContext gracefully', () => {
    vi.stubGlobal('AudioContext', undefined)

    const { result } = renderHook(() => useAudioDetection())
    const mockStream = new MockMediaStream()

    // Should not throw
    act(() => {
      result.current.setup(mockStream as unknown as MediaStream)
    })

    // getScore should return 0
    let score: number = 0
    act(() => {
      score = result.current.getScore()
    })

    expect(score).toBe(0)
  })

  it('handles setup errors gracefully', () => {
    mockCreateMediaStreamSource.mockImplementation(() => {
      throw new Error('Not supported')
    })

    const { result } = renderHook(() => useAudioDetection())
    const mockStream = new MockMediaStream()

    // Should not throw
    expect(() => {
      act(() => {
        result.current.setup(mockStream as unknown as MediaStream)
      })
    }).not.toThrow()
  })

  it('handles getScore errors gracefully', () => {
    mockGetFloatTimeDomainData.mockImplementation(() => {
      throw new Error('Failed to get data')
    })

    const { result } = renderHook(() => useAudioDetection())
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
    const { result } = renderHook(() => useAudioDetection())
    const mockStream = new MockMediaStream()

    act(() => {
      result.current.setup(mockStream as unknown as MediaStream)
    })

    expect(result.current.currentScore).toBe(0)

    act(() => {
      result.current.getScore()
    })

    expect(result.current.currentScore).toBeGreaterThan(0)
  })
})
