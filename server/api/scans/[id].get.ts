import { defineEventHandler, getRouterParam } from 'h3'
import { platformUser } from '../../utils/platform-api'
import { cardScanResult } from '../../utils/card-scan-api'
import { getCardScan } from '../../../lib/card-scans.mjs'
export default defineEventHandler(event => cardScanResult(async () => getCardScan((await platformUser(event)).id, getRouterParam(event, 'id'))))
