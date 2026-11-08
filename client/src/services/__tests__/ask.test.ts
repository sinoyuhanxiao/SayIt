import { describe, expect, it, vi } from 'vitest'
import { AskSession, askContext, conversationPrompt } from '../ask'
import type { ActiveAppContext } from '@/types/appContext'

describe('ephemeral voice question session', () => {
  it('rejects old results and results arriving after cancellation', async () => {
    const publish = vi.fn(async (_snapshot: unknown) => {})
    const session = new AskSession(publish)
    session.begin(1)
    session.cancel(1)
    session.finish(1, { asrText: 'old', llmText: 'old answer', aiStatus: 'applied' } as never)
    session.begin(2)
    session.finish(1, { asrText: 'old', llmText: 'old answer', aiStatus: 'applied' } as never)
    session.finish(2, { asrText: 'new', llmText: 'new answer', aiStatus: 'applied' } as never)
    for (let i = 0; i < 40; i++) await Promise.resolve()
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ runId: 2, status: 'done', answer: 'new answer' }),
    )
    expect(publish.mock.calls.map((call) => call[0])).not.toContainEqual(
      expect.objectContaining({ answer: 'old answer' }),
    )
  })

  it('warns rather than silently using a truncated selection', () => {
    const context = { textContext: { selectedText: 'partial', selectionTruncated: true } } as ActiveAppContext
    const result = askContext(context)
    expect(result.selectedText).toBe('')
    expect(result.contextWarning).toBeTruthy()
  })

  it('carries earlier answers and the original selection into a text follow-up', async () => {
    const session = new AskSession(vi.fn(async () => {}))
    session.begin(1)
    session.update(1, { selectedText: 'Original passage' })
    session.finish(1, { asrText: 'What is this?', llmText: 'A portfolio.', aiStatus: 'applied' } as never)
    const request = vi.fn(async () => 'Product management.')
    await session.followUp(1, ' What work? ', request)
    expect(request).toHaveBeenCalledWith('What work?', expect.stringContaining('A portfolio.'), 'Original passage')
    expect(session.current).toMatchObject({ question: 'What work?', answer: 'Product management.', turns: [{ question: 'What is this?', answer: 'A portfolio.' }] })
    session.begin(2, true)
    expect(session.current?.turns).toHaveLength(2)
    expect(session.current?.selectedText).toBe('Original passage')
    expect(session.prompt).toContain('Product management.')
    session.begin(3)
    expect(session.current?.turns).toEqual([])
    expect(session.current?.selectedText).toBe('')
  })

  it('ignores duplicate sends, cancellation and a response from a previous conversation', async () => {
    const session = new AskSession(vi.fn(async () => {}))
    session.begin(1)
    session.finish(1, { asrText: 'First', llmText: 'Answer', aiStatus: 'applied' } as never)
    let resolve!: (text: string) => void
    const request = vi.fn(() => new Promise<string>(r => { resolve = r }))
    const pending = session.followUp(1, 'Next', request)
    await session.followUp(1, 'Duplicate', request)
    expect(request).toHaveBeenCalledTimes(1)
    session.cancel(1)
    resolve('Late answer')
    await pending
    expect(session.current?.status).toBe('cancelled')
    session.begin(2)
    session.finish(2, { asrText: 'Second', llmText: 'Another answer', aiStatus: 'applied' } as never)
    const pending2 = session.followUp(2, 'Old request', request)
    session.begin(3)
    resolve('Obsolete answer')
    await pending2
    expect(session.current).toMatchObject({ runId: 3, answer: '' })
  })

  it('keeps successful earlier turns after a failed follow-up and retries without the failed turn', async () => {
    const session = new AskSession(vi.fn(async () => {}))
    session.begin(1)
    session.finish(1, { asrText: 'First', llmText: 'Answer', aiStatus: 'applied' } as never)
    await session.followUp(1, 'Failure', async () => { throw new Error('Configure AI') })
    expect(session.current).toMatchObject({ status: 'error', error: 'Configure AI', turns: [{ question: 'First', answer: 'Answer' }] })
    const request = vi.fn(async () => 'Success')
    await session.followUp(1, 'Retry', request)
    expect(request.mock.calls[0]).toBeDefined()
    expect(session.current?.turns).toHaveLength(1)
    expect(session.current?.status).toBe('done')
    expect(conversationPrompt([{ question: 'First', answer: 'Answer' }])).toContain('<conversation_history>')
  })
})
