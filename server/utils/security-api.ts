import { createError, deleteCookie, getCookie, setCookie, type H3Event } from 'h3'
import { AppError } from '../../lib/errors.mjs'
import { configuration } from '../../lib/config.mjs'

export const SESSION_COOKIE = 'cardshelf_session'
export const PENDING_COOKIE = 'cardshelf_pending'
export function securityTokens(event: H3Event) {
  return { sessionToken: getCookie(event, SESSION_COOKIE), pendingToken: getCookie(event, PENDING_COOKIE) }
}
export function clearAuthCookies(event: H3Event) {
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
  deleteCookie(event, PENDING_COOKIE, { path: '/' })
}
export function authenticationResult(event: H3Event, result: any) {
  const { token, pending_token, ...publicResult } = result
  const options = { httpOnly: true, secure: configuration().secureCookies, sameSite: 'strict' as const, path: '/' }
  if (token) {
    setCookie(event, SESSION_COOKIE, token, { ...options, maxAge: configuration().sessionSeconds })
    deleteCookie(event, PENDING_COOKIE, { path: '/' })
  } else if (pending_token) {
    setCookie(event, PENDING_COOKIE, pending_token, { ...options, maxAge: 600 })
    deleteCookie(event, SESSION_COOKIE, { path: '/' })
  } else if (result.pending?.scope === 'email_verification') clearAuthCookies(event)
  return publicResult
}
export async function securityResult<T>(run: () => Promise<T>) {
  try { return await run() }
  catch (error: any) {
    if (error instanceof AppError) throw createError({ statusCode: error.status, message: error.message, data: error.details })
    if (error?.statusCode) throw error
    // SQL/provider errors can include credential material. Never log request bodies or raw errors.
    console.error('CardShelf account security: request failed; inspect service health without exposing credentials.')
    throw createError({ statusCode: 500, message: 'Account security is temporarily unavailable. Try again.' })
  }
}
