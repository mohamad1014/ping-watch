import { useEffect, useState } from 'react'

const CLIP_DURATION_KEY = 'ping-watch:clip-duration'
const MOTION_DELTA_KEY = 'ping-watch:motion-delta'
const MOTION_ABSOLUTE_KEY = 'ping-watch:motion-absolute'
const AUDIO_DELTA_ENABLED_KEY = 'ping-watch:audio-delta-enabled'
const AUDIO_DELTA_KEY = 'ping-watch:audio-delta'
const AUDIO_ABSOLUTE_ENABLED_KEY = 'ping-watch:audio-absolute-enabled'
const AUDIO_ABSOLUTE_KEY = 'ping-watch:audio-absolute'

const readStoredNumber = (key: string, fallback: number) => {
  try {
    const value = localStorage.getItem(key)
    if (value === null) return fallback
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

const readStoredBoolean = (key: string, fallback: boolean) => {
  try {
    const value = localStorage.getItem(key)
    if (value === null) return fallback
    return value === 'true'
  } catch {
    return fallback
  }
}

export type RecordingSettings = {
  clipDuration: number
  motionDeltaThreshold: number
  motionAbsoluteThreshold: number
  audioDeltaEnabled: boolean
  audioDeltaThreshold: number
  audioAbsoluteEnabled: boolean
  audioAbsoluteThreshold: number
}

export type RecordingSettingsActions = {
  setClipDuration: (value: number) => void
  setMotionDeltaThreshold: (value: number) => void
  setMotionAbsoluteThreshold: (value: number) => void
  setAudioDeltaEnabled: (value: boolean) => void
  setAudioDeltaThreshold: (value: number) => void
  setAudioAbsoluteEnabled: (value: boolean) => void
  setAudioAbsoluteThreshold: (value: number) => void
}

export const useRecordingSettings = (): RecordingSettings & RecordingSettingsActions => {
  const [clipDuration, setClipDuration] = useState(() => {
    const override = (globalThis as { __PING_WATCH_CLIP_DURATION_MS__?: number })
      .__PING_WATCH_CLIP_DURATION_MS__
    if (typeof override === 'number') return override / 1000
    return readStoredNumber(CLIP_DURATION_KEY, 10)
  })

  const [motionDeltaThreshold, setMotionDeltaThreshold] = useState(() =>
    readStoredNumber(MOTION_DELTA_KEY, 0.05)
  )
  const [motionAbsoluteThreshold, setMotionAbsoluteThreshold] = useState(() =>
    readStoredNumber(MOTION_ABSOLUTE_KEY, 0.03)
  )

  const [audioDeltaEnabled, setAudioDeltaEnabled] = useState(() =>
    readStoredBoolean(AUDIO_DELTA_ENABLED_KEY, false)
  )
  const [audioDeltaThreshold, setAudioDeltaThreshold] = useState(() =>
    readStoredNumber(AUDIO_DELTA_KEY, 0.1)
  )
  const [audioAbsoluteEnabled, setAudioAbsoluteEnabled] = useState(() =>
    readStoredBoolean(AUDIO_ABSOLUTE_ENABLED_KEY, false)
  )
  const [audioAbsoluteThreshold, setAudioAbsoluteThreshold] = useState(() =>
    readStoredNumber(AUDIO_ABSOLUTE_KEY, 0.15)
  )

  // Persist settings to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(CLIP_DURATION_KEY, String(clipDuration))
      localStorage.setItem(MOTION_DELTA_KEY, String(motionDeltaThreshold))
      localStorage.setItem(MOTION_ABSOLUTE_KEY, String(motionAbsoluteThreshold))
      localStorage.setItem(AUDIO_DELTA_ENABLED_KEY, String(audioDeltaEnabled))
      localStorage.setItem(AUDIO_DELTA_KEY, String(audioDeltaThreshold))
      localStorage.setItem(AUDIO_ABSOLUTE_ENABLED_KEY, String(audioAbsoluteEnabled))
      localStorage.setItem(AUDIO_ABSOLUTE_KEY, String(audioAbsoluteThreshold))
    } catch {
      // Ignore persistence failures
    }
  }, [
    clipDuration,
    motionDeltaThreshold,
    motionAbsoluteThreshold,
    audioDeltaEnabled,
    audioDeltaThreshold,
    audioAbsoluteEnabled,
    audioAbsoluteThreshold,
  ])

  return {
    clipDuration,
    motionDeltaThreshold,
    motionAbsoluteThreshold,
    audioDeltaEnabled,
    audioDeltaThreshold,
    audioAbsoluteEnabled,
    audioAbsoluteThreshold,
    setClipDuration,
    setMotionDeltaThreshold,
    setMotionAbsoluteThreshold,
    setAudioDeltaEnabled,
    setAudioDeltaThreshold,
    setAudioAbsoluteEnabled,
    setAudioAbsoluteThreshold,
  }
}
