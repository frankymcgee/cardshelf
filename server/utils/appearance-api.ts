import { getCookie, getHeader, createError, setHeader, type H3Event } from 'h3'
import { sessionUser } from '../../lib/auth.mjs'
import { AppError, ensure } from '../../lib/errors.mjs'
export async function appearanceUser(event: H3Event) {
  const user = await sessionUser(getCookie(event, 'cardshelf_session'))
  if (!user) throw new AppError(401, 'Sign in to continue.')
  return user
}
export async function appearanceJSON(event: H3Event) {
  ensure(getHeader(event, 'content-type')?.split(';')[0]?.trim() === 'application/json', 415, 'Send an application/json request.')
  let size = 0
  const chunks: Buffer[] = []
  for await (const value of event.node.req) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    size += chunk.length
    // Two independently bounded 5 MB images, base64-encoded, plus settings.
    ensure(size <= 14_000_000, 413, 'Wallpaper request is too large.')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new AppError(400, 'Request body is not valid JSON.') }
}
export async function appearanceAction(action: () => Promise<any>) {
  try { return await action() }
  catch (error: any) {
    if (error instanceof AppError) throw createError({ statusCode: error.status, message: error.message })
    if (error?.statusCode) throw error
    console.error('CardShelf appearance:', error)
    throw createError({ statusCode: 500, message: 'Unable to update binder appearance. Check the application logs.' })
  }
}
export function wallpaperHeaders(event: H3Event, data: Buffer) {
  setHeader(event, 'Content-Type', 'image/webp')
  setHeader(event, 'Content-Length', data.length)
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Cross-Origin-Resource-Policy', 'same-origin')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return data
}
