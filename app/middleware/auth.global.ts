import { publicPage, sharedPage, safeReturnTo } from '../../shared/platform.mjs'
export default defineNuxtRouteMiddleware(async to => {
  // Public marketing is server-rendered without looking up a private session.
  if (publicPage(to.path) || sharedPage(to.path)) return
  if (import.meta.server) return
  const auth = useAuth()
  const login = {path:'/login',query:{next:safeReturnTo(to.fullPath)}}
  try { if (!auth.state.value.loaded) await auth.refresh() }
  catch { if (to.path !== '/login') return navigateTo(login); return }
  if (!auth.state.value.user && to.path !== '/login') return navigateTo(login)
  if (auth.state.value.user && to.path === '/login') return navigateTo(safeReturnTo(to.query.next))
  if (to.path.startsWith('/admin/') && auth.state.value.user?.role !== 'admin') return navigateTo('/account')
})
