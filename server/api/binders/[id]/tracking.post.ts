import { defineEventHandler, getRouterParam, getHeader, getCookie, createError } from 'h3'
import { sessionUser, rateLimit } from '../../../../lib/auth.mjs'
import { AppError, ensure } from '../../../../lib/errors.mjs'
import { markCollected } from '../../../../lib/tracking-binders.mjs'
export default defineEventHandler(async event => {
  try {
    const user = await sessionUser(getCookie(event, 'cardshelf_session'))
    if (!user) throw new AppError(401, 'Sign in to continue.')
    await rateLimit('tracking:' + user.id, 1200)
    ensure(getHeader(event, 'content-type')?.split(';')[0]?.trim() === 'application/json', 415, 'Send an application/json request.')
    let size = 0
    const chunks: Buffer[] = []
    for await (const value of event.node.req) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      size += chunk.length
      ensure(size <= 2048, 413, 'Tracking request is too large.')
      chunks.push(chunk)
    }
    let input: any
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    catch { throw new AppError(400, 'Request body is not valid JSON.') }
    return await markCollected(user.id, getRouterParam(event, 'id'), input)
  } catch (error: any) {
    if (error instanceof AppError) throw createError({ statusCode: error.status, message: error.message })
    if (error?.statusCode) throw error
    console.error('CardShelf tracking:', error)
    throw createError({ statusCode: 500, message: 'Unable to save this tracking mark. Try again or reload the binder.' })
  }
})
