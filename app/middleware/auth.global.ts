import { publicPage, sharedPage, safeReturnTo } from '../../shared/platform.mjs'
import { recoveryPage } from '../../shared/password-recovery.mjs'
export default defineNuxtRouteMiddleware(async to => {
  // Public marketing is server-rendered without looking up a private session.
  if (publicPage(to.path) || sharedPage(to.path) || recoveryPage(to.path) || to.path.replace(/\/+$/, '') === '/verify-email') return
  if (import.meta.server) return
  const auth = useAuth()
  const login = {path:'/login',query:{next:safeReturnTo(to.fullPath)}}
  try { if (!auth.state.value.loaded) await auth.refresh() }
  catch { if (to.path !== '/login') return navigateTo(login); return }
  // An enrollment challenge is intentionally not a private workspace session.
  if (auth.state.value.pending?.scope === 'enrollment') {
    if (to.path !== '/security') return navigateTo({ path: '/security', query: { next: safeReturnTo(to.path === '/login' ? to.query.next : to.fullPath) } })
    return
  }
  if (!auth.state.value.user && to.path !== '/login') return navigateTo(login)
  if (auth.state.value.user && to.path === '/login') return navigateTo(safeReturnTo(to.query.next))
  if ((to.path === '/admin' || to.path.startsWith('/admin/')) && auth.state.value.user?.role !== 'admin') return navigateTo('/account')
})
