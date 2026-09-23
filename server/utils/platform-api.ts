import { createError, getCookie, getHeader, type H3Event } from 'h3'
import { sessionUser } from '../../lib/auth.mjs'
import { AppError, ensure } from '../../lib/errors.mjs'
export async function platformUser(event: H3Event, admin = false) {
  const user = await sessionUser(getCookie(event, 'cardshelf_session'))
  if (!user) throw new AppError(401, 'Sign in to continue.')
  ensure(!admin || user.role === 'admin', 403, 'Administrator access is required.')
  return user
}
export async function platformBody(event: H3Event, maxBytes = 16384) {
  ensure(getHeader(event,'content-type')?.split(';')[0]?.trim() === 'application/json',415,'Send an application/json request.')
  let size = 0
  const chunks: Buffer[] = []
  for await (const value of event.node.req) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    size += chunk.length
    ensure(size <= maxBytes,413,'Request is too large.')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new AppError(400,'Request body is not valid JSON.') }
}
export async function platformResult<T>(run: () => Promise<T>) {
  try { return await run() }
  catch (error: any) {
    if (error instanceof AppError) throw createError({statusCode:error.status,message:error.message})
    if (error?.statusCode) throw error
    console.error('CardShelf platform:',error)
    throw createError({statusCode:500,message:'The server could not complete this request.'})
  }
}
