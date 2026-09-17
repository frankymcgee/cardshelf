import { defineEventHandler, getRouterParam, getQuery } from 'h3'
import { platformUser, platformBody, platformResult } from '../../../utils/platform-api'
import { AppError } from '../../../../lib/errors.mjs'
import { rateLimit } from '../../../../lib/auth.mjs'
import { subscriptionAdmin, retryWebhook } from '../../../../lib/subscription-admin.mjs'
import { setTier, createSubscriptionAccount } from '../../../../lib/membership.mjs'
import { syncStripeSubscription, cancelStripeSubscription } from '../../../../lib/stripe-subscriptions.mjs'
import { approveReferralPartner, approveCommission, recordReferralPayout, commissionSource } from '../../../../lib/subscription-referrals.mjs'
import * as v from '../../../../lib/validate.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event, true), action = getRouterParam(event, 'action') || ''
  const p = action.split('/')
  if (action === 'overview' && event.method === 'GET') return subscriptionAdmin(getQuery(event))
  if (event.method !== 'POST') throw new AppError(404, 'Administration endpoint not found.')
  await rateLimit('billing-admin:' + user.id, 60)
  const body = await platformBody(event)
  if (action === 'accounts') return createSubscriptionAccount(user.id, body)
  if (p.length === 2 && p[0] === 'tiers') return setTier(user.id, p[1], body)
  if (p.length === 2 && p[0] === 'partners') return approveReferralPartner(user.id, p[1], body)
  if (p.length === 2 && p[0] === 'events') return retryWebhook(user.id, p[1])
  if (p.length === 3 && p[0] === 'subscriptions') {
    if (p[2] === 'sync') return syncStripeSubscription(p[1])
    if (p[2] === 'cancel') return cancelStripeSubscription(user.id, p[1], body, true)
  }
  if (p.length === 3 && p[0] === 'commissions' && ['approve','record-paid'].includes(p[2] || '')) {
    v.uuid(p[1])
    const row = await commissionSource(p[1])
    await syncStripeSubscription(row.subscription_id,null,undefined,row.invoice_id)
    if (p[2] === 'approve') return approveCommission(user.id, p[1], body)
    return recordReferralPayout(user.id, p[1], body)
  }
  throw new AppError(404, 'Administration endpoint not found.')
}))
