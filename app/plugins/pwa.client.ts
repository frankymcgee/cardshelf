export default defineNuxtPlugin(() => {
  usePwa().initialize()
  if ('serviceWorker' in navigator && window.isSecureContext && !import.meta.dev) {
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => console.warn('CardShelf could not prepare the installed app.'))
  }
})
