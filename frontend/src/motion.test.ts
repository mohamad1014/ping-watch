import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MotionGate,
  applyMotionGates,
  computeMotionScore,
  computeMotionScoreInRegion,
  computeMotionMetricsInRegion,
  startMotionTrigger,
} from './motion'

describe('computeMotionScore', () => {
  it('returns fraction of pixels above threshold', () => {
    const prev = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255])
    const curr = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255])

    const score = computeMotionScore(prev, curr, 50)

    expect(score).toBeCloseTo(0.5)
  })
})

describe('computeMotionScoreInRegion', () => {
  it('ignores pixels outside the ROI', () => {
    const prev = new Uint8ClampedArray([
      0, 0, 0, 255, 0, 0, 0, 255,
      0, 0, 0, 255, 0, 0, 0, 255,
    ])
    const curr = new Uint8ClampedArray([
      255, 255, 255, 255, 0, 0, 0, 255,
      255, 255, 255, 255, 0, 0, 0, 255,
    ])

    const score = computeMotionScoreInRegion(prev, curr, 50, {
      x: 1,
      y: 0,
      width: 1,
      height: 2,
      frameWidth: 2,
      frameHeight: 2,
    })

    expect(score).toBe(0)
  })
})

describe('computeMotionMetricsInRegion', () => {
  it('returns score and average brightness delta', () => {
    const prev = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255])
    const curr = new Uint8ClampedArray([100, 100, 100, 255, 100, 100, 100, 255])

    const metrics = computeMotionMetricsInRegion(prev, curr, 10, {
      x: 0,
      y: 0,
      width: 2,
      height: 1,
      frameWidth: 2,
      frameHeight: 1,
    })

    expect(metrics.score).toBeCloseTo(1)
    expect(metrics.brightnessDelta).toBeCloseTo(100)
  })
})

describe('applyMotionGates', () => {
  it('returns 0 when brightness shifts exceed gate', () => {
    const score = applyMotionGates(
      { score: 0.4, brightnessDelta: 80 },
      { minScore: 0.05, brightnessThreshold: 40 }
    )

    expect(score).toBe(0)
  })

  it('returns 0 when score is below minScore', () => {
    const score = applyMotionGates(
      { score: 0.02, brightnessDelta: 5 },
      { minScore: 0.05, brightnessThreshold: 40 }
    )

    expect(score).toBe(0)
  })
})

describe('MotionGate', () => {
  it('triggers after consecutive hits and respects cooldown', () => {
    const gate = new MotionGate({ threshold: 0.2, consecutive: 2, cooldownMs: 1000 })

    expect(gate.shouldTrigger(0.1, 0)).toBe(false)
    expect(gate.shouldTrigger(0.3, 100)).toBe(false)
    expect(gate.shouldTrigger(0.3, 200)).toBe(true)
    expect(gate.shouldTrigger(0.3, 500)).toBe(false)
    expect(gate.shouldTrigger(0.3, 1300)).toBe(false)
    expect(gate.shouldTrigger(0.3, 1400)).toBe(true)
  })
})

describe('startMotionTrigger', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('invokes onTrigger when scores exceed threshold', async () => {
    vi.useFakeTimers()
    const scores = [0.05, 0.4, 0.5]
    const onTrigger = vi.fn()
    const trigger = startMotionTrigger({
      getScore: () => scores.shift() ?? 0,
      intervalMs: 100,
      threshold: 0.3,
      consecutive: 2,
      cooldownMs: 1000,
      onTrigger,
    })

    vi.advanceTimersByTime(300)

    expect(onTrigger).toHaveBeenCalledTimes(1)
    trigger.stop()
  })
})
