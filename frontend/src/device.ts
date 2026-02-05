import { registerDevice } from './api'

const DEVICE_ID_KEY = 'ping-watch:device-id'

type EnsureDeviceDeps = {
  registerDevice: typeof registerDevice
  getStorageItem: (key: string) => string | null
  setStorageItem: (key: string, value: string) => void
}

type EnsureDeviceOptions = {
  deviceId?: string
  label?: string
  deps?: Partial<EnsureDeviceDeps>
}

const defaultDeps: EnsureDeviceDeps = {
  registerDevice,
  getStorageItem: (key) => localStorage.getItem(key),
  setStorageItem: (key, value) => localStorage.setItem(key, value),
}

export const ensureDeviceId = async (
  options: EnsureDeviceOptions = {}
): Promise<string> => {
  const { deviceId, label, deps } = options
  const resolvedDeps = { ...defaultDeps, ...(deps ?? {}) }

  const existing = resolvedDeps.getStorageItem(DEVICE_ID_KEY)
  if (existing) {
    return existing
  }

  const response = await resolvedDeps.registerDevice({ deviceId, label })
  resolvedDeps.setStorageItem(DEVICE_ID_KEY, response.device_id)
  return response.device_id
}
