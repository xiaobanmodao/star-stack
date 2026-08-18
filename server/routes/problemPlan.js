import { Router } from 'express'
import {
  getProblemPlan,
  addToPlan,
  removeFromPlan,
  completePlanItem,
} from '../controllers/problemPlanController.js'

const router = Router()

router.get('/', getProblemPlan)
router.post('/', addToPlan)
router.delete('/:id', removeFromPlan)
router.put('/:id/complete', completePlanItem)

export default router
