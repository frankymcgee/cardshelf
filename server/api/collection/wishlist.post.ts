import { defineEventHandler, setHeader } from 'h3'
import { platformBody, platformResult, platformUser } from '../../utils/platform-api'
import { rateLimit } from '../../../lib/auth.mjs'
import { saveWishlist } from '../../../lib/wishlist.mjs'
export default defineEventHandler(event => platformResult(async () => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const user = await platformUser(event)
  await rateLimit('wishlist:' + user.id, 120)
  return saveWishlist(user.id, await platformBody(event))
}))
