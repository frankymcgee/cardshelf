import { defineEventHandler,getQuery,getRouterParam } from 'h3'
import { platformUser,platformBody,platformResult } from '../../../../utils/platform-api'
import { AppError } from '../../../../../lib/errors.mjs'
import { rateLimit } from '../../../../../lib/auth.mjs'
import { db,audit } from '../../../../../lib/db.mjs'
import { stripeEnvironment,stripeId } from '../../../../../lib/stripe-logic.mjs'
import { stripeStatus,saveStripeConnection,testStripeConnection,stripeCatalogue,saveStripeOffer,publishStripeOffer } from '../../../../../lib/stripe-connection.mjs'
import { syncStripeSubscription,cancelStripeSubscription } from '../../../../../lib/stripe-subscriptions.mjs'
export default defineEventHandler(event=>platformResult(async()=>{
  const user=await platformUser(event,true),query=getQuery(event),environment=stripeEnvironment(query.environment||'sandbox')
  const action=getRouterParam(event,'action')||'',p=action.split('/')
  if(event.method==='GET'){
    if(action==='status')return stripeStatus(user.id,environment)
    if(action==='prices'){await rateLimit('stripe-catalogue:'+user.id,30);return stripeCatalogue(user.id,environment,query)}
  }
  if(event.method!=='POST')throw new AppError(404,'Stripe administration endpoint not found.')
  await rateLimit('stripe-admin:'+user.id,30)
  const body=await platformBody(event)
  if(action==='settings')return saveStripeConnection(user.id,environment,body)
  if(action==='test')return testStripeConnection(user.id,environment)
  if(action==='offers')return saveStripeOffer(user.id,environment,body)
  if(p.length===2&&p[0]==='offers')return publishStripeOffer(user.id,environment,p[1],body)
  if(p.length===2&&p[0]==='events'){
    const id=stripeId(p[1],'evt')
    await db()`UPDATE stripe_webhook_events SET status='queued',attempts=0,next_attempt_at=now(),last_error='' WHERE environment=${environment} AND event_id=${id}`
    await audit(db(),user.id,'stripe.webhook_retry',{environment,event_id:id});return {queued:true}
  }
  if(p.length===3&&p[0]==='subscriptions'){
    if(p[2]==='sync')return syncStripeSubscription(p[1])
    if(p[2]==='cancel')return cancelStripeSubscription(user.id,p[1],body,true)
  }
  throw new AppError(404,'Stripe administration endpoint not found.')
}))
