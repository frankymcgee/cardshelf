import { retiredBattleRoute } from '../../shared/legacy-battle.mjs'
export default defineNuxtRouteMiddleware(to => {
  const route = retiredBattleRoute(to.path)
  if (route?.kind === 'page') return navigateTo(route.to, { replace: true })
})
