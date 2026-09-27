import { defineEventHandler, getRouterParam, getQuery, setHeader } from 'h3'
import { platformResult, platformUser } from '../../../../utils/platform-api'
import { rateLimit } from '../../../../../lib/auth.mjs'
import { getBinderCompletionMatches } from '../../../../../lib/binder-completion.mjs'
export default defineEventHandler(event => platformResult(async () => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const user = await platformUser(event)
  await rateLimit('binder-completion-read:' + user.id, 180)
  return getBinderCompletionMatches(user.id, getRouterParam(event, 'id'), getQuery(event))
}))
