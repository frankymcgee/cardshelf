import { defineEventHandler,setHeader } from 'h3'
import { platformUser } from '../../../utils/platform-api'
import { emailResult } from '../../../utils/email-api'
import { emailAdminOverview } from '../../../../lib/email-admin.mjs'
export default defineEventHandler(event => emailResult(async () => {
  setHeader(event,'Cache-Control','private, no-store')
  const user=await platformUser(event,true)
  return emailAdminOverview(user.id)
}))
