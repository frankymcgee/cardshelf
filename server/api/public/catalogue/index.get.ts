import { defineEventHandler, getQuery } from 'h3'
import { platformResult } from '../../../utils/platform-api'
import { publicCatalogueRequest } from '../../../utils/public-catalogue-api'
import { publicCatalogue } from '../../../../lib/public-catalogue.mjs'
export default defineEventHandler(event => platformResult(async () => {
  await publicCatalogueRequest(event)
  return publicCatalogue(getQuery(event))
}))
