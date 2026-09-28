import { defineEventHandler, getRouterParam, getCookie } from 'h3'
import { platformUser, platformBody } from '../../../utils/platform-api'
import { pushResult } from '../../../utils/push-api'
import { rateLimit } from '../../../../lib/auth.mjs'
import { ensure } from '../../../../lib/errors.mjs'
import { pushConfiguration, pushStatus, savePushSubscription, updatePushPreferences, removePushSubscription, queuePushTest } from '../../../../lib/push.mjs'
export default defineEventHandler(event => pushResult(async () => {
  const user = await platformUser(event), action = getRouterParam(event, 'action'), token = getCookie(event, 'cardshelf_session')!
  const body = await platformBody(event, 4096)
  if (action === 'status') return pushStatus(user.id, token, body)
  if (action === 'unsubscribe') return removePushSubscription(user.id, token, body)
  if (action === 'preferences') return updatePushPreferences(user.id, token, body)
  ensure(action === 'subscribe' || action === 'test', 404, 'Notification action not found.')
  ensure((await pushConfiguration()).available, 503, 'Notifications need CardShelf to use a public HTTPS address.')
  await rateLimit('push:' + action + ':' + user.id, action === 'test' ? 5 : 30)
  if (action === 'subscribe') {
    // A permission dialog may outlive a sign-in change in another tab.
    ensure(body.account_id === user.id, 409, 'Your sign-in changed. Reload before enabling notifications.')
    const { account_id: _account, ...subscription } = body
    return savePushSubscription(user.id, token, subscription)
  }
  return queuePushTest(user.id, token, body)
}))
