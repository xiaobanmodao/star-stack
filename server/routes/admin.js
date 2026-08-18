import { Router } from 'express'
import {
  listAdminUsers,
  createAdminUser,
  promoteUser,
  demoteUser,
  resetPassword,
  banUser,
  deleteAdminUser,
  getAdminStats,
  listAdminReports,
  resolveReport,
  adminDeleteMessage,
} from '../controllers/adminController.js'

const router = Router()

// User management
router.get('/users', listAdminUsers)
router.post('/users', createAdminUser)
router.post('/users/:id/promote', promoteUser)
router.post('/users/:id/demote', demoteUser)
router.post('/users/:id/reset-password', resetPassword)
router.post('/users/:id/ban', banUser)
router.delete('/users/:id', deleteAdminUser)

// Dashboard stats
router.get('/stats', getAdminStats)

// Reports
router.get('/reports', listAdminReports)
router.post('/reports/:id/resolve', resolveReport)

// Chat message moderation
router.delete('/messages/:id', adminDeleteMessage)

export default router
