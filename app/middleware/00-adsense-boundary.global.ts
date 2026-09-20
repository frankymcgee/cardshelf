import { adDocumentNeedsReloadForUser } from '../../shared/adsense-browser.mjs'
let navigationSequence = 0
export default defineNuxtRouteMiddleware(async (to, from) => {
  if (import.meta.server) return
  const sequence = ++navigationSequence
  const loaded = (window as Window & { __cardshelfAdSenseLoaded?: boolean }).__cardshelfAdSenseLoaded
  const api = useApi()
  const replaceDocument = await adDocumentNeedsReloadForUser(loaded, to.fullPath, from.fullPath, !from.matched.length,
    (path: string) => api('/api/ads/adsense', { query: { path } }))
  if (sequence !== navigationSequence) return // A newer navigation superseded this read.
  if (replaceDocument) {
    // Removing a <script> does not undo third-party code already executed.
    // A fresh document keeps that code out of account/admin/billing/reset routes.
    return navigateTo(to.fullPath, { external: true })
  }
})
