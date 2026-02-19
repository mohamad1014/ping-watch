import { registerDevice } from './api'

const DEVICE_ID_KEY_PREFIX = 'ping-watch:device-id'

type EnsureDeviceDeps = {
  registerDevice: typeof registerDevice
  getStorageItem: (key: string) => string | null
  setStorageItem: (key: string, value: string) => void
}

type EnsureDeviceOptions = {
  deviceId?: string
  label?: string
  userScopeKey?: string | null
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
  const { deviceId, label, userScopeKey, deps } = options
  const resolvedDeps = { ...defaultDeps, ...(deps ?? {}) }

  const storageKey = userScopeKey
    ? `${DEVICE_ID_KEY_PREFIX}:${userScopeKey}`
    : DEVICE_ID_KEY_PREFIX
  const existing = resolvedDeps.getStorageItem(storageKey)
  const preferredDeviceId = existing ?? deviceId
  // Always verify/upsert with backend so stale local ids recover after DB resets.
  const response = await resolvedDeps.registerDevice({
    deviceId: preferredDeviceId,
    label,
  })
  resolvedDeps.setStorageItem(storageKey, response.device_id)
  return response.device_id
}
