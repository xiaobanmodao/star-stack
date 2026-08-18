import { Router } from 'express'
import {
  listChannels,
  listRooms, createRoom, getRoom, joinRoom, leaveRoom, deleteRoom, inviteMember, removeMember,
  listRoomMessages, sendRoomMessage, roomStream,
  typingIndicator, toggleReaction,
  getThreadReplies, addThreadReply,
  createInviteLink, getInviteLink, joinViaInviteLink,
  toggleBookmark, listBookmarks, getBookmarkStatus,
  markChatRead, updatePresence, getPresence, searchChat, getChatUnread,
  getMyCheckin, doCheckin,
  getMyChatStats, getUserChatAchievements, getActivityLeaderboard,
  createReport,
} from '../controllers/chatController.js'

const router = Router()

router.get('/chat/channels', listChannels)
router.get('/chat/rooms', listRooms)
router.post('/chat/rooms', createRoom)
router.get('/chat/rooms/invite/:token', getInviteLink)
router.post('/chat/rooms/invite/:token/join', joinViaInviteLink)
router.get('/chat/rooms/:id', getRoom)
router.post('/chat/rooms/:id/join', joinRoom)
router.post('/chat/rooms/:id/leave', leaveRoom)
router.delete('/chat/rooms/:id', deleteRoom)
router.post('/chat/rooms/:id/members', inviteMember)
router.delete('/chat/rooms/:id/members/:userId', removeMember)
router.get('/chat/rooms/:id/messages', listRoomMessages)
router.post('/chat/rooms/:id/messages', sendRoomMessage)
router.get('/chat/rooms/:id/stream', roomStream)
router.post('/chat/rooms/:id/invite-link', createInviteLink)

router.post('/chat/typing', typingIndicator)
router.post('/chat/messages/:id/reactions', toggleReaction)
router.get('/chat/messages/:id/replies', getThreadReplies)
router.post('/chat/messages/:id/replies', addThreadReply)

router.post('/bookmarks', toggleBookmark)
router.get('/bookmarks', listBookmarks)
router.get('/bookmarks/status', getBookmarkStatus)

router.post('/chat/read', markChatRead)
router.post('/chat/presence', updatePresence)
router.get('/chat/presence', getPresence)
router.get('/chat/search', searchChat)
router.get('/chat/unread', getChatUnread)

router.get('/me/checkin', getMyCheckin)
router.post('/me/checkin', doCheckin)

router.get('/chat/stats/me', getMyChatStats)
router.get('/chat/achievements/:userId', getUserChatAchievements)
router.get('/chat/activity/leaderboard', getActivityLeaderboard)

router.post('/reports', createReport)

export default router
