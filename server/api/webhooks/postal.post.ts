import { defineEventHandler,getHeader } from 'h3'
import { emailResult } from '../../utils/email-api'
import { ensure } from '../../../lib/errors.mjs'
import { POSTAL_WEBHOOK_LIMIT,receivePostalWebhook } from '../../../lib/postal-webhooks.mjs'
export default defineEventHandler(event=>emailResult(async()=>{
  ensure(getHeader(event,'content-type')?.split(';')[0]?.trim()==='application/json',415,'Send an application/json Postal event.')
  ensure(!getHeader(event,'content-encoding'),415,'Encoded Postal event bodies are not supported.')
  const chunks:Buffer[]=[];let size=0
  for await(const value of event.node.req){const chunk=Buffer.isBuffer(value)?value:Buffer.from(value);size+=chunk.length;ensure(size<=POSTAL_WEBHOOK_LIMIT,413,'Postal event body is too large.');chunks.push(chunk)}
  return receivePostalWebhook(Buffer.concat(chunks),getHeader(event,'x-postal-signature-256'))
}))
