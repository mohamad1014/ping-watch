import { describe, expect, it, vi } from 'vitest'
import { ensureDeviceId } from './device'

const buildRegister = (deviceId: string) =>
  vi.fn().mockResolvedValue({ device_id: deviceId, label: null, created_at: 'now' })

describe('ensureDeviceId', () => {
  it('returns stored device id without registering', async () => {
    localStorage.setItem('ping-watch:device-id', 'device-123')
    const registerDevice = buildRegister('device-999')

    const result = await ensureDeviceId({ deps: { registerDevice } })

    expect(result).toBe('device-123')
    expect(registerDevice).not.toHaveBeenCalled()
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
