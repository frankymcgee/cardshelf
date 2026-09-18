import { defineEventHandler, setHeader } from 'h3'
import { platformResult, platformBody, platformUser } from '../../../utils/platform-api'
import { administratorPasswordRecovery } from '../../../../lib/password-recovery.mjs'
export default defineEventHandler(event => platformResult(async () => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const user = await platformUser(event, true)
  return administratorPasswordRecovery(user.id, await platformBody(event))
}))
