import { memo, useCallback, useEffect, useRef, useState } from 'react'
import Editor, { loader } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import { conf as cppConf, language as baseCppLanguage } from 'monaco-editor/esm/vs/basic-languages/cpp/cpp.js'
import CustomSelect from './CustomSelect'
import LoadingState from './ui/LoadingState'

// Pre-configure Monaco loader to start fetching immediately on import
loader.config({ 'vs/nls': { availableLanguages: { '*': '' } } })

const CPP_STANDARD_TYPES = [
  'string', 'wstring', 'u16string', 'u32string', 'vector', 'array', 'deque', 'list', 'forward_list',
  'set', 'multiset', 'map', 'multimap', 'unordered_set', 'unordered_multiset', 'unordered_map',
  'unordered_multimap', 'stack', 'queue', 'priority_queue', 'pair', 'tuple', 'optional', 'variant',
  'any', 'bitset', 'complex', 'function', 'span', 'ranges', 'istream', 'ostream', 'stringstream',
  'istringstream', 'ostringstream', 'ifstream', 'ofstream', 'fstream',
]

const CPP_STANDARD_STREAMS = [
  'cin', 'cout', 'cerr', 'clog', 'wcin', 'wcout', 'wcerr', 'wclog',
]

const CPP_STANDARD_MANIPULATORS = [
  'endl', 'flush', 'ws', 'fixed', 'scientific', 'setprecision', 'setw', 'setfill',
  'left', 'right', 'boolalpha', 'noboolalpha',
]

const CPP_STANDARD_FUNCTIONS = [
  'begin', 'end', 'sort', 'stable_sort', 'reverse', 'swap', 'max', 'min', 'abs', 'count', 'find',
  'lower_bound', 'upper_bound', 'binary_search', 'next_permutation', 'prev_permutation', 'accumulate',
  'iota', 'gcd', 'lcm', 'move', 'make_pair', 'make_tuple',
]

const CPP_STANDARD_NAMESPACES = ['std']

const CPP_STANDARD_CONSTANTS = ['nullopt', 'monostate']

let monacoEnhancementsReady = false

const ensureMonacoEnhancements = (monaco: typeof Monaco) => {
  if (monacoEnhancementsReady) return

  const enhancedCppLanguage: Monaco.languages.IMonarchLanguage = {
    ...(baseCppLanguage as Monaco.languages.IMonarchLanguage),
    stlTypes: CPP_STANDARD_TYPES,
    stlStreams: CPP_STANDARD_STREAMS,
    stlManipulators: CPP_STANDARD_MANIPULATORS,
    stlFunctions: CPP_STANDARD_FUNCTIONS,
    stlNamespaces: CPP_STANDARD_NAMESPACES,
    stlConstants: CPP_STANDARD_CONSTANTS,
    tokenizer: {
      ...(baseCppLanguage as Monaco.languages.IMonarchLanguage).tokenizer,
      root: [
        [/[a-zA-Z_]\w*/, {
          cases: {
            '@stlNamespaces': 'namespace.std',
            '@stlStreams': 'predefined.stream',
            '@stlManipulators': 'predefined.manipulator',
            '@stlTypes': 'type.identifier',
            '@stlFunctions': 'predefined.function',
            '@stlConstants': 'constant.language',
            '@keywords': { token: 'keyword.$0' },
            '@default': 'identifier',
          },
        }],
        ...(((baseCppLanguage as Monaco.languages.IMonarchLanguage).tokenizer?.root ?? []).slice(1)),
      ],
    },
  }

  monaco.languages.setLanguageConfiguration('cpp', cppConf)
  monaco.languages.setMonarchTokensProvider('cpp', enhancedCppLanguage)
  monaco.languages.registerCompletionItemProvider('cpp', {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }
      const makeSuggestion = (
        label: string,
        kind: Monaco.languages.CompletionItemKind,
        detail: string,
        insertText = label
      ) => ({ label, kind, detail, insertText, range })
      return {
        suggestions: [
          ...CPP_STANDARD_STREAMS.map((item) => makeSuggestion(item, monaco.languages.CompletionItemKind.Variable, 'C++ stream object')),
          ...CPP_STANDARD_MANIPULATORS.map((item) => makeSuggestion(item, monaco.languages.CompletionItemKind.Function, 'C++ stream manipulator')),
          ...CPP_STANDARD_TYPES.map((item) => makeSuggestion(item, monaco.languages.CompletionItemKind.Class, 'C++ standard library type')),
          ...CPP_STANDARD_FUNCTIONS.map((item) => makeSuggestion(item, monaco.languages.CompletionItemKind.Function, 'C++ standard library function')),
          makeSuggestion('std', monaco.languages.CompletionItemKind.Module, 'C++ standard namespace'),
        ],
      }
    },
  })
  monaco.editor.defineTheme('starstack-oj', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '5ea7ff' },
      { token: 'namespace.std', foreground: '4ec9b0' },
      { token: 'type.identifier', foreground: '4ec9b0' },
      { token: 'predefined.stream', foreground: '9cdcfe', fontStyle: 'bold' },
      { token: 'predefined.manipulator', foreground: 'dcdcaa' },
      { token: 'predefined.function', foreground: 'c586c0' },
      { token: 'constant.language', foreground: 'ffd76a' },
    ],
    colors: {
      'editor.background': '#09111f',
      'editorLineNumber.foreground': '#506684',
      'editorLineNumber.activeForeground': '#b8d2f0',
      'editorCursor.foreground': '#8ad7ff',
      'editor.selectionBackground': '#173154',
      'editor.inactiveSelectionBackground': '#10253f',
    },
  })
  monacoEnhancementsReady = true
}

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

  const [initialCode] = useState(() => initialDraft?.code || '')
  const [language, setLanguage] = useState(initialDraft?.language || defaultLanguage)
  const [submitError, setSubmitError] = useState('')
  const [submitBusy, setSubmitBusy] = useState(false)
  const [runBusy, setRunBusy] = useState(false)
  const [runStatus, setRunStatus] = useState('')
  const [runMessage, setRunMessage] = useState('')
  const [runTime, setRunTime] = useState<number | null>(null)
  const [runInput, setRunInput] = useState(initialDraft?.runInput || '')
  const [runOutput, setRunOutput] = useState('')
  const [runExpected, setRunExpected] = useState(initialDraft?.runExpected || '')
  const [draftState, setDraftState] = useState<'restoring' | 'restored' | 'saved' | 'empty'>(
    initialDraft?.code?.trim() ? 'saved' : currentUser ? 'restoring' : 'empty'
  )

  const userEditedRef = useRef(false)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof Monaco | null>(null)
  const codeRef = useRef(initialCode)
  const draftSyncTimerRef = useRef<number | null>(null)
  const pendingSampleRunRef = useRef<number | null>(null)
  const submitBusyRef = useRef(false)
  const outputRef = useRef<HTMLPreElement | null>(null)

  const flushDraft = useCallback(() => {
    onDraftChange(problem.id, {
      language,
      code: codeRef.current,
      runInput,
      runExpected,
    })
  }, [language, onDraftChange, problem.id, runExpected, runInput])

  const scheduleDraftSync = useCallback(() => {
    if (draftSyncTimerRef.current) {
      clearTimeout(draftSyncTimerRef.current)
    }
    draftSyncTimerRef.current = window.setTimeout(() => {
      draftSyncTimerRef.current = null
      flushDraft()
    }, 120)
  }, [flushDraft])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const currentValue = editor.getValue()
    if (currentValue === codeRef.current) return
    editor.setValue(codeRef.current)
  }, [])

  useEffect(() => {
    scheduleDraftSync()
  }, [language, runInput, runExpected, scheduleDraftSync])

  useEffect(() => {
    const flushBeforeLeaving = () => {
      if (draftSyncTimerRef.current) {
        clearTimeout(draftSyncTimerRef.current)
        draftSyncTimerRef.current = null
      }
      flushDraft()
    }

    window.addEventListener('beforeunload', flushBeforeLeaving)
    document.addEventListener('visibilitychange', flushBeforeLeaving)
    return () => {
      window.removeEventListener('beforeunload', flushBeforeLeaving)
      document.removeEventListener('visibilitychange', flushBeforeLeaving)
    }
  }, [flushDraft])

  useEffect(() => {
    if (!currentUser) return
    if (initialDraft?.code?.trim()) {
      setDraftState('saved')
      return
    }
    let cancelled = false
    ;(async () => {
      setDraftState('restoring')
      try {
        const submission = await loadLatestSubmissionForIde(problem.id)
        if (cancelled || userEditedRef.current) return
        if (submission?.code) {
          setLanguage(submission.language || language)
          codeRef.current = submission.code
          const editor = editorRef.current
          if (editor && editor.getValue() !== submission.code) {
            editor.setValue(submission.code)
          }
          setDraftState('restored')
          scheduleDraftSync()
        } else {
          setDraftState('empty')
        }
      } catch {
        if (!cancelled) setDraftState('empty')
      }
    })()
    return () => { cancelled = true }
  }, [currentUser, initialDraft?.code, language, loadLatestSubmissionForIde, problem.id, scheduleDraftSync])

  useEffect(() => {
    return () => {
      if (draftSyncTimerRef.current) {
        clearTimeout(draftSyncTimerRef.current)
        draftSyncTimerRef.current = null
      }
    }
  }, [])

  const updateLanguage = useCallback((next: string) => {
    userEditedRef.current = true
    setDraftState('saved')
    const editor = editorRef.current
    const monaco = monacoRef.current
    const model = editor?.getModel()
    if (editor && monaco && model) {
      monaco.editor.setModelLanguage(model, getLanguageConfig(next).monaco)
    }
    setLanguage(next)
  }, [getLanguageConfig])

  const handleSubmit = useCallback(() => {
    const currentCode = editorRef.current?.getValue() ?? codeRef.current
    if (!currentUser) { openAuth('login'); return }
    if (submitBusyRef.current) return
    if (!currentCode.trim()) { setSubmitError('请填写代码'); return }
    submitBusyRef.current = true
    setSubmitBusy(true)
    setSubmitError('')
    codeRef.current = currentCode
    flushDraft()
    onSubmitJudge({ problemId: problem.id, problemTitle: problem.title, language, code: currentCode })
  }, [currentUser, flushDraft, language, onSubmitJudge, openAuth, problem.id, problem.title])

  const handleRunCustom = useCallback(async (input: string, expected = '') => {
    const currentCode = editorRef.current?.getValue() ?? codeRef.current
    if (!currentUser) { openAuth('login'); return }
    setSubmitError('')
    if (!currentCode.trim()) {
      setRunStatus('无法运行')
      setRunMessage('请先填写代码')
      setRunOutput('')
      setRunTime(null)
      return
    }
    setRunBusy(true)
    setRunStatus('运行中')
    setRunMessage('')
    setRunTime(null)
    setRunOutput('')
    try {
      const { response, data } = await fetchJson<{ status?: string; message?: string; output?: string; timeMs?: number }>('/api/oj/run-custom', {
        method: 'POST',
        body: JSON.stringify({ problemId: problem.id, language, code: currentCode, input, expected }),
      })
      if (!response.ok) {
        setRunStatus('失败')
        setRunMessage(data?.message || '运行失败')
        return
      }
      setRunStatus(data?.status || '完成')
      setRunMessage(data?.message || '')
      setRunOutput(data?.output || '')
      setRunTime(data?.timeMs ?? null)
    } catch {
      setRunStatus('失败')
      setRunMessage('运行请求失败，请稍后重试')
    } finally {
      setRunBusy(false)
    }
  }, [currentUser, fetchJson, language, openAuth, problem.id])

  useEffect(() => {
    const output = outputRef.current
    if (output && runOutput) output.scrollTop = output.scrollHeight
  }, [runOutput])

  const runSample = useCallback(async (index: number) => {
    const sample = problem.samples?.[index]
    if (!sample) return
    setRunInput(sample.input)
    setRunExpected(sample.output)
    await handleRunCustom(sample.input, sample.output)
  }, [handleRunCustom, problem.samples])

  useEffect(() => {
    if (pendingSampleRunIndex === null) {
      pendingSampleRunRef.current = null
      return
    }
    if (pendingSampleRunRef.current === pendingSampleRunIndex) return

    pendingSampleRunRef.current = pendingSampleRunIndex
    let started = false
    const timer = window.setTimeout(() => {
      started = true
      void runSample(pendingSampleRunIndex).finally(onPendingSampleRunHandled)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      if (!started) pendingSampleRunRef.current = null
    }
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
            <CustomSelect
              className="ide-lang-select-wrap"
              buttonClassName="ide-lang-select"
              menuClassName="ide-lang-menu"
              value={language}
              onChange={updateLanguage}
              options={languageOptions.map((item) => ({ value: item.value, label: item.label }))}
            />
            <div className={`ide-draft-status is-${draftState}`} role="status" aria-live="polite">
              <span className="ide-draft-status-dot" aria-hidden="true" />
              {draftState === 'restoring' ? '正在恢复代码…' : draftState === 'restored' ? '已恢复最近提交' : draftState === 'saved' ? '草稿已保留' : '等待输入代码'}
            </div>
          </div>
          <div className="ide-header-right">
            <button
              className="ide-btn ide-btn-primary"
              onClick={handleSubmit}
              disabled={submitBusy}
              aria-busy={submitBusy}
              title="Ctrl+Enter"
            >
              {submitBusy && <span className="loading-button-icon" aria-hidden="true" />}
              {submitBusy ? '提交中...' : '提交'}
            </button>
          </div>
        </div>

        <div className="ide-main">
          <div className="ide-editor">
            <Editor
              height="100%"
              language={getLanguageConfig(language).monaco}
              defaultValue={initialCode}
              loading={<LoadingState variant="ide" label="编辑器启动中…" />}
              onMount={(editor, monaco) => {
                ensureMonacoEnhancements(monaco)
                editorRef.current = editor
                monacoRef.current = monaco
                editor.onDidChangeModelContent(() => {
                  userEditedRef.current = true
                  codeRef.current = editor.getValue()
                  setDraftState('saved')
                  setSubmitError('')
                  scheduleDraftSync()
                })
                editor.addAction({ id: 'starstack-submit', label: 'Submit', keybindings: [2048 | 3], run: () => { handleSubmit() } })
                editor.addAction({ id: 'starstack-save', label: 'Save', keybindings: [2048 | 49], run: () => {} })
                editor.focus()
              }}
              theme="vs-dark"
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
                aria-busy={runBusy}
              >
                {runBusy && <span className="loading-button-icon" aria-hidden="true" />}
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
                {(runStatus || runMessage) && (
                  <span
                    className={`ide-run-status ${runStatus === 'Accepted' ? 'ok' : runStatus === 'Wrong Answer' ? 'bad' : runStatus === 'Compile Error' ? 'warn' : runStatus === 'Runtime Error' ? 'runtime' : ''}`}
                    role="status"
                    aria-live="polite"
                  >
                    {[runStatus, runMessage].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
                <pre ref={outputRef} className="ide-run-output" aria-live="polite">{runOutput || (runStatus === '运行中' ? '正在等待运行结果…' : '运行结果会显示在这里')}</pre>
              </div>
            </div>

            {(runTime !== null || runExpected) && (
              <div className="ide-run-meta">
                {runTime !== null && <span>算法用时: {runTime}ms</span>}
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
