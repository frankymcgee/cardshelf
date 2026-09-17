import { defineEventHandler,getRouterParam,getHeader } from 'h3'
import { platformResult } from '../../../../utils/platform-api'
import { ensure } from '../../../../../lib/errors.mjs'
import { receiveStripeWebhook } from '../../../../../lib/stripe-webhooks.mjs'
export default defineEventHandler(event=>platformResult(async()=>{
  const chunks:Buffer[]=[];let size=0
  for await(const value of event.node.req){const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);size+=bytes.length;ensure(size<=262144,413,'Stripe event is too large.');chunks.push(bytes)}
  return receiveStripeWebhook(getRouterParam(event,'environment'),Buffer.concat(chunks),getHeader(event,'stripe-signature'))
}))
