import { defineEventHandler } from 'h3'
import { platformResult, platformUser, platformBody } from '../../utils/platform-api'
import { saveEmailPreferences } from '../../../lib/email-outbox.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event)
  return saveEmailPreferences(user.id, await platformBody(event))
}))
