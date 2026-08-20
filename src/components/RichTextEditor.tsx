import { useEffect, useRef, useState } from 'react'
import { renderRichText } from '../utils/richText'
import './RichTextEditor.css'

type SizeClass = 'text-sm' | 'text-lg' | 'text-xl'

export default function RichTextEditor({ value, onChange, placeholder }: { value: string; onChange: (html: string) => void; placeholder?: string }) {
  const editorRef = useRef<HTMLDivElement>(null)
  const isInternalChange = useRef(false)
  const [preview, setPreview] = useState(false)

  useEffect(() => {
    if (editorRef.current && !isInternalChange.current) {
      if (editorRef.current.innerHTML !== value) {
        editorRef.current.innerHTML = value
      }
    }
    isInternalChange.current = false
  }, [value])

  const notifyChange = () => {
    isInternalChange.current = true
    onChange(editorRef.current?.innerHTML || '')
  }

  const execCmd = (cmd: string, val?: string) => {
    editorRef.current?.focus()
    document.execCommand(cmd, false, val)
    notifyChange()
  }

  const handleInput = () => {
    isInternalChange.current = true
    onChange(editorRef.current?.innerHTML || '')
  }

  /** 把当前选区包进自定义标签（选区为空时插入占位文本） */
  const wrapSelection = (makeTag: () => HTMLElement, placeholderText?: string) => {
    editorRef.current?.focus()
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    const tag = makeTag()
    if (range.collapsed) {
      tag.textContent = placeholderText ?? ''
      range.insertNode(tag)
      range.setStartAfter(tag)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    } else {
      try {
        range.surroundContents(tag)
      } catch {
        const fragment = range.extractContents()
        tag.appendChild(fragment)
        range.insertNode(tag)
      }
    }
    notifyChange()
  }

  const wrapWithSpan = (sizeClass: SizeClass) => {
    wrapSelection(() => {
      const span = document.createElement('span')
      span.className = sizeClass
      return span
    }, sizeClass === 'text-sm' ? '小字' : sizeClass === 'text-lg' ? '大字' : '特大字')
  }

  const wrapWithLatex = (displayMode: boolean) => {
    const open = displayMode ? '\\[' : '\\('
    const close = displayMode ? '\\]' : '\\)'
    wrapSelection(() => {
      const span = document.createElement('span')
      span.textContent = `${open}公式${close}`
      return span
    }, `${open}公式${close}`)
  }

  const insertCodeBlock = () => {
    editorRef.current?.focus()
    const lang = window.prompt('代码语言（cpp / python / java / js / 留空为纯文本）：', 'cpp')
    const cls = lang && lang.trim() ? ` class="language-${lang.trim().toLowerCase()}"` : ''
    document.execCommand('insertHTML', false, `<pre><code${cls}>// 在这里写代码</code></pre><p><br></p>`)
    notifyChange()
  }

  const insertLink = () => {
    const url = window.prompt('输入链接地址：', 'https://')
    if (url) execCmd('createLink', url)
  }

  return (
    <div className="rich-editor-wrap">
      <div className="rich-editor-toolbar">
        <button type="button" title="粗体" onMouseDown={e => { e.preventDefault(); execCmd('bold') }}><strong>B</strong></button>
        <button type="button" title="斜体" onMouseDown={e => { e.preventDefault(); execCmd('italic') }}><em>I</em></button>
        <button type="button" title="下划线" onMouseDown={e => { e.preventDefault(); execCmd('underline') }}><u>U</u></button>
        <button type="button" title="删除线" onMouseDown={e => { e.preventDefault(); execCmd('strikeThrough') }}><s>S</s></button>
        <span className="rich-editor-sep" aria-hidden="true" />
        <button type="button" title="标题 2" onMouseDown={e => { e.preventDefault(); execCmd('formatBlock', 'h2') }}>H2</button>
        <button type="button" title="标题 3" onMouseDown={e => { e.preventDefault(); execCmd('formatBlock', 'h3') }}>H3</button>
        <button type="button" title="引用" onMouseDown={e => { e.preventDefault(); execCmd('formatBlock', 'blockquote') }}>❝</button>
        <span className="rich-editor-sep" aria-hidden="true" />
        <button type="button" title="行内代码" onMouseDown={e => { e.preventDefault(); execCmd('insertHTML', '<code>code</code>') }}>&lt;/&gt;</button>
        <button type="button" title="代码块（可带语言）" onMouseDown={e => { e.preventDefault(); insertCodeBlock() }}>{'{ }'}</button>
        <button type="button" title="链接" onMouseDown={e => { e.preventDefault(); insertLink() }}>🔗</button>
        <button type="button" title="无序列表" onMouseDown={e => { e.preventDefault(); execCmd('insertUnorderedList') }}>• list</button>
        <button type="button" title="有序列表" onMouseDown={e => { e.preventDefault(); execCmd('insertOrderedList') }}>1. list</button>
        <span className="rich-editor-sep" aria-hidden="true" />
        <button type="button" title="小字" onMouseDown={e => { e.preventDefault(); wrapWithSpan('text-sm') }}><span className="rich-font-sm">A</span></button>
        <button type="button" title="大字" onMouseDown={e => { e.preventDefault(); wrapWithSpan('text-lg') }}><span className="rich-font-lg">A</span></button>
        <button type="button" title="特大字" onMouseDown={e => { e.preventDefault(); wrapWithSpan('text-xl') }}><span className="rich-font-xl">A</span></button>
        <button type="button" title="行内公式 $x^2$" onMouseDown={e => { e.preventDefault(); wrapWithLatex(false) }}>ƒ(x)</button>
        <button type="button" title="块级公式 \[...\]" onMouseDown={e => { e.preventDefault(); wrapWithLatex(true) }}>∫∑</button>
        <span className="rich-editor-sep" aria-hidden="true" />
        <button type="button" title="撤销" onMouseDown={e => { e.preventDefault(); execCmd('undo') }}>↩</button>
        <button type="button" title="重做" onMouseDown={e => { e.preventDefault(); execCmd('redo') }}>↪</button>
        <button type="button" title="清除格式" onMouseDown={e => { e.preventDefault(); execCmd('removeFormat') }}>⌫</button>
        <button
          type="button"
          className={preview ? 'rich-editor-preview-btn active' : 'rich-editor-preview-btn'}
          onClick={() => setPreview((prev) => !prev)}
        >
          {preview ? '编辑' : '预览'}
        </button>
      </div>
      {preview ? (
        <div
          className="rich-editor-preview"
          dangerouslySetInnerHTML={{ __html: renderRichText(value) }}
        />
      ) : (
        <div
          ref={editorRef}
          className="rich-editor-content"
          contentEditable
          role="textbox"
          aria-label="富文本内容"
          aria-multiline="true"
          suppressContentEditableWarning
          onInput={handleInput}
          data-placeholder={placeholder}
        />
      )}
    </div>
  )
}
