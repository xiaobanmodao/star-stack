import { describe, expect, it } from 'vitest'
import {
  PROBLEM_STATUSES,
  getAdminCreateStatus,
  getCreatorUpdateStatus,
  normalizeProblemStatus,
} from './problemStatus.js'

describe('problem status workflow', () => {
  it('supports the draft, review, published and hidden states', () => {
    expect(PROBLEM_STATUSES).toEqual(['draft', 'pending_review', 'published', 'hidden'])
    expect(normalizeProblemStatus('pending_review')).toBe('pending_review')
    expect(normalizeProblemStatus('invalid', 'published')).toBe('published')
  })

  it('returns a review submission to draft after the creator edits it', () => {
    expect(getCreatorUpdateStatus('pending_review')).toBe('draft')
    expect(getCreatorUpdateStatus('draft')).toBe('draft')
    expect(getCreatorUpdateStatus('published')).toBe('draft')
    expect(getCreatorUpdateStatus('hidden')).toBe('draft')
  })

  it('only lets administrators create directly published or draft problems', () => {
    expect(getAdminCreateStatus('draft')).toBe('draft')
    expect(getAdminCreateStatus('published')).toBe('published')
    expect(getAdminCreateStatus('pending_review')).toBe('published')
  })
})
