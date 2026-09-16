import { defineEventHandler, getRequestIP } from 'h3'
import { configuration } from '../../../lib/config.mjs'
import { receiveRequest } from '../../../lib/platform.mjs'
import { platformBody, platformResult } from '../../utils/platform-api'
export default defineEventHandler(event => platformResult(async () => {
  const ip = getRequestIP(event,{xForwardedFor:configuration().trustProxy}) || 'unknown'
  return receiveRequest(await platformBody(event),ip)
}))
