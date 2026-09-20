import { battleResult } from '../../../utils/battle-api'
import { defineEventHandler, setHeader } from 'h3'
import { platformUser } from '../../../utils/platform-api'
import { arenaSettings } from '../../../../lib/arena/access.mjs'
export default defineEventHandler(event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Vary', 'Cookie')
  return battleResult(async () => {
  await platformUser(event, true)
  return arenaSettings()
  })
})
