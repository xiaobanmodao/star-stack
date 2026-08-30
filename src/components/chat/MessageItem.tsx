import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppContext } from '../../context/AppContext'
import type { ChatMessage } from '../../types'
import { formatChatTime } from '../../utils/chat'
import ChatContent from './ChatContent'
import { PRESET_EMOJIS } from './chatMeta'
import DecoratedAvatar from '../profile/DecoratedAvatar'

/** 线程面板内的紧凑回复项 */
function ThreadReplyItem({
  reply,
  onToggleReaction,
}: {
  reply: ChatMessage
  onToggleReaction: (emoji: string) => void
}) {
  const navigate = useNavigate()
  const { currentUser } = useAppContext()
  const [showEmojiBar, setShowEmojiBar] = useState(false)
  const mine = reply.senderId === currentUser?.id
  return (
    <div className={`chat-thread-reply ${mine ? 'mine' : ''}`}>
      <button
        type="button"
        className="chat-thread-reply-avatar"
        onClick={() => navigate(`/user/${reply.senderId}`)}
        title="查看个人主页"
      >
        <DecoratedAvatar
          avatar={reply.senderAvatar}
          fallback={reply.senderName.charAt(0).toUpperCase()}
          frame={reply.senderAvatarFrame}
          overlay={reply.senderAvatarOverlay}
          size="discussion"
          loading="lazy"
        />
      </button>
      <div className="chat-thread-reply-body">
        <div className="chat-thread-reply-head">
          <strong>{reply.senderName}</strong>
          {reply.senderDisplayTitle && <span className="chat-message-user-title">{reply.senderDisplayTitleIcon || '✦'} {reply.senderDisplayTitle}</span>}
          <span>{formatChatTime(reply.createdAt)}</span>
        </div>
        <ChatContent content={reply.content} />
        <div className="chat-thread-reply-foot">
          {reply.reactions.map((reaction) => (
            <button
              key={reaction.emoji}
              type="button"
              className={`chat-reaction-chip small ${reaction.mine ? 'mine' : ''}`}
              onClick={() => onToggleReaction(reaction.emoji)}
            >
              <span>{reaction.emoji}</span>
              <em>{reaction.count}</em>
            </button>
          ))}
          <button
            type="button"
            className="chat-reaction-add small"
            onClick={() => setShowEmojiBar((prev) => !prev)}
            aria-label="添加表情回应"
          >
            {showEmojiBar ? '✕' : '＋'}
          </button>
          {showEmojiBar && (
            <span className="chat-emoji-bar">
              {PRESET_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    onToggleReaction(emoji)
                    setShowEmojiBar(false)
                  }}
                >
                  {emoji}
                </button>
              ))}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function MessageItem({
  message,
  mine,
  onToggleReaction,
  threadOpen,
  threadReplies,
  threadLoading,
  onToggleThread,
  onSendReply,
  onToggleReplyReaction,
}: {
  message: ChatMessage
  mine: boolean
  onToggleReaction: (emoji: string) => void
  threadOpen?: boolean
  threadReplies?: ChatMessage[]
  threadLoading?: boolean
  onToggleThread?: () => void
  onSendReply?: (content: string) => void
  onToggleReplyReaction?: (replyId: number, emoji: string) => void
}) {
  const navigate = useNavigate()
  const [showEmojiBar, setShowEmojiBar] = useState(false)
  const [replyText, setReplyText] = useState('')

  const handleSendReply = () => {
    const text = replyText.trim()
    if (!text || !onSendReply) return
    onSendReply(text)
    setReplyText('')
  }

  return (
    <div className={`chat-message ${mine ? 'mine' : ''}`}>
      <button
        type="button"
        className="chat-message-avatar"
        onClick={() => navigate(`/user/${message.senderId}`)}
        title="查看个人主页"
      >
        <DecoratedAvatar
          avatar={message.senderAvatar}
          fallback={message.senderName.charAt(0).toUpperCase()}
          frame={message.senderAvatarFrame}
          overlay={message.senderAvatarOverlay}
          size="discussion"
          loading="lazy"
        />
      </button>
      <div className="chat-message-body">
        <div className="chat-message-head">
          <strong className="chat-message-name">{message.senderName}</strong>
          {message.senderDisplayTitle && <span className="chat-message-user-title">{message.senderDisplayTitleIcon || '✦'} {message.senderDisplayTitle}</span>}
          <span className="chat-message-time">{formatChatTime(message.createdAt)}</span>
        </div>
        <ChatContent content={message.content} />
        {(message.reactions.length > 0 || showEmojiBar) && (
          <div className="chat-message-reactions">
            {message.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                type="button"
                className={`chat-reaction-chip ${reaction.mine ? 'mine' : ''}`}
                onClick={() => onToggleReaction(reaction.emoji)}
              >
                <span>{reaction.emoji}</span>
                <em>{reaction.count}</em>
              </button>
            ))}
            <button
              type="button"
              className="chat-reaction-add"
              onClick={() => setShowEmojiBar((prev) => !prev)}
              aria-label="添加表情回应"
            >
              {showEmojiBar ? '✕' : '＋'}
            </button>
            {showEmojiBar && (
              <div className="chat-emoji-bar">
                {PRESET_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      onToggleReaction(emoji)
                      setShowEmojiBar(false)
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {onToggleThread && (
          <button type="button" className="chat-thread-toggle" onClick={onToggleThread}>
            💬 {message.threadReplyCount} 条回复
            <span className="chat-thread-toggle-arrow">{threadOpen ? '▾' : '▸'}</span>
          </button>
        )}
        {threadOpen && (
          <div className="chat-thread-panel">
            {threadLoading ? (
              <div className="chat-thread-loading">加载回复...</div>
            ) : (
              <div className="chat-thread-replies">
                {(threadReplies || []).map((reply) => (
                  <ThreadReplyItem
                    key={reply.id}
                    reply={reply}
                    onToggleReaction={(emoji) => onToggleReplyReaction?.(reply.id, emoji)}
                  />
                ))}
                {(threadReplies || []).length === 0 && (
                  <div className="chat-thread-empty">还没有回复，说点什么吧</div>
                )}
              </div>
            )}
            {onSendReply && (
              <div className="chat-thread-composer">
                <input
                  type="text"
                  value={replyText}
                  onChange={(event) => setReplyText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      handleSendReply()
                    }
                  }}
                  placeholder="回复此消息..."
                />
                <button
                  type="button"
                  className="chat-send-btn small"
                  onClick={handleSendReply}
                  disabled={!replyText.trim()}
                >
                  回复
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
