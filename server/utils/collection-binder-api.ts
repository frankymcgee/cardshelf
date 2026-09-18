import { defineEventHandler, getCookie, getHeader, getRouterParam, createError } from 'h3'
import { sessionUser, rateLimit } from '../../lib/auth.mjs'
import { AppError, ensure } from '../../lib/errors.mjs'
import { configuration } from '../../lib/config.mjs'
import { isAllowedMutation } from '../../lib/security.mjs'

type Operation = (userId: string, binderId: string, input: unknown) => Promise<unknown>
export function collectionBinderHandler(operation: Operation, write = false) {
  return defineEventHandler(async event => {
    try {
      const user = await sessionUser(getCookie(event, 'cardshelf_session'))
      if (!user) throw new AppError(401, 'Sign in to continue.')
      await rateLimit('collection-binder:' + user.id, 1200)
      let input: unknown
      if (write) {
        ensure(isAllowedMutation({ origin: getHeader(event, 'origin'), expectedOrigin: configuration().origin,
          requestedWith: getHeader(event, 'x-requested-with'), fetchSite: getHeader(event, 'sec-fetch-site') }), 403, 'This request origin is not allowed.')
        ensure(getHeader(event, 'content-type')?.split(';')[0]?.trim() === 'application/json', 415, 'Send an application/json request.')
        const chunks: Buffer[] = []; let size = 0
        for await (const value of event.node.req) {
          const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
          size += chunk.length; ensure(size <= 4096, 413, 'Collection-sync request is too large.'); chunks.push(chunk)
        }
        try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
        catch { throw new AppError(400, 'Request body is not valid JSON.') }
      }
      return await operation(user.id, getRouterParam(event, 'id') || '', input)
    } catch (error: any) {
      if (error instanceof AppError) throw createError({ statusCode: error.status, message: error.message })
      if (error?.statusCode) throw error
      console.error('CardShelf collection sync:', error?.code || error?.name || 'Unknown failure')
      throw createError({ statusCode: 500, message: 'Unable to confirm this collection change. Retry the same request or reload the binder.' })
    }
  })
}
