import { defineEventHandler, getRouterParam } from 'h3'
import { platformUser, platformResult } from '../../utils/platform-api'
import { getCard } from '../../../lib/catalogue.mjs'
import { catalogueForAccess } from '../../../lib/subscription-redaction.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event)
  return catalogueForAccess(await getCard(user.id, getRouterParam(event, 'id')), event.context.subscriptionFeatures)
}))
