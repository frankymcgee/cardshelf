import { defineEventHandler, getRouterParam, getQuery, getHeader, setHeader, type H3Event } from 'h3'
import { platformUser, platformResult } from '../../utils/platform-api'
import { rateLimit } from '../../../lib/auth.mjs'
import { AppError, ensure } from '../../../lib/errors.mjs'
import * as market from '../../../lib/marketplace.mjs'
async function body(event: H3Event, limit = 16384) {
  ensure(getHeader(event, 'content-type')?.split(';')[0]?.trim() === 'application/json', 415, 'Send an application/json request.')
  let size = 0; const chunks: Buffer[] = []
  for await (const value of event.node.req) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    size += chunk.length; ensure(size <= limit, 413, 'Request body is too large.'); chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new AppError(400, 'Request body is not valid JSON.') }
}
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event), parts = (getRouterParam(event, 'path') || '').split('/').filter(Boolean)
  const route = parts.join('/'), method = event.method, query = getQuery(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  if (method === 'GET') {
    if (route === 'access') return market.marketplaceAccess(user.id)
    if (route === 'listings') return market.listSales(user, query)
    if (route === 'printings') return market.findSalePrintings(user.id, query)
    if (route === 'conversations') return market.inbox(user, query)
    if (route === 'reports') return market.moderationQueue(user, query)
    if (parts[0] === 'listings' && parts.length === 2) return market.getSale(user, parts[1])
    if (parts[0] === 'listings' && parts[2] === 'photos' && parts.length === 4) {
      const bytes = await market.salePhoto(user, parts[1], parts[3]); setHeader(event, 'Content-Type', 'image/webp'); return bytes
    }
    if (parts[0] === 'conversations' && parts.length === 2) return market.conversation(user, parts[1], query)
  }
  // Existing global middleware enforces exact same-origin checks on every write.
  if (route === 'listings' && method === 'POST') {
    await rateLimit('marketplace-create:' + user.id, 20)
    const access = await market.marketplaceAccess(user.id); ensure(access.can_sell, 403, 'Selling requires Collector Plus.')
    return market.createSale(user, await body(event, 5_600_000))
  }
  if (parts[0] === 'listings' && parts.length >= 2) {
    const id = parts[1]
    if (parts.length === 2 && method === 'PATCH') { await rateLimit('marketplace-edit:' + user.id, 60); return market.editSale(user, id, await body(event)) }
    if (parts.length === 2 && method === 'DELETE') return market.deleteSale(user, id, await body(event))
    if (parts.length === 3 && method === 'POST') {
      if (parts[2] === 'enquiries') { await rateLimit('marketplace-enquire:' + user.id, 20); return market.enquire(user, id, await body(event)) }
      if (parts[2] === 'report') { await rateLimit('marketplace-report:' + user.id, 10); return market.reportSale(user, id, await body(event)) }
      if (parts[2] === 'moderate') return market.moderateSale(user, id, await body(event))
    }
  }
  if (parts[0] === 'conversations' && parts.length === 3 && method === 'POST') {
    if (parts[2] === 'messages') { await rateLimit('marketplace-message:' + user.id, 60); return market.sendMessage(user, parts[1], await body(event)) }
    if (parts[2] === 'close') return market.closeConversation(user, parts[1], await body(event))
  }
  throw new AppError(404, 'Marketplace endpoint not found.')
}))
