import { defineEventHandler } from 'h3'
import { platformResult, platformBody, platformUser } from '../../../utils/platform-api'
import { saveAdsenseSettings } from '../../../../lib/adsense.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event, true)
  return saveAdsenseSettings(user.id, await platformBody(event))
}))
