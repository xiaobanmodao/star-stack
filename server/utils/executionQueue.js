// 单进程执行队列：限制同时运行的用户代码数量，并保留 FIFO 顺序。
// 评测进程是有资源成本的，因此队列本身也要有容量上限，避免请求无限堆积。
export const createExecutionQueue = ({ maxActive, maxQueued, maxQueuedPerKey = Infinity }) => {
  const activeLimit = Math.max(1, Number(maxActive) || 1)
  const queuedLimit = Math.max(0, Number(maxQueued) || 0)
  const perKeyLimit = Number.isFinite(maxQueuedPerKey)
    ? Math.max(1, Number(maxQueuedPerKey) || 1)
    : Infinity
  const pending = []
  const queuedByKey = new Map()
  let active = 0
  let sequence = 0

  const keyOf = (metadata) => {
    const key = metadata?.key
    return key === undefined || key === null || key === '' ? null : String(key)
  }

  const adjustQueuedKey = (key, delta) => {
    if (key === null) return
    const next = (queuedByKey.get(key) || 0) + delta
    if (next > 0) queuedByKey.set(key, next)
    else queuedByKey.delete(key)
  }

  const makeError = (message, code) => {
    const error = new Error(message)
    error.code = code
    return error
  }

  const drain = () => {
    while (active < activeLimit && pending.length > 0) {
      const task = pending.shift()
      if (!task || task.cancelled) continue

      adjustQueuedKey(task.key, -1)
      task.started = true
      task.state = 'running'
      active += 1
      Promise.resolve()
        .then(() => task.onStart?.())
        .then(() => task.run())
        .then((value) => {
          task.state = 'completed'
          task.resolve(value)
        }, (error) => {
          task.state = 'failed'
          task.reject(error)
        })
        .finally(() => {
          active = Math.max(0, active - 1)
          drain()
        })
    }
  }

  const enqueue = (run, { onStart, key, metadata } = {}) => {
    const taskKey = key ?? metadata?.key ?? null
    if (pending.length >= queuedLimit) {
      return {
        promise: Promise.reject(makeError('评测队列已满', 'QUEUE_FULL')),
        getPosition: () => null,
        getState: () => 'rejected',
        cancel: () => false,
        accepted: false,
      }
    }
    if (taskKey !== null && (queuedByKey.get(String(taskKey)) || 0) >= perKeyLimit) {
      return {
        promise: Promise.reject(makeError('该用户的评测请求已达到排队上限', 'USER_QUEUE_FULL')),
        getPosition: () => null,
        getState: () => 'rejected',
        cancel: () => false,
        accepted: false,
      }
    }

    let task
    const promise = new Promise((resolve, reject) => {
      task = {
        id: ++sequence,
        run,
        onStart,
        resolve,
        reject,
        key: taskKey === null ? null : String(taskKey),
        metadata,
        started: false,
        cancelled: false,
        state: 'queued',
      }
      pending.push(task)
      adjustQueuedKey(task.key, 1)
      drain()
    })

    return {
      promise,
      accepted: true,
      id: task.id,
      getPosition: () => {
        if (!task || task.started || task.cancelled) return null
        const index = pending.indexOf(task)
        return index >= 0 ? index + 1 : null
      },
      getState: () => task.state,
      cancel: () => {
        if (!task || task.started || task.cancelled) return false
        const index = pending.indexOf(task)
        if (index < 0) return false
        pending.splice(index, 1)
        adjustQueuedKey(task.key, -1)
        task.cancelled = true
        task.state = 'cancelled'
        task.reject(makeError('评测请求已取消', 'QUEUE_CANCELLED'))
        drain()
        return true
      },
    }
  }

  return {
    enqueue,
    isFull: () => pending.length >= queuedLimit,
    isFullFor: (key) => pending.length >= queuedLimit
      || (key !== undefined && key !== null && (queuedByKey.get(String(key)) || 0) >= perKeyLimit),
    get active() { return active },
    get queued() { return pending.length },
    get total() { return active + pending.length },
    get queuedLimit() { return queuedLimit },
    maxActive: activeLimit,
    maxQueued: queuedLimit,
    maxQueuedPerKey: perKeyLimit,
  }
}
