import { defineEventHandler } from 'h3'
import { platformResult, platformUser } from '../../../utils/platform-api'
import { freeSettings } from '../../../../lib/free-accounts.mjs'
export default defineEventHandler(event => platformResult(async () => { await platformUser(event, true); return freeSettings() }))
