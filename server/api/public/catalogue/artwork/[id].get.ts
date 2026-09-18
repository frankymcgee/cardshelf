import { defineEventHandler, getRouterParam, setHeader } from 'h3'
import { platformResult } from '../../../../utils/platform-api'
import { catalogueArtwork } from '../../../../../lib/public-catalogue.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const content = await catalogueArtwork(getRouterParam(event, 'id'))
  setHeader(event, 'Content-Type', 'image/webp')
  setHeader(event, 'Cache-Control', 'public, max-age=86400, immutable')
  return content
}))
