import { defineEventHandler, getRequestIP } from 'h3'
import { completeEmailVerification } from '../../../../lib/email-verification.mjs'
import { configuration } from '../../../../lib/config.mjs'
import { platformBody } from '../../../utils/platform-api'
import { securityResult } from '../../../utils/security-api'
export default defineEventHandler(event => securityResult(async () => completeEmailVerification(await platformBody(event),
  getRequestIP(event, { xForwardedFor: configuration().trustProxy }) || 'unknown')))
