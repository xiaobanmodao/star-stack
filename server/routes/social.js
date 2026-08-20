import { Router } from 'express'
import {
  followUser, unfollowUser,
  blockUser, unblockUser, listBlocks,
  listFriends, listFollowing, listFollowers,
} from '../controllers/socialController.js'
import {
  getVapidPublicKey, subscribePush, unsubscribePush,
  listNotifications, getNotificationsUnreadCount, markNotificationsRead,
} from '../controllers/notificationsController.js'

const router = Router()

router.post('/users/:id/follow', followUser)
router.delete('/users/:id/follow', unfollowUser)
router.post('/users/:id/block', blockUser)
router.delete('/users/:id/block', unblockUser)
router.get('/me/blocks', listBlocks)
router.get('/me/friends', listFriends)
router.get('/me/following', listFollowing)
router.get('/me/followers', listFollowers)
router.get('/push/vapid-public-key', getVapidPublicKey)
router.post('/push/subscribe', subscribePush)
router.delete('/push/subscribe', unsubscribePush)

router.get('/notifications', listNotifications)
router.get('/notifications/unread-count', getNotificationsUnreadCount)
router.post('/notifications/read', markNotificationsRead)

export default router
