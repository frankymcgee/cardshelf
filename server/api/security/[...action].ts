import { defineEventHandler, getRouterParam, getRequestIP } from 'h3'
import * as security from '../../../lib/account-security.mjs'
import { configuration } from '../../../lib/config.mjs'
import { ensure } from '../../../lib/errors.mjs'
import { platformBody } from '../../utils/platform-api'
import { authenticationResult, securityTokens, securityResult } from '../../utils/security-api'

export default defineEventHandler(event => securityResult(async () => {
  const action = getRouterParam(event, 'action') || ''
  const tokens = securityTokens(event)
  if (action === 'status' && event.method === 'GET') return security.securityStatus(tokens)
  ensure(event.method === 'POST', 404, 'Endpoint not found.')
  const input = await platformBody(event, 65536)
  const ip = getRequestIP(event, { xForwardedFor: configuration().trustProxy }) || 'unknown'
  let result
  switch (action) {
    case 'totp/begin': result = await security.beginTotpEnrollment(tokens, input, ip); break
    case 'totp/verify': result = await security.verifyTotpEnrollment(tokens, input, ip); break
    case 'totp/login': result = await security.verifyTotpLogin(tokens.pendingToken, input, ip); break
    case 'passkeys/begin': result = await security.beginPasskeyRegistration(tokens, input, ip); break
    case 'passkeys/verify': result = await security.verifyPasskeyRegistration(tokens, input, ip); break
    case 'passkeys/authenticate/begin': result = await security.beginPasskeyAuthentication(tokens, input, ip); break
    case 'passkeys/authenticate/verify': result = await security.verifyPasskeyAuthentication(tokens, input, ip); break
    case 'recovery/redeem': result = await security.redeemRecoveryCode(tokens.pendingToken, input, ip); break
    case 'reauthenticate': result = await security.reauthenticate(tokens, input, ip); break
    case 'recovery/regenerate': result = await security.regenerateRecoveryCodes(tokens, input, ip); break
    case 'factors/remove': result = await security.removeFactor(tokens, input, ip); break
    default: ensure(false, 404, 'Endpoint not found.')
  }
  return authenticationResult(event, result)
}))
