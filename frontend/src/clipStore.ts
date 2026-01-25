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

export const listClips = async (): Promise<StoredClip[]> => {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readonly')
  const records = await requestToPromise(tx.objectStore(STORE_NAME).getAll())
  await waitForTransaction(tx)
  return records ?? []
}

export const deleteClip = async (id: string) => {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  tx.objectStore(STORE_NAME).delete(id)
  await waitForTransaction(tx)
}
