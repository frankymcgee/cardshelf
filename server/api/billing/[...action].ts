import { defineEventHandler } from 'h3'
import { platformUser, platformResult } from '../../utils/platform-api'
import { AppError } from '../../../lib/errors.mjs'
// Retired routes return protected JSON instead of falling into the page renderer.
// Active operations live under /api/billing/stripe/.
export default defineEventHandler(event => platformResult(async () => {
  await platformUser(event)
  throw new AppError(410, 'This billing endpoint has been retired. Use Stripe membership management.')
}))
