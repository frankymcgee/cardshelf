import { defineEventHandler, getRouterParam } from 'h3'
import { platformResult } from '../../../../../utils/platform-api'
import { publicCatalogueRequest } from '../../../../../utils/public-catalogue-api'
import { publicPrices } from '../../../../../../lib/public-catalogue.mjs'
export default defineEventHandler(event => platformResult(async () => {
  await publicCatalogueRequest(event)
  return publicPrices(getRouterParam(event, 'id'))
}))
