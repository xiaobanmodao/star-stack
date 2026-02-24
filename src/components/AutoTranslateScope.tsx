import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

export type UiLanguage = 'zh' | 'en'

type AutoTranslateScopeProps = {
  rootRef: RefObject<HTMLElement | null>
  language: UiLanguage
  onBusyChange?: (busy: boolean) => void
  onSettled?: (language: UiLanguage) => void
}

type TranslateBatchResponse = {
  translations?: string[]
  message?: string
}

type PendingEntry = {
  key: string
  source: string
}

const EXCLUDED_ANCESTOR_SELECTOR = [
  'script',
  'style',
  'noscript',
  'code',
  'pre',
  'kbd',
  'samp',
  'textarea',
  'select',
  'option',
  'math',
  'svg',
  '.monaco-editor',
  '.katex',
  '.katex-display',
  '[data-no-auto-translate]',
  '[data-user-name]',
  '[data-user-id]',
  '.account-name',
  '.conversation-name',
  '.new-chat-user-name',
  '.new-chat-user-id',
  '.chat-user-name',
  '.comment-author',
  '.discussion-card-author',
  '.post-author',
  '.oj-recent-ac-user',
  '.leaderboard-user-name',
  '.leaderboard-user-id',
  '.admin-user-name',
  '.submission-user-name',
  '.submission-user-id',
  '.comment-reply-to-name',
  '[contenteditable="true"]',
].join(',')

const ATTRIBUTE_SELECTOR = [
  '[title]',
  '[placeholder]',
  '[aria-label]',
  '[aria-placeholder]',
  'input[type="button"][value]',
  'input[type="submit"][value]',
  'input[type="reset"][value]',
].join(',')

const OBSERVED_ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'aria-placeholder', 'value'] as const
type ObservedAttribute = (typeof OBSERVED_ATTRIBUTES)[number]

const MAX_BATCH_ITEMS = 60
const MAX_BATCH_CHARS = 12000

const isCandidateText = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return false
  return /[A-Za-z\u4e00-\u9fff]/.test(trimmed)
}

const isExcludedElement = (element: Element | null) => {
  if (!element) return true
  return Boolean(element.closest(EXCLUDED_ANCESTOR_SELECTOR))
}

const cacheKey = (targetLang: 'en', source: string) => `${targetLang}\u0000${source}`

const chunkEntries = (entries: PendingEntry[]) => {
  const batches: PendingEntry[][] = []
  let current: PendingEntry[] = []
  let chars = 0

  for (const entry of entries) {
    const nextChars = chars + entry.source.length
    if (current.length >= MAX_BATCH_ITEMS || (current.length > 0 && nextChars > MAX_BATCH_CHARS)) {
      batches.push(current)
      current = []
      chars = 0
    }
    current.push(entry)
    chars += entry.source.length
  }

  if (current.length > 0) {
    batches.push(current)
  }

  return batches
}

const shouldTranslateInputValue = (element: Element) => {
  if (!(element instanceof HTMLInputElement)) return false
  const type = element.type.toLowerCase()
  return type === 'button' || type === 'submit' || type === 'reset'
}

const getAttrNamesToTranslate = (element: Element): ObservedAttribute[] => {
  const names: ObservedAttribute[] = []
  for (const attr of OBSERVED_ATTRIBUTES) {
    if (attr === 'value') {
      if (shouldTranslateInputValue(element) && element.hasAttribute('value')) {
        names.push(attr)
      }
      continue
    }
    if (element.hasAttribute(attr)) {
      names.push(attr)
    }
  }
  return names
}

export function AutoTranslateScope({ rootRef, language, onBusyChange, onSettled }: AutoTranslateScopeProps) {
  const originalTextRef = useRef(new WeakMap<Text, string>())
  const originalAttrRef = useRef(new WeakMap<Element, Map<ObservedAttribute, string | null>>())
  const translatedCacheRef = useRef(new Map<string, string>())
  const inflightKeysRef = useRef(new Set<string>())
  const observerRef = useRef<MutationObserver | null>(null)
  const scanTimerRef = useRef<number | null>(null)
  const applyingRef = useRef(false)
  const flushInProgressRef = useRef(false)
  const generationRef = useRef(0)
  const languageRef = useRef<UiLanguage>(language)
  const busyRef = useRef(false)
  const settleTimerRef = useRef<number | null>(null)
  const onBusyChangeRef = useRef<typeof onBusyChange>(onBusyChange)
  const onSettledRef = useRef<typeof onSettled>(onSettled)

  const clearSettleTimer = () => {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current)
      settleTimerRef.current = null
    }
  }

  const emitBusy = (next: boolean) => {
    if (busyRef.current === next) return
    busyRef.current = next
    onBusyChangeRef.current?.(next)
    if (next) {
      clearSettleTimer()
    }
  }

  const scheduleSettled = (delay = 180) => {
    clearSettleTimer()
    const generationAtSchedule = generationRef.current
    const languageAtSchedule = languageRef.current
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null
      if (generationRef.current !== generationAtSchedule) return
      if (languageRef.current !== languageAtSchedule) return
      if (busyRef.current) return
      onSettledRef.current?.(languageAtSchedule)
    }, delay)
  }

  const clearScanTimer = () => {
    if (scanTimerRef.current !== null) {
      window.clearTimeout(scanTimerRef.current)
      scanTimerRef.current = null
    }
  }

  const getSourceText = (node: Text) => {
    const current = node.data
    const cachedOriginal = originalTextRef.current.get(node)
    if (cachedOriginal === undefined) {
      originalTextRef.current.set(node, current)
      return current
    }

    const translated = translatedCacheRef.current.get(cacheKey('en', cachedOriginal))
    if (languageRef.current === 'en' && translated && current !== cachedOriginal && current !== translated) {
      originalTextRef.current.set(node, current)
      return current
    }

    return cachedOriginal
  }

  const getSourceAttrValue = (element: Element, attr: ObservedAttribute) => {
    let attrMap = originalAttrRef.current.get(element)
    if (!attrMap) {
      attrMap = new Map()
      originalAttrRef.current.set(element, attrMap)
    }

    const current = element.getAttribute(attr)
    if (!attrMap.has(attr)) {
      attrMap.set(attr, current)
      return current
    }

    const cachedOriginal = attrMap.get(attr) ?? null
    if (cachedOriginal === null) return null

    const translated = translatedCacheRef.current.get(cacheKey('en', cachedOriginal))
    if (languageRef.current === 'en' && translated && current !== cachedOriginal && current !== translated) {
      attrMap.set(attr, current)
      return current
    }

    return cachedOriginal
  }

  const collectTextNodes = (root: HTMLElement) => {
    const nodes: Text[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let current = walker.nextNode()
    while (current) {
      const textNode = current as Text
      const parent = textNode.parentElement
      if (parent && !isExcludedElement(parent)) {
        const source = getSourceText(textNode)
        if (isCandidateText(source)) {
          nodes.push(textNode)
        }
      }
      current = walker.nextNode()
    }
    return nodes
  }

  const collectAttributeTargets = (root: HTMLElement) => {
    return Array.from(root.querySelectorAll(ATTRIBUTE_SELECTOR)).filter((element) => !isExcludedElement(element))
  }

  const restoreOriginalContent = (root: HTMLElement) => {
    applyingRef.current = true
    try {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let current = walker.nextNode()
      while (current) {
        const textNode = current as Text
        const original = originalTextRef.current.get(textNode)
        if (original !== undefined && textNode.data !== original) {
          textNode.data = original
        }
        current = walker.nextNode()
      }

      for (const element of collectAttributeTargets(root)) {
        const attrMap = originalAttrRef.current.get(element)
        if (!attrMap) continue
        for (const attr of getAttrNamesToTranslate(element)) {
          if (!attrMap.has(attr)) continue
          const original = attrMap.get(attr) ?? null
          if (original === null) {
            element.removeAttribute(attr)
            continue
          }
          if (element.getAttribute(attr) !== original) {
            element.setAttribute(attr, original)
          }
        }
      }
    } finally {
      applyingRef.current = false
    }
  }

  const scheduleScan = (delay = 60) => {
    if (languageRef.current === 'en') {
      emitBusy(true)
    }
    clearScanTimer()
    scanTimerRef.current = window.setTimeout(() => {
      scanTimerRef.current = null
      void runScan()
    }, delay)
  }

  const requestTranslations = async (entries: PendingEntry[], generation: number) => {
    if (entries.length === 0 || flushInProgressRef.current) return
    emitBusy(true)
    flushInProgressRef.current = true

    try {
      const batches = chunkEntries(entries)
      for (const batch of batches) {
        if (generationRef.current !== generation || languageRef.current !== 'en') return

        for (const item of batch) {
          inflightKeysRef.current.add(item.key)
        }

        try {
          const response = await fetch('/api/translate/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sourceLang: 'auto',
              targetLang: 'en',
              texts: batch.map((item) => item.source),
            }),
          })

          if (!response.ok) {
            continue
          }

          const data = (await response.json()) as TranslateBatchResponse
          const translations = data.translations || []
          for (let i = 0; i < batch.length; i += 1) {
            const item = batch[i]
            translatedCacheRef.current.set(item.key, translations[i] || item.source)
          }
        } catch {
          // Keep originals on failure; backend already falls back item-by-item when possible.
        } finally {
          for (const item of batch) {
            inflightKeysRef.current.delete(item.key)
          }
        }
      }
    } finally {
      flushInProgressRef.current = false
      if (generationRef.current === generation && languageRef.current === 'en') {
        scheduleScan(0)
      }
    }
  }

  const runScan = async () => {
    const root = rootRef.current
    if (!root) return

    if (languageRef.current !== 'en') {
      restoreOriginalContent(root)
      return
    }

    const missingByKey = new Map<string, string>()
    const textNodes = collectTextNodes(root)
    const attrTargets = collectAttributeTargets(root)

    applyingRef.current = true
    try {
      for (const textNode of textNodes) {
        const source = getSourceText(textNode)
        const key = cacheKey('en', source)
        const translated = translatedCacheRef.current.get(key)

        if (translated !== undefined) {
          if (textNode.data !== translated) {
            textNode.data = translated
          }
          continue
        }

        if (!inflightKeysRef.current.has(key)) {
          missingByKey.set(key, source)
        }
      }

      for (const element of attrTargets) {
        for (const attr of getAttrNamesToTranslate(element)) {
          const source = getSourceAttrValue(element, attr)
          if (!source || !isCandidateText(source)) continue

          const key = cacheKey('en', source)
          const translated = translatedCacheRef.current.get(key)

          if (translated !== undefined) {
            if (element.getAttribute(attr) !== translated) {
              element.setAttribute(attr, translated)
            }
            continue
          }

          if (!inflightKeysRef.current.has(key)) {
            missingByKey.set(key, source)
          }
        }
      }
    } finally {
      applyingRef.current = false
    }

    if (missingByKey.size > 0) {
      const generation = generationRef.current
      const pendingEntries = Array.from(missingByKey, ([key, source]) => ({ key, source }))
      await requestTranslations(pendingEntries, generation)
      return
    }

    emitBusy(false)
    scheduleSettled()
  }

  useEffect(() => {
    languageRef.current = language
  }, [language])

  useEffect(() => {
    onBusyChangeRef.current = onBusyChange
  }, [onBusyChange])

  useEffect(() => {
    onSettledRef.current = onSettled
  }, [onSettled])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    generationRef.current += 1
    const generation = generationRef.current

    observerRef.current?.disconnect()
    clearScanTimer()
    clearSettleTimer()

    if (language === 'zh') {
      restoreOriginalContent(root)
      emitBusy(false)
      scheduleSettled(0)
      return () => {
        observerRef.current?.disconnect()
        clearScanTimer()
        clearSettleTimer()
      }
    }

    emitBusy(true)
    scheduleScan(0)

    const observer = new MutationObserver((mutations) => {
      if (applyingRef.current || languageRef.current !== 'en') return

      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const name = mutation.attributeName
          if (!name || !(OBSERVED_ATTRIBUTES as readonly string[]).includes(name)) {
            continue
          }
          scheduleScan()
          return
        }
        if (mutation.type === 'childList' || mutation.type === 'characterData') {
          scheduleScan()
          return
        }
      }
    })

    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...OBSERVED_ATTRIBUTES],
    })
    observerRef.current = observer

    return () => {
      if (generationRef.current === generation) {
        observerRef.current?.disconnect()
      } else {
        observer.disconnect()
      }
      clearScanTimer()
      clearSettleTimer()
    }
  }, [language, rootRef])

  return null
}

export default AutoTranslateScope
