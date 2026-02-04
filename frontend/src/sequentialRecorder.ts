/**
 * Sequential Recorder
 *
 * Records independent fixed-length clips with seamless transitions.
 * Each clip uses a fresh MediaRecorder instance to create self-contained WebM files.
 * Tracks real-time motion and audio metrics during recording.
 */

export type ClipMetrics = {
  peakMotionScore: number
  avgMotionScore: number
  motionEventCount: number  // Frames where motion exceeded threshold
  peakAudioScore: number
  avgAudioScore: number
}

export type ClipCompleteData = {
  blob: Blob
  clipIndex: number
  startTime: number
  metrics: ClipMetrics
}

export type SequentialRecorderOptions = {
  stream: MediaStream
  clipDurationMs: number
  mimeType?: string
  // Callbacks to get current motion/audio scores (called during recording)
  getMotionScore?: () => number
  getAudioScore?: () => number
  // Threshold for counting motion events
  motionEventThreshold?: number
  // How often to sample motion/audio (default 500ms)
  samplingIntervalMs?: number
  onClipComplete: (data: ClipCompleteData) => void
  onError?: (error: Error) => void
}

export type SequentialRecorderState = {
  isRecording: boolean
  currentClipIndex: number
  currentMetrics: ClipMetrics | null
}

const EMPTY_METRICS: ClipMetrics = {
  peakMotionScore: 0,
  avgMotionScore: 0,
  motionEventCount: 0,
  peakAudioScore: 0,
  avgAudioScore: 0,
}

export class SequentialRecorder {
  private stream: MediaStream
  private clipDurationMs: number
  private mimeType: string
  private getMotionScore: () => number
  private getAudioScore: () => number
  private motionEventThreshold: number
  private samplingIntervalMs: number
  private onClipComplete: (data: ClipCompleteData) => void
  private onError: (error: Error) => void

  private currentRecorder: MediaRecorder | null = null
  private currentChunks: Blob[] = []
  private currentClipIndex = 0
  private currentClipStartTime = 0
  private clipTimer: number | null = null
  private samplingTimer: number | null = null
  private isRecording = false
  private isStopping = false
  private pendingStopResolve: ((blob: Blob | null) => void) | null = null

  // Real-time metrics tracking for current clip
  private currentMetrics: ClipMetrics = { ...EMPTY_METRICS }
  private motionSamples: number[] = []
  private audioSamples: number[] = []

  constructor(options: SequentialRecorderOptions) {
    this.stream = options.stream
    this.clipDurationMs = options.clipDurationMs
    this.getMotionScore = options.getMotionScore ?? (() => 0)
    this.getAudioScore = options.getAudioScore ?? (() => 0)
    this.motionEventThreshold = options.motionEventThreshold ?? 0.02
    this.samplingIntervalMs = options.samplingIntervalMs ?? 500
    this.onClipComplete = options.onClipComplete
    this.onError = options.onError ?? (() => {})

    // Determine best supported MIME type
    const preferredTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ]
    this.mimeType = options.mimeType ??
      preferredTypes.find((type) => MediaRecorder.isTypeSupported(type)) ??
      'video/webm'
  }

  /**
   * Start sequential recording
   */
  start(): void {
    if (this.isRecording) {
      console.warn('[SequentialRecorder] Already recording')
      return
    }

    this.isRecording = true
    this.isStopping = false
    this.currentClipIndex = 0
    this.startNextClip()
  }

  /**
   * Stop recording and return the final partial clip (if any)
   */
  async stop(): Promise<Blob | null> {
    if (!this.isRecording) {
      return null
    }

    this.isStopping = true
    this.isRecording = false

    // Clear timers
    if (this.clipTimer !== null) {
      window.clearTimeout(this.clipTimer)
      this.clipTimer = null
    }
    if (this.samplingTimer !== null) {
      window.clearInterval(this.samplingTimer)
      this.samplingTimer = null
    }

    // Stop the current recorder and wait for final data
    if (this.currentRecorder && this.currentRecorder.state !== 'inactive') {
      return new Promise((resolve) => {
        this.pendingStopResolve = resolve
        this.currentRecorder!.stop()
      })
    }

    return null
  }

  /**
   * Update clip duration for future clips
   */
  setClipDuration(durationMs: number): void {
    this.clipDurationMs = Math.max(1000, Math.min(30000, durationMs))
  }

  /**
   * Update motion event threshold
   */
  setMotionEventThreshold(threshold: number): void {
    this.motionEventThreshold = threshold
  }

  /**
   * Get current recorder state
   */
  getState(): SequentialRecorderState {
    return {
      isRecording: this.isRecording,
      currentClipIndex: this.currentClipIndex,
      currentMetrics: this.isRecording ? { ...this.currentMetrics } : null,
    }
  }

  private resetMetrics(): void {
    this.currentMetrics = { ...EMPTY_METRICS }
    this.motionSamples = []
    this.audioSamples = []
  }

  private sampleMetrics(): void {
    const motionScore = this.getMotionScore()
    const audioScore = this.getAudioScore()

    this.motionSamples.push(motionScore)
    this.audioSamples.push(audioScore)

    // Update peak values
    if (motionScore > this.currentMetrics.peakMotionScore) {
      this.currentMetrics.peakMotionScore = motionScore
    }
    if (audioScore > this.currentMetrics.peakAudioScore) {
      this.currentMetrics.peakAudioScore = audioScore
    }

    // Count motion events (frames exceeding threshold)
    if (motionScore >= this.motionEventThreshold) {
      this.currentMetrics.motionEventCount += 1
    }

    // Update averages
    this.currentMetrics.avgMotionScore =
      this.motionSamples.reduce((a, b) => a + b, 0) / this.motionSamples.length
    this.currentMetrics.avgAudioScore =
      this.audioSamples.reduce((a, b) => a + b, 0) / this.audioSamples.length
  }

  private startMetricsSampling(): void {
    // Take initial sample
    this.sampleMetrics()

    // Start periodic sampling
    this.samplingTimer = window.setInterval(() => {
      this.sampleMetrics()
    }, this.samplingIntervalMs)
  }

  private stopMetricsSampling(): ClipMetrics {
    if (this.samplingTimer !== null) {
      window.clearInterval(this.samplingTimer)
      this.samplingTimer = null
    }

    // Take final sample
    this.sampleMetrics()

    return { ...this.currentMetrics }
  }

  private startNextClip(): void {
    if (!this.isRecording || this.isStopping) {
      return
    }

    // Reset for new clip
    this.currentChunks = []
    this.resetMetrics()

    try {
      // Create a fresh MediaRecorder for this clip
      this.currentRecorder = new MediaRecorder(
        this.stream,
        { mimeType: this.mimeType }
      )

      this.currentRecorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          this.currentChunks.push(event.data)
        }
      })

      this.currentRecorder.addEventListener('stop', () => {
        this.handleRecorderStop()
      })

      this.currentRecorder.addEventListener('error', (event) => {
        const error = event instanceof ErrorEvent ? event.error : new Error('MediaRecorder error')
        this.onError(error)
      })

      // Record clip start time
      this.currentClipStartTime = Date.now()

      // Start recording - request data every 500ms for smoother chunks
      this.currentRecorder.start(500)

      // Start metrics sampling
      this.startMetricsSampling()

      // Schedule clip completion
      this.clipTimer = window.setTimeout(() => {
        this.completeCurrentClip()
      }, this.clipDurationMs)

      console.log(`[SequentialRecorder] Started clip #${this.currentClipIndex}`, {
        durationMs: this.clipDurationMs,
        mimeType: this.mimeType,
      })
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to start recorder')
      this.onError(error)
      this.isRecording = false
    }
  }

  private completeCurrentClip(): void {
    if (this.clipTimer !== null) {
      window.clearTimeout(this.clipTimer)
      this.clipTimer = null
    }

    if (this.currentRecorder && this.currentRecorder.state !== 'inactive') {
      // Stop will trigger the 'stop' event handler
      this.currentRecorder.stop()
    }
  }

  private handleRecorderStop(): void {
    // Finalize metrics
    const metrics = this.stopMetricsSampling()

    // Build the clip blob from collected chunks
    const blob = this.currentChunks.length > 0
      ? new Blob(this.currentChunks, { type: this.mimeType })
      : null

    const clipIndex = this.currentClipIndex
    const startTime = this.currentClipStartTime

    // Clean up
    this.currentChunks = []
    this.currentRecorder = null

    console.log(`[SequentialRecorder] Clip #${clipIndex} metrics:`, {
      peakMotion: metrics.peakMotionScore.toFixed(4),
      avgMotion: metrics.avgMotionScore.toFixed(4),
      motionEvents: metrics.motionEventCount,
      peakAudio: metrics.peakAudioScore.toFixed(4),
      avgAudio: metrics.avgAudioScore.toFixed(4),
      samples: this.motionSamples.length,
    })

    if (this.isStopping) {
      // Final clip from stop() call
      if (this.pendingStopResolve) {
        this.pendingStopResolve(blob)
        this.pendingStopResolve = null
      }
      // Still emit the final clip if it has data
      if (blob && blob.size > 0) {
        console.log(`[SequentialRecorder] Final clip #${clipIndex} completed`, {
          sizeBytes: blob.size,
        })
        this.onClipComplete({ blob, clipIndex, startTime, metrics })
      }
      return
    }

    // Emit completed clip
    if (blob && blob.size > 0) {
      console.log(`[SequentialRecorder] Clip #${clipIndex} completed`, {
        sizeBytes: blob.size,
        durationMs: Date.now() - startTime,
      })
      this.onClipComplete({ blob, clipIndex, startTime, metrics })
    }

    // Move to next clip
    this.currentClipIndex += 1

    // Start the next clip immediately for seamless transition
    this.startNextClip()
  }
}

/**
 * Factory function for creating a sequential recorder
 */
export const createSequentialRecorder = (
  options: SequentialRecorderOptions
): SequentialRecorder => {
  return new SequentialRecorder(options)
}
