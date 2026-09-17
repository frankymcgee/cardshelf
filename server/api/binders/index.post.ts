import { defineEventHandler } from 'h3'
import { platformUser, platformBody, platformResult } from '../../utils/platform-api'
import { createBinder } from '../../../lib/binders.mjs'
import { requireCapability } from '../../../lib/membership.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event), body = await platformBody(event)
  await requireCapability(user.id, body?.binder_type === 'tracking' ? 'tracking_binders' : 'binders')
  return createBinder(user.id, body)
}))
