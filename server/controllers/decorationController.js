import { requireUser } from '../middleware/auth.js'
import { serializeUser } from '../utils/userHelpers.js'
import {
  getDecorationOptions,
  validateDecorationSelection,
} from '../utils/decorations.js'

export const getMyDecorations = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  try {
    return res.json(await getDecorationOptions(auth.db, auth.user))
  } catch (error) {
    console.error('Failed to load decorations:', error)
    return res.status(500).json({ message: '获取装饰选项失败' })
  }
}

export const updateMyDecorations = async (req, res) => {
  const auth = await requireUser(req, res)
  if (!auth) return
  try {
    const current = await getDecorationOptions(auth.db, auth.user)
    const body = req.body || {}
    const selection = {
      avatarFrame: body.avatarFrame ?? current.equipped.avatarFrame,
      avatarOverlay: body.avatarOverlay ?? current.equipped.avatarOverlay,
      equippedTitle: Object.prototype.hasOwnProperty.call(body, 'equippedTitle')
        ? body.equippedTitle
        : current.equipped.equippedTitle,
    }
    if (selection.equippedTitle !== null && typeof selection.equippedTitle !== 'string') {
      return res.status(400).json({ message: '称号选择无效' })
    }
    const error = validateDecorationSelection(current, selection)
    if (error) return res.status(400).json({ message: error })

    await auth.db.run(
      `UPDATE users
       SET avatar_frame = ?, avatar_overlay = ?, equipped_title = ?
       WHERE id = ?`,
      selection.avatarFrame,
      selection.avatarOverlay,
      selection.equippedTitle,
      auth.user.id,
    )
    auth.user.avatar_frame = selection.avatarFrame
    auth.user.avatar_overlay = selection.avatarOverlay
    auth.user.equipped_title = selection.equippedTitle
    const user = await serializeUser(auth.db, auth.user)
    const decorations = await getDecorationOptions(auth.db, auth.user)
    return res.json({ success: true, user, decorations, ...decorations })
  } catch (error) {
    console.error('Failed to update decorations:', error)
    return res.status(500).json({ message: '保存装饰失败' })
  }
}
