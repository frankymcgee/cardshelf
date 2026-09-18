import { defineEventHandler, getQuery, getCookie, setHeader } from 'h3'
import { platformResult } from '../../utils/platform-api'
import { sessionUser } from '../../../lib/auth.mjs'
import { adsensePlacement } from '../../../lib/adsense.mjs'
export default defineEventHandler(event => platformResult(async () => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Vary', 'Cookie')
  return adsensePlacement(await sessionUser(getCookie(event, 'cardshelf_session')), getQuery(event).path)
}))
