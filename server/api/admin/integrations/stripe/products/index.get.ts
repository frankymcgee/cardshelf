import { defineEventHandler, getQuery } from 'h3'
import { platformUser, platformResult } from '../../../../../utils/platform-api'
import { stripeProductStatus } from '../../../../../../lib/stripe-product-sync.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event, true)
  return stripeProductStatus(user.id, String(getQuery(event).environment || 'sandbox'))
}))
