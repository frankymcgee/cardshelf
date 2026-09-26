import { defineEventHandler, getRouterParam, setHeader } from 'h3'
import { platformBody, platformResult, platformUser } from '../../../../utils/platform-api'
import { rateLimit } from '../../../../../lib/auth.mjs'
import { addBinderCompletionWishlist } from '../../../../../lib/binder-completion.mjs'
export default defineEventHandler(event => platformResult(async () => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const user = await platformUser(event)
  await rateLimit('binder-completion-write:' + user.id, 30)
  return addBinderCompletionWishlist(user.id, getRouterParam(event, 'id'), await platformBody(event, 49152))
}))
