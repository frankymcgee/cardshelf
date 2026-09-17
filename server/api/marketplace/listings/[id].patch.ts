import { defineEventHandler, getRouterParam } from 'h3'
import { platformUser, platformBody, platformResult } from '../../../utils/platform-api'
import { requireCapability } from '../../../../lib/membership.mjs'
import { rateLimit } from '../../../../lib/auth.mjs'
import { editSale } from '../../../../lib/marketplace.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event), body = await platformBody(event)
  // Former sellers may still withdraw or complete existing conversations, but cannot reactivate listings.
  if (body?.status === 'active') await requireCapability(user.id, 'marketplace_sell')
  await rateLimit('marketplace-edit:' + user.id, 60)
  return editSale(user, getRouterParam(event, 'id'), body)
}))
