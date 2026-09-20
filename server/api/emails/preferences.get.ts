import { defineEventHandler } from 'h3'
import { platformResult, platformUser } from '../../utils/platform-api'
import { emailPreferences } from '../../../lib/email-outbox.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event)
  return emailPreferences(user.id)
}))
