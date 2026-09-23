import { defineEventHandler, getRouterParam } from 'h3'
import { platformBody, platformUser } from '../../../utils/platform-api'
import { cardScanResult } from '../../../utils/card-scan-api'
import { confirmCardScan, undoCardScan } from '../../../../lib/card-scans.mjs'
import { scanObject } from '../../../../lib/card-scan-logic.mjs'
import { ensure } from '../../../../lib/errors.mjs'
export default defineEventHandler(event => cardScanResult(async () => {
  const user = await platformUser(event), id = getRouterParam(event, 'id'), action = getRouterParam(event, 'action')
  const body = await platformBody(event, 4096)
  if (action === 'confirm') return confirmCardScan(user.id, id, body)
  ensure(action === 'undo', 404, 'Scanning action not found.')
  ensure(scanObject(body, ['confirm']).confirm === true, 400, 'Confirm undoing this addition.')
  return undoCardScan(user.id, id)
}))
