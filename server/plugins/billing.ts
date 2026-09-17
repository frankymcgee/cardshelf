import { billingTick } from '../../lib/billing-worker.mjs'
export default defineNitroPlugin(nitro => {
  let running: Promise<void> | null = null
  const timer = setInterval(() => {
    if (running) return
    running = billingTick().catch(() => console.error('Billing reconciliation failed; review the administrator queue.')).finally(() => { running = null })
  }, 15000)
  timer.unref()
  nitro.hooks.hook('close', async () => { clearInterval(timer); await running })
})
