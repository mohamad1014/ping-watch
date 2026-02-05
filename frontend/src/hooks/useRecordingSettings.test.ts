import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRecordingSettings } from './useRecordingSettings'

describe('useRecordingSettings', () => {
  let storage: Record<string, string>

  beforeEach(() => {
    storage = {}

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
      return storage[key] ?? null
    })

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => {
      storage[key] = value
    })

    // Clean up any global override
    delete (globalThis as { __PING_WATCH_CLIP_DURATION_MS__?: number }).__PING_WATCH_CLIP_DURATION_MS__
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns default values when localStorage is empty', () => {
    const { result } = renderHook(() => useRecordingSettings())

    expect(result.current.clipDuration).toBe(10)
    expect(result.current.motionDeltaThreshold).toBe(0.05)
    expect(result.current.motionAbsoluteThreshold).toBe(0.03)
    expect(result.current.audioDeltaEnabled).toBe(false)
    expect(result.current.audioDeltaThreshold).toBe(0.1)
    expect(result.current.audioAbsoluteEnabled).toBe(false)
    expect(result.current.audioAbsoluteThreshold).toBe(0.15)
  })

  it('reads stored values from localStorage', () => {
    storage['ping-watch:clip-duration'] = '15'
    storage['ping-watch:motion-delta'] = '0.1'
    storage['ping-watch:motion-absolute'] = '0.05'
    storage['ping-watch:audio-delta-enabled'] = 'true'
    storage['ping-watch:audio-delta'] = '0.2'
    storage['ping-watch:audio-absolute-enabled'] = 'true'
    storage['ping-watch:audio-absolute'] = '0.25'

    const { result } = renderHook(() => useRecordingSettings())

    expect(result.current.clipDuration).toBe(15)
    expect(result.current.motionDeltaThreshold).toBe(0.1)
    expect(result.current.motionAbsoluteThreshold).toBe(0.05)
    expect(result.current.audioDeltaEnabled).toBe(true)
    expect(result.current.audioDeltaThreshold).toBe(0.2)
    expect(result.current.audioAbsoluteEnabled).toBe(true)
    expect(result.current.audioAbsoluteThreshold).toBe(0.25)
  })

  it('uses global override for clip duration', () => {
    ;(globalThis as { __PING_WATCH_CLIP_DURATION_MS__?: number }).__PING_WATCH_CLIP_DURATION_MS__ = 5000

    const { result } = renderHook(() => useRecordingSettings())

    expect(result.current.clipDuration).toBe(5) // 5000ms = 5s
  })

  it('global override takes precedence over localStorage', () => {
    storage['ping-watch:clip-duration'] = '15'
    ;(globalThis as { __PING_WATCH_CLIP_DURATION_MS__?: number }).__PING_WATCH_CLIP_DURATION_MS__ = 3000

    const { result } = renderHook(() => useRecordingSettings())

    expect(result.current.clipDuration).toBe(3)
  })

  it('provides setter functions for all settings', () => {
    const { result } = renderHook(() => useRecordingSettings())

    expect(typeof result.current.setClipDuration).toBe('function')
    expect(typeof result.current.setMotionDeltaThreshold).toBe('function')
    expect(typeof result.current.setMotionAbsoluteThreshold).toBe('function')
    expect(typeof result.current.setAudioDeltaEnabled).toBe('function')
    expect(typeof result.current.setAudioDeltaThreshold).toBe('function')
    expect(typeof result.current.setAudioAbsoluteEnabled).toBe('function')
    expect(typeof result.current.setAudioAbsoluteThreshold).toBe('function')
  })

  it('setClipDuration updates state and persists to localStorage', () => {
    const { result } = renderHook(() => useRecordingSettings())

    act(() => {
      result.current.setClipDuration(20)
    })

    expect(result.current.clipDuration).toBe(20)
    expect(storage['ping-watch:clip-duration']).toBe('20')
  })

  it('setMotionDeltaThreshold updates state and persists', () => {
    const { result } = renderHook(() => useRecordingSettings())

    act(() => {
      result.current.setMotionDeltaThreshold(0.15)
    })

    expect(result.current.motionDeltaThreshold).toBe(0.15)
    expect(storage['ping-watch:motion-delta']).toBe('0.15')
  })

  it('setMotionAbsoluteThreshold updates state and persists', () => {
    const { result } = renderHook(() => useRecordingSettings())

    act(() => {
      result.current.setMotionAbsoluteThreshold(0.08)
    })

    expect(result.current.motionAbsoluteThreshold).toBe(0.08)
    expect(storage['ping-watch:motion-absolute']).toBe('0.08')
  })

  it('setAudioDeltaEnabled updates state and persists', () => {
    const { result } = renderHook(() => useRecordingSettings())

    act(() => {
      result.current.setAudioDeltaEnabled(true)
    })

    expect(result.current.audioDeltaEnabled).toBe(true)
    expect(storage['ping-watch:audio-delta-enabled']).toBe('true')
  })

  it('setAudioDeltaThreshold updates state and persists', () => {
    const { result } = renderHook(() => useRecordingSettings())

    act(() => {
      result.current.setAudioDeltaThreshold(0.3)
    })

    expect(result.current.audioDeltaThreshold).toBe(0.3)
    expect(storage['ping-watch:audio-delta']).toBe('0.3')
  })

  it('setAudioAbsoluteEnabled updates state and persists', () => {
    const { result } = renderHook(() => useRecordingSettings())

    act(() => {
      result.current.setAudioAbsoluteEnabled(true)
    })

    expect(result.current.audioAbsoluteEnabled).toBe(true)
    expect(storage['ping-watch:audio-absolute-enabled']).toBe('true')
  })

  it('setAudioAbsoluteThreshold updates state and persists', () => {
    const { result } = renderHook(() => useRecordingSettings())

    act(() => {
      result.current.setAudioAbsoluteThreshold(0.35)
    })

    expect(result.current.audioAbsoluteThreshold).toBe(0.35)
    expect(storage['ping-watch:audio-absolute']).toBe('0.35')
  })

  it('handles invalid stored number values', () => {
    storage['ping-watch:clip-duration'] = 'invalid'
    storage['ping-watch:motion-delta'] = 'NaN'
    // Note: empty string converts to 0 which is finite, so it returns 0 not the fallback
    storage['ping-watch:audio-delta'] = 'not-a-number'

    const { result } = renderHook(() => useRecordingSettings())

    // Should fallback to defaults
    expect(result.current.clipDuration).toBe(10)
    expect(result.current.motionDeltaThreshold).toBe(0.05)
    expect(result.current.audioDeltaThreshold).toBe(0.1)
  })

  it('handles invalid stored boolean values', () => {
    storage['ping-watch:audio-delta-enabled'] = 'invalid'
    storage['ping-watch:audio-absolute-enabled'] = ''

    const { result } = renderHook(() => useRecordingSettings())

    // 'invalid' !== 'true', so should be false
    expect(result.current.audioDeltaEnabled).toBe(false)
    expect(result.current.audioAbsoluteEnabled).toBe(false)
  })

  it('handles localStorage read errors gracefully', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage error')
    })

    const { result } = renderHook(() => useRecordingSettings())

    // Should fallback to defaults
    expect(result.current.clipDuration).toBe(10)
    expect(result.current.motionDeltaThreshold).toBe(0.05)
  })

  it('handles localStorage write errors gracefully', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage error')
    })

    const { result } = renderHook(() => useRecordingSettings())

    // Should not throw
    expect(() => {
      act(() => {
        result.current.setClipDuration(20)
      })
    }).not.toThrow()

    // State should still update
    expect(result.current.clipDuration).toBe(20)
  })

  it('persists all settings when any value changes', () => {
    const { result } = renderHook(() => useRecordingSettings())

    act(() => {
      result.current.setClipDuration(25)
    })

    // All settings should be persisted
    expect(storage['ping-watch:clip-duration']).toBe('25')
    expect(storage['ping-watch:motion-delta']).toBe('0.05')
    expect(storage['ping-watch:motion-absolute']).toBe('0.03')
    expect(storage['ping-watch:audio-delta-enabled']).toBe('false')
    expect(storage['ping-watch:audio-delta']).toBe('0.1')
    expect(storage['ping-watch:audio-absolute-enabled']).toBe('false')
    expect(storage['ping-watch:audio-absolute']).toBe('0.15')
  })

  it('correctly parses boolean true from storage', () => {
    storage['ping-watch:audio-delta-enabled'] = 'true'

    const { result } = renderHook(() => useRecordingSettings())

    expect(result.current.audioDeltaEnabled).toBe(true)
  })

  it('correctly parses boolean false from storage', () => {
    storage['ping-watch:audio-delta-enabled'] = 'false'

    const { result } = renderHook(() => useRecordingSettings())

    expect(result.current.audioDeltaEnabled).toBe(false)
  })
})
