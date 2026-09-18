import { getRequestIP, setHeader, type H3Event } from 'h3'
import { configuration } from '../../lib/config.mjs'
import { rateLimit } from '../../lib/auth.mjs'
export async function publicCatalogueRequest(event: H3Event) {
  await rateLimit('public-catalogue:' + (getRequestIP(event, { xForwardedFor: configuration().trustProxy }) || 'unknown'), 900)
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'Vary', 'Cookie')
}
