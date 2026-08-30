import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getIdentityDb: vi.fn(),
  loadIdentityConfig: vi.fn(),
  listConnectedApplications: vi.fn(),
  revokeConnectedApplication: vi.fn(),
}))

vi.mock('../middleware/auth.js', () => ({ requireUser: mocks.requireUser }))
vi.mock('../db.js', () => ({ getIdentityDb: mocks.getIdentityDb }))
vi.mock('../identity/config.js', () => ({ loadIdentityConfig: mocks.loadIdentityConfig }))
vi.mock('../services/connectedApps.js', () => ({
  ConnectedApplicationError: class ConnectedApplicationError extends Error {},
  listConnectedApplications: mocks.listConnectedApplications,
  revokeConnectedApplication: mocks.revokeConnectedApplication,
}))

import { listMyConnectedApps, revokeMyConnectedApp } from './connectedAppsController.js'

const application = {
  id: 'jieya',
  name: '界芽计划',
  homepage: 'https://jieya.xingzhan.cc',
  status: 'connected',
  permissions: [],
  connectedAt: '2026-08-31T12:00:00.000Z',
  sessionCount: 1,
  canRevoke: true,
}
const createResponse = () => ({
  status: vi.fn().mockReturnThis(),
  json: vi.fn().mockReturnThis(),
})
describe('connected applications controller', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadIdentityConfig.mockReturnValue({ client: { id: 'jieya-server-local' } })
    mocks.requireUser.mockResolvedValue({ db: { name: 'public-db' }, user: { id: 'alice' } })
    mocks.getIdentityDb.mockResolvedValue({ name: 'identity-db' })
    mocks.listConnectedApplications.mockResolvedValue([application])
  })

  it('preserves the normal authentication boundary', async () => {
    const response = createResponse()
    mocks.requireUser.mockImplementation(async (_req, res) => {
      res.status(401).json({ message: '未登录' })
      return null
    })

    await listMyConnectedApps({}, response)

    expect(response.status).toHaveBeenCalledWith(401)
    expect(mocks.listConnectedApplications).not.toHaveBeenCalled()
  })

  it('lists only serialized application metadata', async () => {
    const response = createResponse()

    await listMyConnectedApps({}, response)

    expect(response.json).toHaveBeenCalledWith({ applications: [application] })
    expect(JSON.stringify(response.json.mock.calls[0][0])).not.toMatch(/account_subject|is_admin|clientId/)
  })

  it('uses the serialized identity connection and returns an async revocation state', async () => {
    const response = createResponse()
    mocks.revokeConnectedApplication.mockResolvedValue({
      changed: true,
      status: 'revocation_pending',
      generation: 1,
    })
    mocks.listConnectedApplications.mockResolvedValue([{
      ...application,
      status: 'revocation_pending',
      connectedAt: null,
      sessionCount: 0,
      canRevoke: false,
    }])

    await revokeMyConnectedApp({ params: { id: 'jieya' } }, response)

    expect(mocks.revokeConnectedApplication).toHaveBeenCalledWith(
      { name: 'identity-db' },
      expect.objectContaining({ accountId: 'alice', applicationId: 'jieya' }),
    )
    expect(response.status).toHaveBeenCalledWith(202)
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      application: expect.objectContaining({ status: 'revocation_pending' }),
    }))
  })
})
