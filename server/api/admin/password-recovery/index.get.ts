import { defineEventHandler, getQuery, setHeader, createError } from 'h3'
import { platformResult, platformUser } from '../../../utils/platform-api'
import { passwordRecoveryAdminStatus } from '../../../../lib/password-recovery.mjs'
export default defineEventHandler(event => platformResult(async () => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  await platformUser(event, true)
  const query = getQuery(event).q ?? ''
  if (typeof query !== 'string') throw createError({ statusCode: 400, message: 'Search must be text.' })
  return passwordRecoveryAdminStatus(query)
}))
