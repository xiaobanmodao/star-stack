import { Router } from 'express'
import {
  listMySubmissions,
  getLatestSubmission,
  listAllSubmissions,
  getSubmission,
  cancelSubmission,
  getJudgeStatus,
  submitSolution,
  streamSubmission,
  runSampleHandler,
  runCustomHandler,
  runSamplesHandler,
} from '../controllers/submissionsController.js'

const router = Router()

router.get('/oj/submissions', listMySubmissions)
router.get('/oj/submissions/latest', getLatestSubmission)
router.get('/oj/submissions/all', listAllSubmissions)
router.get('/oj/submissions/:id', getSubmission)
router.post('/oj/submissions/:id/cancel', cancelSubmission)
router.get('/oj/judge/status', getJudgeStatus)
router.post('/oj/submissions', submitSolution)
router.post('/oj/submissions/stream', streamSubmission)
router.post('/oj/run-sample', runSampleHandler)
router.post('/oj/run-custom', runCustomHandler)
router.post('/oj/run-samples', runSamplesHandler)

export default router
