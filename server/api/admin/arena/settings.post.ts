import { battleResult } from '../../../utils/battle-api'
import { defineEventHandler, setHeader } from 'h3'
import { platformUser, platformBody } from '../../../utils/platform-api'
import { rateLimit } from '../../../../lib/auth.mjs'
import { saveArenaSettings } from '../../../../lib/arena/access.mjs'
export default defineEventHandler(event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Vary', 'Cookie')
  return battleResult(async () => {
  const user = await platformUser(event, true)
  await rateLimit('arena-admin:' + user.id, 10)
  return saveArenaSettings(user.id, await platformBody(event))
  })
})
