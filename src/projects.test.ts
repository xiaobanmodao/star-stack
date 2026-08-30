import { describe, expect, it } from 'vitest'
import { PORTAL_PROJECTS } from './projects'

describe('project portal registry', () => {
  it('publishes Jieya only through the canonical production entry', () => {
    const jieya = PORTAL_PROJECTS.find((project) => project.id === 'jieya')

    expect(jieya).toMatchObject({
      name: '界芽计划',
      kind: 'external',
      href: 'https://jieya.xingzhan.cc',
      actionLabel: '进入游戏',
    })
    expect(jieya?.accountHint).toContain('使用星栈账号')
    expect(jieya?.accountHint).toContain('游客模式')
    expect(JSON.stringify(jieya)).not.toContain('github.io')
  })
})
