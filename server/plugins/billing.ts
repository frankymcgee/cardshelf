import { renewSquareConnections } from '../../lib/square-connector.mjs'
import { billingTick } from '../../lib/billing-worker.mjs'
export default defineNitroPlugin(nitro => {
  let running: Promise<void> | null = null
  let renewal: Promise<void> | null = null
  const renewalTimer = setInterval(() => {
    if (renewal) return
    renewal = renewSquareConnections().catch(() => console.error('Square connector renewal needs administrator attention.')).finally(() => { renewal = null })
  }, 60000)
  renewalTimer.unref()
  const timer = setInterval(() => {
    if (running) return
    running = billingTick().catch(() => console.error('Billing reconciliation failed; review the administrator queue.')).finally(() => { running = null })
  }, 15000)
  timer.unref()
  nitro.hooks.hook('close', async () => { clearInterval(timer); clearInterval(renewalTimer); await Promise.all([running, renewal]) })
})
