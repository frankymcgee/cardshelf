import { defineEventHandler } from 'h3'
import { platformUser, platformBody, platformResult } from '../../../utils/platform-api'
import { createGeneratedBinders } from '../../../../lib/binder-generation.mjs'
import { requireCapability } from '../../../../lib/membership.mjs'
import { rateLimit } from '../../../../lib/auth.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event), body = await platformBody(event)
  await requireCapability(user.id, body?.binder_type === 'tracking' ? 'tracking_binders' : 'binders')
  await rateLimit('binder-generate:' + user.id, 20)
  return createGeneratedBinders(user.id, body)
}))
