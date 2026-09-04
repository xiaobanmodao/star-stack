import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker'
import { conf as cppConf, language as cppLanguage } from 'monaco-editor/esm/vs/basic-languages/cpp/cpp.js'
import { conf as javaConf, language as javaLanguage } from 'monaco-editor/esm/vs/basic-languages/java/java.js'
import { conf as pythonConf, language as pythonLanguage } from 'monaco-editor/esm/vs/basic-languages/python/python.js'

type MonacoWorkerHost = typeof globalThis & {
  MonacoEnvironment?: {
    getWorker: () => Worker
  }
}

// Monaco must be served by StarStack itself. The loader's default points at a
// public CDN, which is both blocked by the production CSP and unreliable on
// networks where that CDN is slow or unavailable.
const workerHost = globalThis as MonacoWorkerHost
workerHost.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
}

const registerLanguage = (
  id: string,
  aliases: string[],
  extensions: string[],
  configuration: monaco.languages.LanguageConfiguration,
  language: monaco.languages.IMonarchLanguage,
) => {
  if (!monaco.languages.getLanguages().some((item) => item.id === id)) {
    monaco.languages.register({ id, aliases, extensions })
  }
  monaco.languages.setLanguageConfiguration(id, configuration)
  monaco.languages.setMonarchTokensProvider(id, language)
}

registerLanguage('cpp', ['C++', 'Cpp', 'cpp'], ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'], cppConf, cppLanguage)
registerLanguage('python', ['Python', 'python'], ['.py'], pythonConf, pythonLanguage)
registerLanguage('java', ['Java', 'java'], ['.java'], javaConf, javaLanguage)
loader.config({ monaco })

export const initializeMonaco = () => loader.init()
