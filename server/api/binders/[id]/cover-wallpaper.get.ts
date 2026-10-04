import { defineEventHandler, getRouterParam } from 'h3'
import { ownerWallpaper } from '../../../../lib/binder-appearance.mjs'
import { appearanceAction, appearanceUser, wallpaperHeaders } from '../../../utils/appearance-api'
export default defineEventHandler(event => appearanceAction(async () => {
  const user = await appearanceUser(event)
  return wallpaperHeaders(event, await ownerWallpaper(user.id, getRouterParam(event, 'id'), 'cover'))
}))
