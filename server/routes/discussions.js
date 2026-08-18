import { Router } from 'express'
import {
  listDiscussions,
  getDiscussion,
  createDiscussion,
  updateDiscussion,
  deleteDiscussion,
  pinDiscussion,
  unpinDiscussion,
  addComment,
  deleteComment,
  toggleLike,
} from '../controllers/discussionsController.js'

const router = Router()

router.get('/discussions', listDiscussions)
router.get('/discussions/:id', getDiscussion)
router.post('/discussions', createDiscussion)
router.put('/discussions/:id', updateDiscussion)
router.delete('/discussions/:id', deleteDiscussion)
router.post('/discussions/:id/pin', pinDiscussion)
router.delete('/discussions/:id/pin', unpinDiscussion)
router.post('/discussions/:id/comments', addComment)
router.delete('/discussions/comments/:id', deleteComment)
router.post('/discussions/like', toggleLike)

export default router
