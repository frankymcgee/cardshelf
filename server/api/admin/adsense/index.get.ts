import { defineEventHandler } from 'h3'
import { platformResult, platformUser } from '../../../utils/platform-api'
import { adsenseSettings } from '../../../../lib/adsense.mjs'
export default defineEventHandler(event => platformResult(async () => { await platformUser(event, true); return adsenseSettings() }))
