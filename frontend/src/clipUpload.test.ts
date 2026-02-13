import { describe, expect, it, vi } from 'vitest'
import { uploadPendingClips } from './clipUpload'

describe('uploadPendingClips', () => {
  it('uploads pending clips and marks them uploaded', async () => {
    const initiateUpload = vi.fn().mockResolvedValue({
      event: { event_id: 'clip-1', status: 'processing', trigger_type: 'motion' },
      uploadUrl: 'http://upload',
    })
    const finalizeUpload = vi.fn().mockResolvedValue({
      event_id: 'clip-1',
      status: 'processing',
      trigger_type: 'motion',
    })
    const uploadBlob = vi.fn().mockResolvedValue({ etag: '"etag-1"' })
    const markClipUploaded = vi.fn().mockResolvedValue(undefined)
    const scheduleClipRetry = vi.fn().mockResolvedValue(undefined)
    const listClips = vi.fn().mockResolvedValue([
      {
        id: 'clip-1',
        sessionId: 'sess-1',
        deviceId: 'device-1',
        triggerType: 'motion',
        blob: new Blob(['a']),
        mimeType: 'video/webm',
        sizeBytes: 1,
        durationSeconds: 2,
        createdAt: 0,
        uploaded: false,
      },
    ])

    const uploaded = await uploadPendingClips({
      sessionId: 'sess-1',
      deps: {
        initiateUpload,
        uploadBlob,
        finalizeUpload,
        listClips,
        markClipUploaded,
        scheduleClipRetry,
        getNow: () => 0,
        sleep: async () => {},
        isOnline: () => true,
      },
    })

    expect(uploaded).toBe(1)
    expect(initiateUpload).toHaveBeenCalledWith({
      eventId: 'clip-1',
      sessionId: 'sess-1',
      deviceId: 'device-1',
      triggerType: 'motion',
      durationSeconds: 2,
      clipMime: 'video/webm',
      clipSizeBytes: 1,
    })
    expect(uploadBlob).toHaveBeenCalledWith('http://upload', expect.any(Blob), {
      contentType: 'video/webm',
    })
    expect(finalizeUpload).toHaveBeenCalledWith('clip-1', '"etag-1"')
    expect(markClipUploaded).toHaveBeenCalledWith('clip-1')
  })

  it('uses backend upload directly for local Azurite URLs', async () => {
    const initiateUpload = vi.fn().mockResolvedValue({
      event: { event_id: 'clip-1', status: 'processing', trigger_type: 'motion' },
      uploadUrl:
        'http://127.0.0.1:10000/devstoreaccount1/clips/sessions/sess-1/events/clip-1.webm?sig=abc',
    })
    const finalizeUpload = vi.fn().mockResolvedValue({
      event_id: 'clip-1',
      status: 'processing',
      trigger_type: 'motion',
    })
    const uploadBlob = vi.fn().mockResolvedValue({ etag: '"etag-direct"' })
    const uploadBlobViaApi = vi.fn().mockResolvedValue({ etag: '"etag-local"' })
    const markClipUploaded = vi.fn().mockResolvedValue(undefined)
    const scheduleClipRetry = vi.fn().mockResolvedValue(undefined)
    const listClips = vi.fn().mockResolvedValue([
      {
        id: 'clip-1',
        sessionId: 'sess-1',
        deviceId: 'device-1',
        triggerType: 'motion',
        blob: new Blob(['a']),
        mimeType: 'video/webm',
        sizeBytes: 1,
        durationSeconds: 2,
        createdAt: 0,
        uploaded: false,
      },
    ])

    const uploaded = await uploadPendingClips({
      sessionId: 'sess-1',
      deps: {
        initiateUpload,
        uploadBlob,
        uploadBlobViaApi,
        finalizeUpload,
        listClips,
        markClipUploaded,
        scheduleClipRetry,
        getNow: () => 0,
        sleep: async () => {},
        isOnline: () => true,
      },
    })

    expect(uploaded).toBe(1)
    expect(uploadBlob).not.toHaveBeenCalled()
    expect(uploadBlobViaApi).toHaveBeenCalledWith('clip-1', expect.any(Blob), {
      contentType: 'video/webm',
    })
    expect(finalizeUpload).toHaveBeenCalledWith('clip-1', '"etag-local"')
    expect(markClipUploaded).toHaveBeenCalledWith('clip-1')
    expect(scheduleClipRetry).not.toHaveBeenCalled()
  })

  it('schedules retry when offline', async () => {
    const initiateUpload = vi.fn()
    const uploadBlob = vi.fn()
    const finalizeUpload = vi.fn()
    const markClipUploaded = vi.fn()
    const scheduleClipRetry = vi.fn().mockResolvedValue(undefined)
    const listClips = vi.fn().mockResolvedValue([
      {
        id: 'clip-1',
        sessionId: 'sess-1',
        deviceId: 'device-1',
        triggerType: 'motion',
        blob: new Blob(['a']),
        mimeType: 'video/webm',
        sizeBytes: 1,
        durationSeconds: 2,
        createdAt: 0,
        uploaded: false,
      },
    ])

    const uploaded = await uploadPendingClips({
      sessionId: 'sess-1',
      deps: {
        initiateUpload,
        uploadBlob,
        finalizeUpload,
        listClips,
        markClipUploaded,
        scheduleClipRetry,
        getNow: () => 1000,
        sleep: async () => {},
        isOnline: () => false,
      },
    })

    expect(uploaded).toBe(0)
    expect(scheduleClipRetry).toHaveBeenCalledWith('clip-1', {
      error: 'offline',
      nextUploadAttemptAt: expect.any(Number),
    })
    expect(initiateUpload).not.toHaveBeenCalled()
  })

  it('retries transient upload errors and eventually succeeds', async () => {
    const initiateUpload = vi.fn().mockResolvedValue({
      event: { event_id: 'clip-1', status: 'processing', trigger_type: 'motion' },
      uploadUrl: 'http://upload',
    })
    const finalizeUpload = vi.fn().mockResolvedValue({
      event_id: 'clip-1',
      status: 'processing',
      trigger_type: 'motion',
    })
    const uploadBlob = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ etag: '"etag-1"' })
    const markClipUploaded = vi.fn().mockResolvedValue(undefined)
    const scheduleClipRetry = vi.fn().mockResolvedValue(undefined)
    const listClips = vi.fn().mockResolvedValue([
      {
        id: 'clip-1',
        sessionId: 'sess-1',
        deviceId: 'device-1',
        triggerType: 'motion',
        blob: new Blob(['a']),
        mimeType: 'video/webm',
        sizeBytes: 1,
        durationSeconds: 2,
        createdAt: 0,
        uploaded: false,
      },
    ])

    const sleep = vi.fn().mockResolvedValue(undefined)
    const uploaded = await uploadPendingClips({
      sessionId: 'sess-1',
      deps: {
        initiateUpload,
        uploadBlob,
        finalizeUpload,
        listClips,
        markClipUploaded,
        scheduleClipRetry,
        getNow: () => 0,
        sleep,
        isOnline: () => true,
      },
    })

    expect(uploaded).toBe(1)
    expect(uploadBlob).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(scheduleClipRetry).not.toHaveBeenCalled()
  })

  it('uploads pending clips across sessions when a sessionId is provided', async () => {
    const initiateUpload = vi.fn().mockResolvedValue({
      event: { event_id: 'clip-1', status: 'processing', trigger_type: 'motion' },
      uploadUrl: 'http://upload',
    })
    const finalizeUpload = vi.fn().mockResolvedValue({
      event_id: 'clip-1',
      status: 'processing',
      trigger_type: 'motion',
    })
    const uploadBlob = vi.fn().mockResolvedValue({ etag: '"etag-1"' })
    const markClipUploaded = vi.fn().mockResolvedValue(undefined)
    const scheduleClipRetry = vi.fn().mockResolvedValue(undefined)
    const listClips = vi.fn().mockResolvedValue([
      {
        id: 'clip-1',
        sessionId: 'sess-1',
        deviceId: 'device-1',
        triggerType: 'motion',
        blob: new Blob(['a']),
        mimeType: 'video/webm',
        sizeBytes: 1,
        durationSeconds: 2,
        createdAt: 0,
        uploaded: false,
      },
      {
        id: 'clip-2',
        sessionId: 'sess-2',
        deviceId: 'device-1',
        triggerType: 'motion',
        blob: new Blob(['b']),
        mimeType: 'video/webm',
        sizeBytes: 1,
        durationSeconds: 2,
        createdAt: 0,
        uploaded: false,
      },
    ])

    const uploaded = await uploadPendingClips({
      sessionId: 'sess-1',
      deps: {
        initiateUpload,
        uploadBlob,
        finalizeUpload,
        listClips,
        markClipUploaded,
        scheduleClipRetry,
        getNow: () => 0,
        sleep: async () => {},
        isOnline: () => true,
      },
    })

    expect(uploaded).toBe(2)
    expect(initiateUpload).toHaveBeenCalledTimes(2)
  })

  it('schedules retry when clip metadata is missing', async () => {
    const initiateUpload = vi.fn()
    const uploadBlob = vi.fn()
    const finalizeUpload = vi.fn()
    const markClipUploaded = vi.fn()
    const scheduleClipRetry = vi.fn().mockResolvedValue(undefined)
    const listClips = vi.fn().mockResolvedValue([
      {
        id: 'clip-1',
        blob: new Blob(['a']),
        mimeType: 'video/webm',
        sizeBytes: 1,
        durationSeconds: 2,
        createdAt: 0,
        uploaded: false,
      },
    ])

    const uploaded = await uploadPendingClips({
      sessionId: 'sess-1',
      deps: {
        initiateUpload,
        uploadBlob,
        finalizeUpload,
        listClips,
        markClipUploaded,
        scheduleClipRetry,
        getNow: () => 1000,
        sleep: async () => {},
        isOnline: () => true,
      },
    })

    expect(uploaded).toBe(0)
    expect(scheduleClipRetry).toHaveBeenCalledWith('clip-1', {
      error: 'missing_metadata',
      nextUploadAttemptAt: expect.any(Number),
    })
    expect(initiateUpload).not.toHaveBeenCalled()
  })
})
