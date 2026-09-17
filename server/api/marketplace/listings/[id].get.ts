import { defineEventHandler, getRouterParam } from 'h3'
import { platformUser, platformResult } from '../../../utils/platform-api'
import { getSale } from '../../../../lib/marketplace.mjs'
// Keep listing reads beside PATCH so they cannot fall through to the page renderer.
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event)
  return getSale(user, getRouterParam(event, 'id'))
}))
