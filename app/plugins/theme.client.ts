import { themeMode, resolvedTheme, THEME_STORAGE_KEY } from '../../shared/theme.mjs'
import type { ThemeMode } from '../../shared/theme.mjs'

export default defineNuxtPlugin(nuxtApp => {
  const mode = useState<ThemeMode>('cardshelf:theme', () => 'system')
  const ready = useState<boolean>('cardshelf:theme-ready', () => false)
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const read = () => {
    try { return themeMode(window.localStorage.getItem(THEME_STORAGE_KEY)) }
    catch { return themeMode(document.documentElement.dataset.themeMode) }
  }
  const apply = () => {
    const resolved = resolvedTheme(mode.value, media.matches)
    document.documentElement.dataset.theme = resolved
    document.documentElement.dataset.themeMode = mode.value
    document.documentElement.style.colorScheme = resolved
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#111827' : '#5546d8')
  }
  // The head script already painted the right colours. Initialise the selector
  // after hydration so public SSR never differs from the first Vue render.
  nuxtApp.hook('app:mounted', () => {
    mode.value = read(); ready.value = true; apply()
    const stop = watch(mode, () => {
      apply()
      try { window.localStorage.setItem(THEME_STORAGE_KEY, mode.value) } catch { /* Session-only preference still works. */ }
    })
    const storage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) { mode.value = read(); apply() }
    }
    window.addEventListener('storage', storage)
    media.addEventListener('change', apply)
    nuxtApp.vueApp.onUnmount(() => {
      stop(); window.removeEventListener('storage', storage); media.removeEventListener('change', apply)
    })
  })
})
