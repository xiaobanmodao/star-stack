import { access, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  assertJudgeKernelPrerequisites,
  assertJudgeSystemdUnit,
} from './systemdSandboxContract.mjs'

describe('StarStack judge systemd boundary', () => {
  it('keeps the API unit hardened without mount protections that break the nested judge sandbox', async () => {
    const unit = await readFile('infra/identity/systemd/starstack-api.service', 'utf8')
    expect(() => assertJudgeSystemdUnit(unit)).not.toThrow()
  })

  it('requires kernel log restriction as the compensating host control', () => {
    expect(() => assertJudgeKernelPrerequisites({ dmesgRestrict: '0' })).toThrow(/dmesg_restrict/)
    expect(() => assertJudgeKernelPrerequisites({ dmesgRestrict: '1\n' })).not.toThrow()
  })

  it('ships both transient probes and freezes the deployment/rollback sequence', async () => {
    await expect(access('scripts/judge/systemd-sandbox-contract.sh')).resolves.toBeUndefined()
    await expect(access('scripts/judge/verify-installed-systemd-sandbox.sh')).resolves.toBeUndefined()
    const [workflow, guide] = await Promise.all([
      readFile('.github/workflows/ci.yml', 'utf8'),
      readFile('infra/identity/PRODUCTION.md', 'utf8'),
    ])
    expect(workflow).toContain('systemd-sandbox-contract.sh')
    expect(guide).toContain('STARSTACK_JUDGE_SANDBOX_CONFIRM=VERIFY_ONLY')
    expect(guide).toContain('starstack-api.service.pre-ss-judge-001')
    expect(guide).toContain('production-judge-fixture.mjs')
    expect(guide).toContain('旧 unit 会继续让评测失败关闭')
  })
})
