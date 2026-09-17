import { defineEventHandler, getRouterParam, getQuery } from 'h3'
import { platformUser, platformBody, platformResult } from '../../../utils/platform-api'
import { AppError, ensure } from '../../../../lib/errors.mjs'
import { db } from '../../../../lib/db.mjs'
import { rateLimit } from '../../../../lib/auth.mjs'
import { subscriptionAdmin, retryWebhook } from '../../../../lib/subscription-admin.mjs'
import { setTier, createSubscriptionAccount } from '../../../../lib/membership.mjs'
import { saveOffer, publishOffer, syncSubscription, cancelSubscription } from '../../../../lib/square-subscriptions.mjs'
import { approveReferralPartner, approveCommission, recordReferralPayout } from '../../../../lib/subscription-referrals.mjs'
import * as v from '../../../../lib/validate.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event, true), action = getRouterParam(event, 'action') || ''
  const p = action.split('/')
  if (action === 'overview' && event.method === 'GET') return subscriptionAdmin(getQuery(event))
  if (event.method !== 'POST') throw new AppError(404, 'Administration endpoint not found.')
  await rateLimit('billing-admin:' + user.id, 60)
  const body = await platformBody(event)
  if (action === 'accounts') return createSubscriptionAccount(user.id, body)
  if (action === 'offers') return saveOffer(user.id, body)
  if (p.length === 2 && p[0] === 'tiers') return setTier(user.id, p[1], body)
  if (p.length === 2 && p[0] === 'partners') return approveReferralPartner(user.id, p[1], body)
  if (p.length === 2 && p[0] === 'offers') return publishOffer(user.id, p[1], body)
  if (p.length === 2 && p[0] === 'events') return retryWebhook(user.id, p[1])
  if (p.length === 3 && p[0] === 'subscriptions') {
    if (p[2] === 'sync') return syncSubscription(p[1])
    if (p[2] === 'cancel') return cancelSubscription(user.id, p[1], body, true)
  }
  if (p.length === 3 && p[0] === 'commissions') {
    v.uuid(p[1])
    const [row] = await db()`SELECT i.subscription_id, i.square_id FROM referral_commissions c JOIN square_invoices i ON i.environment=c.environment AND i.square_id=c.invoice_id WHERE c.id=${p[1]}`
    ensure(row, 404, 'Commission not found.')
    // Re-fetch provider truth immediately before approval/payment recording.
    await syncSubscription(row.subscription_id, null, undefined, row.square_id)
    if (p[2] === 'approve') return approveCommission(user.id, p[1], body)
    if (p[2] === 'record-paid') return recordReferralPayout(user.id, p[1], body)
  }
  throw new AppError(404, 'Administration endpoint not found.')
}))
