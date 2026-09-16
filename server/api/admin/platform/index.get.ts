import { defineEventHandler, getQuery } from 'h3'
import { adminPlatform } from '../../../../lib/platform.mjs'
import { platformUser, platformResult } from '../../../utils/platform-api'
export default defineEventHandler(event => platformResult(async () => {
  await platformUser(event,true)
  return adminPlatform(getQuery(event))
}))
