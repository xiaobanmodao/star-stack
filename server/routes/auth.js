import { Router } from 'express'
import {
  sendRegisterEmailCode,
  sendEmailChangeCode,
  register,
  updateEmail,
  login,
  getMe,
  logout,
  listSessions,
  revokeOtherSessions,
  revokeSession,
  updateName,
  updatePassword,
  updateAvatar,
} from '../controllers/authController.js'
import { createRateLimiter } from '../middleware/rateLimit.js'

const router = Router()
const loginLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 30, message: '登录请求过于频繁，请 10 分钟后再试' })
const registerLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 10, message: '注册请求过于频繁，请稍后再试' })
const emailCodeLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 10, message: '验证码请求过于频繁，请稍后再试' })

router.post('/register', registerLimiter, register)
router.post('/register/email-code', emailCodeLimiter, sendRegisterEmailCode)
router.post('/me/email-code', emailCodeLimiter, sendEmailChangeCode)
router.patch('/me/email', updateEmail)
router.post('/login', loginLimiter, login)
router.get('/me', getMe)
router.post('/logout', logout)
router.get('/me/sessions', listSessions)
router.post('/me/sessions/revoke-others', revokeOtherSessions)
router.delete('/me/sessions/:id', revokeSession)
router.patch('/me/name', updateName)
router.post('/me/password', updatePassword)
router.post('/me/avatar', updateAvatar)

export default router
