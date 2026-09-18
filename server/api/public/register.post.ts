import { defineEventHandler, getRequestIP } from 'h3'
import { platformResult, platformBody } from '../../utils/platform-api'
import { configuration } from '../../../lib/config.mjs'
import { createFreeAccount } from '../../../lib/free-accounts.mjs'
export default defineEventHandler(event => platformResult(async () => createFreeAccount(await platformBody(event),
  getRequestIP(event, { xForwardedFor: configuration().trustProxy }) || 'unknown')))
