import { defineEventHandler, getHeader } from 'h3'
import { platformResult, platformUser } from '../../../utils/platform-api'
import { AppError, ensure } from '../../../../lib/errors.mjs'
import { uploadSponsorImage } from '../../../../lib/free-accounts.mjs'
export default defineEventHandler(event => platformResult(async () => {
  const user = await platformUser(event, true)
  ensure(getHeader(event, 'content-type')?.split(';')[0] === 'application/json', 415, 'Send JSON image data.')
  let size = 0
  const chunks: Buffer[] = []
  for await (const value of event.node.req) { const chunk = Buffer.from(value); size += chunk.length; ensure(size <= 1500000, 413, 'Image request too large.'); chunks.push(chunk) }
  let input: any
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new AppError(400, 'Invalid JSON image data.') }
  return uploadSponsorImage(user.id, input)
}))
