import { defineEventHandler, getCookie } from 'h3'
import { sessionUser } from '../../lib/auth.mjs'
import { requireRecentStrongAuth } from '../../lib/account-security.mjs'
import { securityResult } from '../utils/security-api'

export default defineEventHandler(event => securityResult(async () => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(event.method)) return
  // Protect every administrative mutation, including administrator-only actions
  // outside /admin (catalogue, Arena, account settings and future route handlers).
  const path = decodeURIComponent(event.path.split('?', 1)[0] || '').replace(/\/+/g, '/').replace(/\/+$/, '')
  if (!path.startsWith('/api/') || /^\/api\/(?:login|logout|setup|security|public)(?:\/|$)/.test(path)) return
  const token = getCookie(event, 'cardshelf_session')
  const user = await sessionUser(token)
  if (user?.role === 'admin') await requireRecentStrongAuth(token)
}))
