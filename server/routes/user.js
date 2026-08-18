import { Router } from 'express'
import {
  getUserProfile,
  getUserHeatmap,
  getRatingHistory,
  getWeeklyStats,
  getUserAchievements,
  getSocialProfile,
  updateBio,
  markOnboarded,
} from '../controllers/userController.js'

const router = Router()

router.get('/user/profile/:userId', getUserProfile)
router.get('/user/heatmap/:userId', getUserHeatmap)
router.get('/user/rating-history/:userId', getRatingHistory)
router.get('/user/weekly-stats/:userId', getWeeklyStats)
router.get('/user/achievements/:userId', getUserAchievements)
router.get('/users/:id/profile', getSocialProfile)
router.put('/me/bio', updateBio)
router.post('/me/onboarded', markOnboarded)

export default router
