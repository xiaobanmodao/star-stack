import { describe, expect, it } from 'vitest'
import { getSubmissionActionPlan } from './submissionFeedback'

describe('submission feedback actions', () => {
  it('guides failed submissions back to the IDE and support content', () => {
    expect(getSubmissionActionPlan('wrong', 'fail').map((action) => action.key)).toEqual([
      'edit',
      'solutions',
      'discussion',
      'records',
    ])
  })

  it('offers retry first when the judge service fails', () => {
    expect(getSubmissionActionPlan('judge', 'fail')[0]).toMatchObject({
      key: 'retry',
      variant: 'primary',
    })
  })

  it('keeps accepted users moving toward the problem set and growth records', () => {
    expect(getSubmissionActionPlan('accepted', 'success').map((action) => action.key)).toEqual([
      'problemset',
      'solutions',
      'records',
      'account',
    ])
  })
})
