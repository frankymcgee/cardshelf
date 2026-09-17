import { defineEventHandler, getCookie, getQuery, sendRedirect, setHeader } from 'h3'
import { platformUser } from '../../../../utils/platform-api'
import { finishSquareAuthorization } from '../../../../../lib/square-connector.mjs'
export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Referrer-Policy', 'no-referrer')
  let result = 'error', environment = ''
  try {
    const user = await platformUser(event, true)
    const response = await finishSquareAuthorization(user.id, getCookie(event, 'cardshelf_session'), getQuery(event))
    result = response.result
    environment = response.environment
  } catch {
    // Do not log/reflect callback query parameters, authorization codes or provider errors.
  }
  return sendRedirect(event, '/admin/integrations/square?result=' + result + (environment ? '&environment=' + environment : ''), 303)
})
