import { defineEventHandler } from 'h3'
import { platformUser, platformResult } from '../../utils/platform-api'
import { membershipState } from '../../../lib/membership.mjs'
import { freeMarketplaceReader } from '../../../shared/adsense-policy.mjs'
import { marketplaceAccess } from '../../../lib/marketplace.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event), original = await marketplaceAccess(user.id)
  const features = event.context.subscriptionFeatures
  const { access } = await membershipState(user.id)
  const result = features ? { ...original, can_sell: features.includes('marketplace_sell'), can_browse: features.includes('marketplace_browse'), enforcement_enabled: true } : original
  return { ...result, can_enquire: result.can_browse, can_browse: result.can_browse || freeMarketplaceReader(access) }
}))
