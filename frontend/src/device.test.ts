import { describe, expect, it, vi } from 'vitest'
import { ensureDeviceId } from './device'

const buildRegister = (deviceId: string) =>
  vi.fn().mockResolvedValue({ device_id: deviceId, label: null, created_at: 'now' })

describe('ensureDeviceId', () => {
  it('re-registers stored device id to recover from stale backend state', async () => {
    localStorage.setItem('ping-watch:device-id', 'device-123')
    const registerDevice = buildRegister('device-123')

    const result = await ensureDeviceId({ deps: { registerDevice } })

    expect(result).toBe('device-123')
    expect(registerDevice).toHaveBeenCalledWith({
      deviceId: 'device-123',
      label: undefined,
    })
  })

  it('registers and stores a device id when missing', async () => {
    localStorage.removeItem('ping-watch:device-id')
    const registerDevice = buildRegister('device-abc')

    const result = await ensureDeviceId({ deps: { registerDevice } })

    expect(result).toBe('device-abc')
    expect(localStorage.getItem('ping-watch:device-id')).toBe('device-abc')
    expect(registerDevice).toHaveBeenCalledWith({ deviceId: undefined, label: undefined })
  })
})
