import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  setBenchmark,
  getBenchmark,
  clearBenchmark,
  compareWithBenchmark,
  createBenchmarkData,
  updateBenchmark,
  hasBenchmark,
  getBenchmarkAge,
  type BenchmarkData,
  type ComparisonThresholds,
} from './benchmarkManager'
import type { ClipMetrics } from './sequentialRecorder'

const createMetrics = (overrides: Partial<ClipMetrics> = {}): ClipMetrics => ({
  peakMotionScore: 0.05,
  avgMotionScore: 0.03,
  motionEventCount: 2,
  peakAudioScore: 0.08,
  avgAudioScore: 0.05,
  ...overrides,
})

const createThresholds = (overrides: Partial<ComparisonThresholds> = {}): ComparisonThresholds => ({
  motionDeltaThreshold: 0.02,
  motionAbsoluteThreshold: 0.03,
  audioDeltaEnabled: false,
  audioDeltaThreshold: 0.05,
  audioAbsoluteEnabled: false,
  audioAbsoluteThreshold: 0.1,
  ...overrides,
})

describe('benchmarkManager', () => {
  beforeEach(() => {
    clearBenchmark()
  })

  afterEach(() => {
    clearBenchmark()
  })

  describe('setBenchmark and getBenchmark', () => {
    it('sets and retrieves benchmark data', () => {
      const data: BenchmarkData = {
        clipId: 'clip-1',
        peakMotionScore: 0.05,
        avgMotionScore: 0.03,
        peakAudioScore: 0.08,
        avgAudioScore: 0.05,
        timestamp: Date.now(),
      }

      setBenchmark(data)
      const retrieved = getBenchmark()

      expect(retrieved).not.toBeNull()
      expect(retrieved?.clipId).toBe('clip-1')
      expect(retrieved?.peakMotionScore).toBe(0.05)
      expect(retrieved?.peakAudioScore).toBe(0.08)
    })

    it('preserves provided timestamp', () => {
      const timestamp = 1700000000000
      const data: BenchmarkData = {
        clipId: 'clip-1',
        peakMotionScore: 0.05,
        avgMotionScore: 0.03,
        peakAudioScore: 0.08,
        avgAudioScore: 0.05,
        timestamp,
      }

      setBenchmark(data)

      const retrieved = getBenchmark()
      expect(retrieved?.timestamp).toBe(timestamp)
    })

    it('createBenchmarkData generates timestamp', () => {
      const metrics = {
        peakMotionScore: 0.05,
        avgMotionScore: 0.03,
        motionEventCount: 2,
        peakAudioScore: 0.08,
        avgAudioScore: 0.05,
      }

      const before = Date.now()
      const data = createBenchmarkData('clip-1', metrics)
      const after = Date.now()

      expect(data.timestamp).toBeGreaterThanOrEqual(before)
      expect(data.timestamp).toBeLessThanOrEqual(after)
    })
  })

  describe('clearBenchmark', () => {
    it('clears the benchmark', () => {
      setBenchmark({
        clipId: 'clip-1',
        peakMotionScore: 0.05,
        avgMotionScore: 0.03,
        peakAudioScore: 0.08,
        avgAudioScore: 0.05,
        timestamp: Date.now(),
      })

      expect(getBenchmark()).not.toBeNull()

      clearBenchmark()

      expect(getBenchmark()).toBeNull()
    })
  })

  describe('hasBenchmark', () => {
    it('returns false when no benchmark is set', () => {
      expect(hasBenchmark()).toBe(false)
    })

    it('returns true when benchmark is set', () => {
      setBenchmark({
        clipId: 'clip-1',
        peakMotionScore: 0.05,
        avgMotionScore: 0.03,
        peakAudioScore: 0.08,
        avgAudioScore: 0.05,
        timestamp: Date.now(),
      })

      expect(hasBenchmark()).toBe(true)
    })
  })

  describe('getBenchmarkAge', () => {
    it('returns 0 when no benchmark is set', () => {
      expect(getBenchmarkAge()).toBe(0)
    })

    it('returns age in milliseconds', () => {
      const timestamp = Date.now() - 5000 // 5 seconds ago
      setBenchmark({
        clipId: 'clip-1',
        peakMotionScore: 0.05,
        avgMotionScore: 0.03,
        peakAudioScore: 0.08,
        avgAudioScore: 0.05,
        timestamp,
      })

      const age = getBenchmarkAge()
      expect(age).toBeGreaterThanOrEqual(5000)
      expect(age).toBeLessThan(6000)
    })
  })

  describe('createBenchmarkData', () => {
    it('creates benchmark data from clip metrics', () => {
      const metrics = createMetrics({
        peakMotionScore: 0.1,
        avgMotionScore: 0.06,
        peakAudioScore: 0.15,
        avgAudioScore: 0.1,
      })

      const data = createBenchmarkData('clip-123', metrics)

      expect(data.clipId).toBe('clip-123')
      expect(data.peakMotionScore).toBe(0.1)
      expect(data.avgMotionScore).toBe(0.06)
      expect(data.peakAudioScore).toBe(0.15)
      expect(data.avgAudioScore).toBe(0.1)
      expect(data.timestamp).toBeGreaterThan(0)
    })
  })

  describe('updateBenchmark', () => {
    it('updates the benchmark with new metrics', () => {
      const initialMetrics = createMetrics({ peakMotionScore: 0.05 })
      setBenchmark(createBenchmarkData('clip-1', initialMetrics))

      const newMetrics = createMetrics({ peakMotionScore: 0.1 })
      updateBenchmark('clip-2', newMetrics)

      const benchmark = getBenchmark()
      expect(benchmark?.clipId).toBe('clip-2')
      expect(benchmark?.peakMotionScore).toBe(0.1)
    })
  })

  describe('compareWithBenchmark', () => {
    describe('when no benchmark is set', () => {
      it('returns shouldStore true with no triggers', () => {
        const metrics = createMetrics()
        const thresholds = createThresholds()

        const result = compareWithBenchmark(metrics, thresholds)

        expect(result.shouldStore).toBe(true)
        expect(result.triggeredBy).toEqual([])
        expect(result.motionDelta).toBe(0)
        expect(result.audioDelta).toBe(0)
      })
    })

    describe('motion delta criterion', () => {
      beforeEach(() => {
        setBenchmark(createBenchmarkData('benchmark', createMetrics({
          peakMotionScore: 0.05,
          peakAudioScore: 0.05,
        })))
      })

      it('triggers when motion delta exceeds threshold (positive)', () => {
        const metrics = createMetrics({ peakMotionScore: 0.08 }) // delta = 0.03
        const thresholds = createThresholds({ motionDeltaThreshold: 0.02 })

        const result = compareWithBenchmark(metrics, thresholds)

        expect(result.shouldStore).toBe(true)
        expect(result.triggeredBy).toContain('motionDelta')
        expect(result.motionDelta).toBeCloseTo(0.03)
      })

      it('triggers when motion delta exceeds threshold (negative)', () => {
        const metrics = createMetrics({ peakMotionScore: 0.02 }) // delta = -0.03
        const thresholds = createThresholds({ motionDeltaThreshold: 0.02 })

        const result = compareWithBenchmark(metrics, thresholds)

        expect(result.shouldStore).toBe(true)
        expect(result.triggeredBy).toContain('motionDelta')
        expect(result.motionDelta).toBeCloseTo(-0.03)
      })

      it('does not trigger when motion delta is below threshold', () => {
        const metrics = createMetrics({ peakMotionScore: 0.06 }) // delta = 0.01
        const thresholds = createThresholds({
          motionDeltaThreshold: 0.02,
          motionAbsoluteThreshold: 0.1, // High so it won't trigger
        })

        const result = compareWithBenchmark(metrics, thresholds)

        expect(result.triggeredBy).not.toContain('motionDelta')
        expect(result.details.motionDeltaExceeds).toBe(false)
      })
    })

    describe('motion absolute criterion', () => {
      beforeEach(() => {
        setBenchmark(createBenchmarkData('benchmark', createMetrics({
          peakMotionScore: 0.05,
        })))
      })

      it('triggers when peak motion exceeds absolute threshold', () => {
        const metrics = createMetrics({ peakMotionScore: 0.08 })
        const thresholds = createThresholds({
          motionDeltaThreshold: 0.5, // High so it won't trigger
          motionAbsoluteThreshold: 0.07,
        })

        const result = compareWithBenchmark(metrics, thresholds)

        expect(result.shouldStore).toBe(true)
        expect(result.triggeredBy).toContain('motionAbsolute')
        expect(result.details.motionAbsoluteExceeds).toBe(true)
      })

      it('does not trigger when peak motion is below absolute threshold', () => {
        const metrics = createMetrics({ peakMotionScore: 0.05 })
        const thresholds = createThresholds({
          motionDeltaThreshold: 0.5, // High so it won't trigger
          motionAbsoluteThreshold: 0.1,
        })

        const result = compareWithBenchmark(metrics, thresholds)

        expect(result.triggeredBy).not.toContain('motionAbsolute')
        expect(result.details.motionAbsoluteExceeds).toBe(false)
      })
    })

    describe('audio delta criterion (optional)', () => {
      beforeEach(() => {
        setBenchmark(createBenchmarkData('benchmark', createMetrics({
          peakAudioScore: 0.1,
        })))
      })

      it('does not trigger when disabled', () => {
        const metrics = createMetrics({ peakAudioScore: 0.2 }) // Large delta
        const thresholds = createThresholds({
          audioDeltaEnabled: false,
          audioDeltaThreshold: 0.05,
          motionDeltaThreshold: 0.5, // High so it won't trigger
          motionAbsoluteThreshold: 0.5, // High so it won't trigger
        })

        const result = compareWithBenchmark(metrics, thresholds)

        expect(result.triggeredBy).not.toContain('audioDelta')
        expect(result.details.audioDeltaExceeds).toBe(false)
      })

      it('triggers when enabled and audio delta exceeds threshold', () => {
        const metrics = createMetrics({ peakAudioScore: 0.2 }) // delta = 0.1
        const thresholds = createThresholds({
          audioDeltaEnabled: true,
          audioDeltaThreshold: 0.05,
          motionDeltaThreshold: 0.5, // High so it won't trigger
          motionAbsoluteThreshold: 0.5, // High so it won't trigger
        })

        const result = compareWithBenchmark(metrics, thresholds)

        expect(result.shouldStore).toBe(true)
        expect(result.triggeredBy).toContain('audioDelta')
        expect(result.details.audioDeltaExceeds).toBe(true)
      })

      it('does not trigger when enabled but delta is below threshold', () => {
        const metrics = createMetrics({ peakAudioScore: 0.12 }) // delta = 0.02
        const thresholds = createThresholds({
          audioDeltaEnabled: true,
          audioDeltaThreshold: 0.05,
          motionDeltaThreshold: 0.5, // High so it won't trigger
          motionAbsoluteThreshold: 0.5, // High so it won't trigger
        })

        const result = compareWithBenchmark(metrics, thresholds)

        expect(result.triggeredBy).not.toContain('audioDelta')
      })
    })

    describe('audio absolute criterion (optional)', () => {
      beforeEach(() => {
        setBenchmark(createBenchmarkData('benchmark', createMetrics()))
      })

      it('does not trigger when disabled', () => {
        const metrics = createMetrics({ peakAudioScore: 0.5 }) // Very loud
        const thresholds = createThresholds({
          audioAbsoluteEnabled: false,
          audioAbsoluteThreshold: 0.1,
          motionDeltaThreshold: 0.5, // High so it won't trigger
          motionAbsoluteThreshold: 0.5, // High so it won't trigger
        })

        const result = compareWithBenchmark(metrics, thresholds)

        expect(result.triggeredBy).not.toContain('audioAbsolute')
        expect(result.details.audioAbsoluteExceeds).toBe(false)
      })

      it('triggers when enabled and audio exceeds absolute threshold', () => {
        const metrics = createMetrics({ peakAudioScore: 0.2 })
        const thresholds = createThresholds({
          audioAbsoluteEnabled: true,
          audioAbsoluteThreshold: 0.15,
          motionDeltaThreshold: 0.5, // High so it won't trigger
          motionAbsoluteThreshold: 0.5, // High so it won't trigger
        })

        const result = compareWithBenchmark(metrics, thresholds)

        expect(result.shouldStore).toBe(true)
        expect(result.triggeredBy).toContain('audioAbsolute')
        expect(result.details.audioAbsoluteExceeds).toBe(true)
      })

      it('does not trigger when enabled but audio is below threshold', () => {
        const metrics = createMetrics({ peakAudioScore: 0.1 })
        const thresholds = createThresholds({
          audioAbsoluteEnabled: true,
          audioAbsoluteThreshold: 0.15,
          motionDeltaThreshold: 0.5, // High so it won't trigger
          motionAbsoluteThreshold: 0.5, // High so it won't trigger
        })

        const result = compareWithBenchmark(metrics, thresholds)

        expect(result.triggeredBy).not.toContain('audioAbsolute')
      })
    })

    describe('multiple criteria combinations', () => {
      beforeEach(() => {
        setBenchmark(createBenchmarkData('benchmark', createMetrics({
          peakMotionScore: 0.05,
          peakAudioScore: 0.05,
        })))
      })

      it('triggers multiple criteria when all conditions are met', () => {
        const metrics = createMetrics({
          peakMotionScore: 0.15, // High motion
          peakAudioScore: 0.2, // High audio
        })
        const thresholds = createThresholds({
          motionDeltaThreshold: 0.02,
          motionAbsoluteThreshold: 0.1,
          audioDeltaEnabled: true,
          audioDeltaThreshold: 0.05,
          audioAbsoluteEnabled: true,
          audioAbsoluteThreshold: 0.15,
        })

        const result = compareWithBenchmark(metrics, thresholds)

        expect(result.shouldStore).toBe(true)
        expect(result.triggeredBy).toContain('motionDelta')
        expect(result.triggeredBy).toContain('motionAbsolute')
        expect(result.triggeredBy).toContain('audioDelta')
        expect(result.triggeredBy).toContain('audioAbsolute')
        expect(result.triggeredBy.length).toBe(4)
      })

      it('stores if only motion criteria trigger', () => {
        const metrics = createMetrics({
          peakMotionScore: 0.15,
          peakAudioScore: 0.05, // Same as benchmark
        })
        const thresholds = createThresholds({
          motionDeltaThreshold: 0.02,
          motionAbsoluteThreshold: 0.1,
          audioDeltaEnabled: true,
          audioDeltaThreshold: 0.5, // High so won't trigger
          audioAbsoluteEnabled: true,
          audioAbsoluteThreshold: 0.5, // High so won't trigger
        })

        const result = compareWithBenchmark(metrics, thresholds)

        expect(result.shouldStore).toBe(true)
        expect(result.triggeredBy).toContain('motionDelta')
        expect(result.triggeredBy).toContain('motionAbsolute')
        expect(result.triggeredBy).not.toContain('audioDelta')
        expect(result.triggeredBy).not.toContain('audioAbsolute')
      })

      it('stores if only audio criteria trigger', () => {
        const metrics = createMetrics({
          peakMotionScore: 0.05, // Same as benchmark
          peakAudioScore: 0.2,
        })
        const thresholds = createThresholds({
          motionDeltaThreshold: 0.5, // High so won't trigger
          motionAbsoluteThreshold: 0.5, // High so won't trigger
          audioDeltaEnabled: true,
          audioDeltaThreshold: 0.05,
          audioAbsoluteEnabled: true,
          audioAbsoluteThreshold: 0.15,
        })

        const result = compareWithBenchmark(metrics, thresholds)

        expect(result.shouldStore).toBe(true)
        expect(result.triggeredBy).not.toContain('motionDelta')
        expect(result.triggeredBy).not.toContain('motionAbsolute')
        expect(result.triggeredBy).toContain('audioDelta')
        expect(result.triggeredBy).toContain('audioAbsolute')
      })

      it('does not store when no criteria trigger', () => {
        const metrics = createMetrics({
          peakMotionScore: 0.05, // Same as benchmark
          peakAudioScore: 0.05, // Same as benchmark
        })
        const thresholds = createThresholds({
          motionDeltaThreshold: 0.1, // High
          motionAbsoluteThreshold: 0.1, // High
          audioDeltaEnabled: true,
          audioDeltaThreshold: 0.1,
          audioAbsoluteEnabled: true,
          audioAbsoluteThreshold: 0.1,
        })

        const result = compareWithBenchmark(metrics, thresholds)

        expect(result.shouldStore).toBe(false)
        expect(result.triggeredBy).toEqual([])
      })
    })

    describe('delta calculations', () => {
      it('calculates correct positive deltas', () => {
        setBenchmark(createBenchmarkData('benchmark', createMetrics({
          peakMotionScore: 0.05,
          peakAudioScore: 0.08,
        })))

        const metrics = createMetrics({
          peakMotionScore: 0.1,
          peakAudioScore: 0.15,
        })
        const thresholds = createThresholds()

        const result = compareWithBenchmark(metrics, thresholds)

        expect(result.motionDelta).toBeCloseTo(0.05)
        expect(result.audioDelta).toBeCloseTo(0.07)
      })

      it('calculates correct negative deltas', () => {
        setBenchmark(createBenchmarkData('benchmark', createMetrics({
          peakMotionScore: 0.1,
          peakAudioScore: 0.15,
        })))

        const metrics = createMetrics({
          peakMotionScore: 0.05,
          peakAudioScore: 0.08,
        })
        const thresholds = createThresholds()

        const result = compareWithBenchmark(metrics, thresholds)

        expect(result.motionDelta).toBeCloseTo(-0.05)
        expect(result.audioDelta).toBeCloseTo(-0.07)
      })
    })
  })
})
