import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Check, Copy, LoaderCircle, MessageCircle, Mic, Send, X } from 'lucide-react'
import { askWindowAction, copyText, getAskSnapshot } from '@/services/bridge'
import type { AskSnapshot } from '@/services/ask'
import { setLocale } from '@/i18n'
import { useT } from '@/i18n/useT'
import '@/index.css'

const preview = import.meta.env.DEV && !isTauri()
const previewState = new URLSearchParams(location.search).get('state')
// i18n-allow-start: sample content for the development-only visual preview
const initial: AskSnapshot = {
  revision: 0,
  runId: 0,
  status: preview
    ? previewState === 'processing'
      ? 'processing'
      : previewState === 'error'
        ? 'error'
        : 'done'
    : 'processing',
  question: preview ? '这段话是什么意思？能举个例子吗？' : '',
  answer: preview
    ? '这段话说明：你可以在当前应用中选中文字，再用语音提问。\n\n例如，阅读文档时，选中不理解的段落，按 Alt＋空格说出问题，回答就会显示在这个窗口里。'
    : '',
  selectedText: preview ? 'Select any text, then ask a question with your voice.' : '',
  contextWarning: '',
  error: previewState === 'error' ? 'AI 服务暂时不可用，请稍后重新提问。' : '',
  locale: 'zh-CN',
}
// i18n-allow-end

function AskWindow() {
  const [snapshot, setSnapshot] = useState(initial)
  const [copied, setCopied] = useState(false)
  const [actionError, setActionError] = useState(false)
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submitLock = useRef(false)
  const conversationEnd = useRef<HTMLDivElement>(null)
  const t = useT()
  const busy = snapshot.status === 'processing' || snapshot.status === 'listening'

  useEffect(() => {
    if (preview) {
      setLocale(initial.locale)
      return
    }
    let disposed = false
    let unlisten: (() => void) | undefined
    const apply = (next: AskSnapshot) => {
      if (disposed) return
      setSnapshot((current) => (next.revision >= current.revision ? next : current))
    }
    void (async () => {
      unlisten = await listen<AskSnapshot>('ask-state', ({ payload }) => apply(payload))
      if (disposed) {
        unlisten()
        return
      }
      apply(await getAskSnapshot())
    })().catch(() => {
      if (!disposed) setActionError(true)
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    setLocale(snapshot.locale)
  }, [snapshot.locale])
  useEffect(() => {
    setCopied(false)
    setActionError(false)
  }, [snapshot.question])
  useEffect(() => {
    if (!snapshot.turns?.length) setDraft('')
  }, [snapshot.runId])
  useEffect(() => {
    conversationEnd.current?.scrollIntoView({ block: 'nearest' })
  }, [snapshot.revision])

  const submit = async () => {
    const question = draft.trim()
    if (busy || submitLock.current || !question || question.length > 4000) return
    submitLock.current = true
    setSubmitting(true)
    setActionError(false)
    try {
      if (preview) {
        setSnapshot(current => ({ ...current, revision: current.revision + 1,
          turns: [...(current.turns ?? []), { question: current.question, answer: current.answer }],
          question, answer: current.answer, status: 'done' }))
      } else await askWindowAction(snapshot.runId, 'followup', question)
      setDraft('')
    } catch {
      setActionError(true)
    } finally {
      submitLock.current = false
      setSubmitting(false)
    }
  }

  const act = async (action: 'cancel' | 'new') => {
    try {
      if (!preview) await askWindowAction(snapshot.runId, action)
    } catch {
      setActionError(true)
    }
  }

  const copy = async () => {
    try {
      await copyText(snapshot.answer)
      setCopied(true)
    } catch {
      setActionError(true)
    }
  }

  return (
    <main className="flex h-screen flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div className="flex items-center gap-2 font-semibold">
          <MessageCircle className="h-5 w-5 text-blue-500" />
          {t('ask.title')}
        </div>
        <button
          type="button"
          onClick={() => void act('cancel')}
          aria-label={t('ask.close')}
          className="rounded-lg p-2 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:hover:bg-slate-800"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        {snapshot.selectedText ? (
          <details className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900">
            <summary className="cursor-pointer font-medium">{t('ask.reference')}</summary>
            <p className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-slate-600 dark:text-slate-300">
              {snapshot.selectedText}
            </p>
          </details>
        ) : (
          <p className="text-xs text-slate-500">{snapshot.contextWarning || t('ask.noSelection')}</p>
        )}
        {(snapshot.turns ?? []).map((turn, index) => (
          <article key={index} className="space-y-3 border-b border-slate-100 pb-5 dark:border-slate-800">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('ask.question')}</h2>
            <p className="whitespace-pre-wrap break-words rounded-xl bg-blue-50 px-4 py-3 text-sm leading-relaxed dark:bg-blue-950">{turn.question}</p>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('ask.answer')}</h2>
            <p className="whitespace-pre-wrap break-words text-sm leading-7">{turn.answer}</p>
          </article>
        ))}
        <section aria-label={t('ask.question')}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('ask.question')}</h2>
          <p className="whitespace-pre-wrap break-words rounded-xl bg-blue-50 px-4 py-3 text-sm leading-relaxed dark:bg-blue-950">
            {snapshot.question || t('ask.recognizing')}
          </p>
        </section>
        <section aria-label={t('ask.answer')} aria-busy={busy} aria-live="polite">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('ask.answer')}</h2>
          {snapshot.status === 'error' ? (
            <p role="alert" className="text-sm leading-relaxed text-red-600 dark:text-red-400">
              {snapshot.error}
            </p>
          ) : busy ? (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              {t('ask.thinking')}
            </p>
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm leading-7">{snapshot.answer}</p>
          )}
        </section>
        {actionError ? (
          <p role="alert" className="text-sm text-red-600">
            {t('ask.actionFailed')}
          </p>
        ) : null}
        <div ref={conversationEnd} />
      </div>
      <footer className="shrink-0 space-y-3 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
        <form className="flex items-end gap-2" onSubmit={event => { event.preventDefault(); void submit() }}>
          <textarea
            aria-label={t('ask.followup')}
            placeholder={t('ask.followupPlaceholder')}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void submit()
              }
            }}
            rows={2}
            maxLength={4000}
            className="min-w-0 flex-1 resize-none rounded-lg border border-slate-300 bg-transparent p-3 text-sm focus:outline-blue-500 dark:border-slate-700"
          />
          <button type="submit" disabled={busy || submitting || !draft.trim()}
            aria-label={t('ask.send')}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-3 text-sm text-white disabled:opacity-40">
            <Send className="h-4 w-4" />{t('ask.send')}
          </button>
        </form>
        <p className="text-xs leading-5 text-slate-500">{t('ask.textHint')}</p>
        <div className="flex items-center justify-between gap-3">
        {busy ? (
          <button type="button" onClick={() => void act('cancel')} className="rounded-lg border px-3 py-2 text-sm">
            {t('ask.cancel')}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void act('new')}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
          >
            <Mic className="h-4 w-4" />
            {t('ask.new')}
          </button>
        )}
        <button
          type="button"
          disabled={busy || !snapshot.answer || snapshot.status !== 'done'}
          onClick={() => void copy()}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-40"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {t(copied ? 'ask.copied' : 'ask.copy')}
        </button>
        </div>
      </footer>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<AskWindow />)
