import { useMemo, useState, type ReactNode } from 'react'
import { highlightCode } from '../../utils/highlight'

type ContentBlock =
  | { type: 'code'; lang: string; code: string }
  | { type: 'text'; text: string }

const splitBlocks = (content: string): ContentBlock[] => {
  const blocks: ContentBlock[] = []
  const fencePattern = /```([\w+-]*)\n?([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = fencePattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({ type: 'text', text: content.slice(lastIndex, match.index) })
    }
    blocks.push({ type: 'code', lang: match[1] || 'plaintext', code: match[2].replace(/\n$/, '') })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < content.length) {
    blocks.push({ type: 'text', text: content.slice(lastIndex) })
  }
  return blocks
}

const LINK_PATTERN = /(https?:\/\/[^\s<]+)/g
const BOLD_PATTERN = /\*\*([^*]+)\*\*/g
const ITALIC_PATTERN = /\*([^*]+)\*/g
const MENTION_PATTERN = /@([a-zA-Z0-9_-]{1,32})/g

/** 行内富文本：`code`、**加粗**、*斜体*、自动识别链接、@提及高亮 */
const renderInline = (text: string, keyPrefix: string): ReactNode[] => {
  // 先切出行内代码，代码段不参与其他解析
  const codeParts = text.split(/`([^`]+)`/g)
  return codeParts.map((part, index) => {
    if (index % 2 === 1) {
      return (
        <code className="chat-inline-code" key={`${keyPrefix}-c${index}`}>
          {part}
        </code>
      )
    }
    // 加粗
    const boldParts = part.split(BOLD_PATTERN)
    return boldParts.map((boldPart, boldIndex) => {
      if (boldIndex % 2 === 1) {
        return <strong key={`${keyPrefix}-b${boldIndex}`}>{boldPart}</strong>
      }
      // 斜体
      const italicParts = boldPart.split(ITALIC_PATTERN)
      return italicParts.map((italicPart, italicIndex) => {
        if (italicIndex % 2 === 1) {
          return <em key={`${keyPrefix}-i${italicIndex}`}>{italicPart}</em>
        }
        // 链接
        const linkParts = italicPart.split(LINK_PATTERN)
        return linkParts.map((linkPart, linkIndex) => {
          if (linkIndex % 2 === 1) {
            return (
              <a key={`${keyPrefix}-l${linkIndex}`} href={linkPart} target="_blank" rel="noreferrer">
                {linkPart}
              </a>
            )
          }
          // @提及
          const mentionParts = linkPart.split(MENTION_PATTERN)
          return mentionParts.map((mentionPart, mentionIndex) => {
            if (mentionIndex % 2 === 1) {
              return (
                <span className="chat-mention" key={`${keyPrefix}-m${mentionIndex}`}>
                  @{mentionPart}
                </span>
              )
            }
            return <span key={`${keyPrefix}-t${linkIndex}-${mentionIndex}`}>{mentionPart}</span>
          })
        })
      })
    })
  })
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)

  const html = useMemo(() => highlightCode(code, lang), [lang, code])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用时静默失败
    }
  }

  return (
    <div className="chat-codeblock">
      <div className="chat-codeblock-head">
        <span>{lang}</span>
        <button type="button" onClick={() => void handleCopy()}>
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="chat-codeblock-body">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  )
}

export default function ChatContent({ content }: { content: string }) {
  const blocks = useMemo(() => splitBlocks(content), [content])

  return (
    <div className="chat-content">
      {blocks.map((block, index) =>
        block.type === 'code' ? (
          <CodeBlock key={`code-${index}`} lang={block.lang} code={block.code} />
        ) : (
          <p className="chat-text-line" key={`text-${index}`}>
            {renderInline(block.text, `t${index}`)}
          </p>
        )
      )}
    </div>
  )
}
