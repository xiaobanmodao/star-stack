const operationQueues = new WeakMap()
export const DEFAULT_IDENTITY_OPERATION_LIMIT = 64

export class IdentityOperationCapacityError extends Error {
  constructor(message = 'Identity operation queue capacity exceeded') {
    super(message)
    this.name = 'IdentityOperationCapacityError'
    this.code = 'IDENTITY_OPERATION_CAPACITY_EXCEEDED'
    this.status = 503
  }
}

const assertLimit = (value) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new Error('Identity operation queue limit must be a positive safe integer')
  }
  return value
}

export const acquireIdentityOperation = async (
  db,
  { maxPending = DEFAULT_IDENTITY_OPERATION_LIMIT } = {},
) => {
  if (!db || (typeof db !== 'object' && typeof db !== 'function')) {
    throw new Error('Identity operation requires a SQLite connection')
  }
  const limit = assertLimit(maxPending)
  let state = operationQueues.get(db)
  if (!state) {
    state = { tail: Promise.resolve(), outstanding: 0 }
    operationQueues.set(db, state)
  }
  if (state.outstanding >= limit) throw new IdentityOperationCapacityError()

  const previous = state.tail
  let unlock
  const current = new Promise((resolve) => { unlock = resolve })
  const queued = previous.catch(() => undefined).then(() => current)
  state.tail = queued
  state.outstanding += 1
  await previous.catch(() => undefined)

  let released = false
  return () => {
    if (released) return
    released = true
    state.outstanding -= 1
    unlock()
    void queued.finally(() => {
      if (operationQueues.get(db) === state && state.outstanding === 0) {
        operationQueues.delete(db)
      }
    })
  }
}

export const runIdentityOperation = async (db, operation, options) => {
  const release = await acquireIdentityOperation(db, options)
  try {
    return await operation()
  } finally {
    release()
  }
}
