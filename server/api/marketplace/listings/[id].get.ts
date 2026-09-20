import { defineEventHandler, getRouterParam } from 'h3'
import { platformUser, platformResult } from '../../../utils/platform-api'
import { getSale, marketplaceAccess } from '../../../../lib/marketplace.mjs'
// Keep listing reads beside PATCH so they cannot fall through to the page renderer.
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event)
  const [listing, access] = await Promise.all([getSale(user, getRouterParam(event, 'id')), marketplaceAccess(user.id)])
  // Free can view listings, but creating a seller enquiry remains a paid feature.
  return { ...listing, can_enquire: listing.can_enquire && access.can_browse }
}))
