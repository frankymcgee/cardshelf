import { defineEventHandler } from 'h3'
import { platformUser, platformResult } from '../../../../utils/platform-api'
import { db } from '../../../../../lib/db.mjs'
export default defineEventHandler(event => platformResult(async () => {
  await platformUser(event, true)
  return db()`SELECT * FROM membership_plans ORDER BY code`
}))
