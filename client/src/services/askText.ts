import { invoke } from '@tauri-apps/api/core'
import { getSetting } from './store'
import { t } from '@/i18n'
import { isClientAiConfigComplete } from './transcription/clientAiPolish'

/** Public transcription servers have no text-chat endpoint. Use the user's AI profile. */
export async function requestAskText(question: string, prompt: string, selectedText: string, imageDataUrl?: string): Promise<string> {
  const [provider, apiUrl, apiKey, model] = await Promise.all([
    getSetting('cloudAi.provider', 'openai_compat'), getSetting('cloudAi.apiUrl', ''),
    getSetting('cloudAi.apiKey', ''), getSetting('cloudAi.model', ''),
  ])
  if (!isClientAiConfigComplete({ provider, apiUrl, apiKey, model })) {
    throw new Error(t('ask.textNeedsAi'))
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      invoke<{ text: string }>('cloud_polish', { request: {
        text: question,
        ai_config: { provider, api_url: apiUrl, api_key: apiKey, model, extra: { task: 'ask' } },
        image_data_url: imageDataUrl ?? null,
        system_prompt: prompt,
        text_context: selectedText ? { source: 'ask_conversation', text_before: '', selected_text: selectedText, text_after: '', selection_truncated: false } : null,
      } }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(t('ask.timeout'))), 65_000) }),
    ])
    return result.text
  } catch (error) {
    // Do not display provider error bodies which can contain credentials or prompt text.
    if (error instanceof Error && error.message === t('ask.timeout')) throw error
    if (imageDataUrl) throw new Error(t('ask.imageRequestFailed'))
    throw new Error(t('ask.failed'))
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
