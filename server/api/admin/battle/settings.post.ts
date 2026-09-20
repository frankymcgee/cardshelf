import { battleResult } from '../../../utils/battle-api'
import { defineEventHandler, setHeader } from 'h3'
import { platformUser, platformBody } from '../../../utils/platform-api'
import { updateBattleAdministration } from '../../../../lib/battle/access.mjs'
import { rateLimit } from '../../../../lib/auth.mjs'
export default defineEventHandler(event => battleResult(async () => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const user = await platformUser(event, true)
  await rateLimit('battle:admin:' + user.id, 30)
  return updateBattleAdministration(user.id, await platformBody(event))
}))
