import { useCallback, useRef, useState } from 'react'
import { computeMotionScore } from '../motion'

const FRAME_WIDTH = 160
const FRAME_HEIGHT = 90
const MOTION_DIFF_THRESHOLD = 30

export type MotionDetectionState = {
  currentScore: number
  getScore: () => number
  setup: (stream: MediaStream) => void
  cleanup: () => void
}

export const useMotionDetection = (): MotionDetectionState => {
  const [currentScore, setCurrentScore] = useState(0)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const canvasCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const prevFrameRef = useRef<Uint8ClampedArray | null>(null)
  const scoreRef = useRef(0)

  const getScore = useCallback(() => {
    const video = videoRef.current
    const ctx = canvasCtxRef.current

    if (!video || !ctx || video.readyState < 2) {
      return scoreRef.current
    }

    try {
      ctx.drawImage(video, 0, 0, FRAME_WIDTH, FRAME_HEIGHT)
      const imageData = ctx.getImageData(0, 0, FRAME_WIDTH, FRAME_HEIGHT)
      const currFrame = imageData.data

      if (prevFrameRef.current) {
        const score = computeMotionScore(
          prevFrameRef.current,
          currFrame,
          MOTION_DIFF_THRESHOLD
        )
        scoreRef.current = score
        setCurrentScore(score)
      }

      prevFrameRef.current = new Uint8ClampedArray(currFrame)
    } catch (err) {
      console.warn('[useMotionDetection] Error:', err)
    }

    return scoreRef.current
  }, [])

  const setup = useCallback((stream: MediaStream) => {
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    video.autoplay = true
    videoRef.current = video

    const canvas = document.createElement('canvas')
    canvas.width = FRAME_WIDTH
    canvas.height = FRAME_HEIGHT
    canvasRef.current = canvas

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    canvasCtxRef.current = ctx

    video.play().catch((err) => {
      console.warn('[useMotionDetection] Video play failed:', err)
    })

    console.log('[useMotionDetection] Setup complete')
  }, [])

  const cleanup = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = null
      videoRef.current = null
    }
    canvasRef.current = null
    canvasCtxRef.current = null
    prevFrameRef.current = null
    scoreRef.current = 0
    setCurrentScore(0)
  }, [])

  return { currentScore, getScore, setup, cleanup }
}
