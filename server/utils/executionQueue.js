// 单进程执行队列：限制同时运行的用户代码数量；无 key 时保持 FIFO，有 key 时按 key 轮转。
// 评测进程是有资源成本的，因此队列本身也要有容量上限，避免请求无限堆积。
export const createExecutionQueue = ({ maxActive, maxQueued, maxQueuedPerKey = Infinity, maxActivePerKey = Infinity }) => {
  const activeLimit = Math.max(1, Number(maxActive) || 1)
  const queuedLimit = Math.max(0, Number(maxQueued) || 0)
  const perKeyLimit = Number.isFinite(maxQueuedPerKey)
    ? Math.max(1, Number(maxQueuedPerKey) || 1)
    : Infinity
  const activePerKeyLimit = Number.isFinite(maxActivePerKey)
    ? Math.max(1, Number(maxActivePerKey) || 1)
    : Infinity
  const pending = []
  const queuedByKey = new Map()
  const activeByKey = new Map()
  let active = 0
  let sequence = 0
  let lastStartedKey = null
  const metrics = {
    accepted: 0,
    rejected: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    totalWaitMs: 0,
    totalRunMs: 0,
    maxWaitMs: 0,
    maxRunMs: 0,
  }

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

  const adjustActiveKey = (key, delta) => {
    if (key === null) return
    const next = (activeByKey.get(key) || 0) + delta
    if (next > 0) activeByKey.set(key, next)
    else activeByKey.delete(key)
  }

  const makeError = (message, code) => {
    const error = new Error(message)
    error.code = code
    return error
  }

  const canStart = (task) => task?.key === null
    || (activeByKey.get(task.key) || 0) < activePerKeyLimit

  const canStartKey = (taskKey) => active < activeLimit
    && (taskKey === null || (activeByKey.get(taskKey) || 0) < activePerKeyLimit)

  // 有 key 的任务按轮转方式取出：同一用户连续提交时，不能把其他用户
  // 已经排队的任务一直压在后面；没有 key 的内部任务继续保持 FIFO。
  const nextTaskIndex = () => {
    const fairIndex = pending.findIndex((task) => canStart(task) && (
      task.key === null || task.key !== lastStartedKey
    ))
    if (fairIndex >= 0) return fairIndex
    return pending.findIndex(canStart)
  }

  const drain = () => {
    while (active < activeLimit && pending.length > 0) {
      const taskIndex = nextTaskIndex()
      if (taskIndex < 0) break
      const [task] = pending.splice(taskIndex, 1)
      if (!task || task.cancelled) continue

      adjustQueuedKey(task.key, -1)
      task.started = true
      task.state = 'running'
      task.startedAt = Date.now()
      task.waitMs = Math.max(0, task.startedAt - task.enqueuedAt)
      metrics.totalWaitMs += task.waitMs
      metrics.maxWaitMs = Math.max(metrics.maxWaitMs, task.waitMs)
      lastStartedKey = task.key
      adjustActiveKey(task.key, 1)
      active += 1
      Promise.resolve()
        .then(() => task.onStart?.())
        .then(() => task.run())
        .then((value) => {
          task.state = 'completed'
          metrics.completed += 1
          task.resolve(value)
        }, (error) => {
          task.state = 'failed'
          metrics.failed += 1
          task.reject(error)
        })
        .finally(() => {
          task.finishedAt = Date.now()
          task.runMs = Math.max(0, task.finishedAt - task.startedAt)
          metrics.totalRunMs += task.runMs
          metrics.maxRunMs = Math.max(metrics.maxRunMs, task.runMs)
          adjustActiveKey(task.key, -1)
          active = Math.max(0, active - 1)
          drain()
        })
    }
  }

  const enqueue = (run, { onStart, key, metadata } = {}) => {
    const taskKey = key ?? metadata?.key ?? null
    const normalizedTaskKey = taskKey === null ? null : String(taskKey)
    const canStartImmediately = canStartKey(normalizedTaskKey)
    if ((queuedLimit > 0 && pending.length >= queuedLimit) || (queuedLimit === 0 && !canStartImmediately)) {
      metrics.rejected += 1
      return {
        promise: Promise.reject(makeError('评测队列已满', 'QUEUE_FULL')),
        getPosition: () => null,
        getState: () => 'rejected',
        cancel: () => false,
        accepted: false,
      }
    }
    if (normalizedTaskKey !== null && (queuedByKey.get(normalizedTaskKey) || 0) >= perKeyLimit) {
      metrics.rejected += 1
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
        key: normalizedTaskKey,
        metadata,
        started: false,
        cancelled: false,
        state: 'queued',
        enqueuedAt: Date.now(),
        startedAt: null,
        finishedAt: null,
        waitMs: null,
        runMs: null,
      }
      pending.push(task)
      adjustQueuedKey(task.key, 1)
      metrics.accepted += 1
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
        metrics.cancelled += 1
        task.reject(makeError('评测请求已取消', 'QUEUE_CANCELLED'))
        drain()
        return true
      },
    }
  }

  return {
    enqueue,
    isFull: () => queuedLimit > 0 ? pending.length >= queuedLimit : active >= activeLimit,
    isFullFor: (key) => (queuedLimit > 0 && pending.length >= queuedLimit)
      || (queuedLimit === 0 && !canStartKey(key === undefined || key === null ? null : String(key)))
      || (key !== undefined && key !== null && (queuedByKey.get(String(key)) || 0) >= perKeyLimit),
    get active() { return active },
    get queued() { return pending.length },
    get total() { return active + pending.length },
    get queuedLimit() { return queuedLimit },
    maxActive: activeLimit,
    maxQueued: queuedLimit,
    maxQueuedPerKey: perKeyLimit,
    maxActivePerKey: activePerKeyLimit,
    getMetrics: () => ({
      ...metrics,
      avgWaitMs: metrics.accepted > 0 ? Math.round(metrics.totalWaitMs / Math.max(1, metrics.completed + metrics.failed)) : 0,
      avgRunMs: metrics.completed + metrics.failed > 0
        ? Math.round(metrics.totalRunMs / (metrics.completed + metrics.failed))
        : 0,
      oldestQueuedMs: pending.length > 0
        ? Math.max(0, Date.now() - Math.min(...pending.map((task) => task.enqueuedAt)))
        : 0,
    }),
  }
}
