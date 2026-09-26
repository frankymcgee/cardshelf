import { defineEventHandler } from 'h3'
import { platformResult, platformUser } from '../../../utils/platform-api'
import { affiliateSettings } from '../../../../lib/affiliate-shops.mjs'
export default defineEventHandler(event => platformResult(async () => {
  await platformUser(event, true)
  return affiliateSettings()
}))
