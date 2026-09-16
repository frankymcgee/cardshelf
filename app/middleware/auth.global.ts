export default defineNuxtRouteMiddleware(async to => {
  if (to.path.startsWith('/shared/')) return
  const auth = useAuth()
  try { if (!auth.state.value.loaded) await auth.refresh() }
  catch { if (to.path !== '/login') return navigateTo('/login'); return }
  if (!auth.state.value.user && to.path !== '/login') return navigateTo('/login')
  if (auth.state.value.user && to.path === '/login') return navigateTo('/')
})
