import { defineEventHandler, setHeader } from 'h3'
import { platformResult, platformUser } from '../../utils/platform-api'
import { sponsorImage } from '../../../lib/free-accounts.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const content = await sponsorImage(await platformUser(event))
  setHeader(event, 'Content-Type', 'image/webp')
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Vary', 'Cookie')
  return content
}))
