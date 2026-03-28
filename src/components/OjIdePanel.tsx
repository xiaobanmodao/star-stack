import { memo, useCallback, useEffect, useRef, useState } from 'react'
import Editor, { loader } from '@monaco-editor/react'

// Pre-configure Monaco loader to start fetching immediately on import
loader.config({ 'vs/nls': { availableLanguages: { '*': '' } } })

type LanguageOption = {
  label: string
  value: string
  monaco: string
  template: string
}

type OjProblemDetailLite = {
  id: number
  title: string
  samples: { input: string; output: string }[]
}

type OjSubmissionLite = {
  language?: string
  code?: string | null
}

type IdeDraft = {
  language: string
  code: string
  runInput: string
  runExpected: string
}

type FetchJsonFn = <T = unknown>(
  url: string,
  options?: RequestInit
) => Promise<{ response: Response; data: T | null }>

type OjIdePanelProps = {
  problem: OjProblemDetailLite
  currentUser: { id: string } | null
  languageOptions: LanguageOption[]
  getLanguageConfig: (value: string) => LanguageOption
  fetchJson: FetchJsonFn
  openAuth: (mode: 'login' | 'register') => void
  loadLatestSubmissionForIde: (problemId: number) => Promise<OjSubmissionLite | null>
  initialDraft?: IdeDraft | null
  onDraftChange: (problemId: number, draft: IdeDraft) => void
  onSubmitJudge: (payload: { problemId: number; problemTitle: string; language: string; code: string }) => void
  pendingSampleRunIndex: number | null
  onPendingSampleRunHandled: () => void
}

const OjIdePanel = ({
  problem,
  currentUser,
  languageOptions,
  getLanguageConfig,
  fetchJson,
  openAuth,
  loadLatestSubmissionForIde,
  initialDraft,
  onDraftChange,
  onSubmitJudge,
  pendingSampleRunIndex,
  onPendingSampleRunHandled,
}: OjIdePanelProps) => {
  const defaultLanguage = languageOptions[0]?.value || 'C++'

  const [language, setLanguage] = useState(initialDraft?.language || defaultLanguage)
  const [code, setCode] = useState(initialDraft?.code || '')
  const [submitError, setSubmitError] = useState('')
  const [runBusy, setRunBusy] = useState(false)
  const [runStatus, setRunStatus] = useState('')
  const [runMessage, setRunMessage] = useState('')
  const [runTime, setRunTime] = useState<number | null>(null)
  const [runInput, setRunInput] = useState(initialDraft?.runInput || '')
  const [runOutput, setRunOutput] = useState('')
  const [runExpected, setRunExpected] = useState(initialDraft?.runExpected || '')

  const userEditedRef = useRef(false)

  useEffect(() => {
    userEditedRef.current = false
    const nextLanguage = initialDraft?.language || defaultLanguage
    setLanguage(nextLanguage)
    setCode(initialDraft?.code || '')
    setSubmitError('')
    setRunBusy(false)
    setRunStatus('')
    setRunMessage('')
    setRunTime(null)
    setRunInput(initialDraft?.runInput || '')
    setRunOutput('')
    setRunExpected(initialDraft?.runExpected || '')
  }, [defaultLanguage, initialDraft, problem.id])

  useEffect(() => {
    onDraftChange(problem.id, { language, code, runInput, runExpected })
  }, [code, language, onDraftChange, problem.id, runExpected, runInput])

  useEffect(() => {
    if (!currentUser) return
    if (initialDraft?.code?.trim()) return
    let cancelled = false
    ;(async () => {
      const submission = await loadLatestSubmissionForIde(problem.id)
      if (cancelled || userEditedRef.current) return
      if (submission?.code) {
        setLanguage(submission.language || language)
        setCode(submission.code)
      }
    })()
    return () => { cancelled = true }
  }, [currentUser, initialDraft?.code, language, loadLatestSubmissionForIde, problem.id])

  const updateLanguage = useCallback((next: string) => {
    userEditedRef.current = true
    setLanguage(next)
  }, [])

  const handleSubmit = useCallback(() => {
    if (!currentUser) { openAuth('login'); return }
    if (!code.trim()) { setSubmitError('请填写代码'); return }
    setSubmitError('')
    onSubmitJudge({ problemId: problem.id, problemTitle: problem.title, language, code })
  }, [code, currentUser, language, onSubmitJudge, openAuth, problem.id, problem.title])

  const handleRunCustom = useCallback(async (input: string, expected = '') => {
    if (!currentUser) { openAuth('login'); return }
    setRunBusy(true)
    setRunStatus('运行中')
    setRunMessage('')
    setRunTime(null)
    setRunOutput('')
    const { response, data } = await fetchJson<{ status?: string; message?: string; output?: string; timeMs?: number }>('/api/oj/run-custom', {
      method: 'POST',
      body: JSON.stringify({ problemId: problem.id, language, code, input, expected }),
    })
    if (!response.ok) {
      setRunStatus('失败')
      setRunMessage((data as { message?: string } | null)?.message || '运行失败')
      setRunBusy(false)
      return
    }
    setRunStatus(data?.status || '完成')
    setRunMessage(data?.message || '')
    setRunOutput(data?.output || '')
    setRunTime(data?.timeMs ?? null)
    setRunBusy(false)
  }, [code, currentUser, fetchJson, language, openAuth, problem.id])

  const runSample = useCallback(async (index: number) => {
    const sample = problem.samples?.[index]
    if (!sample) return
    setRunInput(sample.input)
    setRunExpected(sample.output)
    await handleRunCustom(sample.input, sample.output)
  }, [handleRunCustom, problem.samples])

  useEffect(() => {
    if (pendingSampleRunIndex === null) return
    void runSample(pendingSampleRunIndex).finally(onPendingSampleRunHandled)
  }, [onPendingSampleRunHandled, pendingSampleRunIndex, runSample])

  return (
    <div
      className="oj-detail-ide"
      onWheel={(event) => {
        const target = event.target as HTMLElement | null
        if (target && target.closest('.monaco-editor')) return
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <div className="ide-panel side">
        <div className="ide-header">
          <div className="ide-header-left">
            <select
              className="ide-lang-select"
              value={language}
              onChange={(event) => updateLanguage(event.target.value)}
            >
              {languageOptions.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
          <div className="ide-header-right">
            <button className="ide-btn ide-btn-primary" onClick={handleSubmit} title="Ctrl+Enter">
              提交
            </button>
          </div>
        </div>

        <div className="ide-main">
          <div className="ide-editor">
            <Editor
              height="100%"
              language={getLanguageConfig(language).monaco}
              value={code}
              onChange={(value) => { userEditedRef.current = true; setCode(value ?? '') }}
              onMount={(editor) => {
                editor.addAction({ id: 'starstack-submit', label: 'Submit', keybindings: [2048 | 3], run: () => { handleSubmit() } })
                editor.addAction({ id: 'starstack-save', label: 'Save', keybindings: [2048 | 49], run: () => {} })
                editor.focus()
              }}
              theme="vs-dark"
              loading={null}
              saveViewState={false}
              keepCurrentModel={false}
              options={{
                minimap: { enabled: false },
                stickyScroll: { enabled: false },
                fontSize: 14,
                fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
                tabSize: 4,
                insertSpaces: true,
                detectIndentation: false,
                automaticLayout: true,
                scrollBeyondLastLine: false,
                lineNumbers: 'on',
                glyphMargin: false,
                folding: false,
                lineDecorationsWidth: 10,
                lineNumbersMinChars: 4,
                renderLineHighlight: 'line',
                scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
                quickSuggestions: false,
                suggestOnTriggerCharacters: false,
                acceptSuggestionOnCommitCharacter: false,
                acceptSuggestionOnEnter: 'off',
                wordBasedSuggestions: 'off',
                hover: { enabled: false },
                parameterHints: { enabled: false },
                occurrencesHighlight: 'off',
                selectionHighlight: false,
                codeLens: false,
                links: false,
                colorDecorators: false,
                renderWhitespace: 'none',
                guides: { indentation: false, bracketPairs: false },
                overviewRulerLanes: 0,
                hideCursorInOverviewRuler: true,
                overviewRulerBorder: false,
              }}
            />
          </div>
        </div>

        <div className="ide-lab">
          <div className="ide-run">
            <div className="ide-run-header">
              <span className="ide-run-title">测试运行</span>
              <button
                className="ide-btn ide-btn-secondary"
                onClick={() => handleRunCustom(runInput, runExpected)}
                disabled={runBusy}
              >
                {runBusy ? '运行中...' : '运行'}
              </button>
            </div>

            <div className="ide-run-grid">
              <div className="ide-run-pane">
                <div className="ide-run-pane-title">输入</div>
                <textarea
                  className="ide-run-input"
                  value={runInput}
                  onChange={(e) => setRunInput(e.target.value)}
                  placeholder="输入测试数据..."
                  onKeyDown={(e) => {
                    if (e.key === 'Tab') { e.preventDefault(); const t = e.currentTarget; const s = t.selectionStart; const end = t.selectionEnd; setRunInput(runInput.substring(0, s) + '  ' + runInput.substring(end)); setTimeout(() => { t.selectionStart = t.selectionEnd = s + 2 }, 0) }
                  }}
                />
              </div>

              <div className="ide-run-pane">
                <div className="ide-run-pane-title">
                  <span>输出</span>
                  {runExpected && (runStatus || runMessage) && (
                    <span className={`ide-run-status ${runStatus === 'Accepted' ? 'ok' : runStatus === 'Wrong Answer' ? 'bad' : runStatus === 'Compile Error' ? 'warn' : runStatus === 'Runtime Error' ? 'runtime' : ''}`}>
                      {[runStatus, runMessage].filter(Boolean).join(' ')}
                    </span>
                  )}
                </div>
                <pre className="ide-run-output">{runOutput || '暂无输出'}</pre>
              </div>
            </div>

            {(runTime !== null || runExpected) && (
              <div className="ide-run-meta">
                {runTime !== null && <span>用时: {runTime}ms</span>}
                {runExpected && <span>期望输出: {runExpected}</span>}
              </div>
            )}
          </div>
        </div>

        {submitError && (
          <div className="ide-footer">
            <div className="ide-error">{submitError}</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(OjIdePanel)
