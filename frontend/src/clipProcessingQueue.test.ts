import { describe, expect, it, vi } from 'vitest'
import { createSerialQueue } from './clipProcessingQueue'

describe('createSerialQueue', () => {
  it('processes all queued items in order when processing is slow', async () => {
    const processed: number[] = []

    let releaseFirst: (() => void) | null = null
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const queue = createSerialQueue<number>(async (value) => {
      if (value === 1) {
        await firstGate
      }
      processed.push(value)
    })

    queue.enqueue(1)
    queue.enqueue(2)
    queue.enqueue(3)

    await Promise.resolve()
    expect(processed).toEqual([])

    releaseFirst?.()
    await queue.drain()

    expect(processed).toEqual([1, 2, 3])
  })

  it('continues processing after handler errors', async () => {
    const processed: number[] = []
    const onError = vi.fn()

    const queue = createSerialQueue<number>(
      async (value) => {
        if (value === 1) {
          throw new Error('boom')
        }
        processed.push(value)
      },
      { onError }
    )

    queue.enqueue(1)
    queue.enqueue(2)
    await queue.drain()

    expect(onError).toHaveBeenCalledTimes(1)
    expect(processed).toEqual([2])
  })
})
