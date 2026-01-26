import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioGate, computeAudioRms, startAudioTrigger } from './audio'

describe('computeAudioRms', () => {
  it('returns 0 for empty buffers', () => {
    const score = computeAudioRms(new Float32Array())
    expect(score).toBe(0)
  })

  it('computes RMS magnitude for samples', () => {
    const score = computeAudioRms(new Float32Array([1, -1, 1, -1]))
    expect(score).toBeCloseTo(1)
  })
})

describe('AudioGate', () => {
  it('triggers after consecutive hits and respects cooldown', () => {
    const gate = new AudioGate({ threshold: 0.3, consecutive: 2, cooldownMs: 500 })

    expect(gate.shouldTrigger(0.1, 0)).toBe(false)
    expect(gate.shouldTrigger(0.4, 100)).toBe(false)
    expect(gate.shouldTrigger(0.5, 150)).toBe(true)
    expect(gate.shouldTrigger(0.6, 300)).toBe(false)
    expect(gate.shouldTrigger(0.6, 700)).toBe(false)
    expect(gate.shouldTrigger(0.6, 760)).toBe(true)
  })
})

describe('startAudioTrigger', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('invokes onTrigger when scores exceed threshold', () => {
    vi.useFakeTimers()
    const scores = [0.1, 0.4, 0.6]
    const onTrigger = vi.fn()

    const trigger = startAudioTrigger({
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
