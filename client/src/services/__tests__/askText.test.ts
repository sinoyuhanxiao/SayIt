import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { requestAskText } from '../askText'

const settings = vi.hoisted(() => ({} as Record<string, string>))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }))
vi.mock('../store', () => ({ getSetting: vi.fn(async (key: string, fallback: string) => settings[key] ?? fallback) }))

beforeEach(() => {
  Object.keys(settings).forEach(key => delete settings[key])
  vi.mocked(invoke).mockReset()
})

describe('text questions use only the configured custom AI', () => {
  it('explains missing configuration without contacting the public transcription server', async () => {
    await expect(requestAskText('Next question', 'Prompt', 'Selection')).rejects.toThrow()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('sends the question, conversation and original reference without unrelated text', async () => {
    Object.assign(settings, { 'cloudAi.provider': 'ollama', 'cloudAi.apiUrl': 'http://localhost:11434', 'cloudAi.model': 'local-model' })
    vi.mocked(invoke).mockResolvedValue({ text: 'An answer' })
    await expect(requestAskText('Next question', 'Conversation prompt', 'Original reference')).resolves.toBe('An answer')
    expect(invoke).toHaveBeenCalledWith('cloud_polish', { request: {
      text: 'Next question', system_prompt: 'Conversation prompt',
      ai_config: { provider: 'ollama', api_url: 'http://localhost:11434', api_key: '', model: 'local-model', extra: { task: 'ask' } },
      text_context: { source: 'ask_conversation', text_before: '', selected_text: 'Original reference', text_after: '', selection_truncated: false },
    } })
  })

  it('does not show provider error bodies in the conversation', async () => {
    Object.assign(settings, { 'cloudAi.provider': 'ollama', 'cloudAi.apiUrl': 'http://localhost:11434', 'cloudAi.model': 'local-model' })
    vi.mocked(invoke).mockRejectedValue(new Error('Provider response includes secret-api-key'))
    const result = requestAskText('Next question', 'Prompt', '')
    await expect(result).rejects.toThrow()
    await expect(result).rejects.not.toThrow('secret-api-key')
  })
})
