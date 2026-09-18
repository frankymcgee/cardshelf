import { defineEventHandler } from 'h3'
import { platformResult, platformUser, platformBody } from '../../../utils/platform-api'
import { saveFreeSettings } from '../../../../lib/free-accounts.mjs'
export default defineEventHandler(event => platformResult(async () => saveFreeSettings((await platformUser(event, true)).id, await platformBody(event))))
