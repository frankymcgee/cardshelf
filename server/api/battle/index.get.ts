import { battleResult } from '../../utils/battle-api'
import { defineEventHandler, setHeader } from 'h3'
import { platformUser } from '../../utils/platform-api'
import { battleAccess } from '../../../lib/battle/access.mjs'
export default defineEventHandler(event => battleResult(async () => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  return battleAccess((await platformUser(event)).id)
}))
