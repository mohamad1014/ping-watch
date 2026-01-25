type MotionGateOptions = {
  threshold: number
  consecutive: number
  cooldownMs: number
}

export class MotionGate {
  private readonly threshold: number
  private readonly consecutive: number
  private readonly cooldownMs: number
  private hitCount = 0
  private lastTriggerMs = Number.NEGATIVE_INFINITY

  constructor(options: MotionGateOptions) {
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

export const computeMotionScore = (
  prev: Uint8ClampedArray,
  curr: Uint8ClampedArray,
  diffThreshold: number
) => {
  if (prev.length !== curr.length) {
    return 0
  }

  const totalPixels = Math.floor(prev.length / 4)
  if (totalPixels === 0) {
    return 0
  }

  let changed = 0
  for (let i = 0; i < prev.length; i += 4) {
    const dr = Math.abs(curr[i] - prev[i])
    const dg = Math.abs(curr[i + 1] - prev[i + 1])
    const db = Math.abs(curr[i + 2] - prev[i + 2])
    if (dr + dg + db > diffThreshold) {
      changed += 1
    }
  }

  return changed / totalPixels
}

type MotionTriggerOptions = MotionGateOptions & {
  intervalMs: number
  getScore: () => number
  onTrigger: () => void
}

export const startMotionTrigger = (options: MotionTriggerOptions) => {
  const gate = new MotionGate({
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
