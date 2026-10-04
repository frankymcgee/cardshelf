import { defineEventHandler, setHeader, getHeader, createError, getCookie } from 'h3'
import { randomBytes } from 'node:crypto'
import { sessionUser } from '../../lib/auth.mjs'
import { adsensePlacement } from '../../lib/adsense.mjs'
import { adsenseCsp } from '../../lib/adsense-logic.mjs'
import { adsensePageKind } from '../../shared/adsense-policy.mjs'
import { publicPage } from '../../shared/platform.mjs'
import { configuration } from '../../lib/config.mjs'
import { isAllowedMutation } from '../../lib/security.mjs'
import { CARD_ARTWORK_CSP_SOURCES } from '../../shared/card-images.mjs'
export default defineEventHandler(async event => {
  const [path = ''] = event.path.split('?', 1)
  const isPublicWebsite = publicPage(path)
  setHeader(event, 'X-Robots-Tag', isPublicWebsite ? 'index, follow' : 'noindex, nofollow')
  if (!isPublicWebsite && !event.path.startsWith('/_nuxt/')) setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'X-Frame-Options', 'DENY')
  setHeader(event, 'Referrer-Policy', 'no-referrer')
  setHeader(event, 'Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (process.env.NODE_ENV === 'production') setHeader(event, 'Content-Security-Policy',
    `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' ${CARD_ARTWORK_CSP_SOURCES} https://files.stripe.com https://stripe-camo.global.ssl.fastly.net data:; connect-src 'self'; font-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`)
  if (adsensePageKind(event.path) && event.method === 'GET') {
    // A document can differ by session and must never be shared by a CDN/cache.
    setHeader(event, 'Cache-Control', 'private, no-store')
    setHeader(event, 'Vary', 'Cookie')
    try {
      const placement = await adsensePlacement(await sessionUser(getCookie(event, 'cardshelf_session')), event.path, getCookie(event, 'cardshelf_admin_ads'))
      if (placement.eligible) {
        const nonce = randomBytes(16).toString('hex')
        event.context.cardshelfAdsense = { nonce, revision: placement.revision }
        setHeader(event, 'Content-Security-Policy', adsenseCsp(nonce))
      }
    } catch { /* Fail closed: preserve the restrictive default; no Google loader. */ }
  }
  if (event.path.startsWith('/api/')) {
    setHeader(event, 'Cache-Control', 'no-store')
    if (!['GET', 'HEAD', 'OPTIONS'].includes(event.method)) {
      // Every other mutation keeps the existing same-origin and application-header requirements.
      const postalWebhook = path === '/api/webhooks/postal' && event.method === 'POST'
      const webhook = (/^\/api\/billing\/stripe\/webhook\/(sandbox|production)$/.test(path || '') && event.method === 'POST') || postalWebhook
      if (!webhook && !isAllowedMutation({ origin: getHeader(event, 'origin'), expectedOrigin: configuration().origin,
        requestedWith: getHeader(event, 'x-requested-with'), fetchSite: getHeader(event, 'sec-fetch-site') })) {
        throw createError({ statusCode: 403, message: 'Request origin is not allowed. Check APP_ORIGIN on the server.' })
      }
      const length = Number(getHeader(event, 'content-length') || 0)
      const binderAppearance = /^\/api\/binders\/[a-f0-9-]{36}\/appearance$/.test(path) && event.method === 'PATCH'
      if (length > (postalWebhook ? 65536 : webhook ? 262144 : binderAppearance ? 14_000_000 : 8_000_000)) throw createError({ statusCode: 413, message: 'Request body is too large.' })
    }
  }
})
