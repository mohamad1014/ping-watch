type QueueOptions<T> = {
  onError?: (error: unknown, item: T) => void
  onSizeChange?: (size: number) => void
}

export type SerialQueue<T> = {
  enqueue: (item: T) => void
  drain: () => Promise<void>
  size: () => number
  clear: () => void
}

export const createSerialQueue = <T>(
  processItem: (item: T) => Promise<void>,
  options: QueueOptions<T> = {}
): SerialQueue<T> => {
  const items: T[] = []
  let isProcessing = false
  let tail: Promise<void> = Promise.resolve()

  const notifySize = () => {
    options.onSizeChange?.(items.length)
  }

  const processQueuedItems = async () => {
    if (isProcessing) return

    isProcessing = true
    try {
      while (items.length > 0) {
        const next = items.shift() as T
        notifySize()
        try {
          await processItem(next)
        } catch (error) {
          options.onError?.(error, next)
        }
      }
    } finally {
      isProcessing = false
    }
  }

  const enqueue = (item: T) => {
    items.push(item)
    notifySize()
    tail = tail.then(processQueuedItems)
  }

  const drain = () => tail

  const size = () => items.length

  const clear = () => {
    items.length = 0
    notifySize()
  }

  return { enqueue, drain, size, clear }
}
