import { getIdentityDb } from '../db.js'
import { loadIdentityConfig } from '../identity/config.js'
import { requireUser } from '../middleware/auth.js'
import {
  ConnectedApplicationError,
  listConnectedApplications,
  revokeConnectedApplication,
} from '../services/connectedApps.js'

const sendConnectedAppError = (res, error) => {
  if (error instanceof ConnectedApplicationError) {
    return res.status(error.status).json({ error: error.code, message: error.message })
  }
  throw error
}
export const listMyConnectedApps = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return undefined
  try {
    const config = loadIdentityConfig()
    const applications = await listConnectedApplications(auth.db, {
      accountId: auth.user.id,
      client: config.client,
    })
    return res.json({ applications })
  } catch (error) {
    return sendConnectedAppError(res, error)
  }
}

export const revokeMyConnectedApp = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return undefined
  try {
    const config = loadIdentityConfig()
    const result = await revokeConnectedApplication(await getIdentityDb(), {
      accountId: auth.user.id,
      applicationId: String(req.params.id || ''),
      client: config.client,
    })
    const [application] = await listConnectedApplications(auth.db, {
      accountId: auth.user.id,
      client: config.client,
    })
    const status = result.status === 'revocation_pending' ? 202 : 200
    return res.status(status).json({
      success: true,
      application,
      message: result.status === 'revocation_pending'
        ? '界芽授权已失效，后台正在完成撤销。'
        : '界芽当前没有有效授权。',
    })
  } catch (error) {
    return sendConnectedAppError(res, error)
  }
}
