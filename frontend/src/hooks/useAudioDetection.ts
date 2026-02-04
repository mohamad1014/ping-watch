import { useCallback, useRef, useState } from 'react'
import { computeAudioRms } from '../audio'

export type AudioDetectionState = {
  currentScore: number
  getScore: () => number
  setup: (stream: MediaStream) => void
  cleanup: () => void
}

export const useAudioDetection = (): AudioDetectionState => {
  const [currentScore, setCurrentScore] = useState(0)

  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioDataRef = useRef<Float32Array | null>(null)
  const scoreRef = useRef(0)

  const getScore = useCallback(() => {
    const analyser = analyserRef.current
    const audioData = audioDataRef.current

    if (!analyser || !audioData) {
      return scoreRef.current
    }

    try {
      analyser.getFloatTimeDomainData(audioData)
      const rms = computeAudioRms(audioData)
      scoreRef.current = rms
      setCurrentScore(rms)
    } catch (err) {
      console.warn('[useAudioDetection] Error:', err)
    }

    return scoreRef.current
  }, [])

  const setup = useCallback((stream: MediaStream) => {
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

      if (!AudioContextClass) {
        console.warn('[useAudioDetection] AudioContext not available')
        return
      }

      const audioContext = new AudioContextClass()
      audioContextRef.current = audioContext

      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)

      analyserRef.current = analyser
      audioDataRef.current = new Float32Array(analyser.fftSize)

      console.log('[useAudioDetection] Setup complete')
    } catch (err) {
      console.warn('[useAudioDetection] Setup failed:', err)
    }
  }, [])

  const cleanup = useCallback(() => {
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
    analyserRef.current = null
    audioDataRef.current = null
    scoreRef.current = 0
    setCurrentScore(0)
  }, [])

  return { currentScore, getScore, setup, cleanup }
}
