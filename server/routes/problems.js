import { Router } from 'express'
import {
  getDailyProblem,
  listProblems,
  getProblem,
  listSolutions,
  createSolution,
  createProblem,
  getMyProblems,
  getProblemForEdit,
  updateProblem,
  submitProblemForReview,
  deleteProblem,
} from '../controllers/problemsController.js'

const router = Router()

router.get('/problems/daily', getDailyProblem)
router.get('/oj/problems', listProblems)
router.get('/oj/problems/:id', getProblem)
router.get('/oj/problems/:id/solutions', listSolutions)
router.post('/oj/problems/:id/solutions', createSolution)
router.post('/problems', createProblem)
router.get('/my-problems', getMyProblems)
router.get('/problems/:id/edit', getProblemForEdit)
router.put('/problems/:id', updateProblem)
router.post('/problems/:id/submit-review', submitProblemForReview)
router.delete('/problems/:id', deleteProblem)

export default router
