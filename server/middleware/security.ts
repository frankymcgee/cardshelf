import { defineEventHandler, setHeader, getHeader, createError } from 'h3'
import { publicPage } from '../../shared/platform.mjs'
import { configuration } from '../../lib/config.mjs'
import { isAllowedMutation } from '../../lib/security.mjs'
export default defineEventHandler(event => {
  const isPublicWebsite = publicPage(event.path.split('?')[0])
  setHeader(event, 'X-Robots-Tag', isPublicWebsite ? 'index, follow' : 'noindex, nofollow')
  if (!isPublicWebsite && !event.path.startsWith('/_nuxt/')) setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'X-Frame-Options', 'DENY')
  setHeader(event, 'Referrer-Policy', 'no-referrer')
  setHeader(event, 'Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  // Nuxt's bootstrap uses an inline script; API values are never interpolated
  // into that script. Do not add arbitrary external script origins here.
  if (process.env.NODE_ENV === 'production') setHeader(event, 'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https://assets.tcgdex.net data:; connect-src 'self'; font-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
  if (event.path.startsWith('/api/')) {
    setHeader(event, 'Cache-Control', 'no-store')
    if (!['GET', 'HEAD', 'OPTIONS'].includes(event.method)) {
      if (!isAllowedMutation({ origin: getHeader(event, 'origin'), expectedOrigin: configuration().origin,
        requestedWith: getHeader(event, 'x-requested-with'), fetchSite: getHeader(event, 'sec-fetch-site') })) {
        throw createError({ statusCode: 403, message: 'Request origin is not allowed. Check APP_ORIGIN on the server.' })
      }
      const length = Number(getHeader(event, 'content-length') || 0)
      if (length > 8_000_000) throw createError({ statusCode: 413, message: 'Request body is too large.' })
    }
  }
})
