import { defineEventHandler } from 'h3'
import { platformResult, platformUser, platformBody } from '../../../utils/platform-api'
import { createFreeAccount } from '../../../../lib/free-accounts.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event, true)
  return createFreeAccount(await platformBody(event), 'admin', user.id)
}))
