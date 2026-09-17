import { defineEventHandler, getRouterParam } from 'h3'
import { platformUser, platformBody, platformResult } from '../../../utils/platform-api'
import { deleteSale } from '../../../../lib/marketplace.mjs'
// Owners can remove eligible withdrawn listings without an active paid membership.
// The service retains revision, owner, moderation and conversation-history checks.
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event)
  return deleteSale(user, getRouterParam(event, 'id'), await platformBody(event))
}))
