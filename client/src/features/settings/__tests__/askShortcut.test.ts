import { beforeEach, describe, expect, it, vi } from 'vitest'

const testShortcut = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@/services/bridge', () => ({ testShortcut }))

import { checkShortcutBeforeCommit } from '../ShortcutInputs'

describe('question shortcut exception', () => {
  beforeEach(() => testShortcut.mockClear())

  it('continues to reject Alt+Space for existing shortcut settings', async () => {
    expect(await checkShortcutBeforeCommit('Alt+Space')).toBeTruthy()
    expect(testShortcut).not.toHaveBeenCalled()
  })

  it('allows Alt+Space only for the explicit question setting, after conflict probing', async () => {
    expect(await checkShortcutBeforeCommit('Alt+Space', undefined, true)).toBeNull()
    expect(testShortcut).toHaveBeenCalledWith('Alt+Space')
  })

  it.each(['Alt+F4', 'Alt+Tab'])('does not relax other system reservations: %s', async value => {
    expect(await checkShortcutBeforeCommit(value, undefined, true)).toBeTruthy()
    expect(testShortcut).not.toHaveBeenCalled()
  })
})
