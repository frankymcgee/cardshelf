import { defineEventHandler, getQuery } from 'h3'
import { platformUser, platformBody, platformResult } from '../../../../../utils/platform-api'
import { rateLimit } from '../../../../../../lib/auth.mjs'
import { saveStripeProductSettings } from '../../../../../../lib/stripe-product-sync.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event, true)
  await rateLimit('stripe-product-settings:' + user.id, 10)
  return saveStripeProductSettings(user.id, String(getQuery(event).environment || 'sandbox'), await platformBody(event))
}))
