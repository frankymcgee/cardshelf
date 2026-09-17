import { defineEventHandler, getHeader } from 'h3'
import { ensure } from '../../../../lib/errors.mjs'
import { receiveSquareWebhook } from '../../../../lib/square-webhooks.mjs'
import { platformResult } from '../../../utils/platform-api'
export default defineEventHandler(event => platformResult(async () => {
  const chunks: Buffer[] = []; let size = 0
  for await (const value of event.node.req) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    size += chunk.length; ensure(size <= 262144, 413, 'Webhook body is too large.')
    chunks.push(chunk)
  }
  return receiveSquareWebhook(Buffer.concat(chunks), getHeader(event, 'x-square-hmacsha256-signature'))
}))
