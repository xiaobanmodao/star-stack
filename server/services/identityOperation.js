const operationQueues = new WeakMap()

export const acquireIdentityOperation = async (db) => {
  if (!db || (typeof db !== 'object' && typeof db !== 'function')) {
    throw new Error('Identity operation requires a SQLite connection')
  }
  const previous = operationQueues.get(db) || Promise.resolve()
  let unlock
  const current = new Promise((resolve) => { unlock = resolve })
  const queued = previous.catch(() => undefined).then(() => current)
  operationQueues.set(db, queued)
  await previous.catch(() => undefined)

  let released = false
  return () => {
    if (released) return
    released = true
    unlock()
    void queued.finally(() => {
      if (operationQueues.get(db) === queued) operationQueues.delete(db)
    })
  }
}

export const runIdentityOperation = async (db, operation) => {
  const release = await acquireIdentityOperation(db)
  try {
    return await operation()
  } finally {
    release()
  }
}
