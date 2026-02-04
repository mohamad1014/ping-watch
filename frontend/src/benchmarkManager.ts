/**
 * Benchmark Manager
 *
 * Stores benchmark data from the first clip and handles comparison
 * with subsequent clips using multiple criteria:
 * - Motion delta (vs benchmark)
 * - Motion absolute (peak motion exceeds threshold)
 * - Audio delta (vs benchmark) - optional
 * - Audio absolute (peak audio exceeds threshold) - optional
 */

import type { ClipMetrics } from './sequentialRecorder'

export type BenchmarkData = {
  clipId: string
  peakMotionScore: number
  avgMotionScore: number
  peakAudioScore: number
  avgAudioScore: number
  timestamp: number
}

export type TriggerReason = 'motionDelta' | 'motionAbsolute' | 'audioDelta' | 'audioAbsolute'

export type ComparisonResult = {
  shouldStore: boolean
  triggeredBy: TriggerReason[]
  motionDelta: number
  audioDelta: number
  details: {
    motionDeltaExceeds: boolean
    motionAbsoluteExceeds: boolean
    audioDeltaExceeds: boolean
    audioAbsoluteExceeds: boolean
  }
}

export type ComparisonThresholds = {
  // Motion thresholds (always enabled)
  motionDeltaThreshold: number       // Delta from benchmark to trigger
  motionAbsoluteThreshold: number    // Absolute peak motion to trigger

  // Audio thresholds (optional)
  audioDeltaEnabled: boolean         // Whether audio delta comparison is enabled
  audioDeltaThreshold: number        // Delta from benchmark to trigger
  audioAbsoluteEnabled: boolean      // Whether audio absolute threshold is enabled
  audioAbsoluteThreshold: number     // Absolute peak audio to trigger (loud sound)
}

// Session-scoped benchmark storage
let currentBenchmark: BenchmarkData | null = null

/**
 * Set the benchmark clip data
 */
export const setBenchmark = (data: BenchmarkData): void => {
  currentBenchmark = {
    ...data,
    timestamp: data.timestamp ?? Date.now(),
  }

  console.log('[BenchmarkManager] Benchmark set:', {
    clipId: data.clipId,
    peakMotion: data.peakMotionScore.toFixed(4),
    avgMotion: data.avgMotionScore.toFixed(4),
    peakAudio: data.peakAudioScore.toFixed(4),
    avgAudio: data.avgAudioScore.toFixed(4),
  })
}

/**
 * Get the current benchmark
 */
export const getBenchmark = (): BenchmarkData | null => {
  return currentBenchmark
}

/**
 * Clear the current benchmark
 */
export const clearBenchmark = (): void => {
  currentBenchmark = null
  console.log('[BenchmarkManager] Benchmark cleared')
}

/**
 * Compare clip metrics against the benchmark using multiple criteria
 *
 * Returns whether the clip should be stored and which criteria triggered it.
 * A clip is stored if ANY enabled criterion is triggered.
 */
export const compareWithBenchmark = (
  metrics: ClipMetrics,
  thresholds: ComparisonThresholds
): ComparisonResult => {
  if (!currentBenchmark) {
    // No benchmark set - this is the first clip, always store
    return {
      shouldStore: true,
      triggeredBy: [],
      motionDelta: 0,
      audioDelta: 0,
      details: {
        motionDeltaExceeds: false,
        motionAbsoluteExceeds: false,
        audioDeltaExceeds: false,
        audioAbsoluteExceeds: false,
      },
    }
  }

  // Calculate deltas (using peak scores for comparison)
  const motionDelta = metrics.peakMotionScore - currentBenchmark.peakMotionScore
  const audioDelta = metrics.peakAudioScore - currentBenchmark.peakAudioScore

  // Check each criterion
  const triggeredBy: TriggerReason[] = []

  // 1. Motion delta - significant change from benchmark (either direction)
  const motionDeltaExceeds = Math.abs(motionDelta) >= thresholds.motionDeltaThreshold
  if (motionDeltaExceeds) {
    triggeredBy.push('motionDelta')
  }

  // 2. Motion absolute - peak motion exceeds absolute threshold (something moved)
  const motionAbsoluteExceeds = metrics.peakMotionScore >= thresholds.motionAbsoluteThreshold
  if (motionAbsoluteExceeds) {
    triggeredBy.push('motionAbsolute')
  }

  // 3. Audio delta (optional) - significant change from benchmark
  const audioDeltaExceeds = thresholds.audioDeltaEnabled &&
    Math.abs(audioDelta) >= thresholds.audioDeltaThreshold
  if (audioDeltaExceeds) {
    triggeredBy.push('audioDelta')
  }

  // 4. Audio absolute (optional) - peak audio exceeds threshold (loud sound)
  const audioAbsoluteExceeds = thresholds.audioAbsoluteEnabled &&
    metrics.peakAudioScore >= thresholds.audioAbsoluteThreshold
  if (audioAbsoluteExceeds) {
    triggeredBy.push('audioAbsolute')
  }

  const shouldStore = triggeredBy.length > 0

  console.log('[BenchmarkManager] Comparison result:', {
    shouldStore,
    triggeredBy,
    peakMotion: metrics.peakMotionScore.toFixed(4),
    benchmarkPeakMotion: currentBenchmark.peakMotionScore.toFixed(4),
    motionDelta: motionDelta.toFixed(4),
    peakAudio: metrics.peakAudioScore.toFixed(4),
    benchmarkPeakAudio: currentBenchmark.peakAudioScore.toFixed(4),
    audioDelta: audioDelta.toFixed(4),
    thresholds: {
      motionDelta: thresholds.motionDeltaThreshold,
      motionAbsolute: thresholds.motionAbsoluteThreshold,
      audioDelta: thresholds.audioDeltaEnabled ? thresholds.audioDeltaThreshold : 'disabled',
      audioAbsolute: thresholds.audioAbsoluteEnabled ? thresholds.audioAbsoluteThreshold : 'disabled',
    },
  })

  return {
    shouldStore,
    triggeredBy,
    motionDelta,
    audioDelta,
    details: {
      motionDeltaExceeds,
      motionAbsoluteExceeds,
      audioDeltaExceeds,
      audioAbsoluteExceeds,
    },
  }
}

/**
 * Create benchmark data from clip metrics
 */
export const createBenchmarkData = (
  clipId: string,
  metrics: ClipMetrics
): BenchmarkData => {
  return {
    clipId,
    peakMotionScore: metrics.peakMotionScore,
    avgMotionScore: metrics.avgMotionScore,
    peakAudioScore: metrics.peakAudioScore,
    avgAudioScore: metrics.avgAudioScore,
    timestamp: Date.now(),
  }
}

/**
 * Update the benchmark with new clip data (for progressive baseline updates)
 */
export const updateBenchmark = (
  clipId: string,
  metrics: ClipMetrics
): void => {
  setBenchmark(createBenchmarkData(clipId, metrics))
}

/**
 * Check if a benchmark is currently set
 */
export const hasBenchmark = (): boolean => {
  return currentBenchmark !== null
}

/**
 * Get benchmark age in milliseconds
 */
export const getBenchmarkAge = (): number => {
  if (!currentBenchmark) {
    return 0
  }
  return Date.now() - currentBenchmark.timestamp
}
