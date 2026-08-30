import { describe, expect, it } from 'vitest'
import { createExecutionQueue } from './executionQueue.js'

const deferred = () => {
  let resolve
  const promise = new Promise((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createExecutionQueue', () => {
  it('does not exceed the active worker limit and reports FIFO positions', async () => {
    const queue = createExecutionQueue({ maxActive: 1, maxQueued: 4 })
    const firstGate = deferred()
    const started = []
    const first = queue.enqueue(async () => {
      started.push('first')
      await firstGate.promise
      return 'one'
    })
    const second = queue.enqueue(async () => {
      started.push('second')
      return 'two'
    })
    const third = queue.enqueue(async () => {
      started.push('third')
      return 'three'
    })

    expect(queue.active).toBe(1)
    expect(queue.queued).toBe(2)
    expect(second.getPosition()).toBe(1)
    expect(third.getPosition()).toBe(2)
    expect(started).toEqual([])

    await flush()
    expect(started).toEqual(['first'])
    firstGate.resolve()
    await expect(first.promise).resolves.toBe('one')
    await expect(second.promise).resolves.toBe('two')
    await expect(third.promise).resolves.toBe('three')
    expect(started).toEqual(['first', 'second', 'third'])
    expect(queue.active).toBe(0)
    expect(queue.queued).toBe(0)
  })

  it('rejects new work when the pending queue or one user reaches its limit', async () => {
    const queue = createExecutionQueue({ maxActive: 1, maxQueued: 1, maxQueuedPerKey: 1 })
    const gate = deferred()
    queue.enqueue(() => gate.promise, { key: 'user-a' })
    const pending = queue.enqueue(() => 'pending', { key: 'user-a' })
    const rejected = queue.enqueue(() => 'overflow', { key: 'user-a' })

    expect(pending.accepted).toBe(true)
    expect(queue.isFull()).toBe(true)
    expect(queue.isFullFor('user-a')).toBe(true)
    expect(rejected.accepted).toBe(false)
    await expect(rejected.promise).rejects.toMatchObject({ code: 'QUEUE_FULL' })

    gate.resolve('done')
    await expect(pending.promise).resolves.toBe('pending')
  })

  it('cancels pending work without starting it', async () => {
    const queue = createExecutionQueue({ maxActive: 1, maxQueued: 2 })
    const gate = deferred()
    let cancelledRunCount = 0
    queue.enqueue(() => gate.promise)
    const pending = queue.enqueue(() => {
      cancelledRunCount += 1
      return 'should-not-run'
    })

    expect(pending.cancel()).toBe(true)
    expect(pending.getState()).toBe('cancelled')
    await expect(pending.promise).rejects.toMatchObject({ code: 'QUEUE_CANCELLED' })
    expect(cancelledRunCount).toBe(0)
    gate.resolve()
  })

  it('round-robins keyed work and limits active work per key', async () => {
    const queue = createExecutionQueue({ maxActive: 1, maxActivePerKey: 1, maxQueued: 6, maxQueuedPerKey: 4 })
    const gate = deferred()
    const started = []
    const first = queue.enqueue(async () => {
      started.push('a-1')
      await gate.promise
    }, { key: 'a' })
    const second = queue.enqueue(() => { started.push('a-2') }, { key: 'a' })
    const third = queue.enqueue(() => { started.push('b-1') }, { key: 'b' })

    await flush()
    expect(started).toEqual(['a-1'])
    gate.resolve()
    await Promise.all([first.promise, second.promise, third.promise])
    expect(started).toEqual(['a-1', 'b-1', 'a-2'])
    expect(queue.getMetrics()).toMatchObject({ accepted: 3, completed: 3, failed: 0, cancelled: 0 })
  })

  it('allows active work when the waiting capacity is zero', async () => {
    const queue = createExecutionQueue({ maxActive: 1, maxQueued: 0 })
    const task = queue.enqueue(() => 'ok')
    expect(task.accepted).toBe(true)
    expect(queue.isFull()).toBe(true)
    await expect(task.promise).resolves.toBe('ok')
  })

  it('rejects work when zero waiting capacity is already busy', async () => {
    const queue = createExecutionQueue({ maxActive: 1, maxQueued: 0 })
    const gate = deferred()
    queue.enqueue(() => gate.promise)
    const rejected = queue.enqueue(() => 'should-not-run')

    expect(rejected.accepted).toBe(false)
    await expect(rejected.promise).rejects.toMatchObject({ code: 'QUEUE_FULL' })
    gate.resolve()
  })
})
