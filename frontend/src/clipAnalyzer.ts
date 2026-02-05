/**
 * Clip Analyzer
 *
 * Extracts frames from completed video clips and computes motion/audio scores.
 * Reuses the stateless functions from motion.ts and audio.ts.
 */

import { computeMotionMetricsInRegion } from './motion'
import { computeAudioRms } from './audio'

export type FrameData = {
  timestamp: number
  data: Uint8ClampedArray
  width: number
  height: number
}

export type ClipAnalysisResult = {
  motionScore: number
  audioScore: number
  frameCount: number
  durationMs: number
  frames: FrameData[]
}

export type ClipAnalysisOptions = {
  frameIntervalMs?: number  // default 500ms
  width?: number            // default 160
  height?: number           // default 90
  motionDiffThreshold?: number // default 30
}

const DEFAULT_OPTIONS: Required<ClipAnalysisOptions> = {
  frameIntervalMs: 500,
  width: 160,
  height: 90,
  motionDiffThreshold: 30,
}

/**
 * Extract frames from a video blob at regular intervals
 */
export const extractFramesFromBlob = async (
  blob: Blob,
  options: ClipAnalysisOptions = {}
): Promise<FrameData[]> => {
  const { frameIntervalMs, width, height } = { ...DEFAULT_OPTIONS, ...options }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    if (!ctx) {
      URL.revokeObjectURL(url)
      reject(new Error('Could not get canvas context'))
      return
    }

    canvas.width = width
    canvas.height = height

    const frames: FrameData[] = []
    let currentTime = 0
    let hasError = false

    video.muted = true
    video.playsInline = true

    const cleanup = () => {
      URL.revokeObjectURL(url)
      video.src = ''
      video.load()
    }

    video.addEventListener('loadedmetadata', () => {
      if (video.duration === 0 || !Number.isFinite(video.duration)) {
        cleanup()
        resolve([])
        return
      }

      // Set first seek position
      video.currentTime = 0
    })

    video.addEventListener('seeked', () => {
      if (hasError) return

      // Capture frame at current position
      try {
        ctx.drawImage(video, 0, 0, width, height)
        const imageData = ctx.getImageData(0, 0, width, height)

        frames.push({
          timestamp: video.currentTime * 1000, // Convert to ms
          data: imageData.data,
          width,
          height,
        })
      } catch (err) {
        console.warn('[ClipAnalyzer] Failed to capture frame:', err)
      }

      // Move to next frame position
      currentTime += frameIntervalMs / 1000
      if (currentTime < video.duration) {
        video.currentTime = currentTime
      } else {
        // All frames captured
        cleanup()
        resolve(frames)
      }
    })

    video.addEventListener('error', () => {
      hasError = true
      cleanup()
      const errorCode = video.error?.code ?? 0
      const errorMessage = video.error?.message ?? 'Unknown video error'
      reject(new Error(`Video load error (${errorCode}): ${errorMessage}`))
    })

    // Handle case where video has no seekable duration
    video.addEventListener('canplay', () => {
      if (video.duration === Infinity || video.duration === 0) {
        // Try to capture at least one frame
        try {
          ctx.drawImage(video, 0, 0, width, height)
          const imageData = ctx.getImageData(0, 0, width, height)
          frames.push({
            timestamp: 0,
            data: imageData.data,
            width,
            height,
          })
        } catch (err) {
          console.warn('[ClipAnalyzer] Failed to capture frame from non-seekable video:', err)
        }
        cleanup()
        resolve(frames)
      }
    })

    video.src = url
    video.load()
  })
}

/**
 * Compute motion score by comparing consecutive frames
 */
export const computeFrameMotionScores = (
  frames: FrameData[],
  diffThreshold: number = DEFAULT_OPTIONS.motionDiffThreshold
): number[] => {
  if (frames.length < 2) {
    return []
  }

  const scores: number[] = []

  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1]
    const curr = frames[i]

    if (prev.width !== curr.width || prev.height !== curr.height) {
      scores.push(0)
      continue
    }

    const metrics = computeMotionMetricsInRegion(
      prev.data,
      curr.data,
      diffThreshold,
      {
        x: 0,
        y: 0,
        width: curr.width,
        height: curr.height,
        frameWidth: curr.width,
        frameHeight: curr.height,
      }
    )

    scores.push(metrics.score)
  }

  return scores
}

/**
 * Extract audio data from video blob and compute RMS score
 */
export const extractAudioScore = async (blob: Blob): Promise<number> => {
  try {
    const audioContext = new (window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)()

    // Decode audio from the video blob
    const arrayBuffer = await blob.arrayBuffer()
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

    // Get audio samples from the first channel
    const channelData = audioBuffer.getChannelData(0)

    // Compute RMS across the entire clip
    const rms = computeAudioRms(channelData)

    await audioContext.close()
    return rms
  } catch (err) {
    console.warn('[ClipAnalyzer] Failed to extract audio:', err)
    return 0
  }
}

/**
 * Analyze a completed video clip
 *
 * Returns motion and audio scores along with extracted frames for benchmark comparison.
 */
export const analyzeClip = async (
  blob: Blob,
  options: ClipAnalysisOptions = {}
): Promise<ClipAnalysisResult> => {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  // Extract frames in parallel with audio analysis
  const [frames, audioScore] = await Promise.all([
    extractFramesFromBlob(blob, opts).catch((err) => {
      console.warn('[ClipAnalyzer] Frame extraction failed:', err)
      return [] as FrameData[]
    }),
    extractAudioScore(blob),
  ])

  // Compute motion scores between consecutive frames
  const motionScores = computeFrameMotionScores(frames, opts.motionDiffThreshold)

  // Average motion score
  const motionScore = motionScores.length > 0
    ? motionScores.reduce((sum, score) => sum + score, 0) / motionScores.length
    : 0

  // Estimate duration from frames
  const durationMs = frames.length >= 2
    ? frames[frames.length - 1].timestamp - frames[0].timestamp
    : 0

  console.log('[ClipAnalyzer] Analysis complete:', {
    frameCount: frames.length,
    motionScore: motionScore.toFixed(4),
    audioScore: audioScore.toFixed(4),
    durationMs,
  })

  return {
    motionScore,
    audioScore,
    frameCount: frames.length,
    durationMs,
    frames,
  }
}

/**
 * Quick analysis for real-time display (fewer frames, no audio extraction)
 */
export const analyzeClipQuick = async (
  blob: Blob,
  options: ClipAnalysisOptions = {}
): Promise<Omit<ClipAnalysisResult, 'audioScore' | 'frames'> & { audioScore: number }> => {
  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
    frameIntervalMs: 1000, // Less frequent sampling for speed
  }

  const frames = await extractFramesFromBlob(blob, opts).catch(() => [] as FrameData[])
  const motionScores = computeFrameMotionScores(frames, opts.motionDiffThreshold)

  const motionScore = motionScores.length > 0
    ? motionScores.reduce((sum, score) => sum + score, 0) / motionScores.length
    : 0

  const durationMs = frames.length >= 2
    ? frames[frames.length - 1].timestamp - frames[0].timestamp
    : 0

  return {
    motionScore,
    audioScore: 0, // Skip audio for quick analysis
    frameCount: frames.length,
    durationMs,
  }
}
