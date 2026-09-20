import { defineEventHandler,getRouterParam,setHeader } from 'h3'
import { platformUser,platformBody } from '../../../utils/platform-api'
import { emailResult } from '../../../utils/email-api'
import { AppError } from '../../../../lib/errors.mjs'
import { saveEmailSettings } from '../../../../lib/email-settings.mjs'
import { testAdminEmail,retryAdminEmail,setEmailSuppression } from '../../../../lib/email-admin.mjs'
export default defineEventHandler(event => emailResult(async () => {
  setHeader(event,'Cache-Control','private, no-store')
  const user=await platformUser(event,true),action=getRouterParam(event,'action'),body=await platformBody(event)
  if(action==='settings')return saveEmailSettings(user.id,body)
  if(action==='test')return testAdminEmail(user.id,body)
  if(action==='retry')return retryAdminEmail(user.id,body)
  if(action==='suppressions')return setEmailSuppression(user.id,body)
  throw new AppError(404,'Email endpoint not found.')
}))
