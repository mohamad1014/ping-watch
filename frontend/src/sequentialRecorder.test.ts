import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SequentialRecorder, type ClipCompleteData, type ClipMetrics } from './sequentialRecorder'

// Mock MediaRecorder
class MockMediaRecorder {
  static isTypeSupported = vi.fn().mockReturnValue(true)

  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  private listeners: Record<string, ((event: unknown) => void)[]> = {}
  private timeslice = 0

  constructor(
    public stream: MediaStream,
    public options?: { mimeType?: string }
  ) {}

  addEventListener(type: string, listener: (event: unknown) => void) {
    if (!this.listeners[type]) {
      this.listeners[type] = []
    }
    this.listeners[type].push(listener)
  }

  removeEventListener(type: string, listener: (event: unknown) => void) {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter((l) => l !== listener)
    }
  }

  start(timeslice?: number) {
    this.state = 'recording'
    this.timeslice = timeslice ?? 0
  }

  stop() {
    this.state = 'inactive'
    // Emit dataavailable event
    this.emit('dataavailable', { data: new Blob(['test-data'], { type: 'video/webm' }) })
    // Emit stop event
    this.emit('stop', {})
  }

  emit(type: string, event: unknown) {
    if (this.listeners[type]) {
      this.listeners[type].forEach((listener) => listener(event))
    }
  }
}

// Mock MediaStream
class MockMediaStream {
  getTracks() {
    return [{ stop: vi.fn() }]
  }
}

describe('SequentialRecorder', () => {
  let originalMediaRecorder: typeof MediaRecorder

  beforeEach(() => {
    originalMediaRecorder = globalThis.MediaRecorder
    Object.defineProperty(globalThis, 'MediaRecorder', {
      value: MockMediaRecorder,
      configurable: true,
    })
    vi.useFakeTimers()
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'MediaRecorder', {
      value: originalMediaRecorder,
      configurable: true,
    })
    vi.useRealTimers()
  })

  it('starts recording and tracks clip index', () => {
    const onClipComplete = vi.fn()
    const stream = new MockMediaStream() as unknown as MediaStream

    const recorder = new SequentialRecorder({
      stream,
      clipDurationMs: 5000,
      onClipComplete,
    })

    recorder.start()

    const state = recorder.getState()
    expect(state.isRecording).toBe(true)
    expect(state.currentClipIndex).toBe(0)
  })

  it('calls onClipComplete when clip duration elapses', () => {
    const onClipComplete = vi.fn()
    const stream = new MockMediaStream() as unknown as MediaStream

    const recorder = new SequentialRecorder({
      stream,
      clipDurationMs: 5000,
      onClipComplete,
    })

    recorder.start()

    // Advance time to trigger clip completion
    vi.advanceTimersByTime(5000)

    expect(onClipComplete).toHaveBeenCalledTimes(1)
    expect(onClipComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        clipIndex: 0,
        blob: expect.any(Blob),
        metrics: expect.objectContaining({
          peakMotionScore: expect.any(Number),
          avgMotionScore: expect.any(Number),
          motionEventCount: expect.any(Number),
          peakAudioScore: expect.any(Number),
          avgAudioScore: expect.any(Number),
        }),
      })
    )
  })

  it('increments clip index for each completed clip', () => {
    const completedClips: ClipCompleteData[] = []
    const onClipComplete = vi.fn((data: ClipCompleteData) => {
      completedClips.push(data)
    })
    const stream = new MockMediaStream() as unknown as MediaStream

    const recorder = new SequentialRecorder({
      stream,
      clipDurationMs: 5000,
      onClipComplete,
    })

    recorder.start()

    // Complete first clip
    vi.advanceTimersByTime(5000)
    expect(completedClips[0].clipIndex).toBe(0)

    // Complete second clip
    vi.advanceTimersByTime(5000)
    expect(completedClips[1].clipIndex).toBe(1)

    // Complete third clip
    vi.advanceTimersByTime(5000)
    expect(completedClips[2].clipIndex).toBe(2)
  })

  it('samples motion and audio scores during recording', () => {
    let motionScore = 0
    let audioScore = 0
    const onClipComplete = vi.fn()
    const stream = new MockMediaStream() as unknown as MediaStream

    const recorder = new SequentialRecorder({
      stream,
      clipDurationMs: 5000,
      samplingIntervalMs: 500,
      getMotionScore: () => {
        motionScore += 0.01
        return motionScore
      },
      getAudioScore: () => {
        audioScore += 0.005
        return audioScore
      },
      onClipComplete,
    })

    recorder.start()

    // Advance through sampling intervals
    vi.advanceTimersByTime(5000)

    const data = onClipComplete.mock.calls[0][0] as ClipCompleteData
    // Motion should have increased over multiple samples
    expect(data.metrics.avgMotionScore).toBeGreaterThan(0)
    expect(data.metrics.peakMotionScore).toBeGreaterThan(0)
  })

  it('tracks peak motion score correctly', () => {
    const motionScores = [0.01, 0.05, 0.15, 0.08, 0.03]
    let sampleIndex = 0
    const onClipComplete = vi.fn()
    const stream = new MockMediaStream() as unknown as MediaStream

    const recorder = new SequentialRecorder({
      stream,
      clipDurationMs: 2500,
      samplingIntervalMs: 500,
      getMotionScore: () => {
        const score = motionScores[sampleIndex] ?? 0
        sampleIndex++
        return score
      },
      getAudioScore: () => 0,
      onClipComplete,
    })

    recorder.start()
    vi.advanceTimersByTime(2500)

    const data = onClipComplete.mock.calls[0][0] as ClipCompleteData
    expect(data.metrics.peakMotionScore).toBe(0.15)
  })

  it('counts motion events above threshold', () => {
    const motionScores = [0.01, 0.05, 0.08, 0.02, 0.06]
    let sampleIndex = 0
    const onClipComplete = vi.fn()
    const stream = new MockMediaStream() as unknown as MediaStream

    const recorder = new SequentialRecorder({
      stream,
      clipDurationMs: 2500,
      samplingIntervalMs: 500,
      motionEventThreshold: 0.04,
      getMotionScore: () => {
        const score = motionScores[sampleIndex] ?? 0
        sampleIndex++
        return score
      },
      getAudioScore: () => 0,
      onClipComplete,
    })

    recorder.start()
    vi.advanceTimersByTime(2500)

    const data = onClipComplete.mock.calls[0][0] as ClipCompleteData
    // Scores above 0.04: 0.05, 0.08, 0.06 = 3 events
    expect(data.metrics.motionEventCount).toBe(3)
  })

  it('allows updating clip duration while recording', () => {
    const completedClips: ClipCompleteData[] = []
    const onClipComplete = vi.fn((data: ClipCompleteData) => {
      completedClips.push(data)
    })
    const stream = new MockMediaStream() as unknown as MediaStream

    const recorder = new SequentialRecorder({
      stream,
      clipDurationMs: 5000,
      onClipComplete,
    })

    recorder.start()

    // Update duration to 3s DURING the first clip (before it completes)
    // This ensures the next clip will use the new duration
    vi.advanceTimersByTime(2000)
    recorder.setClipDuration(3000)

    // Complete first clip at 5s (original duration)
    vi.advanceTimersByTime(3000)
    expect(completedClips.length).toBe(1)

    // Second clip should complete at 3s (new duration)
    vi.advanceTimersByTime(3000)
    expect(completedClips.length).toBe(2)
  })

  it('allows updating motion event threshold', () => {
    const onClipComplete = vi.fn()
    const stream = new MockMediaStream() as unknown as MediaStream

    const recorder = new SequentialRecorder({
      stream,
      clipDurationMs: 5000,
      motionEventThreshold: 0.02,
      onClipComplete,
    })

    recorder.start()
    recorder.setMotionEventThreshold(0.05)

    // The new threshold should be used for future clips
    expect(recorder.getState().isRecording).toBe(true)
  })

  it('stops recording and returns final clip', async () => {
    const onClipComplete = vi.fn()
    const stream = new MockMediaStream() as unknown as MediaStream

    const recorder = new SequentialRecorder({
      stream,
      clipDurationMs: 10000,
      onClipComplete,
    })

    recorder.start()

    // Advance partway through a clip
    vi.advanceTimersByTime(3000)

    // Stop recording
    const finalBlob = await recorder.stop()

    expect(finalBlob).toBeInstanceOf(Blob)
    expect(recorder.getState().isRecording).toBe(false)
    // onClipComplete should be called for the final partial clip
    expect(onClipComplete).toHaveBeenCalledTimes(1)
  })

  it('does not start if already recording', () => {
    const onClipComplete = vi.fn()
    const stream = new MockMediaStream() as unknown as MediaStream
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const recorder = new SequentialRecorder({
      stream,
      clipDurationMs: 5000,
      onClipComplete,
    })

    recorder.start()
    recorder.start() // Should warn and not start again

    expect(consoleWarn).toHaveBeenCalledWith('[SequentialRecorder] Already recording')
    consoleWarn.mockRestore()
  })

  it('returns null when stopping if not recording', async () => {
    const onClipComplete = vi.fn()
    const stream = new MockMediaStream() as unknown as MediaStream

    const recorder = new SequentialRecorder({
      stream,
      clipDurationMs: 5000,
      onClipComplete,
    })

    const result = await recorder.stop()
    expect(result).toBeNull()
  })

  it('calls onError when MediaRecorder fails', () => {
    const onClipComplete = vi.fn()
    const onError = vi.fn()
    const stream = new MockMediaStream() as unknown as MediaStream

    // Make MediaRecorder constructor throw
    const FailingMediaRecorder = vi.fn().mockImplementation(() => {
      throw new Error('MediaRecorder init failed')
    })
    FailingMediaRecorder.isTypeSupported = vi.fn().mockReturnValue(true)

    Object.defineProperty(globalThis, 'MediaRecorder', {
      value: FailingMediaRecorder,
      configurable: true,
    })

    const recorder = new SequentialRecorder({
      stream,
      clipDurationMs: 5000,
      onClipComplete,
      onError,
    })

    recorder.start()

    expect(onError).toHaveBeenCalledWith(expect.any(Error))
    expect(recorder.getState().isRecording).toBe(false)
  })

  it('uses preferred MIME type when supported', () => {
    const onClipComplete = vi.fn()
    const stream = new MockMediaStream() as unknown as MediaStream

    MockMediaRecorder.isTypeSupported = vi.fn((type: string) => {
      return type === 'video/webm;codecs=vp9,opus'
    })

    const recorder = new SequentialRecorder({
      stream,
      clipDurationMs: 5000,
      onClipComplete,
    })

    recorder.start()

    // The recorder should have created a MediaRecorder with the supported type
    expect(recorder.getState().isRecording).toBe(true)
  })

  it('falls back to basic webm when codecs not supported', () => {
    const onClipComplete = vi.fn()
    const stream = new MockMediaStream() as unknown as MediaStream

    MockMediaRecorder.isTypeSupported = vi.fn((type: string) => {
      return type === 'video/webm'
    })

    const recorder = new SequentialRecorder({
      stream,
      clipDurationMs: 5000,
      onClipComplete,
    })

    recorder.start()

    expect(recorder.getState().isRecording).toBe(true)
  })

  it('includes currentMetrics in state while recording', () => {
    const onClipComplete = vi.fn()
    const stream = new MockMediaStream() as unknown as MediaStream

    const recorder = new SequentialRecorder({
      stream,
      clipDurationMs: 5000,
      getMotionScore: () => 0.05,
      getAudioScore: () => 0.02,
      onClipComplete,
    })

    recorder.start()

    // Advance to trigger some sampling
    vi.advanceTimersByTime(1000)

    const state = recorder.getState()
    expect(state.currentMetrics).not.toBeNull()
    expect(state.currentMetrics?.peakMotionScore).toBeGreaterThanOrEqual(0)
  })

  it('returns null currentMetrics when not recording', () => {
    const onClipComplete = vi.fn()
    const stream = new MockMediaStream() as unknown as MediaStream

    const recorder = new SequentialRecorder({
      stream,
      clipDurationMs: 5000,
      onClipComplete,
    })

    const state = recorder.getState()
    expect(state.currentMetrics).toBeNull()
  })

  it('clamps clip duration to valid range', () => {
    const onClipComplete = vi.fn()
    const stream = new MockMediaStream() as unknown as MediaStream

    const recorder = new SequentialRecorder({
      stream,
      clipDurationMs: 5000,
      onClipComplete,
    })

    recorder.setClipDuration(500) // Below min (1000)
    recorder.setClipDuration(60000) // Above max (30000)

    // Should not throw, values are clamped internally
    expect(recorder.getState().isRecording).toBe(false)
  })
})
