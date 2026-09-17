import { stripeProductTick } from '../../lib/stripe-product-sync.mjs'
export default defineNitroPlugin(nitro => {
  let running: Promise<void> | null = null
  const timer = setInterval(() => {
    if (running) return
    running = stripeProductTick()
      .catch(() => console.error('Stripe product-sync scheduler needs administrator attention.'))
      .finally(() => { running = null })
  }, 60000)
  timer.unref()
  nitro.hooks.hook('close', async () => { clearInterval(timer); await running })
})
