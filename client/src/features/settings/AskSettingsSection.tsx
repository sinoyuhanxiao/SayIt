import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useT } from '@/i18n/useT'
import { getPresetShortcuts, getSetting, setSetting } from '@/services/store'
import * as bridge from '@/services/bridge'
import { pttShortcutConflictsWithAccelerator } from '@/lib/shortcutKeys'
import { IS_MAC } from '@/lib/platform'
import { ComboShortcutInput } from './ShortcutInputs'

export default function AskSettingsSection() {
  const t = useT()
  const [shortcut, setShortcut] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false
    void Promise.all([
      getSetting('shortcutAsk', IS_MAC ? 'Control+Alt+Space' : 'Alt+Space'),
      getSetting('ask.shortcutConflict', false),
      getSetting('ask.enabled', false),
    ])
      .then(([value, conflict, active]) => {
        if (disposed) return
        setShortcut(value)
        setEnabled(active)
        if (conflict) setError(t('ask.shortcutConflict'))
      })
      .catch(() => {
        if (!disposed) setError(t('ask.saveFailed'))
      })
    return () => {
      disposed = true
    }
  }, [t])

  const validate = async (value: string) => {
    const [ptt, handsFree, aiToggle, presets] = await Promise.all([
      getSetting('shortcutPTT', 'ControlRight'),
      getSetting('shortcutHandsFree', 'AltRight'),
      getSetting('shortcutToggleAi', ''),
      getPresetShortcuts(),
    ])
    return pttShortcutConflictsWithAccelerator(ptt, value) ||
      [handsFree, aiToggle, ...Object.values(presets)].some((item) => item && item === value)
      ? t('ask.shortcutInternalConflict')
      : null
  }

  const save = async (value: string) => {
    try {
      await setSetting('shortcutAsk', value)
      await bridge.invoke('shortcuts_changed')
      setShortcut(value)
      setError((await getSetting('ask.shortcutConflict', false)) ? t('ask.shortcutConflict') : '')
    } catch {
      setError(t('ask.saveFailed'))
    }
  }

  const toggle = async () => {
    try {
      const next = !enabled
      await setSetting('ask.enabled', next)
      await bridge.invoke('shortcuts_changed')
      setEnabled(next)
      setError((await getSetting('ask.shortcutConflict', false)) ? t('ask.shortcutConflict') : '')
    } catch {
      setError(t('ask.saveFailed'))
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">{t('ask.title')}</h2>
          <Switch
            checked={enabled}
            onChange={() => void toggle()}
            label={t('ask.enable')}
            disabled={shortcut === null}
          />
        </div>
        <p className="text-sm text-muted-foreground">{t('ask.settingsDescription')}</p>
        {enabled && shortcut !== null ? (
          <ComboShortcutInput
            value={shortcut}
            onChange={(value) => void save(value)}
            label={t('ask.shortcut')}
            description={t('ask.shortcutHint')}
            comboOnly
            allowAltSpace
            validate={validate}
          />
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
