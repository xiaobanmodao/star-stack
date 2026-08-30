import { useMemo, useState, type MouseEvent } from 'react'
import { X } from 'lucide-react'
import { PRESET_TAGS, PROBLEM_TAG_CATEGORIES } from '../constants'
import { useModalFocus } from '../hooks/useModalFocus'
import { IconButton } from './ui'
import './TagSelector.css'

type TagSelectorProps = {
  selectedTags: string[]
  onTagsChange: (tags: string[]) => void
}

export default function TagSelector({ selectedTags, onTagsChange }: TagSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('all')
  const dialogRef = useModalFocus(isOpen, () => setIsOpen(false))

  const maxTags = 8

  const filteredTags = useMemo(() => {
    const categoryTags = activeCategory === 'all'
      ? PRESET_TAGS
      : PROBLEM_TAG_CATEGORIES.find((category) => category.key === activeCategory)?.tags || PRESET_TAGS
    if (!searchQuery.trim()) return categoryTags
    const query = searchQuery.toLowerCase()
    return categoryTags.filter((tag) => tag.toLowerCase().includes(query))
  }, [activeCategory, searchQuery])

  const handleTagClick = (tag: string) => {
    if (selectedTags.includes(tag)) {
      onTagsChange(selectedTags.filter((item) => item !== tag))
      return
    }
    if (selectedTags.length >= maxTags) return
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
                  aria-label={`移除标签 ${tag}`}
                >
                  <X size={12} strokeWidth={2} aria-hidden="true" />
                </button>
              </span>
            ))
          )}
        </div>
        <button
          type="button"
          className="tag-selector-btn"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-controls="tag-selector-dialog"
          onClick={() => setIsOpen(true)}
        >
          选择标签
        </button>
      </div>

      {isOpen && (
        <div id="tag-selector-dialog" className="tag-selector-modal" role="dialog" aria-modal="true" aria-labelledby="tag-selector-dialog-title" onClick={() => setIsOpen(false)}>
          <div ref={dialogRef} className="tag-selector-content" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
            <div className="tag-selector-header">
              <h3 id="tag-selector-dialog-title">选择标签</h3>
              <IconButton
                className="tag-selector-close"
                icon={<X size={17} strokeWidth={1.8} />}
                label="关闭标签选择"
                onClick={() => setIsOpen(false)}
                size="sm"
              />
            </div>

            <div className="tag-selector-search">
              <input
                type="text"
                className="auth-input"
                placeholder="搜索标签..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>

            <div className="tag-selector-categories" role="tablist" aria-label="标签分类">
              <button
                type="button"
                role="tab"
                aria-selected={activeCategory === 'all'}
                className={activeCategory === 'all' ? 'active' : ''}
                onClick={() => setActiveCategory('all')}
              >
                全部
              </button>
              {PROBLEM_TAG_CATEGORIES.map((category) => (
                <button
                  key={category.key}
                  type="button"
                  role="tab"
                  aria-selected={activeCategory === category.key}
                  className={activeCategory === category.key ? 'active' : ''}
                  onClick={() => setActiveCategory(category.key)}
                >
                  {category.label}
                </button>
              ))}
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
                      className={`tag-selector-item ${selectedTags.includes(tag) ? 'selected' : ''} ${!selectedTags.includes(tag) && selectedTags.length >= maxTags ? 'disabled' : ''}`}
                      onClick={() => handleTagClick(tag)}
                      disabled={!selectedTags.includes(tag) && selectedTags.length >= maxTags}
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
                已选择 {selectedTags.length}/{maxTags} 个标签；第一个为主知识点
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
