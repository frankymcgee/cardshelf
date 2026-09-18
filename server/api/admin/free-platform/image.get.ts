import { defineEventHandler, setHeader } from 'h3'
import { platformUser, platformResult } from '../../../utils/platform-api'
import { db } from '../../../../lib/db.mjs'
import { ensure } from '../../../../lib/errors.mjs'
export default defineEventHandler(event => platformResult(async () => {
  await platformUser(event, true)
  const [row] = await db()`SELECT sponsor_image FROM free_platform_settings WHERE singleton`
  ensure(row?.sponsor_image, 404, 'No sponsor image saved.')
  setHeader(event, 'Content-Type', 'image/webp'); setHeader(event, 'Cache-Control', 'private, no-store'); setHeader(event, 'Vary', 'Cookie')
  return row.sponsor_image
}))
