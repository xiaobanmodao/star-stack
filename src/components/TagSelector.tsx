import { useMemo, useState, type MouseEvent } from 'react'
import { PRESET_TAGS } from '../constants'

type TagSelectorProps = {
  selectedTags: string[]
  onTagsChange: (tags: string[]) => void
}

export default function TagSelector({ selectedTags, onTagsChange }: TagSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const filteredTags = useMemo(() => {
    if (!searchQuery.trim()) {
      return PRESET_TAGS
    }
    const query = searchQuery.toLowerCase()
    return PRESET_TAGS.filter((tag) => tag.toLowerCase().includes(query))
  }, [searchQuery])

  const handleTagClick = (tag: string) => {
    if (selectedTags.includes(tag)) {
      onTagsChange(selectedTags.filter((item) => item !== tag))
      return
    }
    onTagsChange([...selectedTags, tag])
  }

  const handleRemoveTag = (tag: string, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onTagsChange(selectedTags.filter((item) => item !== tag))
  }

  return (
    <div className="tag-selector">
      <div className="tag-selector-input" onClick={() => setIsOpen(true)}>
        <div className="selected-tags">
          {selectedTags.length === 0 ? (
            <span className="tag-placeholder">点击选择标签</span>
          ) : (
            selectedTags.map((tag) => (
              <span key={tag} className="selected-tag">
                {tag}
                <button
                  className="remove-tag-btn"
                  onClick={(event) => handleRemoveTag(tag, event)}
                  type="button"
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>
        <button type="button" className="tag-selector-btn">
          选择标签
        </button>
      </div>

      {isOpen && (
        <div className="tag-selector-modal" onClick={() => setIsOpen(false)}>
          <div className="tag-selector-content" onClick={(event) => event.stopPropagation()}>
            <div className="tag-selector-header">
              <h3>选择标签</h3>
              <button
                className="tag-selector-close"
                onClick={() => setIsOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>

            <div className="tag-selector-search">
              <input
                type="text"
                className="auth-input"
                placeholder="搜索标签..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                autoFocus
              />
            </div>

            <div className="tag-selector-body">
              {filteredTags.length === 0 ? (
                <div className="tag-selector-empty">未找到匹配的标签</div>
              ) : (
                <div className="tag-selector-grid">
                  {filteredTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className={`tag-selector-item ${selectedTags.includes(tag) ? 'selected' : ''}`}
                      onClick={() => handleTagClick(tag)}
                    >
                      {tag}
                      {selectedTags.includes(tag) && <span className="tag-check">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="tag-selector-footer">
              <div className="tag-selector-count">
                已选择 {selectedTags.length} 个标签
              </div>
              <button
                className="primary"
                onClick={() => setIsOpen(false)}
                type="button"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
