import { defineEventHandler,getRouterParam } from 'h3'
import { platformUser,platformBody,platformResult } from '../../../utils/platform-api'
import { AppError } from '../../../../lib/errors.mjs'
import { rateLimit } from '../../../../lib/auth.mjs'
import { stripeAccount,startStripeCheckout,syncStripeSubscription,stripePortal,cancelStripeSubscription } from '../../../../lib/stripe-subscriptions.mjs'
export default defineEventHandler(event=>platformResult(async()=>{
  const user=await platformUser(event),action=getRouterParam(event,'action')||'',parts=action.split('/')
  if(event.method==='GET'&&action==='account')return stripeAccount(user.id)
  if(event.method!=='POST')throw new AppError(404,'Stripe endpoint not found.')
  await rateLimit('stripe-member:'+user.id,20)
  const body=await platformBody(event)
  if(action==='checkout')return startStripeCheckout(user.id,body)
  if(action==='portal')return stripePortal(user.id)
  if(parts.length===2){
    if(parts[1]==='sync')return syncStripeSubscription(parts[0],user.id)
    if(parts[1]==='cancel')return cancelStripeSubscription(user.id,parts[0],body)
  }
  throw new AppError(404,'Stripe endpoint not found.')
}))
