import { defineEventHandler } from 'h3'
import { platformUser } from '../../utils/platform-api'
import { cardScanResult } from '../../utils/card-scan-api'
import { scanAvailability } from '../../../lib/card-scans.mjs'
export default defineEventHandler(event => cardScanResult(async () => scanAvailability((await platformUser(event)).id)))
