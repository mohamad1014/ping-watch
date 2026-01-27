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

type MotionRegion = {
  x: number
  y: number
  width: number
  height: number
  frameWidth: number
  frameHeight: number
}

export type MotionMetrics = {
  score: number
  brightnessDelta: number
}

export const computeMotionScoreInRegion = (
  prev: Uint8ClampedArray,
  curr: Uint8ClampedArray,
  diffThreshold: number,
  region: MotionRegion
) => {
  if (prev.length !== curr.length) {
    return 0
  }

  const startX = Math.max(0, Math.floor(region.x))
  const startY = Math.max(0, Math.floor(region.y))
  const endX = Math.min(
    region.frameWidth,
    Math.floor(region.x + region.width)
  )
  const endY = Math.min(
    region.frameHeight,
    Math.floor(region.y + region.height)
  )

  const width = Math.max(0, endX - startX)
  const height = Math.max(0, endY - startY)
  const totalPixels = width * height
  if (totalPixels === 0) {
    return 0
  }

  let changed = 0
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const index = (y * region.frameWidth + x) * 4
      const dr = Math.abs(curr[index] - prev[index])
      const dg = Math.abs(curr[index + 1] - prev[index + 1])
      const db = Math.abs(curr[index + 2] - prev[index + 2])
      if (dr + dg + db > diffThreshold) {
        changed += 1
      }
    }
  }

  return changed / totalPixels
}

export const computeMotionMetricsInRegion = (
  prev: Uint8ClampedArray,
  curr: Uint8ClampedArray,
  diffThreshold: number,
  region: MotionRegion
): MotionMetrics => {
  if (prev.length !== curr.length) {
    return { score: 0, brightnessDelta: 0 }
  }

  const startX = Math.max(0, Math.floor(region.x))
  const startY = Math.max(0, Math.floor(region.y))
  const endX = Math.min(
    region.frameWidth,
    Math.floor(region.x + region.width)
  )
  const endY = Math.min(
    region.frameHeight,
    Math.floor(region.y + region.height)
  )

  const width = Math.max(0, endX - startX)
  const height = Math.max(0, endY - startY)
  const totalPixels = width * height
  if (totalPixels === 0) {
    return { score: 0, brightnessDelta: 0 }
  }

  let changed = 0
  let deltaSum = 0
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const index = (y * region.frameWidth + x) * 4
      const dr = Math.abs(curr[index] - prev[index])
      const dg = Math.abs(curr[index + 1] - prev[index + 1])
      const db = Math.abs(curr[index + 2] - prev[index + 2])
      const delta = (dr + dg + db) / 3
      deltaSum += delta
      if (dr + dg + db > diffThreshold) {
        changed += 1
      }
    }
  }

  return {
    score: changed / totalPixels,
    brightnessDelta: deltaSum / totalPixels,
  }
}

type MotionGateFilters = {
  minScore: number
  brightnessThreshold: number
}

export const applyMotionGates = (
  metrics: MotionMetrics,
  filters: MotionGateFilters
) => {
  if (metrics.brightnessDelta > filters.brightnessThreshold) {
    return 0
  }

  if (metrics.score < filters.minScore) {
    return 0
  }

  return metrics.score
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
