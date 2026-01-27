type AudioGateOptions = {
  threshold: number
  consecutive: number
  cooldownMs: number
}

export class AudioGate {
  private readonly threshold: number
  private readonly consecutive: number
  private readonly cooldownMs: number
  private hitCount = 0
  private lastTriggerMs = Number.NEGATIVE_INFINITY

  constructor(options: AudioGateOptions) {
    this.threshold = options.threshold
    this.consecutive = options.consecutive
    this.cooldownMs = options.cooldownMs
  }

  shouldTrigger(score: number, nowMs: number) {
    if (nowMs - this.lastTriggerMs < this.cooldownMs) {
      return false
    }

    if (score >= this.threshold) {
      this.hitCount += 1
    } else {
      this.hitCount = 0
    }

    if (this.hitCount >= this.consecutive) {
      this.hitCount = 0
      this.lastTriggerMs = nowMs
      return true
    }

    return false
  }
}

export const computeAudioRms = (samples: Float32Array) => {
  if (samples.length === 0) {
    return 0
  }

  let sumSquares = 0
  for (const sample of samples) {
    sumSquares += sample * sample
  }

  return Math.sqrt(sumSquares / samples.length)
}

type AudioTriggerOptions = AudioGateOptions & {
  intervalMs: number
  getScore: () => number
  onTrigger: () => void
}

export const startAudioTrigger = (options: AudioTriggerOptions) => {
  const gate = new AudioGate({
    threshold: options.threshold,
    consecutive: options.consecutive,
    cooldownMs: options.cooldownMs,
  })

  const interval = window.setInterval(() => {
    const score = options.getScore()
    if (gate.shouldTrigger(score, Date.now())) {
      options.onTrigger()
    }
  }, options.intervalMs)

  return {
    stop: () => window.clearInterval(interval),
  }
}
