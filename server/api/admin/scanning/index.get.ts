import { defineEventHandler } from 'h3'
import { platformUser } from '../../../utils/platform-api'
import { cardScanResult } from '../../../utils/card-scan-api'
import { scanningAdminOverview } from '../../../../lib/card-scan-settings.mjs'
export default defineEventHandler(event => cardScanResult(async () => scanningAdminOverview((await platformUser(event, true)).id)))
