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
  getAdminMetrics,
  getAdminProblemReview,
  listAdminReports,
  resolveReport,
  adminDeleteMessage,
  listAdminProblems,
  setProblemStatus,
  deleteAdminProblem,
  deleteAdminDiscussion,
  deleteAdminComment,
  listAdminAuditLogs,
} from '../controllers/adminController.js'
import { requireAdminMiddleware } from '../middleware/auth.js'

const router = Router()

// 所有 /api/admin/* 接口先经过统一管理员校验，控制器内的校验用于复用身份信息。
router.use(requireAdminMiddleware)

// User management
router.get('/users', listAdminUsers)
router.post('/users', createAdminUser)
router.post('/users/:id/promote', promoteUser)
router.post('/users/:id/demote', demoteUser)
router.post('/users/:id/reset-password', resetPassword)
router.post('/users/:id/ban', banUser)
router.delete('/users/:id', deleteAdminUser)

// Problem moderation
router.get('/problems', listAdminProblems)
router.get('/problems/:id/review', getAdminProblemReview)
router.post('/problems/:id/status', setProblemStatus)
router.delete('/problems/:id', deleteAdminProblem)

// Dashboard stats
router.get('/stats', getAdminStats)
router.get('/metrics', getAdminMetrics)

// Reports
router.get('/reports', listAdminReports)
router.post('/reports/:id/resolve', resolveReport)

// Chat message moderation
router.delete('/messages/:id', adminDeleteMessage)
router.delete('/discussions/posts/:id', deleteAdminDiscussion)
router.delete('/discussions/comments/:id', deleteAdminComment)

// Audit log
router.get('/audit-logs', listAdminAuditLogs)

export default router
