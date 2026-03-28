import { useRef, useEffect } from 'react'

export default function RichTextEditor({ value, onChange, placeholder }: { value: string; onChange: (html: string) => void; placeholder?: string }) {
  const editorRef = useRef<HTMLDivElement>(null)
  const isInternalChange = useRef(false)

  useEffect(() => {
    if (editorRef.current && !isInternalChange.current) {
      if (editorRef.current.innerHTML !== value) {
        editorRef.current.innerHTML = value
      }
    }
    isInternalChange.current = false
  }, [value])

  const execCmd = (cmd: string, val?: string) => {
    editorRef.current?.focus()
    document.execCommand(cmd, false, val)
    isInternalChange.current = true
    onChange(editorRef.current?.innerHTML || '')
  }

  const handleInput = () => {
    isInternalChange.current = true
    onChange(editorRef.current?.innerHTML || '')
  }

  const insertCodeBlock = () => {
    editorRef.current?.focus()
    document.execCommand('insertHTML', false, '<pre><code>code here</code></pre><p><br></p>')
    isInternalChange.current = true
    onChange(editorRef.current?.innerHTML || '')
  }

  const insertLink = () => {
    const url = prompt('输入链接地址：', 'https://')
    if (url) execCmd('createLink', url)
  }

  return (
    <div className="rich-editor-wrap">
      <div className="rich-editor-toolbar">
        <button type="button" title="粗体" onMouseDown={e => { e.preventDefault(); execCmd('bold') }}><strong>B</strong></button>
        <button type="button" title="斜体" onMouseDown={e => { e.preventDefault(); execCmd('italic') }}><em>I</em></button>
        <button type="button" title="行内代码" onMouseDown={e => { e.preventDefault(); execCmd('insertHTML', '<code>code</code>') }}>&lt;/&gt;</button>
        <button type="button" title="代码块" onMouseDown={e => { e.preventDefault(); insertCodeBlock() }}>{'{ }'}</button>
        <button type="button" title="链接" onMouseDown={e => { e.preventDefault(); insertLink() }}>🔗</button>
        <button type="button" title="无序列表" onMouseDown={e => { e.preventDefault(); execCmd('insertUnorderedList') }}>• list</button>
        <button type="button" title="有序列表" onMouseDown={e => { e.preventDefault(); execCmd('insertOrderedList') }}>1. list</button>
      </div>
      <div
        ref={editorRef}
        className="rich-editor-content"
        contentEditable
        onInput={handleInput}
        data-placeholder={placeholder || '输入内容...'}
        suppressContentEditableWarning
      />
    </div>
  )
}
