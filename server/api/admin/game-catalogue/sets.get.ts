import { defineEventHandler, getQuery } from 'h3'
import { platformResult, platformUser } from '../../../utils/platform-api'
import { availableGameSets } from '../../../../lib/game-catalogue.mjs'
import { rateLimit } from '../../../../lib/auth.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event, true)
  await rateLimit('game-set-list:' + user.id, 30)
  return availableGameSets(getQuery(event).game)
}))
