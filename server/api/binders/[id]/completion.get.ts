import { defineEventHandler, getRouterParam, setHeader } from 'h3'
import { platformResult, platformUser } from '../../../utils/platform-api'
import { rateLimit } from '../../../../lib/auth.mjs'
import { getBinderCompletion } from '../../../../lib/binder-completion.mjs'
export default defineEventHandler(event => platformResult(async () => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const user = await platformUser(event)
  await rateLimit('binder-completion-read:' + user.id, 180)
  return getBinderCompletion(user.id, getRouterParam(event, 'id'))
}))
