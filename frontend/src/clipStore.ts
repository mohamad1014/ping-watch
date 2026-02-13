const DB_NAME = 'ping-watch'
const STORE_NAME = 'clips'
const DB_VERSION = 1
const CREATED_AT_INDEX = 'createdAt'

type ClipInput = {
  sessionId: string
  deviceId: string
  triggerType: 'motion' | 'audio' | 'benchmark'
  blob: Blob
  mimeType: string
  sizeBytes: number
  durationSeconds: number
  createdAt?: number
  // Sequential recording fields
  isBenchmark?: boolean
  clipIndex?: number
  // Real-time tracked metrics
  peakMotionScore?: number
  avgMotionScore?: number
  motionEventCount?: number
  peakAudioScore?: number
  avgAudioScore?: number
  // Comparison deltas (vs benchmark)
  motionDelta?: number
  audioDelta?: number
  // Trigger reasons (which criteria caused storage)
  triggeredBy?: ('motionDelta' | 'motionAbsolute' | 'audioDelta' | 'audioAbsolute')[]
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

const ensureSchema = (request: IDBOpenDBRequest) => {
  const db = request.result
  let store: IDBObjectStore | null = null
  if (!db.objectStoreNames.contains(STORE_NAME)) {
    store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
  } else {
    store = request.transaction?.objectStore(STORE_NAME) ?? null
  }

  if (store && !store.indexNames.contains(CREATED_AT_INDEX)) {
    store.createIndex(CREATED_AT_INDEX, CREATED_AT_INDEX)
  }
}

const openDbConnection = (version: number) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, version)
    request.onupgradeneeded = () => ensureSchema(request)
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    request.onerror = () => reject(request.error)
  })

const ensureStoreAvailable = async (db: IDBDatabase): Promise<IDBDatabase> => {
  if (db.objectStoreNames.contains(STORE_NAME)) {
    return db
  }

  const nextVersion = db.version + 1
  db.close()
  const upgradedDb = await openDbConnection(nextVersion)
  if (upgradedDb.objectStoreNames.contains(STORE_NAME)) {
    return upgradedDb
  }

  upgradedDb.close()
  throw new Error(`Missing required IndexedDB object store: ${STORE_NAME}`)
}

const openDb = () => {
  ensureIndexedDb()
  if (!dbPromise) {
    dbPromise = openDbConnection(DB_VERSION)
      .then(ensureStoreAvailable)
      .catch((error) => {
        dbPromise = null
        throw error
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

export const deleteClipsBySession = async (sessionId: string) => {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)
  const records = await requestToPromise(store.getAll())
  for (const record of records ?? []) {
    if (record.sessionId === sessionId) {
      store.delete(record.id)
    }
  }
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
