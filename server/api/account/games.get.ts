import { defineEventHandler } from 'h3'
import { platformResult, platformUser, platformBody } from '../../utils/platform-api'
import { accountGames } from '../../../lib/game-access.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event)
  return accountGames(user.id)
}))
