import { defineEventHandler, getRouterParam } from 'h3'
import { updateRequest } from '../../../../../lib/platform.mjs'
import { platformUser, platformBody, platformResult } from '../../../../utils/platform-api'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event,true)
  return updateRequest(user.id,getRouterParam(event,'id'),await platformBody(event))
}))
