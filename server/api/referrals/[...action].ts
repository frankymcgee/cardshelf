import { defineEventHandler, getRouterParam } from 'h3'
import { platformUser, platformBody, platformResult } from '../../utils/platform-api'
import { AppError } from '../../../lib/errors.mjs'
import { rateLimit } from '../../../lib/auth.mjs'
import { referralAccount, referralConsent, claimReferral } from '../../../lib/subscription-referrals.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event), action = getRouterParam(event, 'action') || ''
  if (action === 'account' && event.method === 'GET') return referralAccount(user.id)
  await rateLimit('referral:' + user.id, 30)
  if (action === 'consent' && event.method === 'POST') return referralConsent(user.id, await platformBody(event))
  if (action === 'claim' && event.method === 'POST') return claimReferral(user.id, await platformBody(event))
  throw new AppError(404, 'Referral endpoint not found.')
}))
