import { defineEventHandler, getCookie } from 'h3'
import { platformResult, platformUser } from '../../../utils/platform-api'
import { adsenseSettings, adminAdView } from '../../../../lib/adsense.mjs'
export default defineEventHandler(event => platformResult(async () => { const user = await platformUser(event, true); return { ...await adsenseSettings(), admin_view: adminAdView(user, getCookie(event, 'cardshelf_admin_ads')) } }))
