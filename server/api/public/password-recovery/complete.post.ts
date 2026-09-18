import { defineEventHandler, getRequestIP, setHeader, deleteCookie } from 'h3'
import { platformBody, platformResult } from '../../../utils/platform-api'
import { completePasswordRecovery } from '../../../../lib/password-recovery.mjs'
import { configuration } from '../../../../lib/config.mjs'
export default defineEventHandler(event => platformResult(async () => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const result = await completePasswordRecovery(await platformBody(event), getRequestIP(event, { xForwardedFor: configuration().trustProxy }) || 'unknown')
  deleteCookie(event, 'cardshelf_session', { path: '/' })
  return result
}))
