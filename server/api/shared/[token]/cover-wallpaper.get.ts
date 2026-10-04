import { defineEventHandler, getRouterParam } from 'h3'
import { sharedWallpaper } from '../../../../lib/binder-appearance.mjs'
import { appearanceAction, wallpaperHeaders } from '../../../utils/appearance-api'
export default defineEventHandler(event => appearanceAction(async () =>
  wallpaperHeaders(event, await sharedWallpaper(getRouterParam(event, 'token'), 'cover'))
))
