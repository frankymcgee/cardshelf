import { themeMode } from '../../shared/theme.mjs'
import type { ThemeMode } from '../../shared/theme.mjs'

export function useTheme() {
  const mode = useState<ThemeMode>('cardshelf:theme', () => 'system')
  const ready = useState<boolean>('cardshelf:theme-ready', () => false)
  return { mode: readonly(mode), ready: readonly(ready), setMode: (value: unknown) => { mode.value = themeMode(value) } }
}
