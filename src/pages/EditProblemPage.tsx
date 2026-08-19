import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import CustomSelect from '../components/CustomSelect'
import TagSelector from '../components/TagSelector'
import { Badge, Button, ErrorState, LoadingState, PageHeader, Panel } from '../components/ui'
import { fetchJson } from '../utils'
import { DIFFICULTY_OPTIONS } from '../constants'
import type { ApiResponse } from '../types'
import './CreatorAdminPages.css'

type TestFileDraft = { name: string; type: 'in' | 'out'; content: string }

const sortTestFiles = (files: TestFileDraft[]) => [...files].sort((a, b) => {
  const nameResult = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  return nameResult || a.type.localeCompare(b.type)
})

const validateTestFiles = (files: TestFileDraft[]) => {
  const pairs = new Map<string, { input?: TestFileDraft; output?: TestFileDraft }>()
  for (const file of files) {
    const name = file.name.trim()
    const match = name.match(/^(.+)\.(in|out)$/i)
    if (!match || match[2].toLowerCase() !== file.type) {
      return `测试文件 ${name || '未命名'} 的扩展名与类型不匹配`
    }
    const key = match[1].toLowerCase()
    const pair = pairs.get(key) || {}
    if (file.type === 'in') {
      if (pair.input) return `测试文件 ${name} 重复`
      pair.input = file
    } else {
      if (pair.output) return `测试文件 ${name} 重复`
      pair.output = file
    }
    pairs.set(key, pair)
  }
  for (const [key, pair] of pairs) {
    if (!pair.input || !pair.output) return `测试数据 ${key} 缺少成对的 .in 或 .out 文件`
  }
  return ''
}

export default function EditProblemPage() {
  const navigate = useNavigate()
  const { currentUser, openAuth } = useAppContext()
  const { id } = useParams()
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [difficulty, setDifficulty] = useState('入门')
  const [tags, setTags] = useState<string[]>([])
  const [statement, setStatement] = useState('')
  const [inputDesc, setInputDesc] = useState('')
  const [outputDesc, setOutputDesc] = useState('')
  const [dataRange, setDataRange] = useState('')
  const [samples, setSamples] = useState<{ input: string; output: string }[]>([
    { input: '', output: '' }
  ])
  const [testFiles, setTestFiles] = useState<TestFileDraft[]>([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!currentUser) {
      openAuth('login')
      return
    }
    loadProblem()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const loadProblem = async () => {
    if (!id) return
    setLoading(true)
    setError('')
    try {
      const { response, data } = await fetchJson<{
        problem: {
          title: string
          difficulty: string
          tags: string[]
          statement: string
          inputDesc?: string
          outputDesc?: string
          dataRange?: string
          samples: { input: string; output: string }[]
          testFiles?: TestFileDraft[]
        }
        message?: string
      }>(`/api/problems/${id}/edit`)
      if (!response.ok) {
        setError(data?.message || '无法加载题目')
        return
      }
      const problem = data?.problem
      if (!problem) {
        setError('无法加载题目')
        return
      }
      setTitle(problem.title)
      setDifficulty(problem.difficulty)
      setTags(problem.tags || [])
      setStatement(problem.statement)
      setInputDesc(problem.inputDesc || '')
      setOutputDesc(problem.outputDesc || '')
      setDataRange(problem.dataRange || '')
      setSamples(problem.samples.length > 0 ? problem.samples : [{ input: '', output: '' }])
      setTestFiles(sortTestFiles(problem.testFiles || []))
    } catch {
      setError('网络异常，暂时无法加载题目')
    } finally {
      setLoading(false)
    }
  }

  const addSample = () => {
    setSamples((prev) => [...prev, { input: '', output: '' }])
  }

  const removeSample = (index: number) => {
    setSamples(samples.filter((_, i) => i !== index))
  }

  const updateSample = (index: number, field: 'input' | 'output', value: string) => {
    setSamples((prev) => prev.map((sample, sampleIndex) => (
      sampleIndex === index ? { ...sample, [field]: value } : sample
    )))
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files) return
    const input = event.target
    setError('')

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
        setTestFiles((prev) => sortTestFiles([
          ...prev.filter((item) => item.name !== fileName),
          { name: fileName, type: ext as 'in' | 'out', content },
        ]))
      } catch {
        setError(`文件 ${fileName} 读取失败`)
      }
    }
    input.value = ''
  }

  const removeTestFile = (index: number) => {
    const file = testFiles[index]
    if (file && !window.confirm(`确定删除测试文件 ${file.name} 吗？`)) return
    setTestFiles((prev) => prev.filter((_, i) => i !== index))
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

    const hasIncompleteSample = samples.some((sample) => {
      const hasInput = Boolean(sample.input.trim())
      const hasOutput = Boolean(sample.output.trim())
      return hasInput !== hasOutput
    })
    if (hasIncompleteSample) {
      setError('每组样例必须同时填写输入和输出')
      return
    }

    const validSamples = samples.filter(s => s.input.trim() && s.output.trim())
    if (validSamples.length === 0) {
      setError('请至少添加一个样例')
      return
    }

    const testFileError = validateTestFiles(testFiles)
    if (testFileError) {
      setError(testFileError)
      return
    }

    setSubmitting(true)

    const payload = {
      title: title.trim(),
      difficulty,
      tags: tags,
      statement: statement.trim(),
      inputDesc: inputDesc.trim(),
      outputDesc: outputDesc.trim(),
      dataRange: dataRange.trim(),
      samples: validSamples,
      testFiles,
      status: 'published'
    }

    try {
      const { response, data } = await fetchJson<ApiResponse>(`/api/problems/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        setError(data?.message || '更新题目失败')
        return
      }

      setSuccess('题目更新成功！')
      setTimeout(() => {
        navigate('/my-problems')
      }, 1500)
    } catch {
      setError('网络异常，题目未更新，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  if (!currentUser) {
    return null
  }

  if (loading) {
    return <LoadingState label="正在加载题目编辑器…" />
  }

  if (error && !title && !statement) {
    return (
      <div className="oj-page problem-editor-v2">
        <ErrorState description={error} onRetry={() => void loadProblem()} />
      </div>
    )
  }

  const validSampleCount = samples.filter((sample) => sample.input.trim() && sample.output.trim()).length
  const inputFileCount = testFiles.filter((file) => file.type === 'in').length
  const outputFileCount = testFiles.filter((file) => file.type === 'out').length

  return (
    <div className="oj-page problem-editor-v2">
      <PageHeader
        kicker="Problem Studio"
        title="编辑题目"
        description="维护题面时保留创建页的同款结构，重点检查样例、数据文件和公式描述是否仍然一致。"
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
                <span>编辑标题、难度和标签后，题库检索和推荐展示会同步受影响。</span>
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
                    onChange={setDifficulty}
                    options={DIFFICULTY_OPTIONS.map((opt) => ({ value: opt, label: opt }))}
                  />
                </div>

                <div className="form-section">
                  <label className="form-label">标签</label>
                  <TagSelector selectedTags={tags} onTagsChange={setTags} />
                </div>
              </div>
            </Panel>

            <Panel className="problem-editor-card">
              <div className="problem-editor-card-head">
                <div>
                  <Badge tone="success">Step 02</Badge>
                  <h2>题面内容</h2>
                </div>
                <span>建议每次改动后顺手检查输入输出格式，避免样例与描述脱节。</span>
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
                  <span className="form-hint">当前有效样例 {validSampleCount} 组</span>
                </div>
                {samples.map((sample, index) => (
                  <div key={index} className="sample-group">
                    <div className="sample-header">
                      <span>样例 {index + 1}</span>
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
                  上传 .in 和 .out 文件作为测试数据。文件名应成对，例如：1.in 和 1.out
                  <br />
                  注意：上传新文件将替换所有现有测试数据
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
                {submitting ? '更新中...' : '更新题目'}
              </Button>
            </div>
          </main>

          <aside className="problem-editor-aside">
            <Panel className="problem-editor-guide">
              <div className="problem-editor-guide-head">
                <Badge tone="info">Checklist</Badge>
                <strong>编辑检查</strong>
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
                如果重新上传测试数据，请确认 .in 和 .out 成对；编辑保存后会回到“我的题目”列表。
              </p>
            </Panel>
          </aside>
        </div>
      </form>
    </div>
  )
}
