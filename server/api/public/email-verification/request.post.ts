import { defineEventHandler, getRequestIP } from 'h3'
import { requestEmailVerification } from '../../../../lib/email-verification.mjs'
import { configuration } from '../../../../lib/config.mjs'
import { platformBody } from '../../../utils/platform-api'
import { securityResult } from '../../../utils/security-api'
export default defineEventHandler(event => securityResult(async () => requestEmailVerification(await platformBody(event),
  getRequestIP(event, { xForwardedFor: configuration().trustProxy }) || 'unknown')))
