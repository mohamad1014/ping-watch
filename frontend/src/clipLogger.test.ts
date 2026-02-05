import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  startLogSession,
  endLogSession,
  logClipAnalysis,
  getSessionLogs,
  getCurrentSessionLogs,
  getSessionStats,
  getCurrentSessionStats,
  exportLogs,
  exportCurrentSessionLogs,
  clearSessionLogs,
  clearAllLogs,
  getCurrentSessionId,
  getCurrentSessionCounts,
  type ClipLogEntry,
} from './clipLogger'

describe('clipLogger', () => {
  beforeEach(() => {
    clearAllLogs()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('session management', () => {
    it('starts a new logging session', () => {
      startLogSession('session-1')
      expect(getCurrentSessionId()).toBe('session-1')
    })

    it('ends the current session', () => {
      startLogSession('session-1')
      endLogSession()
      expect(getCurrentSessionId()).toBeNull()
    })

    it('returns null when no session is active', () => {
      expect(getCurrentSessionId()).toBeNull()
    })
  })

  describe('logClipAnalysis', () => {
    it('logs an entry to the current session', () => {
      startLogSession('session-1')

      const entry: ClipLogEntry = {
        clipIndex: 0,
        clipId: 'clip-0',
        isBenchmark: true,
        motionScore: 0.05,
        audioScore: 0.02,
        decision: 'stored',
        timestamp: 1000,
      }

      logClipAnalysis(entry)

      const logs = getCurrentSessionLogs()
      expect(logs).toHaveLength(1)
      expect(logs[0]).toMatchObject(entry)
    })

    it('warns when no session is active', () => {
      const entry: ClipLogEntry = {
        clipIndex: 0,
        clipId: 'clip-0',
        isBenchmark: true,
        motionScore: 0.05,
        audioScore: 0.02,
        decision: 'stored',
        timestamp: 1000,
      }

      logClipAnalysis(entry)

      expect(console.warn).toHaveBeenCalledWith(
        '[ClipLogger] No active session, entry not logged'
      )
    })

    it('logs multiple entries in sequence', () => {
      startLogSession('session-1')

      logClipAnalysis({
        clipIndex: 0,
        clipId: 'clip-0',
        isBenchmark: true,
        motionScore: 0.05,
        audioScore: 0.02,
        decision: 'stored',
        timestamp: 1000,
      })

      logClipAnalysis({
        clipIndex: 1,
        clipId: 'clip-1',
        isBenchmark: false,
        motionScore: 0.08,
        audioScore: 0.03,
        motionDelta: 0.03,
        audioDelta: 0.01,
        decision: 'stored',
        timestamp: 2000,
      })

      logClipAnalysis({
        clipIndex: 2,
        clipId: 'clip-2',
        isBenchmark: false,
        motionScore: 0.04,
        audioScore: 0.02,
        motionDelta: -0.01,
        audioDelta: 0.0,
        decision: 'discarded',
        timestamp: 3000,
      })

      const logs = getCurrentSessionLogs()
      expect(logs).toHaveLength(3)
      expect(logs[0].clipIndex).toBe(0)
      expect(logs[1].clipIndex).toBe(1)
      expect(logs[2].clipIndex).toBe(2)
    })

    it('logs with optional fields', () => {
      startLogSession('session-1')

      const entry: ClipLogEntry = {
        clipIndex: 0,
        clipId: 'clip-0',
        isBenchmark: true,
        motionScore: 0.05,
        audioScore: 0.02,
        decision: 'stored',
        timestamp: 1000,
        durationMs: 5000,
        sizeBytes: 102400,
        frameCount: 10,
      }

      logClipAnalysis(entry)

      const logs = getCurrentSessionLogs()
      expect(logs[0].durationMs).toBe(5000)
      expect(logs[0].sizeBytes).toBe(102400)
      expect(logs[0].frameCount).toBe(10)
    })
  })

  describe('getSessionLogs', () => {
    it('returns logs for a specific session', () => {
      startLogSession('session-1')
      logClipAnalysis({
        clipIndex: 0,
        clipId: 'clip-0',
        isBenchmark: true,
        motionScore: 0.05,
        audioScore: 0.02,
        decision: 'stored',
        timestamp: 1000,
      })
      endLogSession()

      startLogSession('session-2')
      logClipAnalysis({
        clipIndex: 0,
        clipId: 'clip-a',
        isBenchmark: true,
        motionScore: 0.06,
        audioScore: 0.03,
        decision: 'stored',
        timestamp: 2000,
      })

      const session1Logs = getSessionLogs('session-1')
      const session2Logs = getSessionLogs('session-2')

      expect(session1Logs).toHaveLength(1)
      expect(session1Logs[0].clipId).toBe('clip-0')
      expect(session2Logs).toHaveLength(1)
      expect(session2Logs[0].clipId).toBe('clip-a')
    })

    it('returns empty array for unknown session', () => {
      const logs = getSessionLogs('unknown-session')
      expect(logs).toEqual([])
    })
  })

  describe('getCurrentSessionLogs', () => {
    it('returns logs for current session', () => {
      startLogSession('session-1')
      logClipAnalysis({
        clipIndex: 0,
        clipId: 'clip-0',
        isBenchmark: true,
        motionScore: 0.05,
        audioScore: 0.02,
        decision: 'stored',
        timestamp: 1000,
      })

      const logs = getCurrentSessionLogs()
      expect(logs).toHaveLength(1)
    })

    it('returns empty array when no session is active', () => {
      const logs = getCurrentSessionLogs()
      expect(logs).toEqual([])
    })
  })

  describe('getSessionStats', () => {
    it('calculates session statistics', () => {
      startLogSession('session-1')

      logClipAnalysis({
        clipIndex: 0,
        clipId: 'clip-0',
        isBenchmark: true,
        motionScore: 0.05,
        audioScore: 0.02,
        decision: 'stored',
        timestamp: 1000,
      })

      logClipAnalysis({
        clipIndex: 1,
        clipId: 'clip-1',
        isBenchmark: false,
        motionScore: 0.15,
        audioScore: 0.08,
        decision: 'stored',
        timestamp: 6000,
      })

      logClipAnalysis({
        clipIndex: 2,
        clipId: 'clip-2',
        isBenchmark: false,
        motionScore: 0.04,
        audioScore: 0.02,
        decision: 'discarded',
        timestamp: 11000,
      })

      const stats = getSessionStats('session-1')

      expect(stats).not.toBeNull()
      expect(stats!.totalClips).toBe(3)
      expect(stats!.storedClips).toBe(2)
      expect(stats!.discardedClips).toBe(1)
      expect(stats!.averageMotionScore).toBeCloseTo(0.08, 4)
      expect(stats!.averageAudioScore).toBe(0.04)
      expect(stats!.sessionDurationMs).toBe(10000)
    })

    it('returns null for unknown session', () => {
      const stats = getSessionStats('unknown-session')
      expect(stats).toBeNull()
    })

    it('returns null for empty session', () => {
      startLogSession('session-1')
      const stats = getSessionStats('session-1')
      expect(stats).toBeNull()
    })
  })

  describe('getCurrentSessionStats', () => {
    it('returns stats for current session', () => {
      startLogSession('session-1')
      logClipAnalysis({
        clipIndex: 0,
        clipId: 'clip-0',
        isBenchmark: true,
        motionScore: 0.05,
        audioScore: 0.02,
        decision: 'stored',
        timestamp: 1000,
      })

      const stats = getCurrentSessionStats()
      expect(stats).not.toBeNull()
      expect(stats!.totalClips).toBe(1)
    })

    it('returns null when no session is active', () => {
      const stats = getCurrentSessionStats()
      expect(stats).toBeNull()
    })
  })

  describe('exportLogs', () => {
    it('exports session logs as JSON', () => {
      startLogSession('session-1')
      logClipAnalysis({
        clipIndex: 0,
        clipId: 'clip-0',
        isBenchmark: true,
        motionScore: 0.05,
        audioScore: 0.02,
        decision: 'stored',
        timestamp: 1000,
      })

      const json = exportLogs('session-1')
      const parsed = JSON.parse(json)

      expect(parsed.sessionId).toBe('session-1')
      expect(parsed.exportedAt).toBeDefined()
      expect(parsed.stats).not.toBeNull()
      expect(parsed.logs).toHaveLength(1)
      expect(parsed.logs[0].clipId).toBe('clip-0')
    })

    it('exports empty logs for unknown session', () => {
      const json = exportLogs('unknown-session')
      const parsed = JSON.parse(json)

      expect(parsed.sessionId).toBe('unknown-session')
      expect(parsed.stats).toBeNull()
      expect(parsed.logs).toEqual([])
    })
  })

  describe('exportCurrentSessionLogs', () => {
    it('exports current session logs', () => {
      startLogSession('session-1')
      logClipAnalysis({
        clipIndex: 0,
        clipId: 'clip-0',
        isBenchmark: true,
        motionScore: 0.05,
        audioScore: 0.02,
        decision: 'stored',
        timestamp: 1000,
      })

      const json = exportCurrentSessionLogs()
      expect(json).not.toBeNull()

      const parsed = JSON.parse(json!)
      expect(parsed.sessionId).toBe('session-1')
    })

    it('returns null when no session is active', () => {
      const json = exportCurrentSessionLogs()
      expect(json).toBeNull()
    })
  })

  describe('clearSessionLogs', () => {
    it('clears logs for a specific session', () => {
      startLogSession('session-1')
      logClipAnalysis({
        clipIndex: 0,
        clipId: 'clip-0',
        isBenchmark: true,
        motionScore: 0.05,
        audioScore: 0.02,
        decision: 'stored',
        timestamp: 1000,
      })
      endLogSession()

      startLogSession('session-2')
      logClipAnalysis({
        clipIndex: 0,
        clipId: 'clip-a',
        isBenchmark: true,
        motionScore: 0.06,
        audioScore: 0.03,
        decision: 'stored',
        timestamp: 2000,
      })

      clearSessionLogs('session-1')

      expect(getSessionLogs('session-1')).toEqual([])
      expect(getSessionLogs('session-2')).toHaveLength(1)
    })
  })

  describe('clearAllLogs', () => {
    it('clears all session logs and resets current session', () => {
      startLogSession('session-1')
      logClipAnalysis({
        clipIndex: 0,
        clipId: 'clip-0',
        isBenchmark: true,
        motionScore: 0.05,
        audioScore: 0.02,
        decision: 'stored',
        timestamp: 1000,
      })

      clearAllLogs()

      expect(getCurrentSessionId()).toBeNull()
      expect(getSessionLogs('session-1')).toEqual([])
    })
  })

  describe('getCurrentSessionCounts', () => {
    it('returns stored and discarded counts', () => {
      startLogSession('session-1')

      logClipAnalysis({
        clipIndex: 0,
        clipId: 'clip-0',
        isBenchmark: true,
        motionScore: 0.05,
        audioScore: 0.02,
        decision: 'stored',
        timestamp: 1000,
      })

      logClipAnalysis({
        clipIndex: 1,
        clipId: 'clip-1',
        isBenchmark: false,
        motionScore: 0.15,
        audioScore: 0.08,
        decision: 'stored',
        timestamp: 2000,
      })

      logClipAnalysis({
        clipIndex: 2,
        clipId: 'clip-2',
        isBenchmark: false,
        motionScore: 0.04,
        audioScore: 0.02,
        decision: 'discarded',
        timestamp: 3000,
      })

      logClipAnalysis({
        clipIndex: 3,
        clipId: 'clip-3',
        isBenchmark: false,
        motionScore: 0.03,
        audioScore: 0.01,
        decision: 'discarded',
        timestamp: 4000,
      })

      const counts = getCurrentSessionCounts()
      expect(counts.stored).toBe(2)
      expect(counts.discarded).toBe(2)
    })

    it('returns zeros when no session is active', () => {
      const counts = getCurrentSessionCounts()
      expect(counts.stored).toBe(0)
      expect(counts.discarded).toBe(0)
    })

    it('returns zeros for empty session', () => {
      startLogSession('session-1')
      const counts = getCurrentSessionCounts()
      expect(counts.stored).toBe(0)
      expect(counts.discarded).toBe(0)
    })
  })

  describe('multiple sessions', () => {
    it('maintains separate logs for different sessions', () => {
      startLogSession('session-1')
      logClipAnalysis({
        clipIndex: 0,
        clipId: 'clip-0',
        isBenchmark: true,
        motionScore: 0.05,
        audioScore: 0.02,
        decision: 'stored',
        timestamp: 1000,
      })
      logClipAnalysis({
        clipIndex: 1,
        clipId: 'clip-1',
        isBenchmark: false,
        motionScore: 0.08,
        audioScore: 0.03,
        decision: 'stored',
        timestamp: 2000,
      })
      endLogSession()

      startLogSession('session-2')
      logClipAnalysis({
        clipIndex: 0,
        clipId: 'clip-a',
        isBenchmark: true,
        motionScore: 0.06,
        audioScore: 0.03,
        decision: 'stored',
        timestamp: 3000,
      })
      endLogSession()

      expect(getSessionLogs('session-1')).toHaveLength(2)
      expect(getSessionLogs('session-2')).toHaveLength(1)
    })
  })

  describe('console logging', () => {
    it('logs benchmark clips with BENCHMARK prefix', () => {
      startLogSession('session-1')
      logClipAnalysis({
        clipIndex: 0,
        clipId: 'clip-0',
        isBenchmark: true,
        motionScore: 0.05,
        audioScore: 0.02,
        decision: 'stored',
        timestamp: 1000,
      })

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[BENCHMARK]'),
        expect.any(Object)
      )
    })

    it('logs non-benchmark clips with clip number prefix', () => {
      startLogSession('session-1')
      logClipAnalysis({
        clipIndex: 5,
        clipId: 'clip-5',
        isBenchmark: false,
        motionScore: 0.05,
        audioScore: 0.02,
        decision: 'stored',
        timestamp: 1000,
      })

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[CLIP #5]'),
        expect.any(Object)
      )
    })

    it('logs STORED status for stored clips', () => {
      startLogSession('session-1')
      logClipAnalysis({
        clipIndex: 0,
        clipId: 'clip-0',
        isBenchmark: true,
        motionScore: 0.05,
        audioScore: 0.02,
        decision: 'stored',
        timestamp: 1000,
      })

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('STORED'),
        expect.any(Object)
      )
    })

    it('logs DISCARDED status for discarded clips', () => {
      startLogSession('session-1')
      logClipAnalysis({
        clipIndex: 1,
        clipId: 'clip-1',
        isBenchmark: false,
        motionScore: 0.03,
        audioScore: 0.01,
        decision: 'discarded',
        timestamp: 1000,
      })

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('DISCARDED'),
        expect.any(Object)
      )
    })
  })
})
