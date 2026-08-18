import { Router } from 'express'
import {
  searchUsers,
  listConversations,
  getConversation,
  sendMessage,
  markRead,
  getUnreadCount,
  unreadStream,
  deleteMessage,
} from '../controllers/messagesController.js'

const router = Router()

router.get('/users/search', searchUsers)
router.get('/messages/conversations', listConversations)
router.get('/messages/conversations/:userId', getConversation)
router.post('/messages/conversations/:userId', sendMessage)
router.post('/messages/conversations/:userId/read', markRead)
router.get('/messages/unread-count', getUnreadCount)
router.get('/messages/unread-stream', unreadStream)
router.delete('/messages/:messageId', deleteMessage)

export default router
