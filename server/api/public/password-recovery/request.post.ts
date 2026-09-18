import { defineEventHandler, getRequestIP, setHeader } from 'h3'
import { platformBody, platformResult } from '../../../utils/platform-api'
import { requestPasswordRecovery } from '../../../../lib/password-recovery.mjs'
import { configuration } from '../../../../lib/config.mjs'
export default defineEventHandler(event => platformResult(async () => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  return requestPasswordRecovery(await platformBody(event), getRequestIP(event, { xForwardedFor: configuration().trustProxy }) || 'unknown')
}))
