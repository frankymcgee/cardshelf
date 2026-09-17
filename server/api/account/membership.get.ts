import { defineEventHandler } from 'h3'
import { platformUser, platformResult } from '../../utils/platform-api'
import { accountMembership } from '../../../lib/platform.mjs'
import { membershipState } from '../../../lib/membership.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event)
  const [legacy, state] = await Promise.all([accountMembership(user.id), membershipState(user.id)])
  return { ...legacy, ...state, message: state.grant ? 'Your non-expiring testing access is protected. No payment is required.'
    : state.access.reason === 'complimentary' ? 'Complimentary access includes all current features. No subscription payment is required.'
    : 'Your current membership access is shown below. Square billing and administrator assignments are managed separately.' }
}))
