import { battleResult } from '../../../utils/battle-api'
import { defineEventHandler, getQuery, setHeader } from 'h3'
import { platformUser } from '../../../utils/platform-api'
import { battleAdministration } from '../../../../lib/battle/access.mjs'
export default defineEventHandler(event => battleResult(async () => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const user = await platformUser(event, true), q = getQuery(event).q
  return battleAdministration(user.id, typeof q === 'string' ? q : '')
}))
