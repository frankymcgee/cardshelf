import { defineEventHandler, getRouterParam } from 'h3'
import { saveDraftPlan } from '../../../../../lib/platform.mjs'
import { rateLimit } from '../../../../../lib/auth.mjs'
import { platformUser, platformBody, platformResult } from '../../../../utils/platform-api'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event,true)
  await rateLimit('platform-plan:'+user.id,60)
  return saveDraftPlan(user.id,getRouterParam(event,'code'),await platformBody(event))
}))
