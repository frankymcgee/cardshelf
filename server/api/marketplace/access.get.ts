import { defineEventHandler } from 'h3'
import { platformUser, platformResult } from '../../utils/platform-api'
import { marketplaceAccess } from '../../../lib/marketplace.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event), original = await marketplaceAccess(user.id)
  const features = event.context.subscriptionFeatures
  return features ? { ...original, can_sell: features.includes('marketplace_sell'), can_browse: features.includes('marketplace_browse'), enforcement_enabled: true } : original
}))
