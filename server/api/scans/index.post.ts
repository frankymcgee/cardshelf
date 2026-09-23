import { defineEventHandler } from 'h3'
import { platformBody, platformUser } from '../../utils/platform-api'
import { cardScanResult } from '../../utils/card-scan-api'
import { analyseCardScan } from '../../../lib/card-scans.mjs'
import { requireCapability } from '../../../lib/membership.mjs'
import { rateLimit } from '../../../lib/auth.mjs'
export default defineEventHandler(event => cardScanResult(async () => {
  const user = await platformUser(event)
  await requireCapability(user.id, 'collection')
  await rateLimit('card-scan-upload:' + user.id, 60)
  return analyseCardScan(user.id, await platformBody(event, 5_400_000))
}))
