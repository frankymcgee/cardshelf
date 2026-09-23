import { defineEventHandler, setCookie } from 'h3'
import { platformResult, platformBody, platformUser } from '../../../utils/platform-api'
import { configuration } from '../../../../lib/config.mjs'
import { ensure } from '../../../../lib/errors.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event, true)
  const body = await platformBody(event)
  ensure(['hidden', 'preview', 'live'].includes(body?.mode), 400, 'Choose hidden, preview or live ads.')
  setCookie(event, 'cardshelf_admin_ads', user.id + ':' + body.mode, {
    httpOnly: true, sameSite: 'lax', secure: configuration().secureCookies, path: '/', maxAge: 31536000
  })
  return { mode: body.mode }
}))
