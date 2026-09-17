import { defineEventHandler, getQuery } from 'h3'
import { platformUser, platformResult } from '../../utils/platform-api'
import { catalogueCards } from '../../../lib/catalogue.mjs'
import { catalogueForAccess } from '../../../lib/subscription-redaction.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event)
  return catalogueForAccess(await catalogueCards(user.id, getQuery(event)), event.context.subscriptionFeatures)
}))
