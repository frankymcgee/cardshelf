import { defineEventHandler, getCookie, getQuery } from 'h3'
import { billingPolicy } from '../../lib/billing-policy.mjs'
import { membershipState } from '../../lib/membership.mjs'
import { sessionUser } from '../../lib/auth.mjs'
import { ensure } from '../../lib/errors.mjs'
import { db } from '../../lib/db.mjs'
import { platformResult } from '../utils/platform-api'
export default defineEventHandler(event => platformResult(async () => {
  let path: string
  // An indexed split result is optional under noUncheckedIndexedAccess.
  const [pathname = ''] = event.path.split('?', 1)
  try { path = decodeURIComponent(pathname).replace(/\/+/g, '/').replace(/\/+$/, '') }
  catch { ensure(false, 400, 'Invalid request path.'); return }
  ensure(!/[%\\\x00-\x1f]/.test(path), 400, 'Invalid request path.')
  if (!path.startsWith('/api/')) return
  if (/^\/api\/(?:public|ads|billing|referrals|admin|account|shared)(?:\/|$)/.test(path)) return
  const user = await sessionUser(getCookie(event, 'cardshelf_session'))
  if (!user || user.role === 'admin') return // Original handlers enforce authentication/admin ownership.
  const policy = await billingPolicy()
  if (!policy.enforce && !(await db()`SELECT user_id FROM free_accounts WHERE user_id=${user.id}`).length) return
  const { access } = await membershipState(user.id)
  if (!policy.enforce && access.tier !== 'free') return
  event.context.subscriptionFeatures = access.features.map((f: any) => f.code)
  const needs = (code: string) => ensure(event.context.subscriptionFeatures.includes(code), 403,
    'This action needs an active membership with this feature. Open Membership to review your access.')
  const method = event.method
  if (/^\/api\/prices(?:\/|$)/.test(path) || /^\/api\/cards\/[^/]+\/prices$/.test(path)) needs('prices')
  if (path === '/api/collection' && method === 'PUT') needs('collection')
  if (path === '/api/collection/import' && method === 'POST') needs('exports')
  if (path.startsWith('/api/marketplace/')) {
    // Existing conversations, withdrawal and seller status management remain accessible.
    if (path === '/api/marketplace/listings' && method === 'POST') needs('marketplace_sell')
    if (path === '/api/marketplace/listings' && method === 'GET' && getQuery(event).mine !== '1') needs('marketplace_browse')
  }
  if (/^\/api\/marketplace\/listings\/[^/]+\/enquiries$/.test(path) && method === 'POST') needs('marketplace_browse')
  const match = path.match(/^\/api\/binders\/([a-f0-9-]{36})(?:\/(slots|tracking|appearance|share))?$/i)
  if (match && match[2] !== 'share' && ['POST', 'PATCH'].includes(method)) {
    const [binder] = await db()`SELECT binder_type FROM binders WHERE id=${match[1]} AND user_id=${user.id}`
    if (binder) needs(binder.binder_type === 'tracking' ? 'tracking_binders' : 'binders')
  }
  // Reading/exporting/deleting a user's existing records is intentionally not paywalled.
}))
