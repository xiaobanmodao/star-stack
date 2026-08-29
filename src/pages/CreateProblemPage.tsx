import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import CustomSelect from '../components/CustomSelect'
import TagSelector from '../components/TagSelector'
import { Badge, Button, PageHeader, Panel } from '../components/ui'
import { fetchJson } from '../utils'
import {
  DEFAULT_TESTCASE_TIME_LIMIT_MS,
  DIFFICULTY_OPTIONS,
  MAX_TESTCASE_TIME_LIMIT_MS,
  MIN_TESTCASE_TIME_LIMIT_MS,
} from '../constants'
import { getDifficultyMeta, getDifficultyOptions } from '../utils/difficulty'
import type { ApiResponse } from '../types'
import './CreatorAdminPages.css'

type SampleDraft = { input: string; output: string; timeLimitMs: number }
type TestFileDraft = { name: string; type: 'in' | 'out'; content: string; timeLimitMs: number }
type ProblemQualityStatus = 'unchecked' | 'self_tested' | 'pending_review' | 'verified'
type ProblemEditorialStatus = 'none' | 'draft' | 'published'

export default function CreateProblemPage() {
  const navigate = useNavigate()
  const { currentUser, openAuth } = useAppContext()
  const [title, setTitle] = useState('')
  const [difficulty, setDifficulty] = useState(DIFFICULTY_OPTIONS[0])
  const [tags, setTags] = useState<string[]>([])
  const [topicTags, setTopicTags] = useState<string[]>([])
  const [techniqueTags, setTechniqueTags] = useState<string[]>([])
  const [estimatedMinutes, setEstimatedMinutes] = useState('')
  const [recommendedFor, setRecommendedFor] = useState('')
  const [qualityStatus, setQualityStatus] = useState<ProblemQualityStatus>('unchecked')
  const [editorialStatus, setEditorialStatus] = useState<ProblemEditorialStatus>('none')
  const [revisionSummary, setRevisionSummary] = useState('')
  const [statement, setStatement] = useState('')
  const [inputDesc, setInputDesc] = useState('')
  const [outputDesc, setOutputDesc] = useState('')
  const [dataRange, setDataRange] = useState('')
  const [samples, setSamples] = useState<SampleDraft[]>([
    { input: '', output: '', timeLimitMs: DEFAULT_TESTCASE_TIME_LIMIT_MS }
  ])
  const [testFiles, setTestFiles] = useState<TestFileDraft[]>([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!currentUser) {
      openAuth('login')
    }
  }, [currentUser, openAuth])

  const addSample = () => {
    setSamples((prev) => [...prev, { input: '', output: '', timeLimitMs: DEFAULT_TESTCASE_TIME_LIMIT_MS }])
  }

  const removeSample = (index: number) => {
    setSamples(samples.filter((_, i) => i !== index))
  }

  const updateSample = (index: number, field: 'input' | 'output', value: string) => {
    setSamples((prev) => prev.map((sample, sampleIndex) => (
      sampleIndex === index ? { ...sample, [field]: value } : sample
    )))
  }

  const updateSampleTimeLimit = (index: number, value: string) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return
    setSamples((prev) => prev.map((sample, sampleIndex) => (
      sampleIndex === index
        ? { ...sample, timeLimitMs: Math.min(MAX_TESTCASE_TIME_LIMIT_MS, Math.max(MIN_TESTCASE_TIME_LIMIT_MS, Math.round(numeric))) }
        : sample
    )))
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files) return

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const fileName = file.name
      const ext = fileName.split('.').pop()?.toLowerCase()

      if (ext !== 'in' && ext !== 'out') {
        setError(`文件 ${fileName} 格式不正确，只支持 .in 和 .out 文件`)
        continue
      }

      if (file.size > 2 * 1024 * 1024) {
        setError(`文件 ${fileName} 超过 2MB 限制`)
        continue
      }

      try {
        const content = await file.text()
        setTestFiles((prev) => [
          ...prev.filter((item) => item.name !== fileName),
          { name: fileName, type: ext as 'in' | 'out', content, timeLimitMs: DEFAULT_TESTCASE_TIME_LIMIT_MS },
        ])
      } catch {
        setError(`文件 ${fileName} 读取失败`)
      }
    }
    event.target.value = ''
  }

  const removeTestFile = (index: number) => {
    setTestFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const updateTestFileTimeLimit = (index: number, value: string) => {
    const file = testFiles[index]
    if (!file) return
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return
    const timeLimitMs = Math.min(MAX_TESTCASE_TIME_LIMIT_MS, Math.max(MIN_TESTCASE_TIME_LIMIT_MS, Math.round(numeric)))
    const baseName = file.name.replace(/\.(in|out)$/i, '').toLowerCase()
    setTestFiles((prev) => prev.map((item) => (
      item.name.replace(/\.(in|out)$/i, '').toLowerCase() === baseName
        ? { ...item, timeLimitMs }
        : item
    )))
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setSuccess('')

    if (!currentUser) {
      openAuth('login')
      return
    }

    if (!title.trim()) {
      setError('请填写题目标题')
      return
    }

    if (!statement.trim()) {
      setError('请填写题目描述')
      return
    }

    const validSamples = samples.filter(s => s.input.trim() && s.output.trim())
    if (validSamples.length === 0) {
      setError('请至少添加一个样例')
      return
    }

    setSubmitting(true)

    const payload = {
      title: title.trim(),
      difficulty,
      tags: tags,
      topicTags,
      techniqueTags,
      estimatedMinutes: estimatedMinutes ? Number(estimatedMinutes) : null,
      recommendedFor: recommendedFor.trim(),
      qualityStatus,
      editorialStatus,
      revisionSummary: revisionSummary.trim(),
      statement: statement.trim(),
      inputDesc: inputDesc.trim(),
      outputDesc: outputDesc.trim(),
      dataRange: dataRange.trim(),
      samples: validSamples,
      testFiles
    }

    const { response, data } = await fetchJson<ApiResponse>('/api/problems', {
      method: 'POST',
      body: JSON.stringify(payload)
    })

    setSubmitting(false)

    if (!response.ok) {
      setError(data?.message || '创建题目失败')
      return
    }

    setSuccess('题目创建成功！')
    setTimeout(() => {
      navigate('/my-problems')
    }, 1500)
  }

  if (!currentUser) {
    return null
  }

  const validSampleCount = samples.filter((sample) => sample.input.trim() && sample.output.trim()).length
  const inputFileCount = testFiles.filter((file) => file.type === 'in').length
  const outputFileCount = testFiles.filter((file) => file.type === 'out').length

  return (
    <div className="oj-page problem-editor-v2">
      <PageHeader
        kicker="Problem Studio"
        title="创建题目"
        description="把题面、样例和测试数据放进同一个轻量工作台里，提交前可以快速检查关键字段。"
        actions={
          <Button variant="ghost" onClick={() => navigate('/my-problems')}>
            返回我的题目
          </Button>
        }
      />

      <form className="problem-form problem-editor-form" onSubmit={handleSubmit}>
        <div className="problem-editor-shell">
          <main className="problem-editor-main">
            {error && <div className="form-error">{error}</div>}
            {success && <div className="form-success">{success}</div>}

            <Panel className="problem-editor-card">
              <div className="problem-editor-card-head">
                <div>
                  <Badge tone="info">Step 01</Badge>
                  <h2>基础信息</h2>
                </div>
                <span>标题、难度和标签决定用户第一眼是否愿意点进来。</span>
              </div>

              <div className="form-section">
                <label className="form-label">题目标题 *</label>
                <input
                  type="text"
                  className="auth-input"
                  placeholder="例如：A+B Problem"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-section">
                  <label className="form-label">难度 *</label>
                  <CustomSelect
                    className="auth-input-like"
                    value={difficulty}
                    onChange={(value) => setDifficulty(getDifficultyMeta(value).key)}
                    options={getDifficultyOptions()}
                  />
                </div>

                <div className="form-section">
                  <label className="form-label">标签</label>
                  <TagSelector selectedTags={tags} onTagsChange={setTags} />
                </div>
              </div>

              <div className="form-row problem-metadata-row">
                <div className="form-section">
                  <label className="form-label">知识点</label>
                  <TagSelector selectedTags={topicTags} onTagsChange={setTopicTags} />
                  <div className="form-hint">用于题目分类和推荐，最多 8 个。</div>
                </div>
                <div className="form-section">
                  <label className="form-label">解题技巧</label>
                  <TagSelector selectedTags={techniqueTags} onTagsChange={setTechniqueTags} />
                  <div className="form-hint">例如前缀和、二分、贪心等，可与知识点同时设置。</div>
                </div>
              </div>

              <div className="form-row problem-metadata-row">
                <div className="form-section">
                  <label className="form-label" htmlFor="problem-estimated-minutes">预计用时（分钟）</label>
                  <input
                    id="problem-estimated-minutes"
                    type="number"
                    className="auth-input"
                    min={1}
                    max={600}
                    value={estimatedMinutes}
                    onChange={(event) => setEstimatedMinutes(event.target.value)}
                    placeholder="例如：30"
                  />
                </div>
                <div className="form-section">
                  <label className="form-label" htmlFor="problem-recommended-for">适合人群</label>
                  <input
                    id="problem-recommended-for"
                    type="text"
                    className="auth-input"
                    maxLength={120}
                    value={recommendedFor}
                    onChange={(event) => setRecommendedFor(event.target.value)}
                    placeholder="例如：基础巩固、新手入门"
                  />
                </div>
              </div>

              {currentUser.isAdmin && (
                <div className="form-row problem-metadata-row">
                  <div className="form-section">
                    <label className="form-label" htmlFor="problem-quality-status">内容质量</label>
                    <select id="problem-quality-status" className="auth-input" value={qualityStatus} onChange={(event) => setQualityStatus(event.target.value as ProblemQualityStatus)}>
                      <option value="unchecked">未检查</option>
                      <option value="self_tested">已自测</option>
                      <option value="pending_review">审核中</option>
                      <option value="verified">已确认</option>
                    </select>
                  </div>
                  <div className="form-section">
                    <label className="form-label" htmlFor="problem-editorial-status">题解状态</label>
                    <select id="problem-editorial-status" className="auth-input" value={editorialStatus} onChange={(event) => setEditorialStatus(event.target.value as ProblemEditorialStatus)}>
                      <option value="none">暂无题解</option>
                      <option value="draft">题解草稿</option>
                      <option value="published">题解已发布</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="form-section">
                <label className="form-label" htmlFor="problem-revision-summary">本次修改说明</label>
                <input
                  id="problem-revision-summary"
                  type="text"
                  className="auth-input"
                  maxLength={500}
                  value={revisionSummary}
                  onChange={(event) => setRevisionSummary(event.target.value)}
                  placeholder="可选：说明本次补充了哪些知识点或修正了什么内容"
                />
              </div>
            </Panel>

            <Panel className="problem-editor-card">
              <div className="problem-editor-card-head">
                <div>
                  <Badge tone="success">Step 02</Badge>
                  <h2>题面内容</h2>
                </div>
                <span>支持 Markdown 和 LaTeX，渲染前会走安全白名单过滤。</span>
              </div>

              <div className="form-section">
                <label className="form-label">题目描述 *</label>
                <div className="form-hint">
                  支持 Markdown 和 LaTeX 数学公式。行内公式用 $...$ ，块级公式用 $$...$$
                  <br />
                  例如：$x^2$、$$\sum_&#123;i=1&#125;^&#123;n&#125; i$$
                </div>
                <textarea
                  className="auth-input problem-textarea"
                  placeholder="输入题目描述..."
                  value={statement}
                  onChange={(e) => setStatement(e.target.value)}
                  rows={8}
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-section">
                  <label className="form-label">输入格式</label>
                  <textarea
                    className="auth-input"
                    placeholder="描述输入数据的格式..."
                    value={inputDesc}
                    onChange={(e) => setInputDesc(e.target.value)}
                    rows={3}
                  />
                </div>

                <div className="form-section">
                  <label className="form-label">输出格式</label>
                  <textarea
                    className="auth-input"
                    placeholder="描述输出数据的格式..."
                    value={outputDesc}
                    onChange={(e) => setOutputDesc(e.target.value)}
                    rows={3}
                  />
                </div>
              </div>

              <div className="form-section">
                <label className="form-label">数据范围</label>
                <div className="form-hint">
                  支持 LaTeX 公式，例如：$1 \leq n \leq 10^6$
                </div>
                <textarea
                  className="auth-input"
                  placeholder="例如：对于 100% 的数据，$1 \leq n \leq 10^6$"
                  value={dataRange}
                  onChange={(e) => setDataRange(e.target.value)}
                  rows={3}
                />
              </div>
            </Panel>

            <Panel className="problem-editor-card">
              <div className="problem-editor-card-head">
                <div>
                  <Badge tone="warning">Step 03</Badge>
                  <h2>样例与数据</h2>
                </div>
                <Button variant="ghost" size="sm" onClick={addSample}>
                  添加样例
                </Button>
              </div>

              <div className="form-section">
                <div className="form-label-row">
                  <label className="form-label">样例数据 *</label>
                  <span className="form-hint">当前有效样例 {validSampleCount} 组，限时最高 3000ms</span>
                </div>
                {samples.map((sample, index) => (
                  <div key={index} className="sample-group">
                    <div className="sample-header">
                      <span>样例 {index + 1}</span>
                      <div className="sample-header-actions">
                        <label className="testcase-time-limit">
                          限时
                          <input
                            type="number"
                            min={MIN_TESTCASE_TIME_LIMIT_MS}
                            max={MAX_TESTCASE_TIME_LIMIT_MS}
                            step={100}
                            value={sample.timeLimitMs}
                            onChange={(e) => updateSampleTimeLimit(index, e.target.value)}
                          />
                          ms
                        </label>
                        {samples.length > 1 && (
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            onClick={() => removeSample(index)}
                          >
                            删除
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="sample-row">
                      <div className="sample-col">
                        <label className="sample-label">输入</label>
                        <textarea
                          className="auth-input"
                          placeholder="样例输入..."
                          value={sample.input}
                          onChange={(e) => updateSample(index, 'input', e.target.value)}
                          rows={4}
                        />
                      </div>
                      <div className="sample-col">
                        <label className="sample-label">输出</label>
                        <textarea
                          className="auth-input"
                          placeholder="样例输出..."
                          value={sample.output}
                          onChange={(e) => updateSample(index, 'output', e.target.value)}
                          rows={4}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="form-section">
                <label className="form-label">测试数据</label>
                <div className="form-hint">
                  上传 .in 和 .out 文件作为测试数据。文件名应成对，例如：1.in 和 1.out；每对文件就是一个测试点。
                  <br />
                  每个测试点可单独设置限时，范围为 {MIN_TESTCASE_TIME_LIMIT_MS}～{MAX_TESTCASE_TIME_LIMIT_MS}ms；在 .in 文件一侧设置。
                </div>
                <input
                  type="file"
                  accept=".in,.out"
                  multiple
                  onChange={handleFileUpload}
                  className="file-input"
                />
                {testFiles.length > 0 && (
                  <div className="test-files-list">
                    {testFiles.map((file, index) => (
                      <div key={index} className="test-file-item">
                        <span className={`file-badge ${file.type}`}>{file.type}</span>
                        <span className="file-name">{file.name}</span>
                        {file.type === 'in' ? (
                          <label className="testcase-time-limit">
                            限时
                            <input
                              type="number"
                              min={MIN_TESTCASE_TIME_LIMIT_MS}
                              max={MAX_TESTCASE_TIME_LIMIT_MS}
                              step={100}
                              value={file.timeLimitMs}
                              onChange={(e) => updateTestFileTimeLimit(index, e.target.value)}
                            />
                            ms
                          </label>
                        ) : (
                          <span className="testcase-time-follow">跟随测试点</span>
                        )}
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          onClick={() => removeTestFile(index)}
                        >
                          删除
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Panel>

            <div className="form-actions problem-editor-actions">
              <Button variant="ghost" onClick={() => navigate('/my-problems')}>
                取消
              </Button>
              <Button type="submit" variant="primary" loading={submitting}>
                {submitting ? '创建中...' : '创建题目'}
              </Button>
            </div>
          </main>

          <aside className="problem-editor-aside">
            <Panel className="problem-editor-guide">
              <div className="problem-editor-guide-head">
                <Badge tone="info">Checklist</Badge>
                <strong>发布检查</strong>
              </div>
              <div className="problem-editor-checks">
                <span className={title.trim() ? 'done' : ''}>题目标题</span>
                <span className={statement.trim() ? 'done' : ''}>题面描述</span>
                <span className={validSampleCount > 0 ? 'done' : ''}>至少一组样例</span>
                <span className={tags.length > 0 ? 'done' : ''}>题目标签</span>
              </div>
              <div className="problem-editor-guide-metrics">
                <div>
                  <strong>{validSampleCount}</strong>
                  <span>有效样例</span>
                </div>
                <div>
                  <strong>{inputFileCount}/{outputFileCount}</strong>
                  <span>输入/输出文件</span>
                </div>
              </div>
              <p>
                建议题面先给出清晰故事或目标，再补输入输出和数据范围；复杂公式使用 LaTeX，
                页面会按洛谷风格渲染。
              </p>
            </Panel>
          </aside>
        </div>
      </form>
    </div>
  )
}
