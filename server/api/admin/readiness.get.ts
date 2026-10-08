import { defineEventHandler, setHeader } from 'h3'
import { platformUser, platformResult } from '../../utils/platform-api'
import { productionReadiness } from '../../../lib/release-readiness.mjs'
export default defineEventHandler(event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Vary', 'Cookie')
  return platformResult(async () => productionReadiness((await platformUser(event, true)).id))
})
