import { adDocumentNeedsReload } from '../../shared/adsense-browser.mjs'
export default defineNuxtRouteMiddleware((to, from) => {
  if (import.meta.server) return
  const loaded = (window as Window & { __cardshelfAdSenseLoaded?: boolean }).__cardshelfAdSenseLoaded
  if (adDocumentNeedsReload(loaded, to.fullPath, from.fullPath, !from.matched.length)) {
    // Removing a <script> does not undo third-party code already executed.
    // A fresh document keeps that code out of account/admin/billing/reset routes.
    return navigateTo(to.fullPath, { external: true })
  }
})
