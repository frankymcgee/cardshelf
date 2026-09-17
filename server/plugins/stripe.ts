import { stripeTick } from '../../lib/stripe-webhooks.mjs'
export default defineNitroPlugin(nitro=>{
  let running:Promise<void>|null=null
  const timer=setInterval(()=>{
    if(running)return
    running=stripeTick().catch(()=>console.error('Stripe reconciliation needs administrator attention.')).finally(()=>{running=null})
  },15000)
  timer.unref()
  nitro.hooks.hook('close',async()=>{clearInterval(timer);await running})
})
