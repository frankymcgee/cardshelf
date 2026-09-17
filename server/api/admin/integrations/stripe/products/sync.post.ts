import { defineEventHandler, getQuery } from 'h3'
import { platformUser, platformBody, platformResult } from '../../../../../utils/platform-api'
import { rateLimit } from '../../../../../../lib/auth.mjs'
import { strictObject } from '../../../../../../lib/subscription-logic.mjs'
import { syncStripeProducts } from '../../../../../../lib/stripe-product-sync.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event, true)
  strictObject(await platformBody(event), [])
  await rateLimit('stripe-product-sync:' + user.id, 6)
  return syncStripeProducts(user.id, String(getQuery(event).environment || 'sandbox'))
}))
