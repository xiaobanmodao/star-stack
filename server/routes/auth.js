import { Router } from 'express'
import {
  sendRegisterEmailCode,
  register,
  login,
  getMe,
  logout,
  updateName,
  updatePassword,
  updateAvatar,
} from '../controllers/authController.js'

const router = Router()

router.post('/register', register)
router.post('/register/email-code', sendRegisterEmailCode)
router.post('/login', login)
router.get('/me', getMe)
router.post('/logout', logout)
router.patch('/me/name', updateName)
router.post('/me/password', updatePassword)
router.post('/me/avatar', updateAvatar)

export default router
