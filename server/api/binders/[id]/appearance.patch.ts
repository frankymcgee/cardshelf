import { defineEventHandler, getRouterParam } from 'h3'
import { rateLimit } from '../../../../lib/auth.mjs'
import { saveAppearance } from '../../../../lib/binder-appearance.mjs'
import { appearanceAction, appearanceUser, appearanceJSON } from '../../../utils/appearance-api'
export default defineEventHandler(event => appearanceAction(async () => {
  const user = await appearanceUser(event)
  await rateLimit('binder-appearance:' + user.id, 20)
  return await saveAppearance(user.id, getRouterParam(event, 'id'), await appearanceJSON(event))
}))
