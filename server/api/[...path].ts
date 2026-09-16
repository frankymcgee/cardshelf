import { defineEventHandler, getRouterParam, getQuery, getCookie, setCookie, deleteCookie, getHeader,
  setHeader, createError, getRequestIP, type H3Event } from 'h3'
import { configuration } from '../../lib/config.mjs'
import { AppError, ensure } from '../../lib/errors.mjs'
import * as v from '../../lib/validate.mjs'
import * as auth from '../../lib/auth.mjs'
import * as catalogue from '../../lib/catalogue.mjs'
import * as collection from '../../lib/collection.mjs'
import * as binders from '../../lib/binders.mjs'
import * as jobs from '../../lib/jobs.mjs'
import * as prices from '../../lib/prices.mjs'
import * as generation from '../../lib/binder-generation.mjs'
import { parseImport, exportCSV } from '../../lib/portability.mjs'
import { remoteSets } from '../../lib/provider.mjs'
import { db } from '../../lib/db.mjs'
const COOKIE = 'cardshelf_session'
async function readJSON(event: H3Event) {
  ensure(getHeader(event, 'content-type')?.split(';')[0]?.trim() === 'application/json', 415, 'Send an application/json request.')
  let size = 0
  const chunks: Buffer[] = []
  for await (const value of event.node.req) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    size += chunk.length
    ensure(size <= 8_000_000, 413, 'Request body is too large.')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new AppError(400, 'Request body is not valid JSON.') }
}
function cookie(event: H3Event, token: string) {
  setCookie(event, COOKIE, token, { httpOnly: true, secure: configuration().secureCookies,
    sameSite: 'strict', path: '/', maxAge: configuration().sessionSeconds })
}
export default defineEventHandler(async event => {
  try {
    const parts = (getRouterParam(event, 'path') || '').split('/').filter(Boolean).map(decodeURIComponent)
    const route = parts.join('/'), method = event.method, query = getQuery(event)
    const token = getCookie(event, COOKIE)
    if (route === 'session' && method === 'GET') return { user: await auth.sessionUser(token), setup_required: await auth.needsSetup() }
    if ((route === 'setup' || route === 'login') && method === 'POST') {
      const ip = getRequestIP(event, { xForwardedFor: configuration().trustProxy }) || 'unknown'
      const result = await auth[route](await readJSON(event), ip)
      cookie(event, result.token); return { user: result.user }
    }
    if (route === 'logout' && method === 'POST') {
      await auth.logout(token); deleteCookie(event, COOKIE, { path: '/' }); return { ok: true }
    }
    if (parts[0] === 'shared' && parts.length === 2 && method === 'GET') return await binders.getSharedBinder(parts[1])
    const user = await auth.sessionUser(token)
    if (!user) throw new AppError(401, 'Sign in to continue.')
    if (route === 'password' && method === 'POST') {
      await auth.rateLimit('password:' + user.id, 10)
      const next = await auth.changePassword(user.id, await readJSON(event)); cookie(event, next); return { ok: true }
    }
    if (route === 'prices/summary' && method === 'GET') return await prices.priceSummary(user.id, query.binder_id ? v.uuid(query.binder_id) : null)
    if (route === 'prices/refresh' && method === 'POST') {
      await auth.rateLimit('prices:' + user.id, 20)
      const input = v.object(await readJSON(event))
      ensure(input.card_id || user.role === 'admin', 403, 'Only an administrator can queue a collection-wide refresh.')
      return await prices.queuePriceRefresh(user.id, input.card_id ? v.cardId(input.card_id) : null)
    }
    if (parts[0] === 'cards' && parts[2] === 'prices' && parts.length === 3 && method === 'GET') return await prices.getCardPrices(user.id, parts[1])
    if (route === 'binders/generate/preview' && method === 'POST') {
      await auth.rateLimit('binder-preview:' + user.id, 60)
      return await generation.previewGeneration(user.id, await readJSON(event))
    }
    if (route === 'binders/generate' && method === 'POST') {
      await auth.rateLimit('binder-generate:' + user.id, 20)
      return await generation.createGeneratedBinders(user.id, await readJSON(event))
    }
    if (route === 'dashboard' && method === 'GET') return await catalogue.dashboard(user.id)
    if (route === 'catalogue' && method === 'GET') return await catalogue.catalogueCards(user.id, query)
    if (route === 'catalogue/facets' && method === 'GET') return await catalogue.catalogueFacets()
    if (parts[0] === 'cards' && parts.length === 2 && method === 'GET') return await catalogue.getCard(user.id, parts[1])
    if (parts[0] === 'cards' && parts[2] === 'printings' && parts.length === 3 && method === 'POST') {
      ensure(user.role === 'admin', 403, 'Only an administrator can edit the catalogue.')
      return await catalogue.addPrinting(user.id, parts[1], await readJSON(event))
    }
    if (route === 'collection' && method === 'PUT') return await collection.saveEntry(user.id, await readJSON(event))
    if (route === 'collection/export' && method === 'GET') {
      const format = v.oneOf(query.format || 'json', 'Export format', ['json','csv'])
      const entries = await collection.exportEntries(user.id)
      setHeader(event, 'Content-Disposition', `attachment; filename="cardshelf-collection.${format}"`)
      setHeader(event, 'Content-Type', format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8')
      return format === 'csv' ? exportCSV(entries) : JSON.stringify({ format: 'cardshelf-collection', version: 1,
        exported_at: new Date().toISOString(), entries }, null, 2)
    }
    if (route === 'collection/import' && method === 'POST') {
      const input = v.object(await readJSON(event))
      const mode = v.oneOf(input.mode || 'max', 'Merge mode', ['max','replace'])
      const apply = v.bool(input.apply ?? false, 'Apply')
      const parsed = parseImport(input.format, input.text)
      // Apply always returns the rejected-row report; it only changes matched rows.
      return await collection.importEntries(user.id, parsed, mode, apply)
    }
    if (route === 'binders' && method === 'GET') return await binders.listBinders(user.id)
    if (route === 'binders' && method === 'POST') return await binders.createBinder(user.id, await readJSON(event))
    if (parts[0] === 'binders' && parts.length === 2) {
      if (method === 'GET') return await binders.getBinder(user.id, parts[1])
      if (method === 'PATCH') return await binders.updateBinder(user.id, parts[1], await readJSON(event))
      if (method === 'DELETE') return await binders.deleteBinder(user.id, parts[1], await readJSON(event))
    }
    if (parts[0] === 'binders' && parts.length === 3 && method === 'POST') {
      if (parts[2] === 'slots') return await binders.editSlots(user.id, parts[1], await readJSON(event))
      if (parts[2] === 'share') return await binders.shareBinder(user.id, parts[1], await readJSON(event))
    }
    if (parts[0] === 'admin') {
      ensure(user.role === 'admin', 403, 'Administrator access is required.')
      if (route === 'admin/status' && method === 'GET') return { ...await jobs.serverStatus(), jobs: await jobs.listJobs() }
      if (route === 'admin/sets' && method === 'GET') return await remoteSets(v.language(query.language || 'en'))
      if (route === 'admin/imports' && method === 'POST') return await jobs.queueImport(user.id, await readJSON(event))
      if (route === 'admin/users' && method === 'GET') return await db()`SELECT id,email,name,role,created_at FROM app_users ORDER BY created_at`
      if (route === 'admin/users' && method === 'POST') return await auth.createUser(user.id, await readJSON(event))
    }
    throw new AppError(404, 'Endpoint not found.')
  } catch (error: any) {
    if (error instanceof AppError) throw createError({ statusCode: error.status, message: error.message, data: error.details })
    if (error?.statusCode) throw error
    console.error('CardShelf API:', error)
    throw createError({ statusCode: 500, message: 'The server could not complete this request. Check the application logs.' })
  }
})
