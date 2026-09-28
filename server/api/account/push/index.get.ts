import { defineEventHandler } from 'h3'
import { platformUser } from '../../../utils/platform-api'
import { pushResult } from '../../../utils/push-api'
import { pushConfiguration } from '../../../../lib/push.mjs'
export default defineEventHandler(event => pushResult(async () => {
  await platformUser(event)
  return pushConfiguration()
}))
