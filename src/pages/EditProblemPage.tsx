import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAppContext } from '../context/AppContext'
import TagSelector from '../components/TagSelector'
import { fetchJson } from '../utils'
import { DIFFICULTY_OPTIONS } from '../constants'
import type { ApiResponse } from '../types'

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
  const [testFiles, setTestFiles] = useState<{ name: string; type: 'in' | 'out'; content: string }[]>([])
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
      }
      message?: string
    }>(`/api/problems/${id}/edit`)
    if (!response.ok) {
      setError(data?.message || '无法加载题目')
      setLoading(false)
      return
    }
    const problem = data?.problem
    if (!problem) {
      setError('无法加载题目')
      setLoading(false)
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
    setLoading(false)
  }

  const addSample = () => {
    setSamples([...samples, { input: '', output: '' }])
  }

  const removeSample = (index: number) => {
    setSamples(samples.filter((_, i) => i !== index))
  }

  const updateSample = (index: number, field: 'input' | 'output', value: string) => {
    const newSamples = [...samples]
    newSamples[index][field] = value
    setSamples(newSamples)
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

      const content = await file.text()
      setTestFiles(prev => [...prev, {
        name: fileName,
        type: ext as 'in' | 'out',
        content
      }])
    }
  }

  const removeTestFile = (index: number) => {
    setTestFiles(testFiles.filter((_, i) => i !== index))
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
      statement: statement.trim(),
      inputDesc: inputDesc.trim(),
      outputDesc: outputDesc.trim(),
      dataRange: dataRange.trim(),
      samples: validSamples,
      testFiles,
      status: 'published'
    }

    const { response, data } = await fetchJson<ApiResponse>(`/api/problems/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    })

    setSubmitting(false)

    if (!response.ok) {
      setError(data?.message || '更新题目失败')
      return
    }

    setSuccess('题目更新成功！')
    setTimeout(() => {
      navigate('/my-problems')
    }, 1500)
  }

  if (!currentUser) {
    return null
  }

  if (loading) {
    return (
      <div className="oj-page">
        <div className="oj-loading">加载中...</div>
      </div>
    )
  }

  return (
    <div className="oj-page">
      <div className="oj-header">
        <h2>编辑题目</h2>
        <button className="ghost" onClick={() => navigate('/my-problems')}>
          返回
        </button>
      </div>

      <form className="problem-form" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}
        {success && <div className="form-success">{success}</div>}

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
            <select
              className="auth-input"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
            >
              {DIFFICULTY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <div className="form-section">
            <label className="form-label">标签</label>
            <TagSelector selectedTags={tags} onTagsChange={setTags} />
          </div>
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

        <div className="form-section">
          <div className="form-label-row">
            <label className="form-label">样例数据 *</label>
            <button type="button" className="ghost small" onClick={addSample}>
              添加样例
            </button>
          </div>
          {samples.map((sample, index) => (
            <div key={index} className="sample-group">
              <div className="sample-header">
                <span>样例 {index + 1}</span>
                {samples.length > 1 && (
                  <button
                    type="button"
                    className="ghost small danger"
                    onClick={() => removeSample(index)}
                  >
                    删除
                  </button>
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
                  <button
                    type="button"
                    className="ghost small danger"
                    onClick={() => removeTestFile(index)}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="form-actions">
          <button type="button" className="ghost" onClick={() => navigate('/my-problems')}>
            取消
          </button>
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? '更新中...' : '更新题目'}
          </button>
        </div>
      </form>
    </div>
  )
}

