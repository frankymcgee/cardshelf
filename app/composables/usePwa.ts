type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let deferredInstall: InstallEvent | null = null
const DISMISS_KEY = 'cardshelf.install-dismissed-until'
export function usePwa() {
  const state = useState('pwa', () => ({ ready: false, secure: false, installed: false, ios: false, mobile: false, canPrompt: false, dismissed: false, instructions: false, busy: false, message: '' }))
  function dismiss() {
    state.value.dismissed = true; state.value.instructions = false
    try { localStorage.setItem(DISMISS_KEY, String(Date.now() + 30 * 86400000)) } catch { /* Storage may be disabled. */ }
  }
  function initialize() {
    if (!import.meta.client || state.value.ready) return
    const mode = matchMedia('(display-mode: standalone)'), full = matchMedia('(display-mode: fullscreen)')
    const sync = () => { state.value.installed = mode.matches || full.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true }
    sync(); mode.addEventListener('change', sync); full.addEventListener('change', sync)
    state.value.ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    state.value.mobile = state.value.ios || /Android/.test(navigator.userAgent)
    state.value.secure = window.isSecureContext
    try { state.value.dismissed = Number(localStorage.getItem(DISMISS_KEY)) > Date.now() } catch { /* Optional preference. */ }
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault(); deferredInstall = event as InstallEvent; state.value.canPrompt = true
    })
    window.addEventListener('appinstalled', () => {
      deferredInstall = null; state.value.canPrompt = false; state.value.installed = true; state.value.instructions = false
      state.value.message = 'CardShelf is installed. Open it from your Home Screen or app launcher.'
    })
    state.value.ready = true
  }
  async function install() {
    if (state.value.busy) return
    state.value.message = ''
    if (!deferredInstall) { state.value.instructions = !state.value.instructions; return }
    const prompt = deferredInstall; deferredInstall = null; state.value.canPrompt = false; state.value.busy = true
    try {
      // The browser prompt is invoked in the click gesture, before any fetch.
      await prompt.prompt()
      const choice = await prompt.userChoice
      if (choice.outcome === 'dismissed') dismiss()
      else { state.value.dismissed = true; state.value.message = 'Installation requested. Follow your browser’s instructions to finish.' }
    } catch { state.value.instructions = true; state.value.message = 'Use your browser menu to install CardShelf.' }
    finally { state.value.busy = false }
  }
  return { state, initialize, install, dismiss }
}
