import { defineEventHandler, getRouterParam, getQuery, getCookie } from 'h3'
import { platformUser, platformBody, platformResult } from '../../../../utils/platform-api'
import { rateLimit } from '../../../../../lib/auth.mjs'
import { AppError } from '../../../../../lib/errors.mjs'
import * as square from '../../../../../lib/square-connector.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event, true)
  const action = getRouterParam(event, 'action'), query = getQuery(event)
  if (query.environment !== undefined && typeof query.environment !== 'string') throw new AppError(400, 'Choose one connection environment.')
  const environment = typeof query.environment === 'string' ? query.environment : 'sandbox'
  if (event.method === 'GET') {
    if (action === 'status') return square.connectorStatus(user.id, environment)
    if (action === 'plans') {
      await rateLimit('square-connector-read:' + user.id, 30)
      return square.squarePlanOptions(user.id, environment, typeof query.cursor === 'string' ? query.cursor : '')
    }
  }
  if (event.method === 'POST') {
    await rateLimit('square-connector-write:' + user.id, 20)
    const body = await platformBody(event)
    if (action === 'setup') return square.saveConnectorSetup(user.id, environment, body)
    if (action === 'authorize') return square.beginSquareAuthorization(user.id, getCookie(event, 'cardshelf_session'), environment, body)
    if (action === 'test') return square.testSquareConnection(user.id, environment)
    if (action === 'location') return square.chooseSquareLocation(user.id, environment, body)
    if (action === 'disconnect') return square.disconnectSquare(user.id, environment, body)
  }
  throw new AppError(404, 'Square connector endpoint not found.')
}))
