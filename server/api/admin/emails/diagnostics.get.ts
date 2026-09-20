import { defineEventHandler,setHeader,createError } from 'h3'
import { platformUser } from '../../../utils/platform-api'
import { rateLimit } from '../../../../lib/auth.mjs'
import { emailConfiguration,requireEmailAdmin } from '../../../../lib/email-settings.mjs'
import { emailDnsDiagnostics } from '../../../../lib/email-diagnostics.mjs'
import { AppError } from '../../../../lib/errors.mjs'
export default defineEventHandler(async event=>{
  setHeader(event,'Cache-Control','private, no-store')
  try{
    const actor=await platformUser(event,true)
    await requireEmailAdmin(actor.id)
    await rateLimit('email-diagnostics:'+actor.id,6)
    return await emailDnsDiagnostics(await emailConfiguration())
  }catch(error:any){
    if(error instanceof AppError)throw createError({statusCode:error.status,message:error.message})
    if(error?.statusCode)throw error
    throw createError({statusCode:503,message:'Email diagnostics are temporarily unavailable.'})
  }
})
