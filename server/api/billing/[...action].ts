import { defineEventHandler, getRouterParam } from 'h3'
import { platformUser, platformBody, platformResult } from '../../utils/platform-api'
import { AppError } from '../../../lib/errors.mjs'
import { rateLimit } from '../../../lib/auth.mjs'
import { billingAccount, startSubscription, syncSubscription, cancelSubscription, listOffers } from '../../../lib/square-subscriptions.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const route = getRouterParam(event, 'action') || ''
  if (route === 'offers' && event.method === 'GET') return listOffers()
  const user = await platformUser(event)
  if (route === 'account' && event.method === 'GET') return billingAccount(user.id)
  await rateLimit('billing:' + user.id, 20)
  if (route === 'subscribe' && event.method === 'POST') return startSubscription(user.id, await platformBody(event))
  const parts = route.split('/')
  if (parts.length === 2 && event.method === 'POST') {
    if (parts[1] === 'sync') return syncSubscription(parts[0], user.id)
    if (parts[1] === 'cancel') return cancelSubscription(user.id, parts[0], await platformBody(event))
  }
  throw new AppError(404, 'Billing endpoint not found.')
}))
