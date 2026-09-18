import { defineEventHandler, getCookie, getQuery, setHeader } from 'h3'
import { platformResult } from '../../utils/platform-api'
import { sessionUser } from '../../../lib/auth.mjs'
import { advertisement } from '../../../lib/free-accounts.mjs'
export default defineEventHandler(event => platformResult(async () => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Vary', 'Cookie')
  return advertisement(await sessionUser(getCookie(event, 'cardshelf_session')), getQuery(event).placement)
}))
