import { TOKEN_KEY } from '../constants'
import type { ChatStreamEvent } from '../types'

/**
 * 订阅聊天流（SSE over fetch）。
 * 与评测进度流（OjJudgePage）同一模式：fetch + ReadableStream 逐行解析 data: 事件。
 * 断线后自动重连（3 秒退避）。
 */
export function subscribeChatStream(
  scopePath: string,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal
): () => void {
  let aborted = false
  let retryTimer: number | null = null
  let controller: AbortController | null = null

  const connect = async () => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token || aborted) return
    try {
      controller = new AbortController()
      const abortFromOutside = () => controller?.abort()
      signal?.addEventListener('abort', abortFromOutside)

      const response = await fetch(`/api/chat/${scopePath}/stream`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
      if (!response.ok || !response.body) {
        throw new Error(`stream failed: ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() ?? ''
        for (const chunk of chunks) {
          const line = chunk.trim()
          if (!line.startsWith('data: ')) continue
          try {
            onEvent(JSON.parse(line.slice(6)) as ChatStreamEvent)
          } catch {
            // 忽略无法解析的事件
          }
        }
      }
      signal?.removeEventListener('abort', abortFromOutside)
    } catch {
      // 连接断开或中止
    }
    if (!aborted) {
      retryTimer = window.setTimeout(connect, 3000)
    }
  }

  void connect()

  return () => {
    aborted = true
    if (retryTimer !== null) window.clearTimeout(retryTimer)
    controller?.abort()
  }
}

/** 相对时间格式化（聊天消息时间戳） */
export function formatChatTime(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  if (sameDay) return time
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`
}
