import { afterEach, describe, expect, it, vi } from 'vitest'
import { MotionGate, computeMotionScore, startMotionTrigger } from './motion'

describe('computeMotionScore', () => {
  it('returns fraction of pixels above threshold', () => {
    const prev = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255])
    const curr = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255])

    const score = computeMotionScore(prev, curr, 50)

    expect(score).toBeCloseTo(0.5)
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
