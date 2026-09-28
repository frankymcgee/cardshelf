import { pushOutboxTick } from '../../lib/push.mjs'
export default defineNitroPlugin(nitro => {
  if (process.env.PUSH_WORKER_ENABLED === 'false') return
  let running: Promise<void> | null = null
  const timer = setInterval(() => {
    if (running) return
    running = pushOutboxTick().catch(() => console.error('CardShelf push queue needs administrator attention.')).finally(() => { running = null })
  }, 5000)
  timer.unref()
  nitro.hooks.hook('close', async () => { clearInterval(timer); await running })
})
