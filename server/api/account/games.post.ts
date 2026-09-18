import { defineEventHandler } from 'h3'
import { platformResult, platformUser, platformBody } from '../../utils/platform-api'
import { chooseGame } from '../../../lib/game-access.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event)
  return chooseGame(user.id, await platformBody(event))
}))
