const DB_NAME = 'ping-watch'
const STORE_NAME = 'clips'
const DB_VERSION = 1

type ClipInput = {
  blob: Blob
  mimeType: string
  sizeBytes: number
  durationSeconds: number
  createdAt?: number
}

export type StoredClip = ClipInput & {
  id: string
  createdAt: number
  uploaded: boolean
  uploadedAt?: number
  uploadAttempts?: number
  nextUploadAttemptAt?: number
  lastUploadError?: string
}

let dbPromise: Promise<IDBDatabase> | null = null

const ensureIndexedDb = () => {
  if (!globalThis.indexedDB) {
    throw new Error('indexedDB not available')
  }
}

const openDb = () => {
  ensureIndexedDb()
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
          store.createIndex('createdAt', 'createdAt')
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
  return dbPromise
}

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const waitForTransaction = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })

const buildId = () => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }
  return `clip_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

export const saveClip = async (clip: ClipInput): Promise<StoredClip> => {
  const db = await openDb()
  const record: StoredClip = {
    id: buildId(),
    createdAt: clip.createdAt ?? Date.now(),
    uploaded: false,
    uploadAttempts: 0,
    ...clip,
  }

  const tx = db.transaction(STORE_NAME, 'readwrite')
  tx.objectStore(STORE_NAME).put(record)
  await waitForTransaction(tx)
  return record
}

export const getClip = async (id: string): Promise<StoredClip | null> => {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readonly')
  const record = await requestToPromise(tx.objectStore(STORE_NAME).get(id))
  await waitForTransaction(tx)
  return record ?? null
}

type ClipListFilter = {
  uploaded?: boolean
  readyToUpload?: boolean
  now?: number
}

export const listClips = async (
  filter: ClipListFilter = {}
): Promise<StoredClip[]> => {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readonly')
  const records = await requestToPromise(tx.objectStore(STORE_NAME).getAll())
  await waitForTransaction(tx)
  const result = records ?? []
  const now = filter.now ?? Date.now()
  if (typeof filter.uploaded === 'boolean') {
    const filtered = result.filter((clip) => clip.uploaded === filter.uploaded)
    if (filter.readyToUpload) {
      return filtered.filter(
        (clip) =>
          (clip.nextUploadAttemptAt ?? 0) <= now
      )
    }
    return filtered
  }
  if (filter.readyToUpload) {
    return result.filter((clip) => (clip.nextUploadAttemptAt ?? 0) <= now)
  }
  return result
}

export const deleteClip = async (id: string) => {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  tx.objectStore(STORE_NAME).delete(id)
  await waitForTransaction(tx)
}

export const markClipUploaded = async (id: string) => {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)
  const record = await requestToPromise(store.get(id))
  if (record) {
    store.put({
      ...record,
      uploaded: true,
      uploadedAt: Date.now(),
      lastUploadError: undefined,
      nextUploadAttemptAt: undefined,
    })
  }
  await waitForTransaction(tx)
}

export const scheduleClipRetry = async (
  id: string,
  options: { error: string; nextUploadAttemptAt: number }
) => {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)
  const record = await requestToPromise(store.get(id))
  if (record) {
    const attempts = Number(record.uploadAttempts ?? 0) + 1
    store.put({
      ...record,
      uploadAttempts: attempts,
      lastUploadError: options.error,
      nextUploadAttemptAt: options.nextUploadAttemptAt,
    })
  }
  await waitForTransaction(tx)
}
