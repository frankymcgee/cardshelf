import { defineEventHandler } from 'h3'
import { platformUser, platformBody, platformResult } from '../../../../utils/platform-api'
import { rateLimit } from '../../../../../lib/auth.mjs'
import { saveSubscriptionControls } from '../../../../../lib/subscription-controls.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event, true)
  await rateLimit('stripe-controls:' + user.id, 10)
  return saveSubscriptionControls(user.id, await platformBody(event))
}))
