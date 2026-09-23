import { defineEventHandler } from 'h3'
import { platformBody, platformUser } from '../../../utils/platform-api'
import { cardScanResult } from '../../../utils/card-scan-api'
import { saveScanningSettings } from '../../../../lib/card-scan-settings.mjs'
export default defineEventHandler(event => cardScanResult(async () => {
  const user = await platformUser(event, true)
  return saveScanningSettings(user.id, await platformBody(event, 65536))
}))
