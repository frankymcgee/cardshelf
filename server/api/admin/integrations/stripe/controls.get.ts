import { defineEventHandler } from 'h3'
import { platformUser, platformResult } from '../../../../utils/platform-api'
import { subscriptionControls } from '../../../../../lib/subscription-controls.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event, true)
  return subscriptionControls(user.id)
}))
