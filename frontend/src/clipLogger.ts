/**
 * Clip Logger
 *
 * Logs analysis results per clip for debugging and analysis.
 * Stores logs in memory per session with export functionality.
 */

export type ClipLogEntry = {
  clipIndex: number
  clipId: string
  isBenchmark: boolean
  motionScore: number
  audioScore: number
  motionDelta?: number
  audioDelta?: number
  decision: 'stored' | 'discarded'
  timestamp: number
  durationMs?: number
  sizeBytes?: number
  frameCount?: number
}

export type SessionStats = {
  totalClips: number
  storedClips: number
  discardedClips: number
  averageMotionScore: number
  averageAudioScore: number
  sessionDurationMs: number
}

// Session-based log storage
const sessionLogs: Map<string, ClipLogEntry[]> = new Map()
let currentSessionId: string | null = null

/**
 * Start a new logging session
 */
export const startLogSession = (sessionId: string): void => {
  currentSessionId = sessionId
  sessionLogs.set(sessionId, [])
  console.log('[ClipLogger] Session started:', sessionId)
}

/**
 * End the current logging session
 */
export const endLogSession = (): void => {
  if (currentSessionId) {
    console.log('[ClipLogger] Session ended:', currentSessionId)
  }
  currentSessionId = null
}

/**
 * Log a clip analysis result
 */
export const logClipAnalysis = (entry: ClipLogEntry): void => {
  if (!currentSessionId) {
    console.warn('[ClipLogger] No active session, entry not logged')
    return
  }

  const logs = sessionLogs.get(currentSessionId)
  if (logs) {
    logs.push({
      ...entry,
      timestamp: entry.timestamp ?? Date.now(),
    })
  }

  // Console output for real-time debugging
  const prefix = entry.isBenchmark ? '[BENCHMARK]' : `[CLIP #${entry.clipIndex}]`
  const status = entry.decision === 'stored' ? 'STORED' : 'DISCARDED'

  console.log(`[ClipLogger] ${prefix} ${status}`, {
    motionScore: entry.motionScore.toFixed(4),
    audioScore: entry.audioScore.toFixed(4),
    ...(entry.motionDelta !== undefined && { motionDelta: entry.motionDelta.toFixed(4) }),
    ...(entry.audioDelta !== undefined && { audioDelta: entry.audioDelta.toFixed(4) }),
    ...(entry.durationMs && { durationMs: entry.durationMs }),
    ...(entry.sizeBytes && { sizeBytes: entry.sizeBytes }),
  })
}

/**
 * Get logs for a specific session
 */
export const getSessionLogs = (sessionId: string): ClipLogEntry[] => {
  return sessionLogs.get(sessionId) ?? []
}

/**
 * Get logs for the current session
 */
export const getCurrentSessionLogs = (): ClipLogEntry[] => {
  if (!currentSessionId) {
    return []
  }
  return getSessionLogs(currentSessionId)
}

/**
 * Get statistics for a session
 */
export const getSessionStats = (sessionId: string): SessionStats | null => {
  const logs = sessionLogs.get(sessionId)
  if (!logs || logs.length === 0) {
    return null
  }

  const stored = logs.filter((l) => l.decision === 'stored')
  const discarded = logs.filter((l) => l.decision === 'discarded')

  const avgMotion = logs.reduce((sum, l) => sum + l.motionScore, 0) / logs.length
  const avgAudio = logs.reduce((sum, l) => sum + l.audioScore, 0) / logs.length

  const firstTimestamp = logs[0].timestamp
  const lastTimestamp = logs[logs.length - 1].timestamp

  return {
    totalClips: logs.length,
    storedClips: stored.length,
    discardedClips: discarded.length,
    averageMotionScore: avgMotion,
    averageAudioScore: avgAudio,
    sessionDurationMs: lastTimestamp - firstTimestamp,
  }
}

/**
 * Get statistics for the current session
 */
export const getCurrentSessionStats = (): SessionStats | null => {
  if (!currentSessionId) {
    return null
  }
  return getSessionStats(currentSessionId)
}

/**
 * Export logs for a session as JSON string
 */
export const exportLogs = (sessionId: string): string => {
  const logs = sessionLogs.get(sessionId) ?? []
  const stats = getSessionStats(sessionId)

  return JSON.stringify({
    sessionId,
    exportedAt: new Date().toISOString(),
    stats,
    logs,
  }, null, 2)
}

/**
 * Export current session logs as JSON string
 */
export const exportCurrentSessionLogs = (): string | null => {
  if (!currentSessionId) {
    return null
  }
  return exportLogs(currentSessionId)
}

/**
 * Clear logs for a specific session
 */
export const clearSessionLogs = (sessionId: string): void => {
  sessionLogs.delete(sessionId)
}

/**
 * Clear all session logs
 */
export const clearAllLogs = (): void => {
  sessionLogs.clear()
  currentSessionId = null
}

/**
 * Get the current session ID
 */
export const getCurrentSessionId = (): string | null => {
  return currentSessionId
}

/**
 * Get count of stored vs discarded for current session
 */
export const getCurrentSessionCounts = (): { stored: number; discarded: number } => {
  if (!currentSessionId) {
    return { stored: 0, discarded: 0 }
  }

  const logs = sessionLogs.get(currentSessionId) ?? []
  return {
    stored: logs.filter((l) => l.decision === 'stored').length,
    discarded: logs.filter((l) => l.decision === 'discarded').length,
  }
}
