import { defineEventHandler, createError, sendRedirect, setHeader } from 'h3'
import { retiredBattleRoute } from '../../shared/legacy-battle.mjs'
import { platformUser, platformResult } from '../utils/platform-api'
// The ordinary security/origin middleware runs before this retirement boundary.
export default defineEventHandler(event => platformResult(async () => {
  const route = retiredBattleRoute(event.path)
  if (!route) return
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  if (route.kind === 'page') return sendRedirect(event, route.to, 302)
  await platformUser(event, route.admin)
  throw createError({ statusCode: 410, message: 'The assisted battle beta has retired. Use the automated Arena. Previous records are retained.', data: { arena: route.to } })
}))
