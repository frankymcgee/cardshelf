import { defineEventHandler } from 'h3'
import { platformUser, platformResult } from '../../utils/platform-api'
import { listBinders } from '../../../lib/binders.mjs'
// Pair the concrete POST route with GET; do not rely on catch-all method fallback.
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event)
  return listBinders(user.id)
}))
