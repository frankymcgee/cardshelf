import { defineEventHandler } from 'h3'
import { platformResult, platformUser, platformBody } from '../../../utils/platform-api'
import { saveAffiliateSettings } from '../../../../lib/affiliate-shops.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event, true)
  return saveAffiliateSettings(user.id, await platformBody(event, 65536))
}))
