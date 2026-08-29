import { describe, expect, it } from 'vitest'
import { acquireIdentityOperation } from './identityOperation.js'

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

describe('identity operation queue', () => {
  it('rejects immediately when the hard pending limit is reached and recovers after release', async () => {
    const db = {}
    const releaseFirst = await acquireIdentityOperation(db, { maxPending: 2 })
    const second = acquireIdentityOperation(db, { maxPending: 2 })
    await Promise.resolve()
    const third = acquireIdentityOperation(db, { maxPending: 2 })
    const earlyOutcome = await Promise.race([
      third.then(() => 'acquired', () => 'rejected'),
      delay(25).then(() => 'pending'),
    ])

    releaseFirst()
    const releaseSecond = await second
    releaseSecond()
    if (earlyOutcome === 'pending') {
      const releaseThird = await third
      releaseThird()
    }

    expect(earlyOutcome).toBe('rejected')
    const releaseAfterDrain = await acquireIdentityOperation(db, { maxPending: 2 })
    releaseAfterDrain()
  })
})
