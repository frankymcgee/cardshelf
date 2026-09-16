export default defineNuxtPlugin(() => {
  if ('serviceWorker' in navigator && window.isSecureContext && !import.meta.dev) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(error => console.warn('CardShelf service worker:', error))
  }
})
